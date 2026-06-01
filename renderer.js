const els = {
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  prompt: document.getElementById("prompt"),
  sendButton: document.getElementById("sendButton"),
  attachButton: document.getElementById("attachButton"),
  fileInput: document.getElementById("fileInput"),
  attachments: document.getElementById("attachments"),
  toolbarShotButton: document.getElementById("toolbarShotButton"),
  toolbarClearButton: document.getElementById("toolbarClearButton"),
  toolbarDeleteConversation: document.getElementById("toolbarDeleteConversation"),
  toolbarSettings: document.getElementById("toolbarSettings"),
  toolbarNewWindow: document.getElementById("toolbarNewWindow"),
  compactButton: document.getElementById("compactButton"),
  pinButton: document.getElementById("pinButton"),
  toolbarState: document.getElementById("toolbarState"),
  conversationTitle: document.getElementById("conversationTitle"),
  providerSummary: document.getElementById("providerSummary"),
  keyState: document.getElementById("keyState"),
  conversationList: document.getElementById("conversationList"),
  newConversation: document.getElementById("newConversation")
};

const STORAGE_KEY = "deskchat.settings.v1";
const MAX_TOOL_STEPS = 6;

let pendingImages = [];
let chatMessages = [];
let busy = false;
let isApplyingConversationUpdate = false;
let conversations = [];
let currentConversationId = null;
let windowState = { compact: false, pinned: false };
let currentSettings = {
  provider: "openai",
  providerName: "OpenAI",
  baseUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-5.5",
  enableTools: true,
  supportsVision: true,
  systemPrompt:
    "你是一个运行在用户电脑上的桌面 AI 助手。你可以分析用户上传的图片和截图，也可以在用户明确要求时调用工具执行命令、移动鼠标或点击。调用命令和鼠标工具前先简短说明意图。"
};

const tools = [
  {
    type: "function",
    function: {
      name: "take_screenshot",
      description: "Capture the user's primary screen and return an image for visual analysis.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command on the user's computer. Use only after the user asks for command-line help.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to run." },
          timeout: { type: "number", description: "Timeout in milliseconds. Defaults to 30000." }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_mouse",
      description: "Move the mouse cursor to screen coordinates.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" }
        },
        required: ["x", "y"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_mouse",
      description: "Click at screen coordinates.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          button: { type: "string", enum: ["left", "right"] }
        },
        required: ["x", "y"],
        additionalProperties: false
      }
    }
  }
];

function activeConversation() {
  return conversations.find((conversation) => conversation.id === currentConversationId) || conversations[0] || null;
}

function titleFromMessages(messages) {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return "新对话";
  let text = typeof firstUser.content === "string" ? firstUser.content : "";
  if (Array.isArray(firstUser.content)) {
    const textPart = firstUser.content.find((part) => part.type === "text");
    text = textPart ? textPart.text : "图片对话";
  }
  text = String(text || "图片对话").replace(/\s+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
}

async function persistCurrentConversation() {
  if (!currentConversationId || isApplyingConversationUpdate) return;
  const conversation = activeConversation();
  const title = conversation && conversation.title && conversation.title !== "新对话" ? conversation.title : titleFromMessages(chatMessages);
  await window.deskchat.saveConversation({
    id: currentConversationId,
    title,
    messages: chatMessages
  });
}

function updateSettingsSummary() {
  const providerName = currentSettings.name || currentSettings.providerName || currentSettings.provider || "Custom";
  els.providerSummary.textContent = `${providerName} / ${currentSettings.model || "未选择模型"}`;
  const keyText = currentSettings.apiKey ? "API Key 已保存" : "未配置 API Key";
  const visionText = currentSettings.supportsVision ? "支持图片" : "仅文本";
  els.keyState.textContent = `${keyText} / ${visionText}`;
}

function applyWindowState(next) {
  windowState = { ...windowState, ...next };
  document.body.classList.toggle("compact-mode", windowState.compact);
  document.body.classList.toggle("pinned-mode", windowState.pinned);
  els.compactButton.textContent = windowState.compact ? "恢复窗口" : "长条模式";
  els.pinButton.textContent = windowState.pinned ? "取消置顶" : "置顶";
  const modeText = windowState.compact ? "长条模式" : "标准模式";
  const pinText = windowState.pinned ? " / 已置顶" : "";
  els.toolbarState.textContent = `${modeText}${pinText}`;
}

async function migrateLegacySettings() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw || currentSettings.apiKey) return;

  try {
    const legacy = JSON.parse(raw);
    if (legacy.apiKey || legacy.baseUrl || legacy.model) {
      currentSettings = await window.deskchat.saveSettings({
        ...currentSettings,
        ...legacy,
        provider: "custom",
        providerName: "兼容接口",
        name: "兼容接口"
      });
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

async function loadSettings() {
  currentSettings = await window.deskchat.getSettings();
  await migrateLegacySettings();
  updateSettingsSummary();
}

function renderConversationList() {
  const current = activeConversation();
  els.conversationList.innerHTML = "";
  for (const conversation of conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    button.classList.toggle("active", conversation.id === currentConversationId);
    button.dataset.conversationId = conversation.id;
    button.textContent = conversation.title || "新对话";
    button.addEventListener("click", async () => {
      if (conversation.id === currentConversationId) return;
      currentConversationId = conversation.id;
      const store = await window.deskchat.getConversations();
      applyConversationStore(store, currentConversationId);
    });
    els.conversationList.appendChild(button);
  }
  if (current) {
    els.conversationTitle.textContent = current.title || "Deskchat";
  } else {
    els.conversationTitle.textContent = "Deskchat";
  }
  els.toolbarDeleteConversation.disabled = conversations.length <= 1;
}

function renderEmpty() {
  if (chatMessages.length) return;
  els.messages.innerHTML =
    '<div class="empty">配置 API 后即可开始对话。可以上传图片，也可以直接说“看看我在做什么”，模型会先截图再分析。</div>';
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\\\[(.+?)\\\]/g, '<span class="math-block">$1</span>');
  html = html.replace(/\\\((.+?)\\\)/g, '<span class="math-inline">$1</span>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function appendParagraph(parts, html) {
  if (!parts.length) return;
  html.push(`<p>${renderInline(parts.join(" "))}</p>`);
  parts.length = 0;
}

function renderRichText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const html = [];
  const paragraph = [];
  let inCode = false;
  let codeLines = [];
  let listType = null;
  let listItems = [];

  function flushList() {
    if (!listType) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        appendParagraph(paragraph, html);
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      appendParagraph(paragraph, html);
      flushList();
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      appendParagraph(paragraph, html);
      flushList();
      html.push("<hr>");
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      appendParagraph(paragraph, html);
      flushList();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      appendParagraph(paragraph, html);
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(bullet[1]);
      continue;
    }

    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      appendParagraph(paragraph, html);
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  appendParagraph(paragraph, html);
  flushList();
  return html.join("");
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textPart = content.find((part) => part.type === "text");
    return textPart ? textPart.text : "";
  }
  return "";
}

function extractImages(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part.type === "image_url" && part.image_url && part.image_url.url).map((part) => part.image_url.url);
}

function addMessage(role, text, images = []) {
  if (!chatMessages.length) els.messages.innerHTML = "";

  const wrap = document.createElement("article");
  wrap.className = `message ${role}`;

  if (images.length) {
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    for (const image of images) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "attachment";
      thumbs.appendChild(img);
    }
    wrap.appendChild(thumbs);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "assistant") {
    bubble.classList.add("rich");
    bubble.innerHTML = renderRichText(text || "");
  } else {
    bubble.textContent = text || "";
  }
  wrap.appendChild(bubble);
  els.messages.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

function renderMessages() {
  els.messages.innerHTML = "";
  for (const message of chatMessages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      addMessage("tool", extractTextContent(message.content));
      continue;
    }
    if (message.role === "assistant" && message.tool_calls) {
      if (message.content) addMessage("assistant", message.content);
      continue;
    }
    addMessage(message.role, extractTextContent(message.content), extractImages(message.content));
  }
  renderEmpty();
}

function applyConversationStore(store, preferredId) {
  isApplyingConversationUpdate = true;
  conversations = Array.isArray(store.conversations) ? store.conversations : [];
  const urlId = new URLSearchParams(window.location.search).get("conversationId");
  currentConversationId =
    preferredId ||
    (currentConversationId && conversations.some((conversation) => conversation.id === currentConversationId) ? currentConversationId : null) ||
    (urlId && conversations.some((conversation) => conversation.id === urlId) ? urlId : null) ||
    store.activeConversationId ||
    (conversations[0] && conversations[0].id) ||
    null;

  const current = activeConversation();
  chatMessages = current ? [...current.messages] : [];
  renderConversationList();
  renderMessages();
  isApplyingConversationUpdate = false;
}

async function loadConversations() {
  const store = await window.deskchat.getConversations();
  applyConversationStore(store);
}

function renderAttachments() {
  els.attachments.innerHTML = "";
  for (const [index, dataUrl] of pendingImages.entries()) {
    const item = document.createElement("div");
    item.className = "attachment";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "pending attachment";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      pendingImages.splice(index, 1);
      renderAttachments();
    });
    item.append(img, remove);
    els.attachments.appendChild(item);
  }
}

async function filesToImages(files) {
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dataUrl = await window.deskchat.imageFromBuffer(bytes);
    pendingImages.push(dataUrl);
  }
  renderAttachments();
}

function imagePart(dataUrl) {
  return { type: "image_url", image_url: { url: dataUrl } };
}

function userContent(text, images) {
  if (!images.length) return text;
  return [{ type: "text", text: text || "请分析这些图片。" }, ...images.map(imagePart)];
}

function getSettings() {
  return currentSettings;
}

function normalizeChatCompletionsUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  if (!/\/v\d+(\/|$)/.test(trimmed)) return `${trimmed}/v1/chat/completions`;
  return trimmed;
}

async function callModel(messages) {
  const settings = getSettings();
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error("请先填写 API 地址、API Key 和模型名。");
  }

  const body = {
    model: settings.model,
    messages,
    temperature: 0.7
  };

  if (settings.enableTools) {
    body.tools = settings.supportsVision ? tools : tools.filter((tool) => tool.function.name !== "take_screenshot");
    body.tool_choice = "auto";
  }

  const response = await fetch(normalizeChatCompletionsUrl(settings.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("API 请求失败：404。通常是 API 地址没有指向 /v1/chat/completions，或中转站不支持填写的模型名。");
    }
    throw new Error(payload.error && payload.error.message ? payload.error.message : `API 请求失败：${response.status}`);
  }

  const message = payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!message) throw new Error("API 没有返回可用消息。");
  return message;
}

function parseArgs(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function executeToolCall(call) {
  const name = call.function.name;
  const args = parseArgs(call.function.arguments);
  addMessage("tool", `tool: ${name}\n${JSON.stringify(args, null, 2)}`);

  if (name === "take_screenshot") {
    const shot = await window.deskchat.screenshot();
    addMessage("tool", `已截图：${shot.width}x${shot.height} ${shot.sourceName}`, [shot.dataUrl]);
    if (!getSettings().supportsVision) {
      return {
        toolMessage: {
          role: "tool",
          tool_call_id: call.id,
          content: "Screenshot captured, but the current API configuration is text-only and cannot receive images."
        }
      };
    }

    return {
      toolMessage: {
        role: "tool",
        tool_call_id: call.id,
        content: `Screenshot captured: ${shot.width}x${shot.height}, source ${shot.sourceName}. The image is attached in the next user message.`
      },
      followUpMessage: {
        role: "user",
        content: [{ type: "text", text: "这是刚刚通过截图工具获得的屏幕截图，请基于它继续回答。" }, imagePart(shot.dataUrl)]
      }
    };
  }

  if (name === "run_command") {
    const result = await window.deskchat.runCommand(args);
    const shown = JSON.stringify(result, null, 2).slice(0, 6000);
    addMessage("tool", shown);
    return { toolMessage: { role: "tool", tool_call_id: call.id, content: shown } };
  }

  if (name === "move_mouse") {
    const result = await window.deskchat.moveMouse(args);
    addMessage("tool", JSON.stringify(result, null, 2));
    return { toolMessage: { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) } };
  }

  if (name === "click_mouse") {
    const result = await window.deskchat.clickMouse(args);
    addMessage("tool", JSON.stringify(result, null, 2));
    return { toolMessage: { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) } };
  }

  return { toolMessage: { role: "tool", tool_call_id: call.id, content: `Unknown tool: ${name}` } };
}

async function sendMessage(text, images = []) {
  if (busy) return;
  busy = true;
  els.sendButton.disabled = true;

  try {
    if (images.length && !getSettings().supportsVision) {
      addMessage(
        "assistant",
        "当前 API 配置是“仅文本”，不能发送图片或截图。请在 API 配置里开启“支持图片输入”，或切换到支持视觉的模型/中转站。"
      );
      return;
    }

    addMessage("user", text || "请分析图片。", images);
    chatMessages.push({ role: "user", content: userContent(text, images) });
    await persistCurrentConversation();

    const settings = getSettings();
    const capabilityPrompt = settings.supportsVision
      ? ""
      : "\n\n当前 API 配置不支持图片输入。不要尝试截图分析或要求发送 image_url；如果用户要求看屏幕，请告诉用户需要切换到支持视觉的模型或中转站。";
    const formatPrompt =
      "\n\n回答数学、代码或长解释时，请使用清晰的 Markdown：用小标题、短段落、项目列表和必要的公式分块。不要把整段推理挤成一整块。";
    let apiMessages = [{ role: "system", content: `${settings.systemPrompt}${capabilityPrompt}${formatPrompt}` }, ...chatMessages];
    let finalText = "";

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      const assistantMessage = await callModel(apiMessages);
      apiMessages.push(assistantMessage);

      if (!assistantMessage.tool_calls || !assistantMessage.tool_calls.length) {
        finalText = assistantMessage.content || "";
        chatMessages.push({ role: "assistant", content: finalText });
        addMessage("assistant", finalText || "完成。");
        break;
      }

      if (assistantMessage.content) {
        addMessage("assistant", assistantMessage.content);
      }

      for (const toolCall of assistantMessage.tool_calls) {
        const toolResult = await executeToolCall(toolCall);
        apiMessages.push(toolResult.toolMessage);
        if (toolResult.followUpMessage) apiMessages.push(toolResult.followUpMessage);
      }
    }

    if (!finalText) {
      addMessage("assistant", "工具步骤已达到上限，请继续发送一句话让我接着处理。");
    }

    chatMessages = apiMessages.slice(1);
    await persistCurrentConversation();
  } catch (error) {
    addMessage("assistant", `出错了：${error.message}`);
    chatMessages.push({ role: "assistant", content: `出错了：${error.message}` });
    await persistCurrentConversation();
  } finally {
    busy = false;
    els.sendButton.disabled = false;
  }
}

async function captureToAttachments() {
  try {
    const shot = await window.deskchat.screenshot();
    pendingImages.push(shot.dataUrl);
    renderAttachments();
  } catch (error) {
    addMessage("assistant", `截图失败：${error.message}`);
  }
}

els.toolbarSettings.addEventListener("click", () => window.deskchat.openSettings());
els.toolbarNewWindow.addEventListener("click", () => window.deskchat.openChatWindow(currentConversationId));
els.compactButton.addEventListener("click", async () => {
  applyWindowState(await window.deskchat.setCompactMode(!windowState.compact));
});
els.pinButton.addEventListener("click", async () => {
  applyWindowState(await window.deskchat.setPinnedMode(!windowState.pinned));
});
els.newConversation.addEventListener("click", async () => {
  const conversation = await window.deskchat.createConversation("新对话");
  const store = await window.deskchat.getConversations();
  applyConversationStore(store, conversation.id);
});
els.toolbarDeleteConversation.addEventListener("click", async () => {
  if (!currentConversationId || conversations.length <= 1) return;
  const store = await window.deskchat.deleteConversation(currentConversationId);
  applyConversationStore(store);
});
window.deskchat.onWindowState(applyWindowState);
window.deskchat.onSettingsUpdated((settings) => {
  currentSettings = settings;
  updateSettingsSummary();
});
window.deskchat.onConversationsUpdated((store) => {
  applyConversationStore(store, currentConversationId);
});
els.attachButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async (event) => {
  await filesToImages(Array.from(event.target.files || []));
  els.fileInput.value = "";
});

els.toolbarShotButton.addEventListener("click", captureToAttachments);

els.toolbarClearButton.addEventListener("click", async () => {
  chatMessages = [];
  pendingImages = [];
  els.messages.innerHTML = "";
  renderAttachments();
  renderEmpty();
  await persistCurrentConversation();
});

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.prompt.value.trim();
  const images = [...pendingImages];
  if (!text && !images.length) return;
  els.prompt.value = "";
  pendingImages = [];
  renderAttachments();
  await sendMessage(text, images);
});

els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

loadSettings().catch((error) => {
  addMessage("assistant", `读取设置失败：${error.message}`);
});
loadConversations().catch((error) => {
  addMessage("assistant", `读取历史对话失败：${error.message}`);
});
window.deskchat.getWindowState().then(applyWindowState).catch(() => {});
renderEmpty();

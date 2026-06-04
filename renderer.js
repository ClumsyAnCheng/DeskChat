const els = {
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  prompt: document.getElementById("prompt"),
  sendButton: document.getElementById("sendButton"),
  attachButton: document.getElementById("attachButton"),
  fileInput: document.getElementById("fileInput"),
  knowledgeFileInput: document.getElementById("knowledgeFileInput"),
  attachments: document.getElementById("attachments"),
  toolbarShotButton: document.getElementById("toolbarShotButton"),
  toolbarClearButton: document.getElementById("toolbarClearButton"),
  toolbarDeleteConversation: document.getElementById("toolbarDeleteConversation"),
  toolbarSettings: document.getElementById("toolbarSettings"),
  toolbarUploadKnowledge: document.getElementById("toolbarUploadKnowledge"),
  toolbarLinkKnowledge: document.getElementById("toolbarLinkKnowledge"),
  toolbarNewWindow: document.getElementById("toolbarNewWindow"),
  compactButton: document.getElementById("compactButton"),
  pinButton: document.getElementById("pinButton"),
  toolbarState: document.getElementById("toolbarState"),
  conversationTitle: document.getElementById("conversationTitle"),
  knowledgeSummary: document.getElementById("knowledgeSummary"),
  providerSummary: document.getElementById("providerSummary"),
  keyState: document.getElementById("keyState"),
  knowledgeList: document.getElementById("knowledgeList"),
  knowledgeSearchInput: document.getElementById("knowledgeSearchInput"),
  knowledgeSearchResults: document.getElementById("knowledgeSearchResults"),
  conversationList: document.getElementById("conversationList"),
  newConversation: document.getElementById("newConversation"),
  newKnowledgeBase: document.getElementById("newKnowledgeBase"),
  clearKnowledgeSelection: document.getElementById("clearKnowledgeSelection")
};

const STORAGE_KEY = "deskchat.settings.v1";
const MAX_TOOL_STEPS = 6;
const KNOWLEDGE_FILE_LIMIT_BYTES = 1024 * 1024 * 1024;

let pendingImages = [];
let chatMessages = [];
let busy = false;
let isApplyingConversationUpdate = false;
let conversations = [];
let knowledgeBases = [];
let currentConversationId = null;
let activeKnowledgeBaseId = null;
let editingItem = null;
let knowledgePickerOpen = false;
let activeMenuGroup = null;
let mindMapPanel = null;
let activeMindMap = null;
let knowledgeGraphPanel = null;
let activeKnowledgeGraphSimulation = null;
let windowState = { compact: false, pinned: false };
let currentSettings = { ...window.DeskchatConfig.DEFAULT_SETTINGS };

function activeConversation() {
  return conversations.find((conversation) => conversation.id === currentConversationId) || conversations[0] || null;
}

function activeKnowledgeBase() {
  return knowledgeBases.find((base) => base.id === activeKnowledgeBaseId) || null;
}

function knowledgeBaseForConversation(conversationId) {
  return knowledgeBases.find((base) => Array.isArray(base.conversationIds) && base.conversationIds.includes(conversationId)) || null;
}

function conversationById(id) {
  return conversations.find((conversation) => conversation.id === id) || null;
}

function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function formatFileSize(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function startEditing(type, id) {
  editingItem = { type, id };
  renderConversationList();
  window.requestAnimationFrame(() => {
    const input = document.querySelector(`[data-editor-for="${type}:${id}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function stopEditing() {
  editingItem = null;
  renderConversationList();
}

function isEditing(type, id) {
  return Boolean(editingItem && editingItem.type === type && editingItem.id === id);
}

function editableNameInput(type, id, value, onSave) {
  const input = document.createElement("input");
  input.className = "inline-name-input";
  input.type = "text";
  input.value = value || "";
  input.dataset.editorFor = `${type}:${id}`;

  async function commit() {
    const next = input.value.trim();
    if (next && next !== value) await onSave(next);
    editingItem = null;
    renderConversationList();
  }

  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      stopEditing();
    }
  });
  input.addEventListener("blur", commit);
  return input;
}

async function renameKnowledgeBase(id, name) {
  await window.deskchat.saveKnowledgeBase({ id, name, active: activeKnowledgeBaseId === id });
}

async function renameConversation(id, title) {
  const conversation = conversationById(id);
  if (!conversation) return;
  await window.deskchat.saveConversation({
    ...conversation,
    id,
    title,
    messages: Array.isArray(conversation.messages) ? conversation.messages : []
  });
}

async function ensureConversationForActiveKnowledgeBase() {
  const base = activeKnowledgeBase();
  if (!base) return;
  if (currentConversationId && base.conversationIds.includes(currentConversationId)) return;

  const conversation = await window.deskchat.createConversation("新对话");
  await window.deskchat.linkConversationToKnowledgeBase(base.id, conversation.id);
  activeKnowledgeBaseId = base.id;
  const conversationStore = await window.deskchat.getConversations();
  applyConversationStore(conversationStore, conversation.id);
  await loadKnowledgeBases(base.id);
}

function closeKnowledgePicker() {
  knowledgePickerOpen = false;
  const existing = document.querySelector(".knowledge-picker");
  if (existing) existing.remove();
}

function closeMindMapPanel() {
  if (activeMindMap && typeof activeMindMap.destroy === "function") activeMindMap.destroy();
  activeMindMap = null;
  if (mindMapPanel) mindMapPanel.remove();
  mindMapPanel = null;
}

function closeKnowledgeGraphPanel() {
  if (activeKnowledgeGraphSimulation && typeof activeKnowledgeGraphSimulation.stop === "function") {
    activeKnowledgeGraphSimulation.stop();
  }
  activeKnowledgeGraphSimulation = null;
  if (knowledgeGraphPanel) knowledgeGraphPanel.remove();
  knowledgeGraphPanel = null;
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function openMindMapPanel(knowledgeBaseId, fileId) {
  closeMindMapPanel();
  const result = await window.deskchat.getKnowledgeMindMap(knowledgeBaseId, fileId);
  if (!result || !result.ok) {
    addMessage("assistant", result && result.error ? result.error : "思维导图生成失败。");
    return;
  }

  mindMapPanel = document.createElement("section");
  mindMapPanel.className = "mindmap-panel";
  mindMapPanel.innerHTML = `
    <header class="mindmap-header">
      <div>
        <strong>${escapeHtml(result.fileName)}</strong>
        <span>${escapeHtml(result.knowledgeBaseName)} / 文件思维导图</span>
      </div>
      <div class="mindmap-actions">
        <button type="button" data-action="download-md">导出 Markdown</button>
        <button type="button" data-action="fit">适配</button>
        <button type="button" data-action="close">关闭</button>
      </div>
    </header>
    <div class="mindmap-canvas-wrap">
      <svg class="mindmap-canvas"></svg>
    </div>
  `;
  document.body.appendChild(mindMapPanel);

  const svg = mindMapPanel.querySelector(".mindmap-canvas");
  const Markmap = window.markmap && window.markmap.Markmap;
  if (!Markmap) {
    addMessage("assistant", "思维导图库加载失败，请重新启动应用后再试。");
    closeMindMapPanel();
    return;
  }

  try {
    activeMindMap = Markmap.create(svg, {
      autoFit: true,
      colorFreezeLevel: 2,
      duration: 220,
      maxWidth: 360
    }, result.root);
  } catch (error) {
    addMessage("assistant", `思维导图渲染失败：${error.message}`);
    closeMindMapPanel();
    return;
  }

  mindMapPanel.querySelector('[data-action="close"]').addEventListener("click", closeMindMapPanel);
  mindMapPanel.querySelector('[data-action="fit"]').addEventListener("click", () => activeMindMap && activeMindMap.fit());
  mindMapPanel.querySelector('[data-action="download-md"]').addEventListener("click", () => {
    const filename = `${result.fileName.replace(/\.[^.]+$/, "") || "mindmap"}.md`;
    downloadText(filename, result.markdown, "text/markdown");
  });
}

function renderKnowledgeGraph(panel, result) {
  const d3 = window.d3;
  const graph = result.graph || { nodes: [], links: [] };
  const svg = panel.querySelector(".knowledge-graph-canvas");
  const detail = panel.querySelector(".knowledge-graph-detail");
  const width = Math.max(720, svg.clientWidth || 900);
  const height = Math.max(480, svg.clientHeight || 620);
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const links = graph.links.map((link) => ({ ...link }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  function neighborsOf(id) {
    const ids = new Set([id]);
    for (const link of links) {
      const source = typeof link.source === "object" ? link.source.id : link.source;
      const target = typeof link.target === "object" ? link.target.id : link.target;
      if (source === id) ids.add(target);
      if (target === id) ids.add(source);
    }
    return ids;
  }

  function nodeRadius(node) {
    if (node.type === "root") return 34;
    if (node.type === "section" || node.type === "chapter") return 24;
    return 12;
  }

  function nodeColor(node) {
    if (node.type === "root") return "#10b981";
    if (node.type === "section" || node.type === "chapter") return "#64748b";
    if (node.type === "entity") return "#f97316";
    return "#2563eb";
  }

  function showDetail(node) {
    const linked = Array.from(neighborsOf(node.id))
      .filter((id) => id !== node.id)
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .slice(0, 12);
    detail.innerHTML = `
      <div class="knowledge-graph-detail-type">${escapeHtml(node.type || "concept")}</div>
      <h3>${escapeHtml(node.title || node.label || node.id)}</h3>
      <p>${escapeHtml(node.detail || node.description || "No detail returned by RAGFlow yet.")}</p>
      <strong>Related</strong>
      <ul>${linked.map((item) => `<li>${escapeHtml(item.title || item.label || item.id)}</li>`).join("") || "<li>None</li>"}</ul>
    `;
    const neighborIds = neighborsOf(node.id);
    panel.querySelectorAll(".knowledge-graph-node").forEach((item) => {
      item.classList.toggle("muted", !neighborIds.has(item.dataset.nodeId));
      item.classList.toggle("selected", item.dataset.nodeId === node.id);
    });
    panel.querySelectorAll(".knowledge-graph-link").forEach((item) => {
      item.classList.toggle("muted", item.dataset.source !== node.id && item.dataset.target !== node.id);
    });
  }

  d3.select(svg).selectAll("*").remove();
  const root = d3.select(svg).attr("viewBox", [-width / 2, -height / 2, width, height]);
  const zoomLayer = root.append("g");
  root.call(d3.zoom().scaleExtent([0.25, 4]).on("zoom", (event) => zoomLayer.attr("transform", event.transform)));

  const link = zoomLayer
    .append("g")
    .attr("stroke", "#cbd5e1")
    .attr("stroke-opacity", 0.8)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "knowledge-graph-link")
    .attr("data-source", (item) => item.source)
    .attr("data-target", (item) => item.target);

  const node = zoomLayer
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "knowledge-graph-node")
    .attr("data-node-id", (item) => item.id)
    .on("click", (_event, item) => showDetail(item))
    .call(d3.drag()
      .on("start", (event) => {
        if (!event.active) activeKnowledgeGraphSimulation.alphaTarget(0.25).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on("end", (event) => {
        if (!event.active) activeKnowledgeGraphSimulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }));

  node.append("circle")
    .attr("r", nodeRadius)
    .attr("fill", nodeColor)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 3);

  node.append("text")
    .attr("class", "knowledge-graph-label")
    .attr("dy", (item) => nodeRadius(item) + 15)
    .text((item) => item.label || item.title || item.id);

  activeKnowledgeGraphSimulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((item) => item.id).distance((item) => (item.source.type === "root" ? 150 : 92)))
    .force("charge", d3.forceManyBody().strength(-420))
    .force("center", d3.forceCenter(0, 0))
    .force("collision", d3.forceCollide().radius((item) => nodeRadius(item) + 28))
    .on("tick", () => {
      link
        .attr("x1", (item) => item.source.x)
        .attr("y1", (item) => item.source.y)
        .attr("x2", (item) => item.target.x)
        .attr("y2", (item) => item.target.y);
      node.attr("transform", (item) => `translate(${item.x},${item.y})`);
    });

  if (nodes[0]) showDetail(nodes[0]);
  panel.querySelector('[data-action="download-json"]').addEventListener("click", () => {
    const filename = `${result.fileName.replace(/\.[^.]+$/, "") || "knowledge-graph"}.json`;
    downloadText(filename, JSON.stringify(result.graph, null, 2), "application/json");
  });
}

async function openKnowledgeGraphPanel(knowledgeBaseId, fileId) {
  closeKnowledgeGraphPanel();
  const result = await window.deskchat.getKnowledgeGraph(knowledgeBaseId, fileId);
  if (!result || !result.ok) {
    addMessage("assistant", result && result.error ? result.error : "Knowledge graph failed.");
    if (result && result.needsConfig) window.deskchat.openSettings();
    return;
  }

  knowledgeGraphPanel = document.createElement("section");
  knowledgeGraphPanel.className = "mindmap-panel knowledge-graph-panel";
  knowledgeGraphPanel.innerHTML = `
    <header class="mindmap-header">
      <div>
        <strong>${escapeHtml(result.fileName)}</strong>
        <span>${escapeHtml(result.knowledgeBaseName)} / RAGFlow Knowledge Graph</span>
      </div>
      <div class="mindmap-actions">
        <button type="button" data-action="download-json">Export JSON</button>
        <button type="button" data-action="close">Close</button>
      </div>
    </header>
    <div class="knowledge-graph-layout">
      <div class="knowledge-graph-canvas-wrap">
        <svg class="knowledge-graph-canvas"></svg>
      </div>
      <aside class="knowledge-graph-detail"></aside>
    </div>
  `;
  document.body.appendChild(knowledgeGraphPanel);

  if (!window.d3) {
    addMessage("assistant", "D3 is not loaded. Restart the app and try again.");
    closeKnowledgeGraphPanel();
    return;
  }
  renderKnowledgeGraph(knowledgeGraphPanel, result);
  knowledgeGraphPanel.querySelector('[data-action="close"]').addEventListener("click", closeKnowledgeGraphPanel);
}

function closeAppMenus() {
  document.querySelectorAll(".menu-group.open").forEach((group) => {
    group.classList.remove("open");
    const trigger = group.querySelector(".menu-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
  activeMenuGroup = null;
}

function toggleAppMenu(group) {
  const wasOpen = group.classList.contains("open");
  closeAppMenus();
  if (wasOpen) return;
  group.classList.add("open");
  activeMenuGroup = group;
  const trigger = group.querySelector(".menu-trigger");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
}

async function linkCurrentConversationToKnowledgeBase(knowledgeBaseId) {
  if (!currentConversationId) return;
  await window.deskchat.linkConversationToKnowledgeBase(knowledgeBaseId, currentConversationId);
  const store = await window.deskchat.getConversations();
  applyConversationStore(store, currentConversationId);
  await loadKnowledgeBases(knowledgeBaseId);
}

function openKnowledgePicker(anchor) {
  closeKnowledgePicker();

  if (!currentConversationId) {
    addMessage("assistant", "请先选择一个要加入知识库的对话。");
    return;
  }

  if (!knowledgeBases.length) {
    addMessage("assistant", "还没有知识库，请先新建一个知识库。");
    return;
  }

  knowledgePickerOpen = true;
  const picker = document.createElement("div");
  picker.className = "knowledge-picker";

  const title = document.createElement("div");
  title.className = "knowledge-picker-title";
  title.textContent = "加入到知识库";
  picker.appendChild(title);

  for (const base of knowledgeBases) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "knowledge-picker-option";
    option.classList.toggle("active", base.conversationIds.includes(currentConversationId));
    option.innerHTML = `<span>${escapeHtml(base.name)}</span><small>${base.conversationIds.length} 个对话 / ${base.files.length} 个文件</small>`;
    option.addEventListener("click", async () => {
      await linkCurrentConversationToKnowledgeBase(base.id);
      closeKnowledgePicker();
    });
    picker.appendChild(option);
  }

  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  const top = Math.min(window.innerHeight - pickerRect.height - 12, rect.bottom + 8);
  const left = Math.min(window.innerWidth - pickerRect.width - 12, Math.max(12, rect.left));
  picker.style.top = `${Math.max(12, top)}px`;
  picker.style.left = `${left}px`;
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

function conversationButton(conversation, extraClass = "", onSelect) {
  if (isEditing("conversation", conversation.id)) {
    return editableNameInput("conversation", conversation.id, conversation.title || "新对话", (title) =>
      renameConversation(conversation.id, title)
    );
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = `conversation-item ${extraClass}`.trim();
  button.classList.toggle("active", conversation.id === currentConversationId);
  button.dataset.conversationId = conversation.id;
  button.textContent = conversation.title || "新对话";
  if (onSelect) button.addEventListener("click", onSelect);
  button.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    startEditing("conversation", conversation.id);
  });
  return button;
}

function conversationRow(conversation, options = {}) {
  const row = document.createElement("div");
  row.className = options.nested ? "knowledge-row" : "conversation-row";

  const title = conversationButton(conversation, options.nested ? "nested" : "", options.onSelect);
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "row-action";
  rename.textContent = "改名";
  rename.title = "重命名对话";
  rename.addEventListener("click", (event) => {
    event.stopPropagation();
    startEditing("conversation", conversation.id);
  });

  row.append(title, rename);
  if (options.extraAction) row.appendChild(options.extraAction);
  return row;
}

function renderConversationList() {
  const current = activeConversation();
  const currentKnowledge = activeKnowledgeBase();
  const assignedConversationIds = new Set(
    knowledgeBases.flatMap((base) => (Array.isArray(base.conversationIds) ? base.conversationIds : []))
  );

  els.knowledgeList.innerHTML = "";
  els.conversationList.innerHTML = "";

  for (const base of knowledgeBases) {
    const section = document.createElement("section");
    section.className = "knowledge-folder";
    section.classList.toggle("active", base.id === activeKnowledgeBaseId);

    const header = document.createElement("div");
    header.className = "knowledge-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "folder-toggle";
    toggle.textContent = base.expanded ? "⌄" : "›";
    toggle.title = base.expanded ? "收起" : "展开";
    toggle.addEventListener("click", async (event) => {
      event.stopPropagation();
      await window.deskchat.saveKnowledgeBase({ id: base.id, expanded: !base.expanded, active: true });
    });

    const folderTitleWrap = document.createElement("div");
    folderTitleWrap.className = "folder-title-wrap";
    if (isEditing("knowledge", base.id)) {
      folderTitleWrap.appendChild(editableNameInput("knowledge", base.id, base.name, (name) => renameKnowledgeBase(base.id, name)));
    } else {
      const folderButton = document.createElement("button");
      folderButton.type = "button";
      folderButton.className = "folder-title";
      folderButton.title = base.name;
      folderButton.innerHTML = `<span class="folder-icon">▣</span><span>${escapeHtml(base.name)}</span>`;
      folderButton.addEventListener("click", async () => {
        activeKnowledgeBaseId = base.id;
        currentConversationId = null;
        chatMessages = [];
        await window.deskchat.setActiveKnowledgeBase(base.id);
        renderConversationList();
        renderMessages();
      });
      folderButton.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        startEditing("knowledge", base.id);
      });
      folderTitleWrap.appendChild(folderButton);
    }

    const count = document.createElement("span");
    count.className = "folder-count";
    count.textContent = `${base.conversationIds.length}/${base.files.length}`;

    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "folder-action";
    upload.textContent = "+文件";
    upload.title = "上传文件到知识库";
    upload.addEventListener("click", (event) => {
      event.stopPropagation();
      activeKnowledgeBaseId = base.id;
      els.knowledgeFileInput.click();
      renderConversationList();
    });

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "folder-action";
    rename.textContent = "改名";
    rename.title = "重命名知识库";
    rename.addEventListener("click", (event) => {
      event.stopPropagation();
      startEditing("knowledge", base.id);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "folder-action danger-text";
    remove.textContent = "删";
    remove.title = "删除知识库";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!window.confirm(`删除知识库「${base.name}」？其中的对话不会删除，上传文件会从本地知识库目录移除。`)) return;
      await window.deskchat.deleteKnowledgeBase(base.id);
    });

    header.append(toggle, folderTitleWrap, count, upload, rename, remove);
    section.appendChild(header);

    if (base.expanded) {
      const children = document.createElement("div");
      children.className = "knowledge-children";

      const baseConversations = base.conversationIds.map(conversationById).filter(Boolean);
      for (const conversation of baseConversations) {
        const unlink = document.createElement("button");
        unlink.type = "button";
        unlink.className = "row-action";
        unlink.textContent = "移出";
        unlink.title = "从知识库移出此对话";
        unlink.addEventListener("click", async (event) => {
          event.stopPropagation();
          await window.deskchat.unlinkConversationFromKnowledgeBase(base.id, conversation.id);
        });

        const row = conversationRow(conversation, {
          nested: true,
          extraAction: unlink,
          onSelect: async () => {
            activeKnowledgeBaseId = base.id;
            currentConversationId = conversation.id;
            await window.deskchat.setActiveKnowledgeBase(base.id);
            const store = await window.deskchat.getConversations();
            applyConversationStore(store, currentConversationId);
          }
        });
        children.appendChild(row);
      }

      for (const file of base.files) {
        const row = document.createElement("div");
        row.className = "knowledge-file";

        const open = document.createElement("button");
        open.type = "button";
        open.className = "file-title";
        open.title = file.name;
        open.innerHTML = `<span class="file-icon">□</span><span>${escapeHtml(file.name)}</span><small>${formatFileSize(file.size)}</small>`;
        open.addEventListener("click", () => window.deskchat.openKnowledgeFile(base.id, file.id));

        const knowledgeGraph = document.createElement("button");
        knowledgeGraph.type = "button";
        knowledgeGraph.className = "row-action";
        knowledgeGraph.textContent = "Graph";
        knowledgeGraph.title = "Open RAGFlow knowledge graph";
        knowledgeGraph.addEventListener("click", async (event) => {
          event.stopPropagation();
          await openKnowledgeGraphPanel(base.id, file.id);
        });

        const mindMap = document.createElement("button");
        mindMap.type = "button";
        mindMap.className = "row-action";
        mindMap.textContent = "导图";
        mindMap.title = "根据文件生成思维导图";
        mindMap.addEventListener("click", async (event) => {
          event.stopPropagation();
          await openMindMapPanel(base.id, file.id);
        });

        const removeFile = document.createElement("button");
        removeFile.type = "button";
        removeFile.className = "row-action";
        removeFile.textContent = "删除";
        removeFile.title = "从知识库删除文件";
        removeFile.addEventListener("click", async (event) => {
          event.stopPropagation();
          await window.deskchat.removeKnowledgeFile(base.id, file.id);
        });

        row.append(open, knowledgeGraph, mindMap, removeFile);
        children.appendChild(row);
      }

      if (!baseConversations.length && !base.files.length) {
        const empty = document.createElement("div");
        empty.className = "folder-empty";
        empty.textContent = "暂无对话或文件";
        children.appendChild(empty);
      }

      section.appendChild(children);
    }

    els.knowledgeList.appendChild(section);
  }

  if (!knowledgeBases.length) {
    const empty = document.createElement("div");
    empty.className = "folder-empty root-empty";
    empty.textContent = "还没有知识库";
    els.knowledgeList.appendChild(empty);
  }

  for (const conversation of conversations.filter((item) => !assignedConversationIds.has(item.id))) {
    const row = conversationRow(conversation, {
      onSelect: async () => {
        if (conversation.id === currentConversationId) return;
        currentConversationId = conversation.id;
        activeKnowledgeBaseId = null;
        await window.deskchat.setActiveKnowledgeBase(null);
        const store = await window.deskchat.getConversations();
        applyConversationStore(store, currentConversationId);
      }
    });
    els.conversationList.appendChild(row);
  }

  if (!els.conversationList.children.length) {
    const empty = document.createElement("div");
    empty.className = "folder-empty root-empty";
    empty.textContent = "没有未归档对话";
    els.conversationList.appendChild(empty);
  }

  if (current) {
    els.conversationTitle.textContent = current.title || "Deskchat";
  } else {
    els.conversationTitle.textContent = "Deskchat";
  }
  els.knowledgeSummary.textContent = currentKnowledge ? `知识库：${currentKnowledge.name}` : "未选择知识库";
  els.toolbarUploadKnowledge.disabled = !currentKnowledge;
  els.toolbarLinkKnowledge.disabled = !currentConversationId || !knowledgeBases.length;
  els.toolbarLinkKnowledge.textContent = "加入知识库";
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
  return window.DeskchatRichRenderer.escapeHtml(value);
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
    bubble.innerHTML = window.DeskchatRichRenderer.renderRichText(text || "");
    window.DeskchatRichRenderer.enhanceRichContent(bubble);
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

function applyKnowledgeStore(store, preferredId) {
  knowledgeBases = Array.isArray(store.knowledgeBases) ? store.knowledgeBases : [];
  activeKnowledgeBaseId =
    preferredId ||
    (activeKnowledgeBaseId && knowledgeBases.some((base) => base.id === activeKnowledgeBaseId) ? activeKnowledgeBaseId : null) ||
    store.activeKnowledgeBaseId ||
    null;
  if (els.knowledgeSearchInput && !activeKnowledgeBaseId) els.knowledgeSearchInput.value = "";
  clearKnowledgeSearchResults();
  renderConversationList();
}

async function loadKnowledgeBases(preferredId) {
  const store = await window.deskchat.getKnowledgeBases();
  applyKnowledgeStore(store, preferredId);
}

function clearKnowledgeSearchResults() {
  if (els.knowledgeSearchResults) els.knowledgeSearchResults.innerHTML = "";
}

async function runKnowledgeSearch() {
  const base = activeKnowledgeBase();
  const query = els.knowledgeSearchInput ? els.knowledgeSearchInput.value.trim() : "";
  clearKnowledgeSearchResults();
  if (!els.knowledgeSearchResults || !base || query.length < 2) return;

  const search = await window.deskchat.searchKnowledgeBase(base.id, query, { limit: 6 });
  if (!search.results || !search.results.length) {
    const empty = document.createElement("div");
    empty.className = "knowledge-search-empty";
    empty.textContent = "没有命中片段";
    els.knowledgeSearchResults.appendChild(empty);
    return;
  }

  for (const result of search.results) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "knowledge-search-result";
    item.innerHTML = `
      <span>${escapeHtml(result.fileName)} #${Number(result.chunkIndex) + 1}</span>
      <small>${escapeHtml(result.text.slice(0, 180))}</small>
    `;
    item.addEventListener("click", () => {
      const ref = `[${result.fileName}#${Number(result.chunkIndex) + 1}]`;
      els.prompt.value = `请基于这个知识库片段回答：${ref}\n\n${result.text.slice(0, 1200)}`;
      els.prompt.focus();
    });
    els.knowledgeSearchResults.appendChild(item);
  }
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

async function addFilesToKnowledgeBase(files, knowledgeBaseId = activeKnowledgeBaseId) {
  const targetId = knowledgeBaseId || activeKnowledgeBaseId;
  const target = knowledgeBases.find((base) => base.id === targetId);
  if (!target) {
    addMessage("assistant", "请先选择或创建一个知识库，再上传文件。");
    return;
  }

  for (const file of files) {
    if (file.size > KNOWLEDGE_FILE_LIMIT_BYTES) {
      addMessage("assistant", `文件「${file.name}」超过 1 GB，暂未导入知识库。`);
      continue;
    }

    const buffer = await file.arrayBuffer();
    await window.deskchat.addKnowledgeFile(target.id, {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      bytes: new Uint8Array(buffer)
    });
  }

  await loadKnowledgeBases(target.id);
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

function buildKnowledgeContextPrompt() {
  const base = activeKnowledgeBase();
  if (!base) return "";

  const lines = [
    "",
    "",
    `当前知识库：${base.name}`,
    "知识库中的文件和文本预览如下。回答时优先参考这些材料；如果材料不足，请明确说明。"
  ];

  if (!base.files.length) {
    lines.push("当前知识库还没有上传文件。");
  } else {
    for (const file of base.files.slice(0, 20)) {
      lines.push(`\n文件：${file.name}（${formatFileSize(file.size)}）`);
      if (file.textPreview) {
        lines.push(file.textPreview.slice(0, 6000));
      } else {
        lines.push("此文件没有可注入的文本预览，只能作为已上传文件记录。");
      }
    }
  }

  const relatedConversations = base.conversationIds.map(conversationById).filter(Boolean);
  if (relatedConversations.length) {
    lines.push("\n知识库内相关对话：");
    for (const conversation of relatedConversations.slice(0, 12)) {
      lines.push(`- ${conversation.title || "新对话"}`);
    }
  }

  return lines.join("\n");
}

async function buildRetrievedKnowledgeContextPrompt(query) {
  const base = activeKnowledgeBase();
  if (!base) return "";

  const lines = [
    "",
    "",
    `当前知识库：${base.name}`,
    "下面是按用户问题检索出的知识库片段。回答时优先引用这些材料；如果材料不足，请明确说明。引用格式使用 [文件名#片段序号]。"
  ];

  if (!base.files.length) {
    lines.push("当前知识库还没有上传文件。");
  } else {
    const search = await window.deskchat.searchKnowledgeBase(base.id, query || "", { limit: 8 });
    if (search.results && search.results.length) {
      for (const result of search.results) {
        lines.push(`\n[${result.fileName}#${Number(result.chunkIndex) + 1}] score=${result.score}`);
        lines.push(result.text);
      }
    } else {
      lines.push("没有检索到与本次问题直接相关的片段。可参考文件清单：");
      for (const file of base.files.slice(0, 20)) {
        const chunkCount = file.indexStats && file.indexStats.chunkCount ? file.indexStats.chunkCount : 0;
        lines.push(`- ${file.name} (${formatFileSize(file.size)}, ${chunkCount} 个索引片段)`);
      }
    }
  }

  const relatedConversations = base.conversationIds.map(conversationById).filter(Boolean);
  if (relatedConversations.length) {
    lines.push("\n知识库内相关对话：");
    for (const conversation of relatedConversations.slice(0, 12)) {
      lines.push(`- ${conversation.title || "新对话"}`);
    }
  }

  return lines.join("\n");
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
    const tools = window.DeskchatConfig.TOOL_DEFINITIONS;
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
    await ensureConversationForActiveKnowledgeBase();

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
    const capabilityPrompt = settings.supportsVision ? "" : window.DeskchatConfig.TEXT_ONLY_CAPABILITY_PROMPT;
    const formatPrompt = window.DeskchatConfig.RESPONSE_FORMAT_PROMPT;
    const knowledgePrompt = await buildRetrievedKnowledgeContextPrompt(text);
    let apiMessages = [{ role: "system", content: `${settings.systemPrompt}${capabilityPrompt}${formatPrompt}${knowledgePrompt}` }, ...chatMessages];
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
  if (activeKnowledgeBaseId) {
    await window.deskchat.linkConversationToKnowledgeBase(activeKnowledgeBaseId, conversation.id);
  }
  const store = await window.deskchat.getConversations();
  applyConversationStore(store, conversation.id);
  await loadKnowledgeBases(activeKnowledgeBaseId);
});
els.newKnowledgeBase.addEventListener("click", async () => {
  const base = await window.deskchat.createKnowledgeBase("新知识库");
  activeKnowledgeBaseId = base.id;
  editingItem = { type: "knowledge", id: base.id };
  await loadKnowledgeBases(base.id);
  window.requestAnimationFrame(() => {
    const input = document.querySelector(`[data-editor-for="knowledge:${base.id}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  });
});
els.clearKnowledgeSelection.addEventListener("click", async () => {
  activeKnowledgeBaseId = null;
  await window.deskchat.setActiveKnowledgeBase(null);
  if (els.knowledgeSearchInput) els.knowledgeSearchInput.value = "";
  clearKnowledgeSearchResults();
  renderConversationList();
});
if (els.knowledgeSearchInput) {
  els.knowledgeSearchInput.addEventListener("input", debounce(runKnowledgeSearch, 250));
}
els.toolbarUploadKnowledge.addEventListener("click", () => {
  if (!activeKnowledgeBase()) {
    addMessage("assistant", "请先在左侧选择或创建一个知识库。");
    return;
  }
  els.knowledgeFileInput.click();
});
els.toolbarLinkKnowledge.addEventListener("click", async () => {
  if (knowledgePickerOpen) {
    closeKnowledgePicker();
    return;
  }
  openKnowledgePicker(els.toolbarLinkKnowledge);
});
els.toolbarDeleteConversation.addEventListener("click", async () => {
  if (!currentConversationId || conversations.length <= 1) return;
  const store = await window.deskchat.deleteConversation(currentConversationId);
  applyConversationStore(store);
  await loadKnowledgeBases(activeKnowledgeBaseId);
});
window.deskchat.onWindowState(applyWindowState);
window.deskchat.onSettingsUpdated((settings) => {
  currentSettings = settings;
  updateSettingsSummary();
});
window.deskchat.onConversationsUpdated((store) => {
  applyConversationStore(store, currentConversationId);
});
window.deskchat.onKnowledgeBasesUpdated((store) => {
  applyKnowledgeStore(store, activeKnowledgeBaseId);
});
els.attachButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async (event) => {
  await filesToImages(Array.from(event.target.files || []));
  els.fileInput.value = "";
});
els.knowledgeFileInput.addEventListener("change", async (event) => {
  await addFilesToKnowledgeBase(Array.from(event.target.files || []));
  els.knowledgeFileInput.value = "";
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

document.querySelectorAll(".menu-trigger").forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAppMenu(trigger.closest(".menu-group"));
  });
});

document.querySelectorAll(".menu-popover button").forEach((button) => {
  button.addEventListener("click", () => closeAppMenus());
});

els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

document.addEventListener("click", (event) => {
  if (activeMenuGroup && !activeMenuGroup.contains(event.target)) closeAppMenus();
  if (!knowledgePickerOpen) return;
  const picker = document.querySelector(".knowledge-picker");
  if (picker && !picker.contains(event.target) && !els.toolbarLinkKnowledge.contains(event.target)) {
    closeKnowledgePicker();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (knowledgeGraphPanel) closeKnowledgeGraphPanel();
  if (mindMapPanel) closeMindMapPanel();
  if (knowledgePickerOpen) closeKnowledgePicker();
  if (activeMenuGroup) closeAppMenus();
});

loadSettings().catch((error) => {
  addMessage("assistant", `读取设置失败：${error.message}`);
});
loadConversations().catch((error) => {
  addMessage("assistant", `读取历史对话失败：${error.message}`);
});
loadKnowledgeBases().catch((error) => {
  addMessage("assistant", `读取知识库失败：${error.message}`);
});
window.deskchat.getWindowState().then(applyWindowState).catch(() => {});
renderEmpty();

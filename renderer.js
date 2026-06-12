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
  toolbarOpenTodo: document.getElementById("toolbarOpenTodo"),
  toolbarMemoryCenter: document.getElementById("toolbarMemoryCenter"),
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
  openMemoryCenter: document.getElementById("openMemoryCenter"),
  openTodoList: document.getElementById("openTodoList"),
  clearKnowledgeSelection: document.getElementById("clearKnowledgeSelection")
};

const STORAGE_KEY = "deskchat.settings.v1";
const MAX_TOOL_STEPS = 6;
const KNOWLEDGE_FILE_LIMIT_BYTES = 1024 * 1024 * 1024;
const defaultMemorySettings = window.DeskchatConfig.DEFAULT_MEMORY_SETTINGS || {
  enabled: true,
  rememberAssistant: true,
  recallEnabled: true,
  recallLimit: 6,
  minMessageChars: 8,
  minChunkChars: 24
};

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
let contextMenu = null;
let mindMapPanel = null;
let memoryPanel = null;
let activeMindMap = null;
let knowledgeGraphPanel = null;
let activeKnowledgeGraphSimulation = null;
let knowledgeSearchRunId = 0;
let memoryPanelRunId = 0;
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

function memoryExcludeConversationIds() {
  const activeBase = activeKnowledgeBase();
  return [
    currentConversationId,
    ...((activeBase && Array.isArray(activeBase.conversationIds)) ? activeBase.conversationIds : [])
  ].filter(Boolean);
}

function normalizeMemorySettings(config) {
  const recallLimit = Number(config && config.recallLimit);
  const minMessageChars = Number(config && config.minMessageChars);
  const minChunkChars = Number(config && config.minChunkChars);
  return {
    enabled: config && config.enabled !== undefined ? Boolean(config.enabled) : defaultMemorySettings.enabled,
    rememberAssistant: config && config.rememberAssistant !== undefined
      ? Boolean(config.rememberAssistant)
      : defaultMemorySettings.rememberAssistant,
    recallEnabled: config && config.recallEnabled !== undefined
      ? Boolean(config.recallEnabled)
      : defaultMemorySettings.recallEnabled,
    recallLimit: Math.max(0, Math.min(Number.isFinite(recallLimit) ? recallLimit : defaultMemorySettings.recallLimit, 12)),
    minMessageChars: Math.max(1, Math.min(Number.isFinite(minMessageChars) ? minMessageChars : defaultMemorySettings.minMessageChars, 200)),
    minChunkChars: Math.max(1, Math.min(Number.isFinite(minChunkChars) ? minChunkChars : defaultMemorySettings.minChunkChars, 600))
  };
}

function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

async function confirmAction(message, options = {}) {
  if (window.deskchat && typeof window.deskchat.confirmAction === "function") {
    return window.deskchat.confirmAction({
      title: options.title || "确认操作",
      message,
      detail: options.detail || "",
      confirmLabel: options.confirmLabel || "确认",
      cancelLabel: options.cancelLabel || "取消",
      danger: options.danger !== false
    });
  }
  return window.confirm(message);
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

function closeMemoryPanel() {
  if (memoryPanel) memoryPanel.remove();
  memoryPanel = null;
}

function closeKnowledgeGraphPanel() {
  if (activeKnowledgeGraphSimulation && typeof activeKnowledgeGraphSimulation.stop === "function") {
    activeKnowledgeGraphSimulation.stop();
  }
  activeKnowledgeGraphSimulation = null;
  if (knowledgeGraphPanel) knowledgeGraphPanel.remove();
  knowledgeGraphPanel = null;
}

function closeContextMenu() {
  if (contextMenu) contextMenu.remove();
  contextMenu = null;
}

function contextMenuCommand(command) {
  if (typeof document.execCommand === "function") document.execCommand(command);
}

function textFieldContextItems(field) {
  const value = typeof field.value === "string" ? field.value : "";
  const hasSelection = typeof field.selectionStart === "number"
    && typeof field.selectionEnd === "number"
    && field.selectionStart !== field.selectionEnd;
  const editable = !field.disabled && !field.readOnly;
  return [
    { label: "剪切", disabled: !editable || !hasSelection, action: () => contextMenuCommand("cut") },
    { label: "复制", disabled: !hasSelection, action: () => contextMenuCommand("copy") },
    { label: "粘贴", disabled: !editable, action: () => contextMenuCommand("paste") },
    { type: "separator" },
    {
      label: "全选",
      disabled: !value.length,
      action: () => {
        field.focus();
        if (typeof field.select === "function") field.select();
      }
    }
  ];
}

function openContextMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  closeAppMenus();
  closeKnowledgePicker();

  const textField = event.target && event.target.closest && event.target.closest("input, textarea");
  const available = (textField ? textFieldContextItems(textField) : items).filter(Boolean);
  if (!available.length) return;

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  for (const item of available) {
    if (item.type === "separator") {
      const separator = document.createElement("div");
      separator.className = "context-menu-separator";
      menu.appendChild(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = item.label;
    if (item.danger) button.classList.add("danger-text");
    if (item.disabled) button.disabled = true;
    button.addEventListener("click", async () => {
      closeContextMenu();
      if (!item.disabled && item.action) await item.action();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - 8, Math.max(8, event.clientX));
  const top = Math.min(window.innerHeight - rect.height - 8, Math.max(8, event.clientY));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  contextMenu = menu;
}

function bindContextMenu(target, itemsFactory) {
  target.addEventListener("contextmenu", (event) => openContextMenu(event, itemsFactory()));
}

document.addEventListener("contextmenu", (event) => {
  if (event.target && event.target.closest && event.target.closest("input, textarea")) {
    openContextMenu(event, []);
  }
});

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatMemoryTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function memoryPanelQuery() {
  if (!memoryPanel) return "";
  const input = memoryPanel.querySelector('[data-role="memory-query"]');
  return input ? input.value.trim() : "";
}

function setMemoryPanelStatus(message, kind = "") {
  if (!memoryPanel) return;
  const status = memoryPanel.querySelector('[data-role="memory-status"]');
  if (!status) return;
  status.textContent = message || "";
  status.className = `memory-status ${kind}`.trim();
}

function memorySettingsSummary(settings) {
  const memory = normalizeMemorySettings(settings);
  if (!memory.enabled) return "长期记忆索引已关闭";
  if (!memory.recallEnabled) return "长期记忆仅索引，聊天时不自动召回";
  return `自动召回最多 ${memory.recallLimit} 条，${memory.rememberAssistant ? "包含助手回复" : "仅记住用户消息"}`;
}

function updateMemoryPanelSettings(store) {
  if (!memoryPanel) return;
  const settingsNode = memoryPanel.querySelector('[data-role="memory-settings"]');
  if (!settingsNode) return;
  const memory = normalizeMemorySettings((store && store.settings) || currentSettings.memory);
  settingsNode.textContent = memorySettingsSummary(memory);
}

function memoryPreviewText(item) {
  return String(item && item.text ? item.text : "").replace(/\s+/g, " ").trim();
}

function renderMemoryResults(results, store) {
  if (!memoryPanel) return;
  const list = memoryPanel.querySelector('[data-role="memory-list"]');
  const count = memoryPanel.querySelector('[data-role="memory-count"]');
  const hiddenCount = memoryPanel.querySelector('[data-role="memory-hidden-count"]');
  const forgottenCount = memoryPanel.querySelector('[data-role="memory-forgotten-count"]');
  if (!list) return;

  const items = Array.isArray(results) ? results : [];
  updateMemoryPanelSettings(store);
  list.innerHTML = "";
  if (count) count.textContent = `${items.length} 条`;
  if (hiddenCount) hiddenCount.textContent = `${(store && store.hiddenItemIds && store.hiddenItemIds.length) || 0} 条已隐藏`;
  if (forgottenCount) forgottenCount.textContent = `${(store && store.forgottenConversationIds && store.forgottenConversationIds.length) || 0} 个对话已遗忘`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "memory-empty";
    empty.textContent = memoryPanelQuery() ? "没有匹配的记忆" : "还没有可用记忆";
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "memory-item";
    const title = item.conversationTitle || item.conversationId || "未命名对话";
    const chunk = Number(item.chunkIndex) + 1;
    const preview = memoryPreviewText(item);
    row.innerHTML = `
      <header>
        <strong>${escapeHtml(title)} #${Number.isFinite(chunk) ? chunk : 1}</strong>
        <span>${escapeHtml(formatMemoryTime(item.updatedAt))}</span>
      </header>
      <p>${escapeHtml(preview.slice(0, 520))}</p>
      <footer>
        <span>${escapeHtml(item.source || "conversation")}</span>
        ${Number.isFinite(Number(item.score)) ? `<span>score ${escapeHtml(String(item.score))}</span>` : ""}
      </footer>
    `;

    bindContextMenu(row, () => [
      {
        label: "引用到输入框",
        action: () => {
          els.prompt.value = `请基于这条长期记忆回答：[长期记忆:${title}#${Number.isFinite(chunk) ? chunk : 1}]\n\n${String(item.text || "").slice(0, 1200)}`;
          els.prompt.focus();
          closeMemoryPanel();
        }
      },
      {
        label: "复制记忆",
        action: () => window.deskchat.copyText(item.text || "")
      },
      { type: "separator" },
      {
        label: "删除这条记忆",
        danger: true,
        action: async () => {
          if (!(await confirmAction("删除这条记忆？后续重建不会恢复这条隐藏记忆。", { confirmLabel: "删除" }))) return;
          await window.deskchat.deleteMemoryItem(item.id);
          await refreshMemoryPanel();
        }
      },
      {
        label: "遗忘这个对话",
        danger: true,
        action: async () => {
          if (!(await confirmAction(`遗忘对话「${title}」的全部长期记忆？`, { confirmLabel: "遗忘" }))) return;
          await window.deskchat.forgetConversationMemory(item.conversationId);
          await refreshMemoryPanel();
        }
      }
    ]);

    row.addEventListener("dblclick", () => {
      els.prompt.value = `请基于这条长期记忆回答：[长期记忆:${title}#${Number.isFinite(chunk) ? chunk : 1}]\n\n${String(item.text || "").slice(0, 1200)}`;
      els.prompt.focus();
      closeMemoryPanel();
    });
    list.appendChild(row);
  }
}

async function refreshMemoryPanel() {
  if (!memoryPanel) return;
  const query = memoryPanelQuery();
  const runId = memoryPanelRunId + 1;
  memoryPanelRunId = runId;
  const list = memoryPanel.querySelector('[data-role="memory-list"]');
  if (list) list.innerHTML = '<div class="memory-empty">正在读取记忆...</div>';
  try {
    const store = await window.deskchat.getMemories();
    let results = Array.isArray(store.items) ? store.items : [];
    if (query) {
      const search = await window.deskchat.searchMemories(query, {
        limit: 20,
        excludeConversationIds: [],
        includeDisabled: true
      });
      results = Array.isArray(search.results) ? search.results : [];
    }
    if (!memoryPanel || runId !== memoryPanelRunId || query !== memoryPanelQuery()) return;
    renderMemoryResults(results.slice(0, 80), store);
    setMemoryPanelStatus(query ? `已按“${query}”检索` : "长期记忆已同步", "success");
  } catch (error) {
    if (!memoryPanel || runId !== memoryPanelRunId) return;
    renderMemoryResults([], null);
    setMemoryPanelStatus(`读取记忆失败：${error.message || "未知错误"}`, "error");
  }
}

function openMemoryCenter() {
  closeAppMenus();
  closeKnowledgePicker();
  closeMemoryPanel();

  memoryPanel = document.createElement("section");
  memoryPanel.className = "memory-panel";
  memoryPanel.innerHTML = `
    <header class="memory-header">
      <div>
        <strong>记忆中心</strong>
        <span>管理自动沉淀的长期对话记忆</span>
      </div>
      <div class="memory-actions">
        <button type="button" data-action="settings">配置记忆</button>
        <button type="button" data-action="rebuild">重建索引</button>
        <button type="button" data-action="restore">恢复全部</button>
        <button type="button" class="danger-text" data-action="forget-all">遗忘全部</button>
        <button type="button" data-action="close">关闭</button>
      </div>
    </header>
    <div class="memory-toolbar">
      <input data-role="memory-query" type="search" placeholder="搜索长期记忆" />
      <button type="button" data-action="search">搜索</button>
      <button type="button" data-action="clear-search">全部</button>
    </div>
    <div class="memory-meta">
      <span data-role="memory-count">0 条</span>
      <span data-role="memory-hidden-count">0 条已隐藏</span>
      <span data-role="memory-forgotten-count">0 个对话已遗忘</span>
      <span data-role="memory-settings">长期记忆状态读取中</span>
    </div>
    <div data-role="memory-status" class="memory-status"></div>
    <div data-role="memory-list" class="memory-list"></div>
  `;
  document.body.appendChild(memoryPanel);

  memoryPanel.querySelector('[data-action="close"]').addEventListener("click", closeMemoryPanel);
  memoryPanel.querySelector('[data-action="settings"]').addEventListener("click", () => window.deskchat.openSettings());
  memoryPanel.querySelector('[data-action="search"]').addEventListener("click", refreshMemoryPanel);
  memoryPanel.querySelector('[data-action="clear-search"]').addEventListener("click", () => {
    const input = memoryPanel.querySelector('[data-role="memory-query"]');
    if (input) input.value = "";
    refreshMemoryPanel();
  });
  memoryPanel.querySelector('[data-action="rebuild"]').addEventListener("click", async () => {
    setMemoryPanelStatus("正在重建记忆索引...");
    try {
      await window.deskchat.rebuildMemories();
      await refreshMemoryPanel();
      setMemoryPanelStatus("记忆索引已重建", "success");
    } catch (error) {
      setMemoryPanelStatus(`重建失败：${error.message || "未知错误"}`, "error");
    }
  });
  memoryPanel.querySelector('[data-action="forget-all"]').addEventListener("click", async () => {
    if (!(await confirmAction("遗忘所有长期记忆？历史对话不会删除，但自动记忆会被清空并保持遗忘状态。", { confirmLabel: "遗忘全部" }))) return;
    await window.deskchat.forgetAllMemories();
    await refreshMemoryPanel();
    setMemoryPanelStatus("已遗忘全部长期记忆", "success");
  });
  memoryPanel.querySelector('[data-action="restore"]').addEventListener("click", async () => {
    if (!(await confirmAction("恢复并重建全部历史对话记忆？之前隐藏的单条记忆也会重新参与索引。", { confirmLabel: "恢复重建", danger: false }))) return;
    await window.deskchat.restoreAllMemories();
    await refreshMemoryPanel();
    setMemoryPanelStatus("全部长期记忆已恢复", "success");
  });
  const queryInput = memoryPanel.querySelector('[data-role="memory-query"]');
  queryInput.addEventListener("input", debounce(refreshMemoryPanel, 250));
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      refreshMemoryPanel();
    }
  });
  bindContextMenu(memoryPanel, () => [
    { label: "搜索记忆", action: refreshMemoryPanel },
    { label: "重建索引", action: () => memoryPanel.querySelector('[data-action="rebuild"]').click() },
    { label: "配置记忆", action: () => window.deskchat.openSettings() },
    { type: "separator" },
    { label: "恢复全部", action: () => memoryPanel.querySelector('[data-action="restore"]').click() },
    {
      label: "遗忘全部",
      danger: true,
      action: () => memoryPanel.querySelector('[data-action="forget-all"]').click()
    }
  ]);
  refreshMemoryPanel();
}

async function openMindMapPanel(knowledgeBaseId, fileId) {
  closeMindMapPanel();
  let result;
  try {
    result = await window.deskchat.getKnowledgeMindMap(knowledgeBaseId, fileId);
  } catch (error) {
    await addAssistantNotice(`思维导图生成失败：${error.message}`);
    return;
  }
  if (!result || !result.ok) {
    await addAssistantNotice(result && result.error ? result.error : "思维导图生成失败。");
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
    await addAssistantNotice("思维导图库加载失败，请重新启动应用后再试。");
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
    await addAssistantNotice(`思维导图渲染失败：${error.message}`);
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

function setKnowledgeGraphLoading(panel, title, detail) {
  panel.querySelector(".knowledge-graph-layout").innerHTML = `
    <div class="knowledge-graph-status">
      <div class="knowledge-graph-spinner"></div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function setKnowledgeGraphPending(panel, result, knowledgeBaseId, fileId) {
  const trace = result && result.graphTrace;
  const documentStatus = result && result.documentStatus;
  const isGraphStage = result && result.stage === "graph";
  const message = trace && trace.message
    ? trace.message.split("\n").slice(-4).join("\n")
    : documentStatus && documentStatus.progressMessage
      ? documentStatus.progressMessage.split("\n").slice(-4).join("\n")
    : (result && result.error) || "RAGFlow is parsing the document and building the graph.";
  const progressText = isGraphStage && trace && trace.progressText
    ? trace.progressText
    : documentStatus && documentStatus.progressText
      ? documentStatus.progressText
      : "";
  panel.querySelector(".knowledge-graph-layout").innerHTML = `
    <div class="knowledge-graph-status">
      <h3>${isGraphStage ? "Knowledge graph is building" : "Document is parsing"}</h3>
      <p>${escapeHtml(message)}</p>
      ${progressText ? `<strong>${escapeHtml(progressText)}</strong>` : ""}
      ${documentStatus ? `
        <div class="knowledge-graph-meta">
          <span>Chunks ${escapeHtml(String(documentStatus.chunkCount || 0))}</span>
          <span>Tokens ${escapeHtml(String(documentStatus.tokenCount || 0))}</span>
          <span>Run ${escapeHtml(documentStatus.run || "unknown")}</span>
        </div>
      ` : ""}
      <button type="button" data-action="refresh-graph">Refresh</button>
    </div>
  `;
  panel.querySelector('[data-action="refresh-graph"]').addEventListener("click", async () => {
    await loadKnowledgeGraphIntoPanel(panel, knowledgeBaseId, fileId);
  });
}

function setKnowledgeGraphIssue(panel, result, knowledgeBaseId, fileId) {
  const diagnosis = result && result.diagnosis;
  const titleMap = {
    service: "RAGFlow is offline",
    auth: "RAGFlow API key failed",
    dataset: "RAGFlow dataset is not ready",
    model: "RAGFlow model setup is incomplete"
  };
  const title = titleMap[diagnosis && diagnosis.kind] || "Knowledge graph failed";
  const message = result && result.error ? result.error : "Knowledge graph failed.";
  panel.querySelector(".knowledge-graph-layout").innerHTML = `
    <div class="knowledge-graph-status knowledge-graph-issue">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      <div class="knowledge-graph-status-actions">
        ${result && result.needsConfig ? '<button type="button" data-action="open-settings">Open Settings</button>' : ""}
        <button type="button" data-action="refresh-graph">Refresh</button>
      </div>
    </div>
  `;
  const settingsButton = panel.querySelector('[data-action="open-settings"]');
  if (settingsButton) settingsButton.addEventListener("click", () => window.deskchat.openSettings());
  panel.querySelector('[data-action="refresh-graph"]').addEventListener("click", async () => {
    await loadKnowledgeGraphIntoPanel(panel, knowledgeBaseId, fileId);
  });
}

function createKnowledgeGraphPanel(fileName = "Knowledge Graph", knowledgeBaseName = "RAGFlow") {
  closeKnowledgeGraphPanel();
  knowledgeGraphPanel = document.createElement("section");
  knowledgeGraphPanel.className = "mindmap-panel knowledge-graph-panel";
  knowledgeGraphPanel.innerHTML = `
    <header class="mindmap-header">
      <div>
        <strong>${escapeHtml(fileName)}</strong>
        <span>${escapeHtml(knowledgeBaseName)} / RAGFlow Knowledge Graph</span>
      </div>
      <div class="mindmap-actions">
        <button type="button" data-action="download-json" disabled>Export JSON</button>
        <button type="button" data-action="close">Close</button>
      </div>
    </header>
    <div class="knowledge-graph-layout"></div>
  `;
  document.body.appendChild(knowledgeGraphPanel);
  knowledgeGraphPanel.querySelector('[data-action="close"]').addEventListener("click", closeKnowledgeGraphPanel);
  return knowledgeGraphPanel;
}

async function loadKnowledgeGraphIntoPanel(panel, knowledgeBaseId, fileId) {
  setKnowledgeGraphLoading(panel, "Preparing knowledge graph", "Uploading if needed, starting parsing, and checking GraphRAG status.");
  let result;
  try {
    result = await window.deskchat.getKnowledgeGraph(knowledgeBaseId, fileId);
  } catch (error) {
    setKnowledgeGraphIssue(panel, { ok: false, error: error.message || "Knowledge graph failed." }, knowledgeBaseId, fileId);
    return;
  }
  if (!result || !result.ok) {
    if (result && result.pending) {
      setKnowledgeGraphPending(panel, result, knowledgeBaseId, fileId);
      return;
    }
    setKnowledgeGraphIssue(panel, result, knowledgeBaseId, fileId);
    return;
  }

  panel.querySelector(".mindmap-header strong").textContent = result.fileName;
  panel.querySelector(".mindmap-header span").textContent = `${result.knowledgeBaseName} / RAGFlow Knowledge Graph`;
  panel.querySelector(".knowledge-graph-layout").innerHTML = `
    <div class="knowledge-graph-canvas-wrap">
      <svg class="knowledge-graph-canvas"></svg>
    </div>
    <aside class="knowledge-graph-detail"></aside>
  `;
  const exportButton = panel.querySelector('[data-action="download-json"]');
  exportButton.disabled = false;
  if (!window.d3) {
    await addAssistantNotice("D3 is not loaded. Restart the app and try again.");
    closeKnowledgeGraphPanel();
    return;
  }
  renderKnowledgeGraph(panel, result);
}

async function openKnowledgeGraphPanel(knowledgeBaseId, fileId) {
  const panel = createKnowledgeGraphPanel();
  await loadKnowledgeGraphIntoPanel(panel, knowledgeBaseId, fileId);
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

async function openKnowledgePicker(anchor) {
  closeKnowledgePicker();

  if (!currentConversationId) {
    await addAssistantNotice("请先选择一个要加入知识库的对话。");
    return;
  }

  if (!knowledgeBases.length) {
    await addAssistantNotice("还没有知识库，请先新建一个知识库。");
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

async function openTodoWindow() {
  closeAppMenus();
  closeKnowledgePicker();
  await window.deskchat.openTodoWindow();
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

async function addAssistantNotice(text, options = {}) {
  const content = String(text || "");
  if (!content) return;
  const messageIndex = chatMessages.length;
  const message = {
    role: "assistant",
    content,
    ...(options.remember === true ? {} : { remember: false })
  };
  chatMessages.push(message);
  addMessage("assistant", content, [], messageIndex);
  if (options.persist === false) return;
  try {
    await persistCurrentConversation();
  } catch (error) {
    console.warn("Failed to persist assistant notice", error);
  }
}

async function clearCurrentConversation() {
  if (chatMessages.length && !(await confirmAction("清空当前对话的所有消息？", { confirmLabel: "清空" }))) return;
  chatMessages = [];
  pendingImages = [];
  els.messages.innerHTML = "";
  renderAttachments();
  renderEmpty();
  await persistCurrentConversation();
}

async function deleteCurrentConversation() {
  if (!currentConversationId || conversations.length <= 1) return;
  const current = activeConversation();
  if (!(await confirmAction(`删除对话「${(current && current.title) || "新对话"}」？`, { confirmLabel: "删除" }))) return;
  const store = await window.deskchat.deleteConversation(currentConversationId);
  applyConversationStore(store);
  await loadKnowledgeBases(activeKnowledgeBaseId);
}

async function createConversationFromMenu() {
  const conversation = await window.deskchat.createConversation("新对话");
  if (activeKnowledgeBaseId) {
    await window.deskchat.linkConversationToKnowledgeBase(activeKnowledgeBaseId, conversation.id);
  }
  const store = await window.deskchat.getConversations();
  applyConversationStore(store, conversation.id);
  await loadKnowledgeBases(activeKnowledgeBaseId);
}

function updateSettingsSummary() {
  const providerName = currentSettings.name || currentSettings.providerName || currentSettings.provider || "Custom";
  els.providerSummary.textContent = `${providerName} / ${currentSettings.model || "未选择模型"}`;
  const keyText = currentSettings.apiKey ? "API Key 已保存" : "未配置 API Key";
  const visionText = currentSettings.supportsVision ? "支持图片" : "仅文本";
  const memory = normalizeMemorySettings(currentSettings.memory);
  const memoryText = memory.enabled
    ? (memory.recallEnabled ? `记忆 ${memory.recallLimit} 条` : "记忆仅索引")
    : "记忆关闭";
  els.keyState.textContent = `${keyText} / ${visionText} / ${memoryText}`;
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
  bindContextMenu(row, () => {
    const items = [
      {
        label: "打开",
        action: options.onSelect || (async () => {
          currentConversationId = conversation.id;
          activeKnowledgeBaseId = options.knowledgeBaseId || null;
          if (activeKnowledgeBaseId) await window.deskchat.setActiveKnowledgeBase(activeKnowledgeBaseId);
          const store = await window.deskchat.getConversations();
          applyConversationStore(store, conversation.id);
        })
      },
      { label: "改名", action: () => startEditing("conversation", conversation.id) },
      {
        label: "新窗口打开",
        action: () => window.deskchat.openChatWindow(conversation.id)
      }
    ];
    if (options.knowledgeBaseId) {
      items.push({
        label: "移出知识库",
        action: async () => {
          await window.deskchat.unlinkConversationFromKnowledgeBase(options.knowledgeBaseId, conversation.id);
          await loadKnowledgeBases(activeKnowledgeBaseId);
        }
      });
    }
    items.push({ type: "separator" });
    items.push({
      label: "删除对话",
      danger: true,
      disabled: conversations.length <= 1,
      action: async () => {
        if (!(await confirmAction(`删除对话「${conversation.title || "新对话"}」？`, { confirmLabel: "删除" }))) return;
        const store = await window.deskchat.deleteConversation(conversation.id);
        applyConversationStore(store);
        await loadKnowledgeBases(activeKnowledgeBaseId);
      }
    });
    return items;
  });
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
      if (!(await confirmAction(`删除知识库「${base.name}」？其中的对话不会删除，上传文件会从本地知识库目录移除。`, { confirmLabel: "删除" }))) return;
      await window.deskchat.deleteKnowledgeBase(base.id);
    });

    header.append(toggle, folderTitleWrap, count, upload, rename, remove);
    bindContextMenu(header, () => [
      {
        label: base.expanded ? "收起知识库" : "展开知识库",
        action: () => window.deskchat.saveKnowledgeBase({ id: base.id, expanded: !base.expanded, active: true })
      },
      {
        label: "设为当前知识库",
        action: async () => {
          activeKnowledgeBaseId = base.id;
          currentConversationId = null;
          chatMessages = [];
          await window.deskchat.setActiveKnowledgeBase(base.id);
          renderConversationList();
          renderMessages();
        }
      },
      {
        label: "上传文件",
        action: () => {
          activeKnowledgeBaseId = base.id;
          els.knowledgeFileInput.click();
          renderConversationList();
        }
      },
      { label: "改名", action: () => startEditing("knowledge", base.id) },
      { type: "separator" },
      {
        label: "删除知识库",
        danger: true,
        action: async () => {
          if (!(await confirmAction(`删除知识库「${base.name}」？其中的对话不会删除，上传文件会从本地知识库目录移除。`, { confirmLabel: "删除" }))) return;
          await window.deskchat.deleteKnowledgeBase(base.id);
        }
      }
    ]);
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
          knowledgeBaseId: base.id,
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
          if (!(await confirmAction(`从知识库删除文件「${file.name}」？`, { confirmLabel: "删除" }))) return;
          await window.deskchat.removeKnowledgeFile(base.id, file.id);
        });

        row.append(open, knowledgeGraph, mindMap, removeFile);
        bindContextMenu(row, () => [
          { label: "打开文件", action: () => window.deskchat.openKnowledgeFile(base.id, file.id) },
          { label: "生成思维导图", action: () => openMindMapPanel(base.id, file.id) },
          { label: "打开知识图谱", action: () => openKnowledgeGraphPanel(base.id, file.id) },
          { type: "separator" },
          {
            label: "删除文件",
            danger: true,
            action: async () => {
              if (!(await confirmAction(`从知识库删除文件「${file.name}」？`, { confirmLabel: "删除" }))) return;
              await window.deskchat.removeKnowledgeFile(base.id, file.id);
            }
          }
        ]);
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
  els.toolbarShotButton.disabled = false;
  els.toolbarClearButton.disabled = false;
  els.toolbarNewWindow.disabled = !currentConversationId;
  if (els.toolbarOpenTodo) els.toolbarOpenTodo.textContent = "打开 Todo";
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

function contentForModel(content, settings) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (settings.supportsVision) return content;
  return extractTextContent(content);
}

function messagesForModel(messages, settings) {
  const safe = [];
  for (const message of messages) {
    if (!message || message.role === "system" || message.role === "tool") continue;

    if (message.role === "assistant") {
      const content = extractTextContent(message.content).trim();
      if (content) safe.push({ role: "assistant", content });
      continue;
    }

    if (message.role === "user") {
      safe.push({ role: "user", content: contentForModel(message.content, settings) });
    }
  }
  return safe;
}

function messagesForStorage(messages) {
  const safe = [];
  for (const message of messages) {
    if (!message || message.role === "system" || message.role === "tool") continue;
    const remember = message.remember === false ? false : undefined;

    if (message.role === "assistant") {
      const content = extractTextContent(message.content).trim();
      if (content) {
        safe.push({
          role: "assistant",
          content,
          ...(remember === false ? { remember: false } : {})
        });
      }
      continue;
    }

    if (message.role === "user") {
      safe.push({
        role: "user",
        content: message.content,
        ...(remember === false ? { remember: false } : {})
      });
    }
  }
  return safe;
}

function visibleMessageIndexes() {
  const indexes = [];
  chatMessages.forEach((message, index) => {
    if (!message || message.role === "system" || message.role === "tool") return;
    if (message.role === "assistant" && message.tool_calls && !message.content) return;
    indexes.push(index);
  });
  return indexes;
}

async function copyMessageText(message) {
  const text = extractTextContent(message && message.content).trim();
  if (!text) return;
  await window.deskchat.copyText(text);
}

async function deleteMessageAt(index) {
  if (index < 0 || index >= chatMessages.length) return;
  const message = chatMessages[index];
  const text = extractTextContent(message && message.content).trim();
  const preview = text ? `「${text.slice(0, 40)}${text.length > 40 ? "..." : ""}」` : "这条消息";
  if (!(await confirmAction(`删除${preview}？`, { confirmLabel: "删除" }))) return;
  chatMessages.splice(index, 1);
  renderMessages();
  await persistCurrentConversation();
}

async function setMessageRememberAt(index, remember) {
  if (index < 0 || index >= chatMessages.length) return;
  const message = chatMessages[index];
  if (!message || (message.role !== "user" && message.role !== "assistant")) return;
  if (remember === false) {
    message.remember = false;
  } else {
    delete message.remember;
  }
  renderMessages();
  await persistCurrentConversation();
}

function bindMessageContextMenu(wrap, messageIndex) {
  bindContextMenu(wrap, () => {
    const message = chatMessages[messageIndex];
    const text = extractTextContent(message && message.content).trim();
    const hasText = Boolean(text);
    const excludedFromMemory = message && message.remember === false;
    return [
      { label: "复制消息", disabled: !hasText, action: () => copyMessageText(message) },
      { label: "复制 Markdown", disabled: !hasText, action: () => copyMessageText(message) },
      {
        label: excludedFromMemory ? "加入长期记忆" : "不写入长期记忆",
        disabled: !message || (message.role !== "user" && message.role !== "assistant"),
        action: () => setMessageRememberAt(messageIndex, excludedFromMemory)
      },
      { type: "separator" },
      {
        label: "删除消息",
        danger: true,
        action: () => deleteMessageAt(messageIndex)
      }
    ];
  });
}

function addMessage(role, text, images = [], messageIndex = -1) {
  if (!chatMessages.length) els.messages.innerHTML = "";

  const wrap = document.createElement("article");
  wrap.className = `message ${role}`;
  if (messageIndex >= 0) {
    wrap.dataset.messageIndex = String(messageIndex);
    bindMessageContextMenu(wrap, messageIndex);
  }
  const message = messageIndex >= 0 ? chatMessages[messageIndex] : null;
  if (message && message.remember === false) wrap.classList.add("memory-excluded");

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
  if (message && message.remember === false) {
    const memoryState = document.createElement("div");
    memoryState.className = "message-memory-state";
    memoryState.textContent = "不写入长期记忆";
    wrap.appendChild(memoryState);
  }
  els.messages.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

function renderMessages() {
  els.messages.innerHTML = "";
  for (const index of visibleMessageIndexes()) {
    const message = chatMessages[index];
    if (message.role === "system") continue;
    if (message.role === "tool") {
      continue;
    }
    if (message.role === "assistant" && message.tool_calls) {
      if (message.content) addMessage("assistant", message.content, [], index);
      continue;
    }
    addMessage(message.role, extractTextContent(message.content), extractImages(message.content), index);
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

function showKnowledgeSearchMessage(message, className = "knowledge-search-empty") {
  if (!els.knowledgeSearchResults) return;
  clearKnowledgeSearchResults();
  const item = document.createElement("div");
  item.className = className;
  item.textContent = message;
  els.knowledgeSearchResults.appendChild(item);
}

function knowledgeSearchResultTitle(result) {
  if (!result) return "未命中片段";
  if (result.type === "conversation") return `${result.conversationTitle || "对话记忆"} #${Number(result.chunkIndex) + 1}`;
  if (result.type === "memory") return `${result.conversationTitle || "长期记忆"} #${Number(result.chunkIndex) + 1}`;
  return `${result.fileName || "知识文件"} #${Number(result.chunkIndex) + 1}`;
}

function knowledgeSearchResultRef(result) {
  if (!result) return "[片段]";
  if (result.type === "conversation") {
    return `[对话记忆:${result.conversationTitle || result.conversationId}#${Number(result.chunkIndex) + 1}]`;
  }
  if (result.type === "memory") {
    return `[长期记忆:${result.conversationTitle || result.conversationId}#${Number(result.chunkIndex) + 1}]`;
  }
  return `[${result.fileName || "知识文件"}#${Number(result.chunkIndex) + 1}]`;
}

function promptTextForKnowledgeSearchResult(result) {
  return `请基于这个片段回答：${knowledgeSearchResultRef(result)}\n\n${String(result && result.text || "").slice(0, 1200)}`;
}

function insertKnowledgeSearchResult(result, append = false) {
  const text = promptTextForKnowledgeSearchResult(result);
  const current = els.prompt.value.trim();
  els.prompt.value = append && current ? `${current}\n\n${text}` : text;
  els.prompt.focus();
}

function canOpenKnowledgeSearchSource(result) {
  if (!result) return false;
  if (result.type === "file") return Boolean(result.knowledgeBaseId && result.fileId);
  return Boolean(result.conversationId);
}

async function openKnowledgeSearchSource(result) {
  if (!canOpenKnowledgeSearchSource(result)) return;
  if (result.type === "file") {
    const opened = await window.deskchat.openKnowledgeFile(result.knowledgeBaseId, result.fileId);
    if (opened && opened.ok === false) await addAssistantNotice(opened.error || "打开文件失败。");
    return;
  }

  const store = await window.deskchat.getConversations();
  const source = (store.conversations || []).find((conversation) => conversation.id === result.conversationId);
  if (!source) {
    await addAssistantNotice("找不到这条记忆对应的原始对话。");
    return;
  }

  const sourceBase = result.knowledgeBaseId
    ? knowledgeBases.find((base) => base.id === result.knowledgeBaseId)
    : knowledgeBaseForConversation(result.conversationId);
  activeKnowledgeBaseId = sourceBase ? sourceBase.id : null;
  await window.deskchat.setActiveKnowledgeBase(activeKnowledgeBaseId);
  applyConversationStore(store, result.conversationId);
  await loadKnowledgeBases(activeKnowledgeBaseId);
}

async function runKnowledgeSearch() {
  const base = activeKnowledgeBase();
  const query = els.knowledgeSearchInput ? els.knowledgeSearchInput.value.trim() : "";
  const runId = knowledgeSearchRunId + 1;
  knowledgeSearchRunId = runId;
  clearKnowledgeSearchResults();
  if (!els.knowledgeSearchResults || query.length < 2) return;

  let knowledgeSearch;
  let memorySearch;
  try {
    [knowledgeSearch, memorySearch] = await Promise.all([
      base
        ? window.deskchat.searchKnowledgeMemories(base.id, query, {
            fileLimit: 5,
            conversationLimit: 3,
            excludeConversationId: currentConversationId
          })
        : Promise.resolve({ fileResults: [], conversationResults: [] }),
      window.deskchat.searchMemories(query, {
        limit: base ? 4 : 8,
        excludeConversationIds: memoryExcludeConversationIds(),
        includeDisabled: true
      })
    ]);
  } catch (error) {
    const latestQuery = els.knowledgeSearchInput ? els.knowledgeSearchInput.value.trim() : "";
    if (runId !== knowledgeSearchRunId || latestQuery !== query) return;
    showKnowledgeSearchMessage(`搜索失败：${error.message || "未知错误"}`, "knowledge-search-empty knowledge-search-error");
    return;
  }

  const latestQuery = els.knowledgeSearchInput ? els.knowledgeSearchInput.value.trim() : "";
  if (runId !== knowledgeSearchRunId || latestQuery !== query) return;
  const results = [
    ...((knowledgeSearch.fileResults || []).map((result) => ({ ...result, type: "file" }))),
    ...((knowledgeSearch.conversationResults || []).map((result) => ({ ...result, type: "conversation" }))),
    ...((memorySearch.results || []).map((result) => ({ ...result, type: "memory" })))
  ].sort((a, b) => b.score - a.score).slice(0, 8);

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "knowledge-search-empty";
    empty.textContent = "没有命中知识或记忆";
    els.knowledgeSearchResults.appendChild(empty);
    return;
  }

  for (const result of results) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "knowledge-search-result";
    const isConversation = result.type === "conversation";
    const isMemory = result.type === "memory";
    const title = knowledgeSearchResultTitle(result);
    item.innerHTML = `
      <span>${escapeHtml(isConversation || isMemory ? `记忆：${title}` : title)}</span>
      <small>${escapeHtml(result.text.slice(0, 180))}</small>
    `;
    item.addEventListener("click", () => insertKnowledgeSearchResult(result));
    bindContextMenu(item, () => [
      { label: "引用到输入框", action: () => insertKnowledgeSearchResult(result) },
      { label: "追加到输入框", action: () => insertKnowledgeSearchResult(result, true) },
      {
        label: "复制片段",
        action: () => window.deskchat.copyText(`${knowledgeSearchResultRef(result)}\n\n${result.text || ""}`)
      },
      { type: "separator" },
      {
        label: result.type === "file" ? "打开文件" : "打开原对话",
        disabled: !canOpenKnowledgeSearchSource(result),
        action: () => openKnowledgeSearchSource(result)
      }
    ]);
    els.knowledgeSearchResults.appendChild(item);
  }
}

function removeAttachmentAt(index) {
  if (index < 0 || index >= pendingImages.length) return;
  pendingImages.splice(index, 1);
  renderAttachments();
}

function moveAttachment(index, offset) {
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || index >= pendingImages.length || nextIndex >= pendingImages.length) return;
  const [item] = pendingImages.splice(index, 1);
  pendingImages.splice(nextIndex, 0, item);
  renderAttachments();
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
      removeAttachmentAt(index);
    });
    item.append(img, remove);
    bindContextMenu(item, () => [
      { label: "删除附件", action: () => removeAttachmentAt(index) },
      { label: "前移", disabled: index <= 0, action: () => moveAttachment(index, -1) },
      { label: "后移", disabled: index >= pendingImages.length - 1, action: () => moveAttachment(index, 1) },
      { label: "复制图片数据", action: () => window.deskchat.copyText(dataUrl) },
      { type: "separator" },
      {
        label: "清空全部附件",
        danger: true,
        disabled: !pendingImages.length,
        action: () => {
          pendingImages = [];
          renderAttachments();
        }
      }
    ]);
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
    await addAssistantNotice("请先选择或创建一个知识库，再上传文件。");
    return;
  }

  for (const file of files) {
    if (file.size > KNOWLEDGE_FILE_LIMIT_BYTES) {
      await addAssistantNotice(`文件「${file.name}」超过 1 GB，暂未导入知识库。`);
      continue;
    }

    try {
      const buffer = await file.arrayBuffer();
      await window.deskchat.addKnowledgeFile(target.id, {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        bytes: new Uint8Array(buffer)
      });
    } catch (error) {
      await addAssistantNotice(`文件「${file.name}」导入失败：${error.message}`);
    }
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
    "下面是按用户问题检索出的知识库片段和对话记忆。回答时优先引用这些材料；如果材料不足，请明确说明。文件引用格式使用 [文件名#片段序号]，对话记忆引用格式使用 [对话记忆:标题#片段序号]。"
  ];

  if (!base.files.length && !base.conversationIds.length) {
    lines.push("当前知识库还没有上传文件。");
  } else {
    let search;
    try {
      search = await window.deskchat.searchKnowledgeMemories(base.id, query || "", {
        fileLimit: 8,
        conversationLimit: 4,
        excludeConversationId: currentConversationId
      });
    } catch (error) {
      lines.push(`知识库检索暂时失败：${error.message || "未知错误"}。本次回答不要假设已检索到知识库内容。`);
      return lines.join("\n");
    }
    if (search.fileResults && search.fileResults.length) {
      lines.push("\n文件片段：");
      for (const result of search.fileResults) {
        lines.push(`\n[${result.fileName}#${Number(result.chunkIndex) + 1}] score=${result.score}`);
        lines.push(result.text);
      }
    }
    if (search.conversationResults && search.conversationResults.length) {
      lines.push("\n对话记忆：");
      for (const result of search.conversationResults) {
        lines.push(`\n[对话记忆:${result.conversationTitle || result.conversationId}#${Number(result.chunkIndex) + 1}] score=${result.score}`);
        lines.push(result.text);
      }
    }
    if (!(search.fileResults && search.fileResults.length) && !(search.conversationResults && search.conversationResults.length)) {
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

async function buildRetrievedMemoryContextPrompt(query) {
  const memory = normalizeMemorySettings(getSettings().memory);
  if (!memory.enabled || !memory.recallEnabled || !memory.recallLimit) return "";
  let search;
  try {
    search = await window.deskchat.searchMemories(query || "", {
      limit: memory.recallLimit,
      excludeConversationIds: memoryExcludeConversationIds()
    });
  } catch (error) {
    return [
      "",
      "",
      `长期记忆检索暂时失败：${error.message || "未知错误"}。本次回答不要假设已召回历史记忆。`
    ].join("\n");
  }
  const results = search && Array.isArray(search.results) ? search.results : [];
  if (!results.length) return "";

  const lines = [
    "",
    "",
    "长期记忆：",
    "下面是从历史对话自动召回的相关记忆。回答时只在确实相关时使用；如果与当前问题冲突，以用户本轮明确要求为准。引用格式使用 [长期记忆:标题#片段序号]。"
  ];

  for (const result of results) {
    lines.push(`\n[长期记忆:${result.conversationTitle || result.conversationId}#${Number(result.chunkIndex) + 1}] score=${result.score}`);
    lines.push(result.text);
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

function requestedToolNamesForMessage(text) {
  const input = String(text || "").toLowerCase();
  const names = new Set();

  if (/(截图|截屏|屏幕截图|看一下.*屏幕|看看.*屏幕|看.*我的屏幕|看看.*我在做什么|看.*我在做什么|screenshot|screen capture|capture screen)/i.test(input)) {
    names.add("take_screenshot");
  }

  if (/(帮我|请|你|直接)?(执行|运行|跑一下|run).*(命令|指令|powershell|cmd|终端|terminal|shell|npm|node|git|docker)/i.test(input)) {
    names.add("run_command");
  }

  if (/(移动鼠标|鼠标移动|帮我点击|替我点击|点击屏幕|点一下屏幕|move .*mouse|click .*screen)/i.test(input)) {
    names.add("move_mouse");
    names.add("click_mouse");
  }

  return names;
}

function toolsForRequest(settings, toolNames) {
  if (!settings.enableTools || !toolNames || !toolNames.size) return [];
  const tools = window.DeskchatConfig.TOOL_DEFINITIONS || [];
  return tools.filter((tool) => {
    const name = tool.function && tool.function.name;
    if (!toolNames.has(name)) return false;
    if (name === "take_screenshot" && !settings.supportsVision) return false;
    return true;
  });
}

function formatCommandResult(result) {
  const lines = [];
  lines.push(`Exit code: ${result && Number.isInteger(result.code) ? result.code : "unknown"}`);
  if (result && result.signal) lines.push(`Signal: ${result.signal}`);
  if (result && result.stdout) lines.push(`\nstdout:\n${String(result.stdout).trimEnd()}`);
  if (result && result.stderr) lines.push(`\nstderr:\n${String(result.stderr).trimEnd()}`);
  if (!result || (!result.stdout && !result.stderr)) lines.push("\n(no output)");
  return lines.join("\n").slice(0, 6000);
}

async function callModel(messages, options = {}) {
  const settings = getSettings();
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error("请先填写 API 地址、API Key 和模型名。");
  }

  const body = {
    model: settings.model,
    messages,
    temperature: 0.7
  };

  const tools = toolsForRequest(settings, options.toolNames);
  if (tools.length) {
    body.tools = tools;
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
        content: [{ type: "text", text: "这是刚刚通过截图工具获得的屏幕截图，请基于它继续回答。" }, imagePart(shot.dataUrl)],
        remember: false
      }
    };
  }

  if (name === "run_command") {
    const result = await window.deskchat.runCommand(args);
    const shown = formatCommandResult(result);
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
      pendingImages = [...images, ...pendingImages];
      renderAttachments();
      await addAssistantNotice(
        "当前 API 配置是“仅文本”，不能发送图片或截图。请在 API 配置里开启“支持图片输入”，或切换到支持视觉的模型/中转站。"
      );
      return;
    }

    const userMessageIndex = chatMessages.length;
    chatMessages.push({ role: "user", content: userContent(text, images) });
    addMessage("user", text || "请分析图片。", images, userMessageIndex);
    await persistCurrentConversation();

    const settings = getSettings();
    const capabilityPrompt = settings.supportsVision ? "" : window.DeskchatConfig.TEXT_ONLY_CAPABILITY_PROMPT;
    const formatPrompt = window.DeskchatConfig.RESPONSE_FORMAT_PROMPT;
    const knowledgePrompt = await buildRetrievedKnowledgeContextPrompt(text);
    const memoryPrompt = await buildRetrievedMemoryContextPrompt(text);
    let apiMessages = [
      { role: "system", content: `${settings.systemPrompt}${capabilityPrompt}${formatPrompt}${knowledgePrompt}${memoryPrompt}` },
      ...messagesForModel(chatMessages, settings)
    ];
    let finalText = "";
    const requestedToolNames = requestedToolNamesForMessage(text);

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      const assistantMessage = await callModel(apiMessages, { toolNames: requestedToolNames });
      apiMessages.push(assistantMessage);

      if (!assistantMessage.tool_calls || !assistantMessage.tool_calls.length) {
        finalText = assistantMessage.content || "";
        const assistantMessageIndex = chatMessages.length;
        chatMessages.push({ role: "assistant", content: finalText });
        addMessage("assistant", finalText || "完成。", [], assistantMessageIndex);
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
      apiMessages.push({ role: "assistant", content: "工具步骤已达到上限，请继续发送一句话让我接着处理。", remember: false });
    }

    chatMessages = messagesForStorage(apiMessages.slice(1));
    renderMessages();
    await persistCurrentConversation();
  } catch (error) {
    const errorMessageIndex = chatMessages.length;
    chatMessages.push({ role: "assistant", content: `出错了：${error.message}`, remember: false });
    addMessage("assistant", `出错了：${error.message}`, [], errorMessageIndex);
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
    await addAssistantNotice(`截图失败：${error.message}`);
  }
}

els.toolbarSettings.addEventListener("click", () => window.deskchat.openSettings());
els.toolbarNewWindow.addEventListener("click", () => window.deskchat.openChatWindow(currentConversationId));
if (els.toolbarOpenTodo) {
  els.toolbarOpenTodo.addEventListener("click", openTodoWindow);
}
if (els.toolbarMemoryCenter) {
  els.toolbarMemoryCenter.addEventListener("click", openMemoryCenter);
}
els.compactButton.addEventListener("click", async () => {
  applyWindowState(await window.deskchat.setCompactMode(!windowState.compact));
});
els.pinButton.addEventListener("click", async () => {
  applyWindowState(await window.deskchat.setPinnedMode(!windowState.pinned));
});
els.newConversation.addEventListener("click", createConversationFromMenu);
if (els.openTodoList) {
  els.openTodoList.addEventListener("click", openTodoWindow);
}
if (els.openMemoryCenter) {
  els.openMemoryCenter.addEventListener("click", openMemoryCenter);
}
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
bindContextMenu(document.querySelector(".sidebar"), () => [
  { label: "新建对话", action: createConversationFromMenu },
  { label: "新建知识库", action: () => els.newKnowledgeBase.click() },
  { label: "打开 Todo", action: openTodoWindow },
  { label: "记忆中心", action: openMemoryCenter },
  { label: "设置", action: () => window.deskchat.openSettings() },
  { type: "separator" },
  {
    label: "上传知识文件",
    disabled: !activeKnowledgeBase(),
    action: () => els.knowledgeFileInput.click()
  },
  {
    label: "清除知识库选择",
    disabled: !activeKnowledgeBaseId,
    action: async () => {
      activeKnowledgeBaseId = null;
      await window.deskchat.setActiveKnowledgeBase(null);
      if (els.knowledgeSearchInput) els.knowledgeSearchInput.value = "";
      clearKnowledgeSearchResults();
      renderConversationList();
    }
  }
]);
bindContextMenu(els.messages, () => [
  { label: "新建对话", action: createConversationFromMenu },
  { label: "打开 Todo", action: openTodoWindow },
  { label: "记忆中心", action: openMemoryCenter },
  { type: "separator" },
  { label: "截图到输入框", action: captureToAttachments },
  {
    label: "上传图片",
    action: () => els.fileInput.click()
  },
  {
    label: "上传知识文件",
    disabled: !activeKnowledgeBase(),
    action: () => els.knowledgeFileInput.click()
  },
  { type: "separator" },
  {
    label: "清空当前对话",
    disabled: !chatMessages.length,
    danger: true,
    action: clearCurrentConversation
  },
  {
    label: "删除当前对话",
    disabled: !currentConversationId || conversations.length <= 1,
    danger: true,
    action: deleteCurrentConversation
  }
]);
bindContextMenu(document.querySelector(".chat-toolbar"), () => [
  { label: "新窗口打开当前对话", disabled: !currentConversationId, action: () => window.deskchat.openChatWindow(currentConversationId) },
  { label: windowState.compact ? "恢复窗口" : "长条模式", action: async () => applyWindowState(await window.deskchat.setCompactMode(!windowState.compact)) },
  { label: windowState.pinned ? "取消置顶" : "置顶", action: async () => applyWindowState(await window.deskchat.setPinnedMode(!windowState.pinned)) },
  { type: "separator" },
  { label: "API 配置", action: () => window.deskchat.openSettings() },
  { label: "打开 Todo", action: openTodoWindow },
  { label: "记忆中心", action: openMemoryCenter }
]);
bindContextMenu(els.composer, () => [
  { label: "发送", disabled: busy || (!els.prompt.value.trim() && !pendingImages.length), action: () => els.composer.requestSubmit() },
  { label: "截图到输入框", action: captureToAttachments },
  { label: "上传图片", action: () => els.fileInput.click() },
  {
    label: "清空附件",
    disabled: !pendingImages.length,
    action: () => {
      pendingImages = [];
      renderAttachments();
    }
  },
  { type: "separator" },
  {
    label: "清空输入框",
    disabled: !els.prompt.value.length,
    action: () => {
      els.prompt.value = "";
      els.prompt.focus();
    }
  }
]);
els.toolbarUploadKnowledge.addEventListener("click", async () => {
  if (!activeKnowledgeBase()) {
    await addAssistantNotice("请先在左侧选择或创建一个知识库。");
    return;
  }
  els.knowledgeFileInput.click();
});
els.toolbarLinkKnowledge.addEventListener("click", async () => {
  if (knowledgePickerOpen) {
    closeKnowledgePicker();
    return;
  }
  await openKnowledgePicker(els.toolbarLinkKnowledge);
});
els.toolbarDeleteConversation.addEventListener("click", deleteCurrentConversation);
window.deskchat.onWindowState(applyWindowState);
window.deskchat.onSettingsUpdated((settings) => {
  currentSettings = settings;
  updateSettingsSummary();
});
window.deskchat.onConversationsUpdated((store) => {
  applyConversationStore(store, currentConversationId);
});
window.deskchat.onMemoriesUpdated(() => {
  if (els.knowledgeSearchInput && els.knowledgeSearchInput.value.trim().length >= 2) {
    runKnowledgeSearch();
  }
  if (memoryPanel) refreshMemoryPanel();
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

els.toolbarClearButton.addEventListener("click", clearCurrentConversation);

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
  if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
  if (activeMenuGroup && !activeMenuGroup.contains(event.target)) closeAppMenus();
  if (memoryPanel && event.target === memoryPanel) closeMemoryPanel();
  if (!knowledgePickerOpen) return;
  const picker = document.querySelector(".knowledge-picker");
  if (picker && !picker.contains(event.target) && !els.toolbarLinkKnowledge.contains(event.target)) {
    closeKnowledgePicker();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (memoryPanel) closeMemoryPanel();
  if (knowledgeGraphPanel) closeKnowledgeGraphPanel();
  if (mindMapPanel) closeMindMapPanel();
  if (contextMenu) closeContextMenu();
  if (knowledgePickerOpen) closeKnowledgePicker();
  if (activeMenuGroup) closeAppMenus();
});

loadSettings().catch(async (error) => {
  await addAssistantNotice(`读取设置失败：${error.message}`);
});
loadConversations().catch(async (error) => {
  await addAssistantNotice(`读取历史对话失败：${error.message}`);
});
loadKnowledgeBases().catch(async (error) => {
  await addAssistantNotice(`读取知识库失败：${error.message}`);
});
window.deskchat.getWindowState().then(applyWindowState).catch(() => {});
renderEmpty();

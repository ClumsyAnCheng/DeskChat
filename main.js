const { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { exec } = require("node:child_process");
const { Transformer } = require("markmap-lib");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");

const isWindows = process.platform === "win32";
const chatWindows = new Set();
const windowModes = new Map();
let mainWindow = null;
let settingsWindow = null;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "was",
  "were",
  "you",
  "your",
  "have",
  "has",
  "not",
  "but",
  "can",
  "will",
  "about",
  "into",
  "what",
  "when",
  "where",
  "which",
  "how",
  "为什么",
  "什么",
  "如何",
  "怎么",
  "以及",
  "这个",
  "那个",
  "我们",
  "你们",
  "他们",
  "是否"
]);

const defaultSystemPrompt =
  "你是一个运行在用户电脑上的桌面 AI 助手。你可以分析用户上传的图片和截图，也可以在用户明确要求时调用工具执行命令、移动鼠标或点击。调用命令和鼠标工具前先简短说明意图。";

const defaultApiConfig = {
  id: "default-openai",
  name: "OpenAI",
  provider: "openai",
  providerName: "OpenAI",
  baseUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-5.5",
  enableTools: true,
  supportsVision: true,
  systemPrompt: defaultSystemPrompt
};

const defaultRagflowConfig = {
  enabled: false,
  baseUrl: "http://localhost:9380",
  apiKey: "",
  datasetId: ""
};

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function userDataFile(name) {
  return path.join(app.getPath("userData"), name);
}

function ensureUserDataDir() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeApiConfig(config, index = 0) {
  const merged = { ...defaultApiConfig, ...(config || {}) };
  if (!merged.id) merged.id = index === 0 ? defaultApiConfig.id : makeId("api");
  if (!merged.name) merged.name = merged.providerName || merged.provider || `API ${index + 1}`;
  if (merged.supportsVision === undefined && merged.provider === "deepseek") merged.supportsVision = false;
  return merged;
}

function normalizeSettingsStore(raw) {
  let configs = [];
  let activeConfigId = raw && raw.activeConfigId;

  if (raw && Array.isArray(raw.apiConfigs)) {
    configs = raw.apiConfigs.map(normalizeApiConfig);
  } else if (raw && typeof raw === "object") {
    configs = [normalizeApiConfig({ ...raw, id: raw.id || defaultApiConfig.id, name: raw.name || raw.providerName })];
    activeConfigId = configs[0].id;
  }

  if (!configs.length) configs = [normalizeApiConfig(defaultApiConfig)];

  const seen = new Set();
  configs = configs.map((config, index) => {
    const next = normalizeApiConfig(config, index);
    if (seen.has(next.id)) next.id = makeId("api");
    seen.add(next.id);
    return next;
  });

  if (!configs.some((config) => config.id === activeConfigId)) activeConfigId = configs[0].id;
  const ragflow = {
    ...defaultRagflowConfig,
    ...((raw && raw.ragflow) || {})
  };
  ragflow.enabled = Boolean(ragflow.enabled);
  ragflow.baseUrl = String(ragflow.baseUrl || defaultRagflowConfig.baseUrl).replace(/\/+$/, "");
  ragflow.apiKey = String(ragflow.apiKey || "");
  ragflow.datasetId = String(ragflow.datasetId || "");
  return { activeConfigId, apiConfigs: configs, ragflow };
}

function settingsPath() {
  return userDataFile("settings.json");
}

function readSettingsStore() {
  return normalizeSettingsStore(readJson(settingsPath(), null));
}

function activeSettings(store = readSettingsStore()) {
  const active = store.apiConfigs.find((config) => config.id === store.activeConfigId) || store.apiConfigs[0];
  return { ...active, activeConfigId: store.activeConfigId, apiConfigs: store.apiConfigs, ragflow: store.ragflow || defaultRagflowConfig };
}

function persistSettingsStore(store) {
  const normalized = normalizeSettingsStore(store);
  ensureUserDataDir();
  fs.writeFileSync(settingsPath(), JSON.stringify(normalized, null, 2), "utf8");
  const current = activeSettings(normalized);
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("settings:updated", current);
  });
  return current;
}

function readSettings() {
  return activeSettings(readSettingsStore());
}

function writeSettings(settings) {
  const currentStore = readSettingsStore();
  if (settings && Array.isArray(settings.apiConfigs)) {
    return persistSettingsStore(settings);
  }

  const activeId = (settings && settings.id) || currentStore.activeConfigId;
  const existingIndex = currentStore.apiConfigs.findIndex((config) => config.id === activeId);
  const nextConfig = normalizeApiConfig({
    ...(existingIndex >= 0 ? currentStore.apiConfigs[existingIndex] : {}),
    ...(settings || {}),
    id: activeId
  });

  if (existingIndex >= 0) {
    currentStore.apiConfigs[existingIndex] = nextConfig;
  } else {
    currentStore.apiConfigs.push(nextConfig);
  }
  currentStore.activeConfigId = nextConfig.id;
  return persistSettingsStore(currentStore);
}

function conversationsPath() {
  return userDataFile("conversations.json");
}

function normalizeConversation(conversation, index = 0) {
  const now = new Date().toISOString();
  return {
    id: conversation && conversation.id ? String(conversation.id) : makeId("chat"),
    title: conversation && conversation.title ? String(conversation.title) : `新对话 ${index + 1}`,
    messages: Array.isArray(conversation && conversation.messages) ? conversation.messages : [],
    createdAt: (conversation && conversation.createdAt) || now,
    updatedAt: (conversation && conversation.updatedAt) || now
  };
}

function normalizeConversationStore(raw) {
  let conversations = raw && Array.isArray(raw.conversations) ? raw.conversations.map(normalizeConversation) : [];
  if (!conversations.length) conversations = [normalizeConversation({ title: "新对话" })];

  const seen = new Set();
  conversations = conversations.map((conversation) => {
    const next = normalizeConversation(conversation);
    if (seen.has(next.id)) next.id = makeId("chat");
    seen.add(next.id);
    return next;
  });

  let activeConversationId = raw && raw.activeConversationId;
  if (!conversations.some((conversation) => conversation.id === activeConversationId)) {
    activeConversationId = conversations[0].id;
  }
  return { activeConversationId, conversations };
}

function readConversationStore() {
  return normalizeConversationStore(readJson(conversationsPath(), null));
}

function persistConversationStore(store) {
  const normalized = normalizeConversationStore(store);
  ensureUserDataDir();
  fs.writeFileSync(conversationsPath(), JSON.stringify(normalized, null, 2), "utf8");
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("conversations:updated", normalized);
  });
  return normalized;
}

function createConversation(title = "新对话") {
  const store = readConversationStore();
  const conversation = normalizeConversation({ title, messages: [] }, store.conversations.length);
  store.conversations.unshift(conversation);
  store.activeConversationId = conversation.id;
  persistConversationStore(store);
  return conversation;
}

function saveConversation(payload) {
  const store = readConversationStore();
  const now = new Date().toISOString();
  const id = payload && payload.id ? String(payload.id) : store.activeConversationId;
  const index = store.conversations.findIndex((conversation) => conversation.id === id);
  const conversation = normalizeConversation({
    ...(index >= 0 ? store.conversations[index] : {}),
    ...(payload || {}),
    id,
    updatedAt: now
  });

  if (index >= 0) {
    store.conversations[index] = conversation;
  } else {
    store.conversations.unshift(conversation);
  }
  store.activeConversationId = id;
  return persistConversationStore(store);
}

function deleteConversation(id) {
  const store = readConversationStore();
  const remaining = store.conversations.filter((conversation) => conversation.id !== id);
  const nextStore = normalizeConversationStore({
    activeConversationId: store.activeConversationId === id ? undefined : store.activeConversationId,
    conversations: remaining
  });
  const result = persistConversationStore(nextStore);
  removeConversationFromKnowledgeBases(id);
  return result;
}

function knowledgeBasesPath() {
  return userDataFile("knowledge-bases.json");
}

function knowledgeFilesRoot() {
  return userDataFile("knowledge-files");
}

function safeFileName(name) {
  return String(name || "file")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "file";
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenizeText(value) {
  const tokens = String(value || "")
    .toLowerCase()
    .match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9_-]{1,}/gu);
  return (tokens || []).filter((token) => !STOP_WORDS.has(token) && token.length <= 40);
}

function tokenSet(value) {
  return new Set(tokenizeText(value));
}

function splitTextIntoChunks(text, options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const maxChars = Number(options.maxChars) || 1400;
  const overlapChars = Number(options.overlapChars) || 180;
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  let index = 0;

  function pushCurrent() {
    const content = current.trim();
    if (!content) return;
    chunks.push({
      index,
      text: content,
      tokens: tokenizeText(content),
      charLength: content.length
    });
    index += 1;
    current = content.length > overlapChars ? content.slice(-overlapChars) : "";
  }

  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let start = 0; start < paragraph.length; start += maxChars - overlapChars) {
        const piece = paragraph.slice(start, start + maxChars).trim();
        if (!piece) continue;
        chunks.push({
          index,
          text: piece,
          tokens: tokenizeText(piece),
          charLength: piece.length
        });
        index += 1;
      }
      current = "";
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      pushCurrent();
      current = paragraph;
    } else {
      current = next;
    }
  }

  pushCurrent();
  return chunks.slice(0, 500);
}

function summarizeTextForMap(text) {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const headings = lines.filter((line) => /^#{1,6}\s+/.test(line)).slice(0, 40);
  if (headings.length) return headings.map((line) => line.replace(/^#{1,6}\s+/, "")).join("\n");
  return lines.slice(0, 80).join("\n").slice(0, 12000);
}

function extractOutlineFromText(text, fileName) {
  const source = summarizeTextForMap(text);
  const rawLines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = safeFileName(fileName).replace(/\.[^.]+$/, "") || "思维导图";
  const lines = [`# ${title}`];
  let added = 0;

  for (const raw of rawLines) {
    const markdownHeading = raw.match(/^(#{1,6})\s+(.+)$/);
    if (markdownHeading) {
      const level = Math.min(markdownHeading[1].length + 1, 6);
      lines.push(`${"#".repeat(level)} ${markdownHeading[2].slice(0, 96)}`);
      added += 1;
      continue;
    }

    const cleaned = raw.replace(/^[-*+\d.)\s]+/, "").slice(0, 120);
    if (!cleaned) continue;
    lines.push(`## ${cleaned}`);
    added += 1;
    if (added >= 60) break;
  }

  if (!added) lines.push("## 暂无可分析文本");
  return lines.join("\n");
}

function fileExtension(name) {
  return path.extname(String(name || "")).toLowerCase();
}

function looksLikeTextFile(name, type) {
  if (String(type || "").startsWith("text/")) return true;
  return /\.(md|txt|json|csv|tsv|log|xml|html|css|js|ts|tsx|jsx|py|java|c|cpp|cs|go|rs|php|rb|yml|yaml)$/i.test(name || "");
}

async function extractTextFromFileBuffer(file, bytes) {
  const name = file && file.name ? String(file.name) : "";
  const type = file && file.type ? String(file.type) : "";
  const ext = fileExtension(name);
  const buffer = Buffer.from(bytes || []);

  if (!buffer.length) return "";

  try {
    if (looksLikeTextFile(name, type)) return buffer.toString("utf8");

    if (ext === ".pdf" || type === "application/pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result && result.text ? result.text : "";
      } finally {
        await parser.destroy().catch(() => {});
      }
    }

    if (ext === ".docx" || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer });
      return result && result.value ? result.value : "";
    }

    if ([".xlsx", ".xls", ".csv", ".ods"].includes(ext) || /spreadsheet|excel|csv/i.test(type)) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      return workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const text = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
        return `# ${sheetName}\n${text}`;
      }).join("\n\n");
    }
  } catch {
    return "";
  }

  return normalizeText(file && file.fullText);
}

function getKnowledgeFileIndexStatus(file, chunks) {
  const now = new Date().toISOString();
  const indexedChunks = Array.isArray(chunks) ? chunks.length : Number(file && file.indexStats && file.indexStats.chunkCount) || 0;
  const storedPath = file && file.storedPath ? String(file.storedPath) : "";
  const sourceExists = storedPath ? fs.existsSync(storedPath) : false;
  const name = file && file.name ? String(file.name) : "";
  const ext = fileExtension(name);

  if (indexedChunks > 0) {
    return {
      state: "ready",
      label: "已索引",
      detail: `${indexedChunks} 个片段可检索。`,
      updatedAt: now
    };
  }

  if (storedPath && !sourceExists) {
    return {
      state: "source_missing",
      label: "原文件丢失",
      detail: "知识库记录存在，但上传副本不在本机；请重新导入该文件。",
      updatedAt: now
    };
  }

  if (ext === ".pdf" || String(file && file.type || "").includes("pdf")) {
    return {
      state: "empty_text",
      label: "未提取文本",
      detail: "PDF 未解析到文本；如果是扫描版或图片型 PDF，需要 OCR 后再入库。",
      updatedAt: now
    };
  }

  return {
    state: "empty_text",
    label: "未提取文本",
    detail: "文件未解析出可检索文本，请重建索引或重新导入。",
    updatedAt: now
  };
}

function normalizeKnowledgeFile(file) {
  const fullText = normalizeText(file && file.fullText);
  const hasStoredChunks = Array.isArray(file && file.chunks) && file.chunks.length > 0;
  const chunks = hasStoredChunks
    ? file.chunks.map((chunk, index) => ({
        index,
        text: normalizeText(chunk && chunk.text).slice(0, 2200),
        tokens: Array.isArray(chunk && chunk.tokens) ? chunk.tokens.slice(0, 260) : tokenizeText(chunk && chunk.text),
        charLength: Number(chunk && chunk.charLength) || normalizeText(chunk && chunk.text).length
      }))
    : splitTextIntoChunks(fullText || (file && file.textPreview));
  const now = new Date().toISOString();
  const indexStatus = getKnowledgeFileIndexStatus(file, chunks);
  return {
    id: file && file.id ? String(file.id) : makeId("file"),
    name: file && file.name ? String(file.name) : "未命名文件",
    type: file && file.type ? String(file.type) : "application/octet-stream",
    size: Number(file && file.size) || 0,
    addedAt: (file && file.addedAt) || now,
    storedPath: file && file.storedPath ? String(file.storedPath) : "",
    textPreview: file && file.textPreview ? String(file.textPreview).slice(0, 16000) : fullText.slice(0, 16000),
    fullText: fullText.slice(0, 500000),
    chunks,
    ragflowDocumentId: file && file.ragflowDocumentId ? String(file.ragflowDocumentId) : "",
    indexStats: {
      chunkCount: chunks.length,
      tokenCount: chunks.reduce((total, chunk) => total + (Array.isArray(chunk.tokens) ? chunk.tokens.length : 0), 0),
      indexedAt: (file && file.indexStats && file.indexStats.indexedAt) || now
    },
    indexStatus,
    mindMapMarkdown: file && file.mindMapMarkdown ? String(file.mindMapMarkdown).slice(0, 50000) : ""
  };
}

function normalizeKnowledgeBase(base, index = 0) {
  const now = new Date().toISOString();
  const conversationIds = Array.isArray(base && base.conversationIds)
    ? [...new Set(base.conversationIds.map((id) => String(id)))]
    : [];
  return {
    id: base && base.id ? String(base.id) : makeId("kb"),
    name: base && base.name ? String(base.name) : `知识库 ${index + 1}`,
    conversationIds,
    files: Array.isArray(base && base.files) ? base.files.map(normalizeKnowledgeFile) : [],
    expanded: base && base.expanded !== undefined ? Boolean(base.expanded) : true,
    createdAt: (base && base.createdAt) || now,
    updatedAt: (base && base.updatedAt) || now
  };
}

function normalizeKnowledgeStore(raw) {
  let knowledgeBases = raw && Array.isArray(raw.knowledgeBases) ? raw.knowledgeBases.map(normalizeKnowledgeBase) : [];
  const seen = new Set();
  knowledgeBases = knowledgeBases.map((base) => {
    const next = normalizeKnowledgeBase(base);
    if (seen.has(next.id)) next.id = makeId("kb");
    seen.add(next.id);
    return next;
  });

  let activeKnowledgeBaseId = raw && raw.activeKnowledgeBaseId ? String(raw.activeKnowledgeBaseId) : null;
  if (activeKnowledgeBaseId && !knowledgeBases.some((base) => base.id === activeKnowledgeBaseId)) {
    activeKnowledgeBaseId = null;
  }
  return { activeKnowledgeBaseId, knowledgeBases };
}

function readKnowledgeStore() {
  return normalizeKnowledgeStore(readJson(knowledgeBasesPath(), null));
}

function persistKnowledgeStore(store) {
  const normalized = normalizeKnowledgeStore(store);
  ensureUserDataDir();
  fs.writeFileSync(knowledgeBasesPath(), JSON.stringify(normalized, null, 2), "utf8");
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("knowledge:updated", normalized);
  });
  return normalized;
}

function createKnowledgeBase(name = "新知识库") {
  const store = readKnowledgeStore();
  const base = normalizeKnowledgeBase({ name }, store.knowledgeBases.length);
  store.knowledgeBases.unshift(base);
  store.activeKnowledgeBaseId = base.id;
  persistKnowledgeStore(store);
  return base;
}

function saveKnowledgeBase(payload) {
  const store = readKnowledgeStore();
  const now = new Date().toISOString();
  const id = payload && payload.id ? String(payload.id) : "";
  const index = store.knowledgeBases.findIndex((base) => base.id === id);
  if (index < 0) return persistKnowledgeStore(store);

  store.knowledgeBases[index] = normalizeKnowledgeBase({
    ...store.knowledgeBases[index],
    ...(payload || {}),
    id,
    updatedAt: now
  }, index);
  if (payload && Object.prototype.hasOwnProperty.call(payload, "active")) {
    store.activeKnowledgeBaseId = payload.active ? id : null;
  }
  return persistKnowledgeStore(store);
}

function deleteKnowledgeBase(id) {
  const store = readKnowledgeStore();
  const targetId = String(id || "");
  const remaining = store.knowledgeBases.filter((base) => base.id !== targetId);
  const result = persistKnowledgeStore({
    activeKnowledgeBaseId: store.activeKnowledgeBaseId === targetId ? null : store.activeKnowledgeBaseId,
    knowledgeBases: remaining
  });

  const root = path.resolve(knowledgeFilesRoot());
  const target = path.resolve(root, targetId);
  if (targetId && target.startsWith(root + path.sep) && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  return result;
}

function setActiveKnowledgeBase(id) {
  const store = readKnowledgeStore();
  const targetId = id ? String(id) : null;
  store.activeKnowledgeBaseId = store.knowledgeBases.some((base) => base.id === targetId) ? targetId : null;
  return persistKnowledgeStore(store);
}

function linkConversationToKnowledgeBase(knowledgeBaseId, conversationId) {
  const store = readKnowledgeStore();
  const targetId = String(knowledgeBaseId || "");
  const chatId = String(conversationId || "");
  const index = store.knowledgeBases.findIndex((base) => base.id === targetId);
  if (index < 0 || !chatId) return persistKnowledgeStore(store);

  for (const base of store.knowledgeBases) {
    base.conversationIds = base.conversationIds.filter((id) => id !== chatId);
  }
  store.knowledgeBases[index].conversationIds.unshift(chatId);
  store.knowledgeBases[index].conversationIds = [...new Set(store.knowledgeBases[index].conversationIds)];
  store.knowledgeBases[index].updatedAt = new Date().toISOString();
  store.activeKnowledgeBaseId = targetId;
  return persistKnowledgeStore(store);
}

function unlinkConversationFromKnowledgeBase(knowledgeBaseId, conversationId) {
  const store = readKnowledgeStore();
  const targetId = String(knowledgeBaseId || "");
  const chatId = String(conversationId || "");
  const base = store.knowledgeBases.find((item) => item.id === targetId);
  if (!base || !chatId) return persistKnowledgeStore(store);
  base.conversationIds = base.conversationIds.filter((id) => id !== chatId);
  base.updatedAt = new Date().toISOString();
  return persistKnowledgeStore(store);
}

function removeConversationFromKnowledgeBases(conversationId) {
  const store = readKnowledgeStore();
  const chatId = String(conversationId || "");
  let changed = false;
  for (const base of store.knowledgeBases) {
    const nextIds = base.conversationIds.filter((id) => id !== chatId);
    if (nextIds.length !== base.conversationIds.length) {
      base.conversationIds = nextIds;
      base.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) persistKnowledgeStore(store);
}

async function addKnowledgeFile(knowledgeBaseId, file) {
  const store = readKnowledgeStore();
  const targetId = String(knowledgeBaseId || "");
  const index = store.knowledgeBases.findIndex((base) => base.id === targetId);
  if (index < 0) return persistKnowledgeStore(store);

  const fileId = makeId("file");
  const originalName = safeFileName(file && file.name);
  const storedName = `${fileId}-${originalName}`;
  const dir = path.join(knowledgeFilesRoot(), targetId);
  fs.mkdirSync(dir, { recursive: true });
  const storedPath = path.join(dir, storedName);
  const bytes = file && file.bytes ? Buffer.from(file.bytes) : Buffer.alloc(0);
  fs.writeFileSync(storedPath, bytes);
  const fallbackText = (file && (file.fullText || file.textPreview)) || "";
  const extractedText = normalizeText((await extractTextFromFileBuffer(file, bytes)) || fallbackText);

  const item = normalizeKnowledgeFile({
    id: fileId,
    name: originalName,
    type: file && file.type,
    size: file && file.size,
    storedPath,
    textPreview: extractedText.slice(0, 16000),
    fullText: extractedText
  });
  store.knowledgeBases[index].files.unshift(item);
  store.knowledgeBases[index].updatedAt = new Date().toISOString();
  store.activeKnowledgeBaseId = targetId;
  return persistKnowledgeStore(store);
}

async function reindexKnowledgeFile(knowledgeBaseId, fileId) {
  const store = readKnowledgeStore();
  const targetId = String(knowledgeBaseId || "");
  const targetFileId = String(fileId || "");
  const baseIndex = store.knowledgeBases.findIndex((base) => base.id === targetId);
  if (baseIndex < 0) return { ok: false, error: "Knowledge base not found." };

  const base = store.knowledgeBases[baseIndex];
  const fileIndex = base.files.findIndex((item) => item.id === targetFileId);
  if (fileIndex < 0) return { ok: false, error: "File not found." };

  const file = base.files[fileIndex];
  if (!file.storedPath) {
    file.indexStatus = {
      state: "source_missing",
      label: "原文件丢失",
      detail: "知识库中没有该文件的本地上传副本，请重新导入。",
      updatedAt: new Date().toISOString()
    };
    base.updatedAt = new Date().toISOString();
    const nextStore = persistKnowledgeStore(store);
    return { ok: false, error: file.indexStatus.detail, store: nextStore };
  }

  const root = path.resolve(knowledgeFilesRoot());
  const target = path.resolve(file.storedPath);
  if (!(target === root || target.startsWith(root + path.sep)) || !fs.existsSync(target)) {
    file.indexStatus = {
      state: "source_missing",
      label: "原文件丢失",
      detail: "知识库记录存在，但上传副本不在本机；请重新导入该文件。",
      updatedAt: new Date().toISOString()
    };
    base.updatedAt = new Date().toISOString();
    const nextStore = persistKnowledgeStore(store);
    return { ok: false, error: file.indexStatus.detail, store: nextStore };
  }

  const bytes = fs.readFileSync(target);
  const extractedText = normalizeText(await extractTextFromFileBuffer(file, bytes));
  const nextFile = normalizeKnowledgeFile({
    ...file,
    textPreview: extractedText.slice(0, 16000),
    fullText: extractedText,
    chunks: undefined,
    indexStats: undefined,
    indexStatus: undefined,
    mindMapMarkdown: ""
  });

  base.files[fileIndex] = nextFile;
  base.updatedAt = new Date().toISOString();
  const nextStore = persistKnowledgeStore(store);

  if (!nextFile.indexStats.chunkCount) {
    return {
      ok: false,
      error: nextFile.indexStatus.detail,
      file: nextFile,
      store: nextStore
    };
  }

  return { ok: true, file: nextFile, store: nextStore };
}

function removeKnowledgeFile(knowledgeBaseId, fileId) {
  const store = readKnowledgeStore();
  const targetId = String(knowledgeBaseId || "");
  const targetFileId = String(fileId || "");
  const base = store.knowledgeBases.find((item) => item.id === targetId);
  if (!base) return persistKnowledgeStore(store);
  const file = base.files.find((item) => item.id === targetFileId);
  base.files = base.files.filter((item) => item.id !== targetFileId);
  base.updatedAt = new Date().toISOString();
  if (file && file.storedPath && fs.existsSync(file.storedPath)) {
    const root = path.resolve(knowledgeFilesRoot());
    const target = path.resolve(file.storedPath);
    if (target.startsWith(root + path.sep)) fs.rmSync(target, { force: true });
  }
  return persistKnowledgeStore(store);
}

async function openKnowledgeFile(knowledgeBaseId, fileId) {
  const store = readKnowledgeStore();
  const base = store.knowledgeBases.find((item) => item.id === String(knowledgeBaseId || ""));
  const file = base && base.files.find((item) => item.id === String(fileId || ""));
  if (!file || !file.storedPath) return { ok: false, error: "File not found." };
  const error = await shell.openPath(file.storedPath);
  return error ? { ok: false, error } : { ok: true };
}

function scoreChunk(queryTokens, chunk, fileName) {
  if (!queryTokens.size || !chunk || !chunk.text) return 0;
  const chunkTokens = Array.isArray(chunk.tokens) && chunk.tokens.length ? chunk.tokens : tokenizeText(chunk.text);
  const chunkSet = new Set(chunkTokens);
  const nameSet = tokenSet(fileName);
  let score = 0;

  for (const token of queryTokens) {
    if (chunkSet.has(token)) score += 8;
    if (nameSet.has(token)) score += 3;
    if (String(chunk.text).toLowerCase().includes(token)) score += 2;
  }

  const density = chunkTokens.length ? score / Math.sqrt(chunkTokens.length) : score;
  return Number((score + density).toFixed(4));
}

async function searchKnowledgeBase(knowledgeBaseId, query, options = {}) {
  const store = readKnowledgeStore();
  const base = store.knowledgeBases.find((item) => item.id === String(knowledgeBaseId || ""));
  if (!base) return { knowledgeBaseId: null, query: String(query || ""), results: [], diagnostics: [] };

  const queryText = normalizeText(query);
  const queryTokens = tokenSet(queryText);
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 20));
  const results = [];
  const diagnostics = [];

  for (const file of base.files) {
    let currentFile = file;
    let chunks = Array.isArray(currentFile.chunks) && currentFile.chunks.length
      ? currentFile.chunks
      : splitTextIntoChunks(currentFile.fullText || currentFile.textPreview);

    if (!chunks.length && currentFile.storedPath) {
      const reindex = await reindexKnowledgeFile(base.id, currentFile.id);
      if (reindex.file) {
        currentFile = reindex.file;
        chunks = Array.isArray(currentFile.chunks) ? currentFile.chunks : [];
      }
      if (!reindex.ok) {
        diagnostics.push({
          fileId: currentFile.id,
          fileName: currentFile.name,
          state: currentFile.indexStatus && currentFile.indexStatus.state || "empty_text",
          message: reindex.error || "文件未能建立索引。"
        });
      }
    }

    if (!chunks.length) {
      const status = getKnowledgeFileIndexStatus(currentFile, chunks);
      diagnostics.push({
        fileId: currentFile.id,
        fileName: currentFile.name,
        state: status.state,
        message: status.detail
      });
      continue;
    }

    for (const chunk of chunks) {
      const score = scoreChunk(queryTokens, chunk, currentFile.name);
      if (score <= 0) continue;
      results.push({
        knowledgeBaseId: base.id,
        knowledgeBaseName: base.name,
        fileId: currentFile.id,
        fileName: currentFile.name,
        chunkIndex: chunk.index,
        score,
        text: String(chunk.text || "").slice(0, 1800)
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return {
    knowledgeBaseId: base.id,
    knowledgeBaseName: base.name,
    query: queryText,
    results: results.slice(0, limit),
    diagnostics
  };
}

async function getKnowledgeMindMap(knowledgeBaseId, fileId) {
  const store = readKnowledgeStore();
  const base = store.knowledgeBases.find((item) => item.id === String(knowledgeBaseId || ""));
  let file = base && base.files.find((item) => item.id === String(fileId || ""));
  if (!base || !file) return { ok: false, error: "File not found." };

  if (!(file.fullText || file.textPreview || (Array.isArray(file.chunks) && file.chunks.length)) && file.storedPath) {
    const reindex = await reindexKnowledgeFile(base.id, file.id);
    if (reindex.file) file = reindex.file;
    if (!reindex.ok) return { ok: false, error: reindex.error || "该文件没有可分析文本。", file };
  }

  const sourceText = file.fullText || file.textPreview || (Array.isArray(file.chunks) ? file.chunks.map((chunk) => chunk.text).join("\n\n") : "");
  if (!normalizeText(sourceText)) {
    const status = getKnowledgeFileIndexStatus(file, file.chunks || []);
    return { ok: false, error: status.detail, file };
  }

  const markdown = file.mindMapMarkdown || extractOutlineFromText(sourceText, file.name);
  const transformer = new Transformer();
  const { root, features } = transformer.transform(markdown);
  return {
    ok: true,
    knowledgeBaseId: base.id,
    knowledgeBaseName: base.name,
    fileId: file.id,
    fileName: file.name,
    markdown,
    root,
    features
  };
}

function ragflowConfig() {
  const settings = readSettingsStore();
  return settings.ragflow || defaultRagflowConfig;
}

function normalizeRagflowGraph(raw) {
  const source = raw && raw.data ? raw.data : raw;
  const graph = source && source.graph ? source.graph : source;
  const rawNodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
  const rawLinks = Array.isArray(graph && graph.edges)
    ? graph.edges
    : Array.isArray(graph && graph.links)
      ? graph.links
      : [];
  const nodes = rawNodes.map((node, index) => {
    const id = String(node.id || node.entity_id || node.entity_name || node.name || node.label || index);
    const label = String(node.label || node.entity_name || node.name || node.title || id);
    return {
      id,
      label,
      title: String(node.title || label),
      type: String(node.type || node.category || "concept"),
      detail: String(node.description || node.detail || node.summary || "")
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = rawLinks
    .map((link) => ({
      source: String(link.src_id || link.source_id || link.source || link.from || link.src || ""),
      target: String(link.tgt_id || link.target_id || link.target || link.to || link.dst || ""),
      label: String(link.label || link.type || link.relation || "")
    }))
    .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));
  return { nodes, links };
}

async function ragflowRequest(config, apiPath, options = {}) {
  const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("RAGFlow base URL is empty.");
  const response = await fetch(`${baseUrl}${apiPath}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json"
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && body.message ? body.message : text || response.statusText;
    throw new Error(`RAGFlow ${response.status}: ${message}`);
  }
  if (body && typeof body === "object" && body.code !== undefined && Number(body.code) !== 0) {
    throw new Error(body.message || `RAGFlow returned code ${body.code}`);
  }
  return body;
}

async function updateKnowledgeFilePatch(knowledgeBaseId, fileId, patch) {
  const store = readKnowledgeStore();
  const base = store.knowledgeBases.find((item) => item.id === String(knowledgeBaseId || ""));
  const index = base && base.files.findIndex((item) => item.id === String(fileId || ""));
  if (!base || index < 0) return null;
  base.files[index] = normalizeKnowledgeFile({ ...base.files[index], ...patch });
  persistKnowledgeStore(store);
  return base.files[index];
}

async function ensureRagflowDocument(knowledgeBaseId, file) {
  const config = ragflowConfig();
  if (!config.enabled || !config.apiKey || !config.datasetId) {
    return { ok: false, error: "RAGFlow is not configured. Open settings and fill Base URL, API Key, and Dataset ID." };
  }
  if (file.ragflowDocumentId) return { ok: true, documentId: file.ragflowDocumentId, uploaded: false };
  if (!file.storedPath || !fs.existsSync(file.storedPath)) {
    return { ok: false, error: "Source file is missing, so it cannot be uploaded to RAGFlow." };
  }

  const form = new FormData();
  const bytes = fs.readFileSync(file.storedPath);
  form.append("file", new Blob([bytes], { type: file.type || "application/octet-stream" }), file.name || "document");
  const upload = await ragflowRequest(config, `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/documents`, {
    method: "POST",
    body: form
  });
  const data = upload && upload.data;
  const first = Array.isArray(data) ? data[0] : data;
  const documentId = String((first && (first.id || first.document_id)) || "");
  if (!documentId) return { ok: false, error: "RAGFlow upload finished but no document id was returned." };
  await updateKnowledgeFilePatch(knowledgeBaseId, file.id, { ragflowDocumentId: documentId });
  return { ok: true, documentId, uploaded: true };
}

async function startRagflowDocumentParse(documentId) {
  const config = ragflowConfig();
  return ragflowRequest(config, `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/chunks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_ids: [documentId] })
  }).catch((error) => ({ code: "parse_start_failed", message: error.message }));
}

async function enableRagflowKnowledgeGraph() {
  const config = ragflowConfig();
  let parserConfig = {};
  try {
    const current = await ragflowRequest(config, `/api/v1/datasets/${encodeURIComponent(config.datasetId)}`);
    parserConfig = {
      ...((current && current.data && current.data.parser_config) || (current && current.parser_config) || {})
    };
  } catch {
    parserConfig = {};
  }
  return ragflowRequest(config, `/api/v1/datasets/${encodeURIComponent(config.datasetId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parser_config: {
        ...parserConfig,
        graphrag: {
          ...(parserConfig.graphrag || {}),
          use_graphrag: true
        }
      }
    })
  }).catch((error) => ({ code: "graph_config_failed", message: error.message }));
}

async function getRagflowKnowledgeGraph(knowledgeBaseId, fileId) {
  const store = readKnowledgeStore();
  const base = store.knowledgeBases.find((item) => item.id === String(knowledgeBaseId || ""));
  const file = base && base.files.find((item) => item.id === String(fileId || ""));
  if (!base || !file) return { ok: false, error: "File not found." };

  const config = ragflowConfig();
  if (!config.enabled || !config.apiKey || !config.datasetId) {
    return {
      ok: false,
      needsConfig: true,
      error: "RAGFlow is not configured. Open settings and fill Base URL, API Key, and Dataset ID."
    };
  }

  const ensured = await ensureRagflowDocument(base.id, file);
  if (!ensured.ok) return ensured;
  if (ensured.uploaded) {
    await enableRagflowKnowledgeGraph();
    await startRagflowDocumentParse(ensured.documentId);
  }

  try {
    const raw = await ragflowRequest(config, `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/knowledge_graph`);
    const graph = normalizeRagflowGraph(raw);
    if (!graph.nodes.length) {
      return {
        ok: false,
        pending: true,
        documentId: ensured.documentId,
        error: "RAGFlow graph is not ready yet. Finish dataset parsing and GraphRAG build in RAGFlow, then open it again."
      };
    }
    return {
      ok: true,
      engine: "ragflow",
      knowledgeBaseId: base.id,
      knowledgeBaseName: base.name,
      fileId: file.id,
      fileName: file.name,
      documentId: ensured.documentId,
      graph
    };
  } catch (error) {
    return { ok: false, documentId: ensured.documentId, error: error.message };
  }
}

function getFocusedChatWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && chatWindows.has(focused)) return focused;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return Array.from(chatWindows).find((win) => !win.isDestroyed()) || null;
}

function createWindow(options = {}) {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    title: "Deskchat",
    autoHideMenuBar: true,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setMenuBarVisibility(false);

  chatWindows.add(win);
  windowModes.set(win.id, { compact: false, pinned: false, normalBounds: null });
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = win;

  const query = options.conversationId ? { conversationId: String(options.conversationId) } : {};
  win.loadFile("index.html", { query });
  win.on("closed", () => {
    chatWindows.delete(win);
    windowModes.delete(win.id);
    if (mainWindow === win) mainWindow = getFocusedChatWindow();
  });
  return win;
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 620,
    minHeight: 680,
    title: "API Settings",
    autoHideMenuBar: true,
    backgroundColor: "#f7f8fa",
    parent: getFocusedChatWindow() || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow.setMenuBarVisibility(false);

  settingsWindow.loadFile("settings.html");
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function runCommand(command, timeout = 30000) {
  return new Promise((resolve) => {
    exec(command, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : null,
        signal: error && error.signal ? error.signal : null,
        stdout: stdout || "",
        stderr: stderr || (error ? error.message : "")
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWindowMode(win) {
  if (!win || win.isDestroyed()) return { compact: false, pinned: false, normalBounds: null };
  if (!windowModes.has(win.id)) windowModes.set(win.id, { compact: false, pinned: false, normalBounds: null });
  return windowModes.get(win.id);
}

function sendWindowState(win) {
  if (win && !win.isDestroyed()) {
    const mode = getWindowMode(win);
    win.webContents.send("window:state", {
      compact: mode.compact,
      pinned: mode.pinned
    });
  }
}

function setPinnedMode(win, pinned) {
  const mode = getWindowMode(win);
  mode.pinned = Boolean(pinned);
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(mode.pinned, "floating");
  }
  sendWindowState(win);
  return { compact: mode.compact, pinned: mode.pinned };
}

function setCompactMode(win, enabled) {
  const mode = getWindowMode(win);
  if (!win || win.isDestroyed()) {
    return { compact: mode.compact, pinned: mode.pinned };
  }

  const next = Boolean(enabled);
  if (next === mode.compact) {
    sendWindowState(win);
    return { compact: mode.compact, pinned: mode.pinned };
  }

  mode.compact = next;
  if (mode.compact) {
    mode.normalBounds = win.getBounds();
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = 420;
    const height = Math.min(720, Math.max(560, Math.floor(workArea.height * 0.74)));
    win.setMinimumSize(360, 500);
    win.setBounds({
      x: workArea.x + workArea.width - width - 18,
      y: workArea.y + 18,
      width,
      height
    });
  } else {
    win.setMinimumSize(920, 640);
    if (mode.normalBounds) {
      win.setBounds(mode.normalBounds);
    } else {
      win.setSize(1180, 820);
      win.center();
    }
  }

  sendWindowState(win);
  return { compact: mode.compact, pinned: mode.pinned };
}

async function takeScreenshot(requestingWindow) {
  const windowsToMove = [requestingWindow, settingsWindow, ...chatWindows]
    .filter((win, index, list) => win && !win.isDestroyed() && list.indexOf(win) === index)
    .filter((win) => win.isVisible() && !win.isMinimized());
  const restoreStates = windowsToMove.map((win) => ({
    win,
    focused: win.isFocused()
  }));

  if (restoreStates.length) {
    restoreStates.forEach(({ win }) => win.minimize());
    await wait(420);
  }

  const primary = screen.getPrimaryDisplay();
  const size = primary.size;
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(size.width * primary.scaleFactor),
        height: Math.round(size.height * primary.scaleFactor)
      }
    });

    const source = sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("No screen source was available.");
    }

    const image = source.thumbnail.resize({ width: Math.min(1600, source.thumbnail.getSize().width) });
    return {
      dataUrl: image.toDataURL(),
      width: image.getSize().width,
      height: image.getSize().height,
      sourceName: source.name
    };
  } finally {
    for (const { win, focused } of restoreStates) {
      if (!win.isDestroyed()) {
        win.restore();
        if (focused) win.focus();
      }
    }
  }
}

async function moveMouse({ x, y }) {
  if (!isWindows) {
    return { ok: false, error: "Mouse control is currently implemented for Windows only." };
  }

  const px = Number.parseInt(x, 10);
  const py = Number.parseInt(y, 10);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return { ok: false, error: "x and y must be numbers." };
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${px}, ${py})`
  ].join("; ");

  const result = await runCommand(`powershell.exe -NoProfile -Command "${script}"`, 5000);
  return result.ok ? { ok: true, x: px, y: py } : { ok: false, error: result.stderr };
}

async function clickMouse({ x, y, button = "left" }) {
  if (!isWindows) {
    return { ok: false, error: "Mouse control is currently implemented for Windows only." };
  }

  const px = Number.parseInt(x, 10);
  const py = Number.parseInt(y, 10);
  const downUp = button === "right" ? "0x0008,0x0010" : "0x0002,0x0004";
  const script = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class MouseNative {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}';
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${px}, ${py});
$events = @(${downUp});
[MouseNative]::mouse_event($events[0], 0, 0, 0, [UIntPtr]::Zero);
Start-Sleep -Milliseconds 80;
[MouseNative]::mouse_event($events[1], 0, 0, 0, [UIntPtr]::Zero);
`;

  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = await runCommand(`powershell.exe -NoProfile -EncodedCommand ${encoded}`, 7000);
  return result.ok ? { ok: true, x: px, y: py, button } : { ok: false, error: result.stderr };
}

ipcMain.handle("tool:screenshot", async (event) => takeScreenshot(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle("settings:get", async () => readSettings());
ipcMain.handle("settings:save", async (_event, settings) => writeSettings(settings || {}));
ipcMain.handle("settings:open", async () => {
  openSettingsWindow();
  return true;
});
ipcMain.handle("window:get-state", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const mode = getWindowMode(win);
  return { compact: mode.compact, pinned: mode.pinned };
});
ipcMain.handle("window:set-compact", async (event, enabled) => setCompactMode(BrowserWindow.fromWebContents(event.sender), enabled));
ipcMain.handle("window:set-pinned", async (event, pinned) => setPinnedMode(BrowserWindow.fromWebContents(event.sender), pinned));
ipcMain.handle("chat:open-window", async (_event, conversationId) => {
  createWindow({ conversationId });
  return true;
});
ipcMain.handle("conversations:get", async () => readConversationStore());
ipcMain.handle("conversations:create", async (_event, title) => createConversation(title));
ipcMain.handle("conversations:save", async (_event, conversation) => saveConversation(conversation || {}));
ipcMain.handle("conversations:delete", async (_event, id) => deleteConversation(String(id || "")));
ipcMain.handle("knowledge:get", async () => readKnowledgeStore());
ipcMain.handle("knowledge:create", async (_event, name) => createKnowledgeBase(String(name || "新知识库")));
ipcMain.handle("knowledge:save", async (_event, base) => saveKnowledgeBase(base || {}));
ipcMain.handle("knowledge:delete", async (_event, id) => deleteKnowledgeBase(String(id || "")));
ipcMain.handle("knowledge:set-active", async (_event, id) => setActiveKnowledgeBase(id ? String(id) : null));
ipcMain.handle("knowledge:link-conversation", async (_event, args) =>
  linkConversationToKnowledgeBase(args && args.knowledgeBaseId, args && args.conversationId)
);
ipcMain.handle("knowledge:unlink-conversation", async (_event, args) =>
  unlinkConversationFromKnowledgeBase(args && args.knowledgeBaseId, args && args.conversationId)
);
ipcMain.handle("knowledge:add-file", async (_event, args) => addKnowledgeFile(args && args.knowledgeBaseId, args && args.file));
ipcMain.handle("knowledge:remove-file", async (_event, args) =>
  removeKnowledgeFile(args && args.knowledgeBaseId, args && args.fileId)
);
ipcMain.handle("knowledge:open-file", async (_event, args) => openKnowledgeFile(args && args.knowledgeBaseId, args && args.fileId));
ipcMain.handle("knowledge:reindex-file", async (_event, args) =>
  reindexKnowledgeFile(args && args.knowledgeBaseId, args && args.fileId)
);
ipcMain.handle("knowledge:search", async (_event, args) =>
  searchKnowledgeBase(args && args.knowledgeBaseId, args && args.query, args && args.options)
);
ipcMain.handle("knowledge:mind-map", async (_event, args) => getKnowledgeMindMap(args && args.knowledgeBaseId, args && args.fileId));
ipcMain.handle("knowledge:graph", async (_event, args) => getRagflowKnowledgeGraph(args && args.knowledgeBaseId, args && args.fileId));
ipcMain.handle("tool:run-command", async (_event, args) => {
  const command = String(args && args.command ? args.command : "");
  if (!command.trim()) return { ok: false, stderr: "No command supplied.", stdout: "" };
  return runCommand(command, Number(args.timeout) || 30000);
});
ipcMain.handle("tool:move-mouse", async (_event, args) => moveMouse(args || {}));
ipcMain.handle("tool:click-mouse", async (_event, args) => clickMouse(args || {}));
ipcMain.handle("image:from-buffer", async (_event, bytes) => {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) throw new Error("Could not read image.");
  return image.resize({ width: Math.min(1600, image.getSize().width) }).toDataURL();
});

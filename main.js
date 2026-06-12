const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, screen, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { exec } = require("node:child_process");
const { Transformer } = require("markmap-lib");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");

const isWindows = process.platform === "win32";
const testUserDataDir = process.env.DESKCHAT_TEST_USER_DATA || process.env.DESKCHAT_USER_DATA_DIR;
if (testUserDataDir) app.setPath("userData", path.resolve(testUserDataDir));
const chatWindows = new Set();
const windowModes = new Map();
let mainWindow = null;
let settingsWindow = null;
let todoWindow = null;
const MEMORY_STORE_VERSION = 1;
const MEMORY_MAX_CHUNKS_PER_CONVERSATION = 80;
const MEMORY_MAX_ITEMS = 5000;
const MEMORY_CHUNK_MAX_CHARS = 1200;
const MEMORY_CHUNK_OVERLAP_CHARS = 160;
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

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-software-rasterizer");

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

const defaultMemoryConfig = {
  enabled: true,
  rememberAssistant: true,
  recallEnabled: true,
  recallLimit: 6,
  minMessageChars: 8,
  minChunkChars: 24
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
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
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
  const memory = normalizeMemoryConfig(raw && raw.memory);
  return { activeConfigId, apiConfigs: configs, ragflow, memory };
}

function normalizeMemoryConfig(config) {
  const recallLimit = Number(config && config.recallLimit);
  const minMessageChars = Number(config && config.minMessageChars);
  const minChunkChars = Number(config && config.minChunkChars);
  return {
    enabled: config && config.enabled !== undefined ? Boolean(config.enabled) : defaultMemoryConfig.enabled,
    rememberAssistant: config && config.rememberAssistant !== undefined
      ? Boolean(config.rememberAssistant)
      : defaultMemoryConfig.rememberAssistant,
    recallEnabled: config && config.recallEnabled !== undefined
      ? Boolean(config.recallEnabled)
      : defaultMemoryConfig.recallEnabled,
    recallLimit: Math.max(0, Math.min(Number.isFinite(recallLimit) ? recallLimit : defaultMemoryConfig.recallLimit, 12)),
    minMessageChars: Math.max(1, Math.min(Number.isFinite(minMessageChars) ? minMessageChars : defaultMemoryConfig.minMessageChars, 200)),
    minChunkChars: Math.max(1, Math.min(Number.isFinite(minChunkChars) ? minChunkChars : defaultMemoryConfig.minChunkChars, 600))
  };
}

function settingsPath() {
  return userDataFile("settings.json");
}

function readSettingsStore() {
  return normalizeSettingsStore(readJson(settingsPath(), null));
}

function activeSettings(store = readSettingsStore()) {
  const active = store.apiConfigs.find((config) => config.id === store.activeConfigId) || store.apiConfigs[0];
  return {
    ...active,
    activeConfigId: store.activeConfigId,
    apiConfigs: store.apiConfigs,
    ragflow: store.ragflow || defaultRagflowConfig,
    memory: normalizeMemoryConfig(store.memory)
  };
}

function persistSettingsStore(store) {
  const normalized = normalizeSettingsStore(store);
  ensureUserDataDir();
  fs.writeFileSync(settingsPath(), JSON.stringify(normalized, null, 2), "utf8");
  const current = activeSettings(normalized);
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("settings:updated", current);
    win.webContents.send("memories:updated", memoryStoreForClient(readMemoryStore()));
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
  if (settings && settings.memory !== undefined) {
    currentStore.memory = normalizeMemoryConfig(settings.memory);
  }
  if (settings && settings.ragflow !== undefined) {
    currentStore.ragflow = {
      ...defaultRagflowConfig,
      ...(settings.ragflow || {})
    };
  }
  return persistSettingsStore(currentStore);
}

function conversationsPath() {
  return userDataFile("conversations.json");
}

function memoriesPath() {
  return userDataFile("memories.json");
}

function normalizeConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const normalized = [];

  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const remember = message.remember === false ? false : undefined;

    if (message.role === "assistant") {
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (content) {
        normalized.push({
          role: "assistant",
          content,
          ...(remember === false ? { remember: false } : {})
        });
      }
      continue;
    }

    normalized.push({
      role: "user",
      content: message.content,
      ...(remember === false ? { remember: false } : {})
    });
  }

  return normalized;
}

function messageContentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part) return "";
      if (typeof part === "string") return part;
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeConversation(conversation, index = 0) {
  const now = new Date().toISOString();
  return {
    id: conversation && conversation.id ? String(conversation.id) : makeId("chat"),
    title: conversation && conversation.title ? String(conversation.title) : `新对话 ${index + 1}`,
    messages: normalizeConversationMessages(conversation && conversation.messages),
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
  const result = persistConversationStore(store);
  upsertConversationMemory(conversation);
  return result;
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
  removeConversationMemories(id);
  return result;
}

function todosPath() {
  return userDataFile("todos.json");
}

function cleanTodoText(value, maxLength) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeTodoPriority(priority) {
  const value = String(priority || "medium");
  if (value === "normal") return "medium";
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeTodoDueDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeTodoTags(tags) {
  const source = Array.isArray(tags)
    ? tags
    : String(tags || "")
        .split(/[,\s，、#]+/g)
        .filter(Boolean);
  const seen = new Set();
  return source
    .map((tag) => cleanTodoText(tag, 24).replace(/^#+/, ""))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function normalizeTodoProject(project) {
  return cleanTodoText(project, 48) || "Inbox";
}

function normalizeTodoRepeat(repeat) {
  const value = String(repeat || "none");
  return ["none", "daily", "weekly", "monthly"].includes(value) ? value : "none";
}

function normalizeTodoMinutes(value) {
  const minutes = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(Number.isFinite(minutes) ? minutes : 0, 100000));
}

function normalizeFocusDuration(value) {
  const raw = Number(value);
  const minutes = Math.round(Number.isFinite(raw) && raw > 0 ? raw : 50);
  return Math.max(1, Math.min(minutes, 240));
}

function normalizeModelId(value, fallbackPrefix) {
  const text = cleanTodoText(value, 80);
  return text || makeId(fallbackPrefix);
}

function normalizeTaskStatus(value, completed) {
  const status = String(value || "").trim();
  if (status === "archived") return "archived";
  return completed ? "done" : "todo";
}

function normalizeClockTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : "";
}

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string=} note
 * @property {"todo"|"done"|"archived"} status
 * @property {string=} categoryId
 * @property {string=} dueDate
 * @property {string=} startTime
 * @property {string=} endTime
 * @property {number=} estimateMinutes
 * @property {number=} actualMinutes
 * @property {"low"|"medium"|"high"} priority
 * @property {string=} goalId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string=} completedAt
 * @property {string=} archivedAt
 * @property {string=} deletedAt
 *
 * @typedef {Object} Event
 * @property {string} id
 * @property {string} title
 * @property {string=} note
 * @property {string} startAt
 * @property {string} endAt
 * @property {string=} categoryId
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} FocusSession
 * @property {string} id
 * @property {string=} taskId
 * @property {string=} goalId
 * @property {string=} categoryId
 * @property {string} startedAt
 * @property {string=} endedAt
 * @property {number} durationMinutes
 * @property {number} plannedMinutes
 * @property {"running"|"paused"|"completed"|"abandoned"} status
 * @property {string} createdAt
 *
 * @typedef {Object} Goal
 * @property {string} id
 * @property {string} title
 * @property {string=} categoryId
 * @property {string=} deadline
 * @property {number=} targetCount
 * @property {number=} currentCount
 * @property {number=} targetScore
 * @property {number=} currentAverageScore
 * @property {"active"|"done"|"failed"|"archived"} status
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {string=} color
 * @property {string} createdAt
 * @property {string} updatedAt
 */

const DEFAULT_TODO_CATEGORIES = [
  { id: "未分类", name: "未分类", color: "#94a3b8" },
  { id: "数学", name: "数学", color: "#3b82f6" },
  { id: "408", name: "408", color: "#14b8a6" },
  { id: "英语", name: "英语", color: "#f59e0b" },
  { id: "C++", name: "C++", color: "#8b5cf6" },
  { id: "信息学竞赛", name: "信息学竞赛", color: "#ef4444" }
];

const TODO_CATEGORY_COLORS = ["#3b82f6", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b", "#2f7d73"];

function normalizeCategory(category, index = 0) {
  const now = new Date().toISOString();
  const name = cleanTodoText(category && category.name, 48) || `分类 ${index + 1}`;
  return {
    id: normalizeModelId(category && category.id, "cat"),
    name,
    color: cleanTodoText(category && category.color, 24),
    createdAt: (category && category.createdAt) || now,
    updatedAt: (category && category.updatedAt) || now
  };
}

function normalizeGoal(goal, index = 0) {
  const now = new Date().toISOString();
  const status = String(goal && goal.status || "active");
  return {
    id: normalizeModelId(goal && goal.id, "goal"),
    title: cleanTodoText(goal && goal.title, 180) || `目标 ${index + 1}`,
    categoryId: cleanTodoText(goal && goal.categoryId, 80),
    deadline: normalizeTodoDueDate(goal && goal.deadline),
    targetCount: normalizeTodoMinutes(goal && goal.targetCount),
    currentCount: normalizeTodoMinutes(goal && goal.currentCount),
    targetScore: normalizeTodoMinutes(goal && goal.targetScore),
    currentAverageScore: normalizeTodoMinutes(goal && goal.currentAverageScore),
    status: ["active", "done", "failed", "archived"].includes(status) ? status : "active",
    createdAt: (goal && goal.createdAt) || now,
    updatedAt: (goal && goal.updatedAt) || now
  };
}

function normalizeEvent(event, index = 0) {
  const now = new Date().toISOString();
  const startAt = event && event.startAt ? String(event.startAt) : "";
  const endAt = event && event.endAt ? String(event.endAt) : "";
  return {
    id: normalizeModelId(event && event.id, "event"),
    title: cleanTodoText(event && event.title, 180) || `日程 ${index + 1}`,
    note: cleanTodoText(event && (event.note || event.notes), 4000),
    startAt,
    endAt: endAt || startAt,
    categoryId: cleanTodoText(event && event.categoryId, 80),
    createdAt: (event && event.createdAt) || now,
    updatedAt: (event && event.updatedAt) || now
  };
}

function normalizeTodoReviewType(value) {
  const type = String(value || "daily");
  return ["daily", "weekly", "monthly"].includes(type) ? type : "daily";
}

function normalizeTodoReviewScore(value) {
  const score = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(Number.isFinite(score) ? score : 0, 5));
}

function normalizeTodoReview(review, index = 0) {
  const now = new Date().toISOString();
  return {
    id: review && review.id ? String(review.id) : makeId("review"),
    type: normalizeTodoReviewType(review && review.type),
    periodKey: cleanTodoText(review && review.periodKey, 24) || dateKey(),
    wins: cleanTodoText(review && review.wins, 4000),
    blockers: cleanTodoText(review && review.blockers, 4000),
    nextActions: cleanTodoText(review && review.nextActions, 4000),
    score: normalizeTodoReviewScore(review && review.score),
    createdAt: (review && review.createdAt) || now,
    updatedAt: (review && review.updatedAt) || now
  };
}

function normalizeFocusSession(session) {
  const now = new Date().toISOString();
  const minutes = normalizeTodoMinutes(session && (session.minutes || session.durationMinutes));
  const targetMinutes = session && (session.targetMinutes || session.plannedMinutes)
    ? normalizeFocusDuration(session.targetMinutes || session.plannedMinutes)
    : 0;
  const status = String(session && session.status || "");
  const endedAt = session && session.endedAt ? String(session.endedAt) : "";
  const normalizedStatus = ["running", "paused", "completed", "abandoned"].includes(status)
    ? status
    : endedAt ? "completed" : "running";
  return {
    id: session && session.id ? String(session.id) : makeId("focus"),
    todoId: session && (session.todoId || session.taskId) ? String(session.todoId || session.taskId) : "",
    taskId: session && (session.taskId || session.todoId) ? String(session.taskId || session.todoId) : "",
    goalId: cleanTodoText(session && session.goalId, 80),
    categoryId: cleanTodoText(session && session.categoryId, 80),
    title: cleanTodoText(session && session.title, 180) || "番茄专注",
    project: normalizeTodoProject(session && (session.project || session.categoryId)),
    startedAt: (session && session.startedAt) || now,
    endedAt,
    minutes,
    durationMinutes: minutes,
    targetMinutes,
    plannedMinutes: targetMinutes || minutes,
    status: normalizedStatus,
    completed: normalizedStatus === "completed",
    createdAt: (session && session.createdAt) || now
  };
}

function normalizeFocusTimer(timer) {
  const now = new Date().toISOString();
  const status = String(timer && timer.status || "idle");
  const normalizedStatus = ["running", "paused"].includes(status) ? status : "idle";
  const taskId = timer && (timer.taskId || timer.todoId) ? String(timer.taskId || timer.todoId) : "";
  if (normalizedStatus === "idle" || !taskId) {
    return {
      status: "idle",
      taskId: "",
      todoId: "",
      title: "",
      categoryId: "",
      goalId: "",
      project: "",
      startedAt: "",
      lastStartedAt: "",
      pausedAt: "",
      plannedMinutes: normalizeFocusDuration(timer && timer.plannedMinutes),
      remainingSeconds: normalizeFocusDuration(timer && timer.plannedMinutes) * 60,
      createdAt: timer && timer.createdAt ? String(timer.createdAt) : now,
      updatedAt: timer && timer.updatedAt ? String(timer.updatedAt) : now
    };
  }
  const plannedMinutes = normalizeFocusDuration(timer && (timer.plannedMinutes || timer.targetMinutes));
  const rawRemaining = Math.round(Number(timer && timer.remainingSeconds));
  const remainingSeconds = Math.max(0, Math.min(Number.isFinite(rawRemaining) ? rawRemaining : plannedMinutes * 60, plannedMinutes * 60));
  return {
    status: normalizedStatus,
    taskId,
    todoId: taskId,
    title: cleanTodoText(timer && timer.title, 180),
    categoryId: cleanTodoText(timer && timer.categoryId, 80),
    goalId: cleanTodoText(timer && timer.goalId, 80),
    project: normalizeTodoProject(timer && (timer.project || timer.categoryId)),
    startedAt: timer && timer.startedAt ? String(timer.startedAt) : now,
    lastStartedAt: normalizedStatus === "running"
      ? (timer && timer.lastStartedAt ? String(timer.lastStartedAt) : now)
      : "",
    pausedAt: normalizedStatus === "paused"
      ? (timer && timer.pausedAt ? String(timer.pausedAt) : now)
      : "",
    plannedMinutes,
    remainingSeconds,
    createdAt: timer && timer.createdAt ? String(timer.createdAt) : now,
    updatedAt: timer && timer.updatedAt ? String(timer.updatedAt) : now
  };
}

function normalizeTodoSubtasks(subtasks) {
  const source = Array.isArray(subtasks) ? subtasks : [];
  return source
    .map((subtask) => ({
      id: subtask && subtask.id ? String(subtask.id) : makeId("sub"),
      title: cleanTodoText(subtask && subtask.title, 160),
      completed: Boolean(subtask && subtask.completed)
    }))
    .filter((subtask) => subtask.title)
    .slice(0, 80);
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function advanceRepeatDate(date, repeat) {
  const next = new Date(date);
  if (repeat === "daily") next.setDate(next.getDate() + 1);
  if (repeat === "weekly") next.setDate(next.getDate() + 7);
  if (repeat === "monthly") {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const monthEnd = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, monthEnd));
  }
  return next;
}

function addRepeatDueDate(value, repeat, reference = new Date()) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : dateKey();
  let next = new Date(`${base}T00:00:00`);
  if (Number.isNaN(next.getTime())) return "";
  const today = dateKey(reference);
  let guard = 0;
  do {
    next = advanceRepeatDate(next, repeat);
    guard += 1;
  } while (dateKey(next) <= today && guard < 5000);
  return dateKey(next);
}

function settleTodoTimer(todo, now = new Date()) {
  if (!todo || !todo.timerStartedAt) return todo;
  const started = new Date(todo.timerStartedAt);
  if (Number.isNaN(started.getTime())) return { ...todo, timerStartedAt: "" };
  const elapsed = Math.max(1, Math.round((now.getTime() - started.getTime()) / 60000));
  return {
    ...todo,
    spentMinutes: normalizeTodoMinutes((todo.spentMinutes || 0) + elapsed),
    timerStartedAt: "",
    focusTargetMinutes: 0
  };
}

function finishTodoTimer(todo, now = new Date()) {
  if (!todo || !todo.timerStartedAt) return { todo, session: null };
  const started = new Date(todo.timerStartedAt);
  if (Number.isNaN(started.getTime())) {
    return { todo: { ...todo, timerStartedAt: "", focusTargetMinutes: 0 }, session: null };
  }
  const elapsed = Math.max(1, Math.round((now.getTime() - started.getTime()) / 60000));
  const targetMinutes = Number(todo.focusTargetMinutes) ? normalizeFocusDuration(todo.focusTargetMinutes) : 0;
  return {
    todo: {
      ...todo,
      spentMinutes: normalizeTodoMinutes((todo.spentMinutes || 0) + elapsed),
      timerStartedAt: "",
      focusTargetMinutes: 0
    },
    session: normalizeFocusSession({
      todoId: todo.id,
      taskId: todo.id,
      goalId: todo.goalId,
      categoryId: todo.categoryId || todo.project,
      title: todo.title,
      project: todo.project,
      startedAt: started.toISOString(),
      endedAt: now.toISOString(),
      minutes: elapsed,
      targetMinutes,
      completed: targetMinutes ? elapsed >= targetMinutes : true
    })
  };
}

function resetTodoSubtasksForNextRepeat(subtasks) {
  return normalizeTodoSubtasks(subtasks).map((subtask) => ({
    ...subtask,
    completed: false
  }));
}

function completeTodoForStore(todo, nowIso) {
  const settled = settleTodoTimer(todo, new Date(nowIso));
  if (settled.repeat !== "none") {
    const lastSpentMinutes = normalizeTodoMinutes(settled.spentMinutes);
    return normalizeTodo({
      ...settled,
      status: "todo",
      completed: false,
      completedAt: null,
      dueDate: addRepeatDueDate(settled.dueDate, settled.repeat, new Date(nowIso)),
      subtasks: resetTodoSubtasksForNextRepeat(settled.subtasks),
      spentMinutes: 0,
      lastSpentMinutes,
      totalSpentMinutes: normalizeTodoMinutes(settled.totalSpentMinutes) + lastSpentMinutes,
      completedCount: normalizeTodoMinutes(settled.completedCount) + 1,
      lastCompletedAt: nowIso,
      updatedAt: nowIso
    });
  }

  return normalizeTodo({
    ...settled,
    status: "done",
    completed: true,
    completedAt: nowIso,
    timerStartedAt: "",
    updatedAt: nowIso
  });
}

function normalizeTodo(todo, index = 0) {
  const now = new Date().toISOString();
  const incomingStatus = todo && todo.status ? String(todo.status) : "";
  const completed = Boolean(todo && todo.completed) || incomingStatus === "done";
  const completedAt = completed
    ? (todo && todo.completedAt) || (todo && todo.updatedAt) || now
    : null;
  const notes = cleanTodoText(todo && (todo.notes || todo.note), 4000);
  const project = normalizeTodoProject(todo && (todo.project || todo.categoryId));
  const spentMinutes = normalizeTodoMinutes(todo && (todo.spentMinutes || todo.actualMinutes));

  return {
    id: todo && todo.id ? String(todo.id) : makeId("todo"),
    title: cleanTodoText(todo && todo.title, 180) || `任务 ${index + 1}`,
    kind: "task",
    note: notes,
    notes,
    status: normalizeTaskStatus(incomingStatus, completed),
    completed,
    priority: normalizeTodoPriority(todo && todo.priority),
    project,
    categoryId: cleanTodoText(todo && todo.categoryId, 80) || project,
    goalId: cleanTodoText(todo && todo.goalId, 80),
    dueDate: normalizeTodoDueDate(todo && todo.dueDate),
    startTime: normalizeClockTime(todo && todo.startTime),
    endTime: normalizeClockTime(todo && todo.endTime),
    waitingFor: cleanTodoText(todo && todo.waitingFor, 120),
    waitingUntil: normalizeTodoDueDate(todo && todo.waitingUntil),
    repeat: normalizeTodoRepeat(todo && todo.repeat),
    tags: normalizeTodoTags(todo && todo.tags),
    subtasks: normalizeTodoSubtasks(todo && todo.subtasks),
    estimateMinutes: normalizeTodoMinutes(todo && todo.estimateMinutes),
    spentMinutes,
    actualMinutes: spentMinutes,
    lastSpentMinutes: normalizeTodoMinutes(todo && todo.lastSpentMinutes),
    totalSpentMinutes: normalizeTodoMinutes(todo && todo.totalSpentMinutes),
    timerStartedAt: todo && todo.timerStartedAt && !completed ? String(todo.timerStartedAt) : "",
    focusTargetMinutes: todo && todo.focusTargetMinutes ? normalizeFocusDuration(todo.focusTargetMinutes) : 0,
    completedCount: normalizeTodoMinutes(todo && todo.completedCount),
    lastCompletedAt: todo && todo.lastCompletedAt ? String(todo.lastCompletedAt) : "",
    createdAt: (todo && todo.createdAt) || now,
    updatedAt: (todo && todo.updatedAt) || now,
    completedAt,
    archivedAt: todo && todo.archivedAt ? String(todo.archivedAt) : "",
    deletedAt: todo && todo.deletedAt ? String(todo.deletedAt) : ""
  };
}

function normalizeTodoStore(raw) {
  const source = Array.isArray(raw) ? raw : raw && Array.isArray(raw.todos) ? raw.todos : [];
  const reviewSource = raw && Array.isArray(raw.reviews) ? raw.reviews : [];
  const focusSource = raw && Array.isArray(raw.focusSessions) ? raw.focusSessions : [];
  const eventSource = raw && Array.isArray(raw.events) ? raw.events : [];
  const goalSource = raw && Array.isArray(raw.goals) ? raw.goals : [];
  const categorySource = raw && Array.isArray(raw.categories) ? raw.categories : [];
  const seen = new Set();
  const todos = source.map(normalizeTodo).map((todo) => {
    const next = normalizeTodo(todo);
    if (seen.has(next.id)) next.id = makeId("todo");
    seen.add(next.id);
    return next;
  });
  const reviewKeys = new Set();
  const reviews = reviewSource.map(normalizeTodoReview).map((review) => {
    const key = `${review.type}:${review.periodKey}`;
    const next = reviewKeys.has(key) ? { ...review, id: makeId("review") } : review;
    reviewKeys.add(key);
    return next;
  });
  const focusSessions = focusSource.map(normalizeFocusSession).slice(-1000);
  let focusTimer = normalizeFocusTimer(raw && raw.focusTimer);
  if (focusTimer.status === "idle") {
    const legacyRunning = todos.find((todo) => todo.timerStartedAt);
    if (legacyRunning) {
      focusTimer = normalizeFocusTimer({
        status: "running",
        taskId: legacyRunning.id,
        title: legacyRunning.title,
        categoryId: legacyRunning.categoryId || legacyRunning.project,
        goalId: legacyRunning.goalId,
        project: legacyRunning.project,
        startedAt: legacyRunning.timerStartedAt,
        lastStartedAt: legacyRunning.timerStartedAt,
        plannedMinutes: legacyRunning.focusTargetMinutes || raw && raw.focusDefaultMinutes,
        remainingSeconds: normalizeFocusDuration(legacyRunning.focusTargetMinutes || raw && raw.focusDefaultMinutes) * 60
      });
    }
  }
  const categoryNames = new Set(categorySource.map((category) => cleanTodoText(category && category.name, 48)).filter(Boolean));
  const derivedCategories = todos
    .map((todo) => cleanTodoText(todo.categoryId, 80) || normalizeTodoProject(todo.project))
    .filter((project) => project && !categoryNames.has(project))
    .map((project) => ({
      id: project,
      name: project,
      createdAt: todos.find((todo) => (cleanTodoText(todo.categoryId, 80) || normalizeTodoProject(todo.project)) === project)?.createdAt,
      updatedAt: todos.find((todo) => (cleanTodoText(todo.categoryId, 80) || normalizeTodoProject(todo.project)) === project)?.updatedAt
    }));
  const categoryMap = new Map();
  for (const category of [...DEFAULT_TODO_CATEGORIES, ...categorySource, ...derivedCategories].map(normalizeCategory)) {
    const key = category.name || category.id;
    if (!categoryMap.has(key)) categoryMap.set(key, category);
  }
  const categories = [...categoryMap.values()];
  const events = eventSource.map(normalizeEvent);
  const goals = goalSource.map(normalizeGoal);
  return {
    todos,
    tasks: todos,
    events,
    goals,
    categories,
    reviews,
    focusSessions,
    focusTimer,
    focusDefaultMinutes: normalizeFocusDuration(raw && raw.focusDefaultMinutes)
  };
}

function readTodoStore() {
  return normalizeTodoStore(readJson(todosPath(), null));
}

function persistTodoStore(store) {
  const normalized = normalizeTodoStore(store);
  ensureUserDataDir();
  fs.writeFileSync(todosPath(), JSON.stringify(normalized, null, 2), "utf8");
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("todo:updated", normalized);
  });
  return normalized;
}

function todoCategoryKey(value) {
  const text = cleanTodoText(value, 80);
  return !text || text === "Inbox" ? "未分类" : text;
}

function defaultCategoryColor(name, index = 0) {
  const existing = DEFAULT_TODO_CATEGORIES.find((category) => category.name === name || category.id === name);
  if (existing && existing.color) return existing.color;
  return TODO_CATEGORY_COLORS[index % TODO_CATEGORY_COLORS.length];
}

function findCategoryIndex(store, name) {
  const target = todoCategoryKey(name);
  return store.categories.findIndex((category) =>
    todoCategoryKey(category && category.name) === target || todoCategoryKey(category && category.id) === target
  );
}

function saveTodoCategory(payload = {}) {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const name = todoCategoryKey(payload.name);
  if (!name) return store;
  const index = findCategoryIndex(store, name);
  const color = cleanTodoText(payload.color, 24) || defaultCategoryColor(name, store.categories.length);
  if (index >= 0) {
    store.categories[index] = normalizeCategory({
      ...store.categories[index],
      name,
      color,
      updatedAt: now
    }, index);
  } else {
    store.categories.push(normalizeCategory({
      id: name,
      name,
      color,
      createdAt: now,
      updatedAt: now
    }, store.categories.length));
  }
  return persistTodoStore(store);
}

function renameTodoCategory(payload = {}) {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const oldName = todoCategoryKey(payload.oldName || payload.id);
  const newName = todoCategoryKey(payload.newName || payload.name);
  if (!oldName || !newName || oldName === newName) return store;
  const existingIndex = findCategoryIndex(store, oldName);
  const existing = existingIndex >= 0 ? store.categories[existingIndex] : null;
  const color = cleanTodoText(payload.color, 24) || cleanTodoText(existing && existing.color, 24) || defaultCategoryColor(newName, store.categories.length);
  const withoutOld = store.categories.filter((category) => todoCategoryKey(category && category.name) !== oldName && todoCategoryKey(category && category.id) !== oldName);
  const duplicateIndex = withoutOld.findIndex((category) => todoCategoryKey(category && category.name) === newName || todoCategoryKey(category && category.id) === newName);
  if (duplicateIndex >= 0) {
    withoutOld[duplicateIndex] = normalizeCategory({ ...withoutOld[duplicateIndex], name: newName, color, updatedAt: now }, duplicateIndex);
  } else {
    withoutOld.push(normalizeCategory({
      id: newName,
      name: newName,
      color,
      createdAt: existing && existing.createdAt || now,
      updatedAt: now
    }, withoutOld.length));
  }
  const renameCategoryValue = (value) => todoCategoryKey(value) === oldName ? newName : value;
  const todos = store.todos.map((todo) => normalizeTodo({
    ...todo,
    project: renameCategoryValue(todo.project),
    categoryId: renameCategoryValue(todo.categoryId),
    updatedAt: todoCategoryKey(todo.categoryId || todo.project) === oldName ? now : todo.updatedAt
  }));
  const events = store.events.map((event) => normalizeEvent({
    ...event,
    categoryId: renameCategoryValue(event.categoryId),
    updatedAt: todoCategoryKey(event.categoryId) === oldName ? now : event.updatedAt
  }));
  const goals = store.goals.map((goal) => normalizeGoal({
    ...goal,
    categoryId: renameCategoryValue(goal.categoryId),
    updatedAt: todoCategoryKey(goal.categoryId) === oldName ? now : goal.updatedAt
  }));
  const focusSessions = store.focusSessions.map((session) => normalizeFocusSession({
    ...session,
    project: renameCategoryValue(session.project),
    categoryId: renameCategoryValue(session.categoryId)
  }));
  return persistTodoStore({ ...store, categories: withoutOld, todos, events, goals, focusSessions });
}

function deleteTodoCategory(name) {
  const store = readTodoStore();
  const target = todoCategoryKey(name);
  if (!target || target === "未分类") return store;
  const now = new Date().toISOString();
  const categories = store.categories.filter((category) =>
    todoCategoryKey(category && category.name) !== target && todoCategoryKey(category && category.id) !== target
  );
  const moveCategoryValue = (value) => todoCategoryKey(value) === target ? "未分类" : value;
  const todos = store.todos.map((todo) => normalizeTodo({
    ...todo,
    project: moveCategoryValue(todo.project),
    categoryId: moveCategoryValue(todo.categoryId),
    updatedAt: todoCategoryKey(todo.categoryId || todo.project) === target ? now : todo.updatedAt
  }));
  const events = store.events.map((event) => normalizeEvent({
    ...event,
    categoryId: moveCategoryValue(event.categoryId),
    updatedAt: todoCategoryKey(event.categoryId) === target ? now : event.updatedAt
  }));
  const goals = store.goals.map((goal) => normalizeGoal({
    ...goal,
    categoryId: moveCategoryValue(goal.categoryId),
    updatedAt: todoCategoryKey(goal.categoryId) === target ? now : goal.updatedAt
  }));
  const focusSessions = store.focusSessions.map((session) => normalizeFocusSession({
    ...session,
    project: moveCategoryValue(session.project),
    categoryId: moveCategoryValue(session.categoryId)
  }));
  return persistTodoStore({ ...store, categories, todos, events, goals, focusSessions });
}

function createTodo(payload = {}) {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const todo = normalizeTodo({
    ...(payload || {}),
    completed: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    id: makeId("todo")
  });
  store.todos.unshift(todo);
  return persistTodoStore(store);
}

function saveTodo(payload = {}) {
  const store = readTodoStore();
  const id = payload && payload.id ? String(payload.id) : "";
  if (!id) return store;

  const index = store.todos.findIndex((todo) => todo.id === id);
  if (index < 0) return store;

  const now = new Date().toISOString();
  const existing = store.todos[index];
  const requestedStatus = payload && payload.status ? String(payload.status) : "";
  const isArchiving = requestedStatus === "archived";
  const nextCompleted = isArchiving
    ? false
    : requestedStatus === "done"
      ? true
      : payload.completed === undefined ? existing.completed : Boolean(payload.completed);
  const nextCompletedAt = nextCompleted
    ? existing.completed
      ? existing.completedAt
      : now
    : null;
  const nextStatus = isArchiving ? "archived" : nextCompleted ? "done" : "todo";

  store.todos[index] = normalizeTodo({
    ...existing,
    ...(payload || {}),
    id,
    status: nextStatus,
    completed: nextCompleted,
    completedAt: nextCompletedAt,
    updatedAt: now
  });
  return persistTodoStore(store);
}

function saveTodoGoal(payload = {}) {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const id = payload && payload.id ? String(payload.id) : "";
  const index = id ? store.goals.findIndex((goal) => goal.id === id) : -1;
  const existing = index >= 0 ? store.goals[index] : {};
  const next = normalizeGoal({
    ...existing,
    ...(payload || {}),
    id: index >= 0 ? id : makeId("goal"),
    status: payload && payload.status ? payload.status : existing.status || "active",
    createdAt: existing.createdAt || now,
    updatedAt: now
  });
  if (index >= 0) store.goals[index] = next;
  else store.goals.unshift(next);
  return persistTodoStore(store);
}

function archiveTodoGoal(id) {
  const store = readTodoStore();
  const targetId = String(id || "");
  const index = store.goals.findIndex((goal) => goal.id === targetId);
  if (index < 0) return store;
  store.goals[index] = normalizeGoal({
    ...store.goals[index],
    status: "archived",
    updatedAt: new Date().toISOString()
  });
  return persistTodoStore(store);
}

function deleteTodo(id) {
  const store = readTodoStore();
  const targetId = String(id || "");
  const index = store.todos.findIndex((todo) => todo.id === targetId);
  if (index < 0) return store;
  const finished = finishTodoTimer(store.todos[index], new Date());
  if (finished.session) store.focusSessions.push(finished.session);
  store.todos.splice(index, 1);
  return persistTodoStore(store);
}

function toggleTodo(id, completed) {
  const store = readTodoStore();
  const targetId = String(id || "");
  const index = store.todos.findIndex((todo) => todo.id === targetId);
  if (index < 0) return store;

  const todo = store.todos[index];
  const now = new Date().toISOString();
  const nextCompleted = typeof completed === "boolean" ? completed : !todo.completed;
  if (nextCompleted) {
    const finished = finishTodoTimer(todo, new Date(now));
    if (finished.session) store.focusSessions.push(finished.session);
    store.todos[index] = completeTodoForStore(finished.todo, now);
    return persistTodoStore(store);
  }
  const finished = finishTodoTimer(todo, new Date(now));
  if (finished.session) store.focusSessions.push(finished.session);
  store.todos[index] = normalizeTodo({
    ...finished.todo,
    status: "todo",
    completed: false,
    completedAt: null,
    timerStartedAt: finished.todo.timerStartedAt,
    updatedAt: now
  });
  return persistTodoStore(store);
}

function toggleTodoSubtask(todoId, subtaskId, completed) {
  const store = readTodoStore();
  const targetId = String(todoId || "");
  const targetSubtaskId = String(subtaskId || "");
  const index = store.todos.findIndex((todo) => todo.id === targetId);
  if (index < 0) return store;

  const todo = store.todos[index];
  const subtasks = (todo.subtasks || []).map((subtask) =>
    subtask.id === targetSubtaskId
      ? { ...subtask, completed: typeof completed === "boolean" ? completed : !subtask.completed }
      : subtask
  );
  store.todos[index] = normalizeTodo({
    ...todo,
    subtasks,
    updatedAt: new Date().toISOString()
  });
  return persistTodoStore(store);
}

function focusTimerRemainingSeconds(timer, now = new Date()) {
  const current = normalizeFocusTimer(timer);
  if (current.status !== "running") return current.remainingSeconds;
  const lastStarted = new Date(current.lastStartedAt || current.startedAt);
  const elapsed = Number.isNaN(lastStarted.getTime())
    ? 0
    : Math.max(0, Math.floor((now.getTime() - lastStarted.getTime()) / 1000));
  return Math.max(0, current.remainingSeconds - elapsed);
}

function focusTimerDurationMinutes(timer, now = new Date()) {
  const current = normalizeFocusTimer(timer);
  const plannedSeconds = normalizeFocusDuration(current.plannedMinutes) * 60;
  const remainingSeconds = focusTimerRemainingSeconds(current, now);
  const elapsedSeconds = Math.max(0, plannedSeconds - remainingSeconds);
  if (!elapsedSeconds) return 0;
  return Math.max(1, Math.round(elapsedSeconds / 60));
}

function clearLegacyTodoTimers(store, activeTaskId = "") {
  store.todos = store.todos.map((todo) => normalizeTodo({
    ...todo,
    timerStartedAt: "",
    focusTargetMinutes: todo.id === activeTaskId ? store.focusDefaultMinutes : 0
  }));
}

function finishFocusTimerForStore(store, status, nowIso = new Date().toISOString()) {
  const timer = normalizeFocusTimer(store.focusTimer);
  if (!["running", "paused"].includes(timer.status)) return false;
  const now = new Date(nowIso);
  const durationMinutes = focusTimerDurationMinutes(timer, now);
  store.focusSessions.push(normalizeFocusSession({
    id: makeId("focus"),
    todoId: timer.taskId,
    taskId: timer.taskId,
    goalId: timer.goalId,
    categoryId: timer.categoryId,
    title: timer.title,
    project: timer.project || timer.categoryId,
    startedAt: timer.startedAt,
    endedAt: nowIso,
    minutes: status === "completed" ? Math.max(durationMinutes, timer.plannedMinutes) : durationMinutes,
    durationMinutes: status === "completed" ? Math.max(durationMinutes, timer.plannedMinutes) : durationMinutes,
    plannedMinutes: timer.plannedMinutes,
    targetMinutes: timer.plannedMinutes,
    status
  }));
  store.focusTimer = normalizeFocusTimer({ status: "idle", plannedMinutes: store.focusDefaultMinutes });
  clearLegacyTodoTimers(store);
  return true;
}

function startTodoTimer(id, targetMinutes) {
  const store = readTodoStore();
  const targetId = String(id || "");
  const now = new Date().toISOString();
  const target = store.todos.find((todo) => todo.id === targetId);
  if (!target) return store;
  const focusTargetMinutes = normalizeFocusDuration(targetMinutes || store.focusDefaultMinutes);
  finishFocusTimerForStore(store, "abandoned", now);
  store.focusDefaultMinutes = focusTargetMinutes;
  clearLegacyTodoTimers(store, targetId);
  store.focusTimer = normalizeFocusTimer({
    status: "running",
    taskId: target.id,
    todoId: target.id,
    title: target.title,
    categoryId: target.categoryId || target.project,
    goalId: target.goalId,
    project: target.project || target.categoryId,
    startedAt: now,
    lastStartedAt: now,
    plannedMinutes: focusTargetMinutes,
    remainingSeconds: focusTargetMinutes * 60,
    createdAt: now,
    updatedAt: now
  });
  return persistTodoStore(store);
}

function pauseTodoTimer() {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const timer = normalizeFocusTimer(store.focusTimer);
  if (timer.status !== "running") return store;
  store.focusTimer = normalizeFocusTimer({
    ...timer,
    status: "paused",
    remainingSeconds: focusTimerRemainingSeconds(timer, new Date(now)),
    lastStartedAt: "",
    pausedAt: now,
    updatedAt: now
  });
  return persistTodoStore(store);
}

function resumeTodoTimer() {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const timer = normalizeFocusTimer(store.focusTimer);
  if (timer.status !== "paused") return store;
  store.focusTimer = normalizeFocusTimer({
    ...timer,
    status: "running",
    lastStartedAt: now,
    pausedAt: "",
    updatedAt: now
  });
  return persistTodoStore(store);
}

function completeTodoTimer() {
  const store = readTodoStore();
  const changed = finishFocusTimerForStore(store, "completed", new Date().toISOString());
  return changed ? persistTodoStore(store) : store;
}

function abandonTodoTimer() {
  const store = readTodoStore();
  const changed = finishFocusTimerForStore(store, "abandoned", new Date().toISOString());
  return changed ? persistTodoStore(store) : store;
}

function stopTodoTimer(id) {
  const store = readTodoStore();
  const timer = normalizeFocusTimer(store.focusTimer);
  if (!id || timer.taskId === String(id || "")) return completeTodoTimer();
  const targetId = String(id || "");
  const index = store.todos.findIndex((todo) => todo.id === targetId);
  if (index < 0) return store;
  const finished = finishTodoTimer(store.todos[index], new Date());
  if (finished.session) store.focusSessions.push(finished.session);
  store.todos[index] = normalizeTodo({ ...finished.todo, updatedAt: new Date().toISOString() });
  return persistTodoStore(store);
}

function setTodoFocusDefaultMinutes(minutes) {
  const store = readTodoStore();
  store.focusDefaultMinutes = normalizeFocusDuration(minutes);
  return persistTodoStore(store);
}

function clearCompletedTodos() {
  const store = readTodoStore();
  const archivedAt = new Date().toISOString();
  let changed = false;
  const nextTodos = store.todos.map((todo) => {
    if (!todo.completed && todo.status !== "done") return todo;
    changed = true;
    return normalizeTodo({
      ...todo,
      status: "archived",
      completed: false,
      completedAt: null,
      archivedAt,
      timerStartedAt: "",
      focusTargetMinutes: 0,
      updatedAt: archivedAt
    });
  });
  if (!changed) return store;
  return persistTodoStore({ ...store, todos: nextTodos });
}

function setAllTodosCompleted(completed) {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const nextCompleted = Boolean(completed);
  let changed = false;
  const todos = store.todos.map((todo) => {
    if (todo.completed === nextCompleted && !todo.timerStartedAt) return todo;
    changed = true;
    const finished = finishTodoTimer(todo, new Date(now));
    if (finished.session) store.focusSessions.push(finished.session);
    if (nextCompleted) return completeTodoForStore(finished.todo, now);
    return normalizeTodo({
      ...finished.todo,
      status: "todo",
      completed: false,
      completedAt: null,
      updatedAt: now
    });
  });
  if (!changed) return store;
  return persistTodoStore({ ...store, todos });
}

function saveTodoReview(payload = {}) {
  const store = readTodoStore();
  const now = new Date().toISOString();
  const incoming = normalizeTodoReview({
    ...(payload || {}),
    updatedAt: now
  });
  const index = store.reviews.findIndex((review) =>
    review.type === incoming.type && review.periodKey === incoming.periodKey
  );
  if (index >= 0) {
    store.reviews[index] = normalizeTodoReview({
      ...store.reviews[index],
      ...incoming,
      id: store.reviews[index].id,
      createdAt: store.reviews[index].createdAt,
      updatedAt: now
    });
  } else {
    store.reviews.unshift(normalizeTodoReview({
      ...incoming,
      id: makeId("review"),
      createdAt: now,
      updatedAt: now
    }));
  }
  return persistTodoStore(store);
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
  const source = String(value || "").toLowerCase();
  const tokens = source.match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9_-]{1,}/gu);
  const expanded = [];

  for (const token of tokens || []) {
    const isHan = /^[\p{Script=Han}]+$/u.test(token);
    if (!STOP_WORDS.has(token) && token.length <= 40) expanded.push(token);
    if (!isHan) continue;

    if (token.length > 2) {
      for (let size = 2; size <= Math.min(4, token.length); size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          const part = token.slice(index, index + size);
          if (!STOP_WORDS.has(part)) expanded.push(part);
        }
      }
    }
  }

  return [...new Set(expanded)];
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

function memoryContentHash(text) {
  return crypto.createHash("sha256")
    .update(normalizeText(text))
    .digest("hex")
    .slice(0, 24);
}

function memoryHiddenKey(item) {
  const conversationId = item && item.conversationId ? String(item.conversationId) : "";
  const contentHash = item && item.contentHash ? String(item.contentHash) : memoryContentHash(item && item.text);
  return conversationId && contentHash ? `memhide:${conversationId}:${contentHash}` : "";
}

function isMemoryItemHidden(hiddenItemSet, item) {
  const key = memoryHiddenKey(item);
  return Boolean(key && hiddenItemSet.has(key));
}

function normalizeMemoryItem(item) {
  const text = normalizeText(item && item.text);
  if (!text) return null;
  const now = new Date().toISOString();
  const tokens = Array.isArray(item && item.tokens) && item.tokens.length
    ? [...new Set(item.tokens.map((token) => String(token || "").trim()).filter(Boolean))].slice(0, 260)
    : tokenizeText(text).slice(0, 260);

  return {
    id: item && item.id ? String(item.id) : makeId("mem"),
    type: item && item.type ? String(item.type) : "conversation",
    source: item && item.source ? String(item.source) : "conversation",
    conversationId: item && item.conversationId ? String(item.conversationId) : "",
    conversationTitle: item && item.conversationTitle ? String(item.conversationTitle) : "",
    chunkIndex: Number.isFinite(Number(item && item.chunkIndex)) ? Number(item.chunkIndex) : 0,
    scoreHint: Number.isFinite(Number(item && item.scoreHint)) ? Number(item.scoreHint) : 0,
    contentHash: memoryContentHash(text),
    text: text.slice(0, 1800),
    tokens,
    createdAt: item && item.createdAt ? String(item.createdAt) : now,
    updatedAt: item && item.updatedAt ? String(item.updatedAt) : now
  };
}

function normalizeMemoryStore(raw) {
  const forgottenConversationIds = raw && Array.isArray(raw.forgottenConversationIds)
    ? [...new Set(raw.forgottenConversationIds.map((id) => String(id || "")).filter(Boolean))]
    : [];
  const hiddenItemIds = raw && Array.isArray(raw.hiddenItemIds)
    ? [...new Set(raw.hiddenItemIds.map((id) => String(id || "")).filter(Boolean))]
    : [];
  const forgottenConversationSet = new Set(forgottenConversationIds);
  const items = raw && Array.isArray(raw.items)
    ? raw.items.map(normalizeMemoryItem).filter(Boolean)
    : [];
  const hiddenKeys = new Set(hiddenItemIds);
  for (const item of items) {
    if (hiddenKeys.has(item.id)) {
      const key = memoryHiddenKey(item);
      if (key) hiddenKeys.add(key);
    }
  }
  const visibleItems = items
    .filter((item) => !isMemoryItemHidden(hiddenKeys, item))
    .filter((item) => !forgottenConversationSet.has(item.conversationId));
  visibleItems.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return {
    version: MEMORY_STORE_VERSION,
    indexSignature: raw && raw.indexSignature ? String(raw.indexSignature) : "",
    updatedAt: raw && raw.updatedAt ? String(raw.updatedAt) : new Date().toISOString(),
    forgottenConversationIds,
    hiddenItemIds: [...hiddenKeys].filter((id) => id.startsWith("memhide:")),
    items: visibleItems.slice(0, MEMORY_MAX_ITEMS)
  };
}

function readMemoryStore() {
  return normalizeMemoryStore(readJson(memoriesPath(), null));
}

function memorySettings() {
  return normalizeMemoryConfig(readSettingsStore().memory);
}

function memoryIndexSignature(config = memorySettings()) {
  return JSON.stringify({
    rememberAssistant: Boolean(config.rememberAssistant),
    minMessageChars: Number(config.minMessageChars),
    minChunkChars: Number(config.minChunkChars)
  });
}

function shouldIndexMessageForMemory(message, config = memorySettings()) {
  if (!message || message.remember === false) return false;
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (message.role === "assistant" && !config.rememberAssistant) return false;
  const content = normalizeText(messageContentToText(message.content));
  return content.length >= config.minMessageChars;
}

function persistMemoryStore(store) {
  const normalized = normalizeMemoryStore({
    ...(store || {}),
    updatedAt: new Date().toISOString()
  });
  ensureUserDataDir();
  fs.writeFileSync(memoriesPath(), JSON.stringify(normalized, null, 2), "utf8");
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("memories:updated", memoryStoreForClient(normalized));
  });
  return normalized;
}

function memoryStoreForClient(store) {
  const source = store || ensureMemoryStoreFresh();
  return {
    ...source,
    settings: memorySettings()
  };
}

function conversationMemoryText(conversation, config = memorySettings()) {
  const messages = Array.isArray(conversation && conversation.messages) ? conversation.messages : [];
  return messages
    .filter((message) => shouldIndexMessageForMemory(message, config))
    .map((message) => {
      const content = normalizeText(messageContentToText(message && message.content));
      if (!content) return "";
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function conversationHasMemoryText(conversation, config = memorySettings()) {
  const messages = Array.isArray(conversation && conversation.messages) ? conversation.messages : [];
  return messages.some((message) => shouldIndexMessageForMemory(message, config));
}

function memoryItemsForConversation(conversation, config = memorySettings()) {
  if (!conversation || !conversation.id) return [];
  if (!conversationHasMemoryText(conversation, config)) return [];
  const memoryText = conversationMemoryText(conversation, config);
  const chunks = splitTextIntoChunks(memoryText, {
    maxChars: MEMORY_CHUNK_MAX_CHARS,
    overlapChars: MEMORY_CHUNK_OVERLAP_CHARS
  }).slice(0, MEMORY_MAX_CHUNKS_PER_CONVERSATION);
  const updatedAt = conversation.updatedAt || new Date().toISOString();
  const createdAt = conversation.createdAt || updatedAt;

  return chunks
    .filter((chunk) => normalizeText(chunk.text).length >= config.minChunkChars)
    .map((chunk) => normalizeMemoryItem({
      id: `memory:${conversation.id}:${chunk.index}`,
      type: "conversation",
      source: "conversation",
      conversationId: conversation.id,
      conversationTitle: conversation.title || "新对话",
      chunkIndex: chunk.index,
      text: chunk.text,
      tokens: chunk.tokens,
      scoreHint: Math.min(3, Math.max(0, Math.log10(String(chunk.text || "").length + 1))),
      createdAt,
      updatedAt
    }))
    .filter(Boolean);
}

function filterVisibleMemoryItemsForStore(store, items) {
  const forgottenConversationIds = new Set(Array.isArray(store && store.forgottenConversationIds) ? store.forgottenConversationIds : []);
  const hiddenItemIds = new Set(Array.isArray(store && store.hiddenItemIds) ? store.hiddenItemIds : []);
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && !isMemoryItemHidden(hiddenItemIds, item))
    .filter((item) => !forgottenConversationIds.has(item.conversationId));
}

function migrateHiddenMemoryIds(store, items) {
  const existing = Array.isArray(store && store.hiddenItemIds) ? store.hiddenItemIds : [];
  if (!existing.length) return existing;
  return [...new Set(existing)].filter((id) => String(id || "").startsWith("memhide:"));
}

function upsertConversationMemory(conversation) {
  const config = memorySettings();
  if (!config.enabled) return readMemoryStore();
  const store = readMemoryStore();
  const indexSignature = memoryIndexSignature(config);
  if (store.indexSignature && store.indexSignature !== indexSignature) return rebuildMemoryStore();
  const conversationId = String(conversation && conversation.id || "");
  const candidateItems = memoryItemsForConversation(conversation, config);
  const hiddenItemIds = migrateHiddenMemoryIds(store, candidateItems);
  const nextStore = { ...store, hiddenItemIds };
  const memoryItems = filterVisibleMemoryItemsForStore(nextStore, candidateItems);
  const remaining = store.items.filter((item) => item.conversationId !== conversationId);
  return persistMemoryStore({
    ...nextStore,
    indexSignature,
    items: [...memoryItems, ...remaining]
  });
}

function removeConversationMemories(conversationId) {
  const targetId = String(conversationId || "");
  if (!targetId) return readMemoryStore();
  const store = readMemoryStore();
  const items = store.items.filter((item) => item.conversationId !== targetId);
  if (items.length === store.items.length) return store;
  return persistMemoryStore({ ...store, items });
}

function rebuildMemoryStore() {
  const existing = readMemoryStore();
  const config = memorySettings();
  const forgottenConversationIds = new Set(existing.forgottenConversationIds);
  const conversationStore = readConversationStore();
  const items = conversationStore.conversations
    .filter((conversation) => !forgottenConversationIds.has(conversation.id))
    .flatMap((conversation) => memoryItemsForConversation(conversation, config));
  const hiddenItemIds = migrateHiddenMemoryIds(existing, items);
  const nextStore = { ...existing, hiddenItemIds };
  return persistMemoryStore({
    ...nextStore,
    version: MEMORY_STORE_VERSION,
    indexSignature: memoryIndexSignature(config),
    items: filterVisibleMemoryItemsForStore(nextStore, items)
  });
}

function deleteMemoryItem(memoryId) {
  const targetId = String(memoryId || "");
  if (!targetId) return readMemoryStore();
  const store = readMemoryStore();
  const targetItem = store.items.find((item) => item.id === targetId || memoryHiddenKey(item) === targetId);
  const hiddenKey = targetItem ? memoryHiddenKey(targetItem) : targetId;
  const hiddenItemIds = [...new Set([...(store.hiddenItemIds || []), hiddenKey].filter(Boolean))];
  return persistMemoryStore({
    ...store,
    hiddenItemIds,
    items: store.items.filter((item) => item.id !== targetId && memoryHiddenKey(item) !== hiddenKey)
  });
}

function forgetConversationMemory(conversationId) {
  const targetId = String(conversationId || "");
  if (!targetId) return readMemoryStore();
  const store = readMemoryStore();
  const forgottenConversationIds = [...new Set([...(store.forgottenConversationIds || []), targetId])];
  return persistMemoryStore({
    ...store,
    forgottenConversationIds,
    items: store.items.filter((item) => item.conversationId !== targetId)
  });
}

function forgetAllMemories() {
  const conversationStore = readConversationStore();
  const conversationIds = conversationStore.conversations.map((conversation) => conversation.id).filter(Boolean);
  return persistMemoryStore({
    version: MEMORY_STORE_VERSION,
    indexSignature: memoryIndexSignature(),
    forgottenConversationIds: [...new Set(conversationIds)],
    hiddenItemIds: [],
    items: []
  });
}

function restoreAllMemories() {
  const conversationStore = readConversationStore();
  const config = memorySettings();
  const items = conversationStore.conversations.flatMap((conversation) => memoryItemsForConversation(conversation, config));
  return persistMemoryStore({
    version: MEMORY_STORE_VERSION,
    indexSignature: memoryIndexSignature(config),
    forgottenConversationIds: [],
    hiddenItemIds: [],
    items
  });
}

function ensureMemoryStoreFresh() {
  const store = readMemoryStore();
  const config = memorySettings();
  const indexSignature = memoryIndexSignature(config);
  if (!config.enabled) return store;
  const conversationStore = readConversationStore();
  const forgottenConversationIds = new Set(store.forgottenConversationIds);
  const hiddenItemIds = new Set(store.hiddenItemIds);
  const expectedItemsByConversation = new Map();
  const expectedConversationIds = new Set();

  for (const conversation of conversationStore.conversations) {
    if (!conversation || forgottenConversationIds.has(conversation.id)) continue;
    const expectedItems = filterVisibleMemoryItemsForStore(store, memoryItemsForConversation(conversation, config));
    if (!expectedItems.length) continue;
    expectedItemsByConversation.set(conversation.id, { conversation, items: expectedItems });
    expectedConversationIds.add(conversation.id);
  }

  let stale = store.indexSignature !== indexSignature;
  stale = stale || (store.items.length === 0 && expectedItemsByConversation.size > 0);
  stale = stale || store.items.some((item) =>
    !item.conversationId ||
    isMemoryItemHidden(hiddenItemIds, item) ||
    forgottenConversationIds.has(item.conversationId) ||
    !expectedConversationIds.has(item.conversationId)
  );
  const itemsByConversation = new Map();

  for (const item of store.items) {
    if (!item.conversationId) continue;
    const items = itemsByConversation.get(item.conversationId) || [];
    items.push(item);
    itemsByConversation.set(item.conversationId, items);
  }

  if (!stale) {
    for (const [conversationId, expected] of expectedItemsByConversation) {
      const items = itemsByConversation.get(conversationId) || [];
      const newestItem = items.reduce((newest, item) =>
        String(item.updatedAt || "") > String(newest.updatedAt || "") ? item : newest,
      items[0] || { updatedAt: "" });
      if (
        items.length !== expected.items.length ||
        String(newestItem.updatedAt || "") < String(expected.conversation.updatedAt || "")
      ) {
        stale = true;
        break;
      }
    }
  }

  return stale ? rebuildMemoryStore() : store;
}

function searchGlobalMemories(query, options = {}) {
  options = options || {};
  const config = memorySettings();
  const queryText = normalizeText(query);
  const queryTokens = tokenSet(queryText);
  const rawLimit = Number(options.limit ?? config.recallLimit);
  const limit = Math.max(0, Math.min(Number.isFinite(rawLimit) ? rawLimit : config.recallLimit, 20));
  const excludeConversationIds = new Set(
    Array.isArray(options.excludeConversationIds)
      ? options.excludeConversationIds.map((id) => String(id || "")).filter(Boolean)
      : []
  );
  if (options.excludeConversationId) excludeConversationIds.add(String(options.excludeConversationId));
  const store = ensureMemoryStoreFresh();
  const results = [];

  if (!config.enabled && !options.includeDisabled) {
    return { query: queryText, results: [], updatedAt: store.updatedAt, settings: config };
  }

  if (!limit || !queryTokens.size) {
    return { query: queryText, results: [], updatedAt: store.updatedAt, settings: config };
  }

  for (const item of store.items) {
    if (excludeConversationIds.has(item.conversationId)) continue;
    const score = scoreChunk(queryTokens, item, item.conversationTitle || "");
    if (score <= 0) continue;
    results.push({
      type: "memory",
      id: item.id,
      source: item.source,
      conversationId: item.conversationId,
      conversationTitle: item.conversationTitle,
      chunkIndex: item.chunkIndex,
      score: Number((score + (Number(item.scoreHint) || 0)).toFixed(4)),
      text: String(item.text || "").slice(0, 1600),
      updatedAt: item.updatedAt
    });
  }

  results.sort((a, b) => b.score - a.score || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return {
    query: queryText,
    results: results.slice(0, limit),
    updatedAt: store.updatedAt,
    settings: config
  };
}

async function searchKnowledgeMemories(knowledgeBaseId, query, options = {}) {
  const store = readKnowledgeStore();
  const base = store.knowledgeBases.find((item) => item.id === String(knowledgeBaseId || ""));
  if (!base) return { knowledgeBaseId: null, query: String(query || ""), fileResults: [], conversationResults: [], diagnostics: [] };

  const queryText = normalizeText(query);
  const queryTokens = tokenSet(queryText);
  const rawFileLimit = Number(options.fileLimit ?? options.limit ?? 6);
  const rawConversationLimit = Number(options.conversationLimit ?? 4);
  const fileLimit = Math.max(0, Math.min(Number.isFinite(rawFileLimit) ? rawFileLimit : 6, 20));
  const conversationLimit = Math.max(0, Math.min(Number.isFinite(rawConversationLimit) ? rawConversationLimit : 4, 12));
  const excludeConversationId = options.excludeConversationId ? String(options.excludeConversationId) : "";
  const fileSearch = fileLimit > 0
    ? await searchKnowledgeBase(base.id, queryText, { limit: fileLimit })
    : { results: [], diagnostics: [] };
  const conversationStore = readConversationStore();
  const memoryConfig = memorySettings();
  const conversationMap = new Map(conversationStore.conversations.map((conversation) => [conversation.id, conversation]));
  const conversationResults = [];

  for (const conversationId of base.conversationIds) {
    if (excludeConversationId && conversationId === excludeConversationId) continue;
    const conversation = conversationMap.get(conversationId);
    if (!conversation) continue;

    const memoryItems = memoryItemsForConversation(conversation, memoryConfig).slice(0, 80);
    for (const item of memoryItems) {
      const score = scoreChunk(queryTokens, item, conversation.title || "");
      if (score <= 0) continue;
      conversationResults.push({
        type: "conversation",
        knowledgeBaseId: base.id,
        knowledgeBaseName: base.name,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        chunkIndex: item.chunkIndex,
        score,
        text: String(item.text || "").slice(0, 1600),
        updatedAt: conversation.updatedAt
      });
    }
  }

  conversationResults.sort((a, b) => b.score - a.score);
  return {
    knowledgeBaseId: base.id,
    knowledgeBaseName: base.name,
    query: queryText,
    fileResults: (fileSearch.results || []).map((result) => ({ ...result, type: "file" })),
    conversationResults: conversationResults.slice(0, conversationLimit),
    diagnostics: fileSearch.diagnostics || []
  };
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
      type: String(node.type || node.entity_type || node.category || "concept"),
      detail: String(node.description || node.detail || node.summary || "")
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = rawLinks
    .map((link) => ({
      source: String(link.src_id || link.source_id || link.source || link.from || link.src || ""),
      target: String(link.tgt_id || link.target_id || link.target || link.to || link.dst || ""),
      label: String(link.label || link.type || link.relation || link.description || "")
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
    const error = new Error(`RAGFlow ${response.status}: ${message}`);
    error.status = response.status;
    error.apiPath = apiPath;
    error.body = body;
    throw error;
  }
  if (body && typeof body === "object" && body.code !== undefined && Number(body.code) !== 0) {
    const error = new Error(body.message || `RAGFlow returned code ${body.code}`);
    error.ragflowCode = body.code;
    error.apiPath = apiPath;
    error.body = body;
    throw error;
  }
  return body;
}

function canTryRagflowFallback(error) {
  return error && (error.status === 404 || error.status === 405);
}

function classifyRagflowError(error) {
  const message = String(error && error.message ? error.message : error || "");
  if (error && (error.status === 401 || error.status === 403) || /authorization|authentication|api key|token/i.test(message)) {
    return "auth";
  }
  if (error && error.status === 404 || /dataset.*not found|can't find this dataset|datasets not found|invalid dataset/i.test(message)) {
    return "dataset";
  }
  if (/embedding|embd|llm|model|provider|api key/i.test(message)) {
    return "model";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|connect/i.test(message)) {
    return "service";
  }
  return "unknown";
}

function buildRagflowSetupIssue(kind, detail = "") {
  const details = detail ? `\n\nDetail: ${detail}` : "";
  if (kind === "service") {
    return {
      ok: false,
      needsConfig: true,
      diagnosis: { kind, detail },
      error: `RAGFlow is not reachable. Start Docker/RAGFlow first, then refresh the graph.${details}`
    };
  }
  if (kind === "auth") {
    return {
      ok: false,
      needsConfig: true,
      diagnosis: { kind, detail },
      error: `RAGFlow API Key is invalid or missing. Create/copy an API key in RAGFlow and save it in Deskchat Settings.${details}`
    };
  }
  if (kind === "dataset") {
    return {
      ok: false,
      needsConfig: true,
      diagnosis: { kind, detail },
      error: `RAGFlow Dataset ID is missing or not accessible. Create a dataset in RAGFlow, copy its ID, and save it in Deskchat Settings.${details}`
    };
  }
  if (kind === "model") {
    return {
      ok: false,
      needsConfig: true,
      diagnosis: { kind, detail },
      error: `RAGFlow dataset is not ready for parsing/GraphRAG. Configure a model provider, default chat model, and embedding model in RAGFlow, then create or update the dataset.${details}`
    };
  }
  return {
    ok: false,
    diagnosis: { kind, detail },
    error: detail || "RAGFlow setup check failed."
  };
}

async function ragflowRequestFirst(config, candidates, options = {}) {
  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const apiPath = candidates[index];
    try {
      return await ragflowRequest(config, apiPath, options);
    } catch (error) {
      lastError = error;
      if (index >= candidates.length - 1 || !canTryRagflowFallback(error)) throw error;
    }
  }
  throw lastError || new Error("RAGFlow request failed.");
}

async function runRagflowKnowledgeGraph(config = ragflowConfig()) {
  return ragflowRequestFirst(config, [
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/index?type=graph`,
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/run_graphrag`
  ], {
    method: "POST"
  });
}

async function traceRagflowKnowledgeGraph(config = ragflowConfig()) {
  return ragflowRequestFirst(config, [
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/index?type=graph`,
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/trace_graphrag`
  ]);
}

async function fetchRagflowKnowledgeGraph(config = ragflowConfig()) {
  return ragflowRequestFirst(config, [
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/graph`,
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/knowledge_graph`
  ]);
}

async function getRagflowDataset(config = ragflowConfig()) {
  return ragflowRequest(config, `/api/v1/datasets/${encodeURIComponent(config.datasetId)}`);
}

function normalizeRagflowDataset(raw) {
  const data = raw && raw.data ? raw.data : raw;
  if (!data || typeof data !== "object") return null;
  return {
    id: String(data.id || ""),
    name: String(data.name || ""),
    embdId: String(data.embd_id || data.embedding_model || ""),
    parserId: String(data.parser_id || data.chunk_method || ""),
    docCount: Number(data.doc_num ?? data.document_count ?? 0),
    chunkCount: Number(data.chunk_num ?? data.chunk_count ?? 0),
    parserConfig: data.parser_config || {}
  };
}

async function diagnoseRagflowReadiness(config = ragflowConfig()) {
  if (!config.enabled) return buildRagflowSetupIssue("dataset", "RAGFlow integration is disabled in Deskchat Settings.");
  if (!config.baseUrl || !config.apiKey || !config.datasetId) {
    return buildRagflowSetupIssue("dataset", "Base URL, API Key, and Dataset ID are required.");
  }

  try {
    const dataset = normalizeRagflowDataset(await getRagflowDataset(config));
    if (!dataset || !dataset.id) return buildRagflowSetupIssue("dataset", "Dataset lookup returned no dataset data.");
    if (!dataset.embdId) {
      return buildRagflowSetupIssue("model", `Dataset "${dataset.name || config.datasetId}" has no embedding model.`);
    }
    return { ok: true, dataset };
  } catch (error) {
    return buildRagflowSetupIssue(classifyRagflowError(error), error.message);
  }
}

function normalizeRagflowGraphTrace(raw) {
  const data = raw && raw.data ? raw.data : raw;
  const trace = Array.isArray(data) ? data[0] : data;
  if (!trace || typeof trace !== "object") return null;
  const progress = Number(trace.progress);
  const progressText = Number.isFinite(progress) ? `${Math.round(progress * 100)}%` : "";
  const message = String(trace.progress_msg || trace.message || trace.status || "").trim();
  const failed = Number.isFinite(progress) && progress < 0;
  return {
    id: String(trace.id || trace.task_id || trace.graphrag_task_id || ""),
    progress: Number.isFinite(progress) ? progress : null,
    progressText,
    message,
    done: Number.isFinite(progress) && progress >= 1,
    failed
  };
}

function normalizeRagflowDocument(raw, documentId = "") {
  const data = raw && raw.data ? raw.data : raw;
  const items = Array.isArray(data)
    ? data
    : data && Array.isArray(data.docs)
      ? data.docs
      : data && Array.isArray(data.documents)
        ? data.documents
        : data && Array.isArray(data.data)
          ? data.data
          : data
            ? [data]
            : [];
  const doc = items.find((item) => String(item && (item.id || item.document_id)) === String(documentId)) || items[0];
  if (!doc || typeof doc !== "object") return null;
  const progress = Number(doc.progress);
  const run = String(doc.run ?? doc.run_status ?? "");
  const chunkCount = Number(doc.chunk_num ?? doc.chunk_count ?? doc.chunkCount ?? 0);
  return {
    id: String(doc.id || doc.document_id || documentId || ""),
    name: String(doc.name || ""),
    run,
    progress: Number.isFinite(progress) ? progress : null,
    progressText: Number.isFinite(progress) ? `${Math.round(progress * 100)}%` : "",
    progressMessage: String(doc.progress_msg || doc.message || "").trim(),
    chunkCount,
    tokenCount: Number(doc.token_num ?? doc.token_count ?? 0),
    error: String(doc.error || doc.error_msg || "")
  };
}

function ragflowDocumentStage(doc) {
  if (!doc) return "unknown";
  if (doc.progress !== null && doc.progress < 0) return "failed";
  if (doc.error) return "failed";
  if (doc.run === "3" || /fail|error/i.test(doc.run)) return "failed";
  if (doc.run === "1" || doc.run === "2" || (doc.progress !== null && doc.progress > 0 && doc.progress < 1)) return "parsing";
  if (doc.run === "0" || doc.run === "" || doc.run === "null") return doc.chunkCount > 0 ? "ready" : "unparsed";
  if (doc.run === "4" || doc.progress >= 1 || doc.chunkCount > 0) return "ready";
  return "unknown";
}

async function getRagflowDocument(config, documentId) {
  return ragflowRequestFirst(config, [
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/documents?id=${encodeURIComponent(documentId)}&page_size=1`,
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/documents/${encodeURIComponent(documentId)}`
  ]);
}

function isRagflowTaskRunningError(error) {
  return /already running|in progress/i.test(String(error && error.message ? error.message : ""));
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
  return ragflowRequestFirst(config, [
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/documents/parse`,
    `/api/v1/datasets/${encodeURIComponent(config.datasetId)}/chunks`,
    "/api/v1/documents/ingest"
  ], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_ids: [documentId], document_ids: [documentId], run: 1, apply_kb: true })
  }).catch((error) => ({ code: "parse_start_failed", message: error.message }));
}

function buildRagflowDocumentPending(documentId, document, parseResult = null) {
  const stage = ragflowDocumentStage(document);
  const suffix = document && document.progressMessage ? ` ${document.progressMessage.split("\n").slice(-1)[0]}` : "";
  if (stage === "failed") {
    return {
      ok: false,
      documentId,
      documentStatus: document,
      error: document && (document.error || document.progressMessage)
        ? `RAGFlow document parsing failed. ${document.error || document.progressMessage}`
        : "RAGFlow document parsing failed. Check the dataset parser/model settings in RAGFlow."
    };
  }
  return {
    ok: false,
    pending: true,
    stage: stage === "unparsed" ? "parsing" : stage,
    documentId,
    documentStatus: document,
    parseStart: parseResult,
    error: document && document.progressText
      ? `RAGFlow is parsing this document (${document.progressText}).${suffix}`
      : "RAGFlow is parsing this document. Refresh after parsing finishes, then GraphRAG can build the graph."
  };
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

  const readiness = await diagnoseRagflowReadiness(config);
  if (!readiness.ok) return readiness;

  const ensured = await ensureRagflowDocument(base.id, file);
  if (!ensured.ok) return ensured;
  if (ensured.uploaded) {
    await enableRagflowKnowledgeGraph();
    await startRagflowDocumentParse(ensured.documentId);
  }

  try {
    let documentStatus = null;
    try {
      documentStatus = normalizeRagflowDocument(await getRagflowDocument(config, ensured.documentId), ensured.documentId);
      const documentStage = ragflowDocumentStage(documentStatus);
      if (documentStage === "unparsed") {
        const parseResult = await startRagflowDocumentParse(ensured.documentId);
        return buildRagflowDocumentPending(ensured.documentId, documentStatus, parseResult);
      }
      if (documentStage === "parsing" || documentStage === "failed") {
        return buildRagflowDocumentPending(ensured.documentId, documentStatus);
      }
    } catch (error) {
      if (!canTryRagflowFallback(error)) throw error;
    }

    let trace = null;
    try {
      trace = normalizeRagflowGraphTrace(await traceRagflowKnowledgeGraph(config));
    } catch (error) {
      if (!canTryRagflowFallback(error)) throw error;
    }

    const raw = await fetchRagflowKnowledgeGraph(config);
    const graph = normalizeRagflowGraph(raw);
    if (!graph.nodes.length) {
      let started = null;
      let startError = null;
      try {
        started = await runRagflowKnowledgeGraph(config);
      } catch (error) {
        startError = error;
        if (!isRagflowTaskRunningError(error)) throw error;
      }

      try {
        trace = normalizeRagflowGraphTrace(await traceRagflowKnowledgeGraph(config)) || trace;
      } catch (error) {
        if (!isRagflowTaskRunningError(startError)) throw error;
      }

      if (trace && trace.failed) {
        return {
          ok: false,
          documentId: ensured.documentId,
          documentStatus,
          graphTrace: trace,
          error: trace.message || "RAGFlow graph build failed. Check the dataset model and parsing configuration in RAGFlow."
        };
      }

      return {
        ok: false,
        pending: true,
        stage: "graph",
        documentId: ensured.documentId,
        documentStatus,
        graphTaskId: String((started && started.data && (started.data.task_id || started.data.graphrag_task_id)) || ""),
        graphTrace: trace,
        startError: startError ? startError.message : "",
        error: trace && trace.message
          ? `RAGFlow graph is building${trace.progressText ? ` (${trace.progressText})` : ""}. ${trace.message.split("\n").slice(-1)[0]}`
          : startError
            ? `RAGFlow graph task is already running. ${startError.message}`
          : "RAGFlow graph is building. Wait for parsing and GraphRAG to finish, then refresh."
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
      documentStatus,
      graphTrace: trace,
      graph
    };
  } catch (error) {
    const kind = classifyRagflowError(error);
    const issue = buildRagflowSetupIssue(kind, error.message);
    return { ...issue, documentId: ensured.documentId };
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
    title: "Deskchat 设置",
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

function openTodoWindow() {
  if (todoWindow && !todoWindow.isDestroyed()) {
    todoWindow.focus();
    return;
  }

  todoWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: "Todo 清单",
    autoHideMenuBar: true,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  todoWindow.setMenuBarVisibility(false);

  todoWindow.loadFile("todo.html");
  todoWindow.on("closed", () => {
    todoWindow = null;
  });
}

function normalizeConfirmOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  return {
    title: source.title ? String(source.title).slice(0, 120) : "确认操作",
    message: source.message ? String(source.message).slice(0, 500) : "确定继续？",
    detail: source.detail ? String(source.detail).slice(0, 1200) : "",
    confirmLabel: source.confirmLabel ? String(source.confirmLabel).slice(0, 40) : "确认",
    cancelLabel: source.cancelLabel ? String(source.cancelLabel).slice(0, 40) : "取消",
    danger: Boolean(source.danger)
  };
}

async function confirmDialog(sender, options) {
  const normalized = normalizeConfirmOptions(options);
  if (process.env.DESKCHAT_E2E_AUTO_CONFIRM === "1") return true;
  const parent = sender ? BrowserWindow.fromWebContents(sender) : null;
  const result = await dialog.showMessageBox(parent || undefined, {
    type: normalized.danger ? "warning" : "question",
    title: normalized.title,
    message: normalized.message,
    detail: normalized.detail,
    buttons: [normalized.cancelLabel, normalized.confirmLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    normalizeAccessKeys: true
  });
  return result.response === 1;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  if (process.env.DESKCHAT_SMOKE_OPEN_TODO === "1") {
    setTimeout(() => openTodoWindow(), 300);
  }
  if (process.env.DESKCHAT_SMOKE_OPEN_SETTINGS === "1") {
    setTimeout(() => openSettingsWindow(), 500);
  }
  const smokeQuitMs = Number(process.env.DESKCHAT_SMOKE_QUIT_MS || 0);
  if (Number.isFinite(smokeQuitMs) && smokeQuitMs > 0) {
    setTimeout(() => app.quit(), smokeQuitMs);
  }

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
ipcMain.handle("ui:confirm", async (event, options) => confirmDialog(event.sender, options));
ipcMain.handle("clipboard:write-text", async (_event, text) => {
  clipboard.writeText(String(text || ""));
  return { ok: true };
});
ipcMain.handle("settings:open", async () => {
  openSettingsWindow();
  return true;
});
ipcMain.handle("todo:open-window", async () => {
  openTodoWindow();
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
ipcMain.handle("memories:get", async () => memoryStoreForClient());
ipcMain.handle("memories:search", async (_event, args) => searchGlobalMemories(args && args.query, args && args.options));
ipcMain.handle("memories:rebuild", async () => rebuildMemoryStore());
ipcMain.handle("memories:delete-item", async (_event, id) => deleteMemoryItem(id));
ipcMain.handle("memories:forget-conversation", async (_event, id) => forgetConversationMemory(id));
ipcMain.handle("memories:forget-all", async () => forgetAllMemories());
ipcMain.handle("memories:restore-all", async () => restoreAllMemories());
ipcMain.handle("todo:get", async () => readTodoStore());
ipcMain.handle("todo:create", async (_event, todo) => createTodo(todo || {}));
ipcMain.handle("todo:save", async (_event, todo) => saveTodo(todo || {}));
ipcMain.handle("todo:save-goal", async (_event, goal) => saveTodoGoal(goal || {}));
ipcMain.handle("todo:archive-goal", async (_event, id) => archiveTodoGoal(String(id || "")));
ipcMain.handle("todo:delete", async (_event, id) => deleteTodo(String(id || "")));
ipcMain.handle("todo:toggle", async (_event, args) => toggleTodo(args && args.id, args && args.completed));
ipcMain.handle("todo:toggle-subtask", async (_event, args) =>
  toggleTodoSubtask(args && args.todoId, args && args.subtaskId, args && args.completed)
);
ipcMain.handle("todo:start-timer", async (_event, args) => {
  if (args && typeof args === "object") return startTodoTimer(args.id, args.targetMinutes);
  return startTodoTimer(args);
});
ipcMain.handle("todo:stop-timer", async (_event, id) => stopTodoTimer(id));
ipcMain.handle("todo:pause-timer", async () => pauseTodoTimer());
ipcMain.handle("todo:resume-timer", async () => resumeTodoTimer());
ipcMain.handle("todo:complete-timer", async () => completeTodoTimer());
ipcMain.handle("todo:abandon-timer", async () => abandonTodoTimer());
ipcMain.handle("todo:set-focus-default", async (_event, minutes) => setTodoFocusDefaultMinutes(minutes));
ipcMain.handle("todo:save-review", async (_event, review) => saveTodoReview(review || {}));
ipcMain.handle("todo:clear-completed", async () => clearCompletedTodos());
ipcMain.handle("todo:set-all-completed", async (_event, completed) => setAllTodosCompleted(completed));
ipcMain.handle("todo:save-category", async (_event, category) => saveTodoCategory(category || {}));
ipcMain.handle("todo:rename-category", async (_event, category) => renameTodoCategory(category || {}));
ipcMain.handle("todo:delete-category", async (_event, name) => deleteTodoCategory(String(name || "")));
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
ipcMain.handle("knowledge:search-memories", async (_event, args) =>
  searchKnowledgeMemories(args && args.knowledgeBaseId, args && args.query, args && args.options)
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

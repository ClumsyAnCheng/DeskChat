const { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { exec } = require("node:child_process");

const isWindows = process.platform === "win32";
const chatWindows = new Set();
const windowModes = new Map();
let mainWindow = null;
let settingsWindow = null;

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
  return { activeConfigId, apiConfigs: configs };
}

function settingsPath() {
  return userDataFile("settings.json");
}

function readSettingsStore() {
  return normalizeSettingsStore(readJson(settingsPath(), null));
}

function activeSettings(store = readSettingsStore()) {
  const active = store.apiConfigs.find((config) => config.id === store.activeConfigId) || store.apiConfigs[0];
  return { ...active, activeConfigId: store.activeConfigId, apiConfigs: store.apiConfigs };
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
  return persistConversationStore(nextStore);
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
    backgroundColor: "#f6f4ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

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
    backgroundColor: "#f6f4ef",
    parent: getFocusedChatWindow() || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  settingsWindow.loadFile("settings.html");
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

app.whenReady().then(() => {
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

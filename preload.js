const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deskchat", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  setCompactMode: (enabled) => ipcRenderer.invoke("window:set-compact", enabled),
  setPinnedMode: (pinned) => ipcRenderer.invoke("window:set-pinned", pinned),
  openChatWindow: (conversationId) => ipcRenderer.invoke("chat:open-window", conversationId),
  getConversations: () => ipcRenderer.invoke("conversations:get"),
  createConversation: (title) => ipcRenderer.invoke("conversations:create", title),
  saveConversation: (conversation) => ipcRenderer.invoke("conversations:save", conversation),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", id),
  getKnowledgeBases: () => ipcRenderer.invoke("knowledge:get"),
  createKnowledgeBase: (name) => ipcRenderer.invoke("knowledge:create", name),
  saveKnowledgeBase: (base) => ipcRenderer.invoke("knowledge:save", base),
  deleteKnowledgeBase: (id) => ipcRenderer.invoke("knowledge:delete", id),
  setActiveKnowledgeBase: (id) => ipcRenderer.invoke("knowledge:set-active", id),
  linkConversationToKnowledgeBase: (knowledgeBaseId, conversationId) =>
    ipcRenderer.invoke("knowledge:link-conversation", { knowledgeBaseId, conversationId }),
  unlinkConversationFromKnowledgeBase: (knowledgeBaseId, conversationId) =>
    ipcRenderer.invoke("knowledge:unlink-conversation", { knowledgeBaseId, conversationId }),
  addKnowledgeFile: (knowledgeBaseId, file) => ipcRenderer.invoke("knowledge:add-file", { knowledgeBaseId, file }),
  removeKnowledgeFile: (knowledgeBaseId, fileId) => ipcRenderer.invoke("knowledge:remove-file", { knowledgeBaseId, fileId }),
  openKnowledgeFile: (knowledgeBaseId, fileId) => ipcRenderer.invoke("knowledge:open-file", { knowledgeBaseId, fileId }),
  searchKnowledgeBase: (knowledgeBaseId, query, options) =>
    ipcRenderer.invoke("knowledge:search", { knowledgeBaseId, query, options }),
  getKnowledgeMindMap: (knowledgeBaseId, fileId) => ipcRenderer.invoke("knowledge:mind-map", { knowledgeBaseId, fileId }),
  onSettingsUpdated: (callback) => {
    ipcRenderer.removeAllListeners("settings:updated");
    ipcRenderer.on("settings:updated", (_event, settings) => callback(settings));
  },
  onConversationsUpdated: (callback) => {
    ipcRenderer.removeAllListeners("conversations:updated");
    ipcRenderer.on("conversations:updated", (_event, store) => callback(store));
  },
  onKnowledgeBasesUpdated: (callback) => {
    ipcRenderer.removeAllListeners("knowledge:updated");
    ipcRenderer.on("knowledge:updated", (_event, store) => callback(store));
  },
  onWindowState: (callback) => {
    ipcRenderer.removeAllListeners("window:state");
    ipcRenderer.on("window:state", (_event, state) => callback(state));
  },
  screenshot: () => ipcRenderer.invoke("tool:screenshot"),
  runCommand: (args) => ipcRenderer.invoke("tool:run-command", args),
  moveMouse: (args) => ipcRenderer.invoke("tool:move-mouse", args),
  clickMouse: (args) => ipcRenderer.invoke("tool:click-mouse", args),
  imageFromBuffer: (bytes) => ipcRenderer.invoke("image:from-buffer", bytes)
});

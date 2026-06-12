const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deskchat", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  confirmAction: (options) => ipcRenderer.invoke("ui:confirm", options),
  openTodoWindow: () => ipcRenderer.invoke("todo:open-window"),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  setCompactMode: (enabled) => ipcRenderer.invoke("window:set-compact", enabled),
  setPinnedMode: (pinned) => ipcRenderer.invoke("window:set-pinned", pinned),
  openChatWindow: (conversationId) => ipcRenderer.invoke("chat:open-window", conversationId),
  getConversations: () => ipcRenderer.invoke("conversations:get"),
  createConversation: (title) => ipcRenderer.invoke("conversations:create", title),
  saveConversation: (conversation) => ipcRenderer.invoke("conversations:save", conversation),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", id),
  getMemories: () => ipcRenderer.invoke("memories:get"),
  searchMemories: (query, options) => ipcRenderer.invoke("memories:search", { query, options }),
  rebuildMemories: () => ipcRenderer.invoke("memories:rebuild"),
  deleteMemoryItem: (id) => ipcRenderer.invoke("memories:delete-item", id),
  forgetConversationMemory: (id) => ipcRenderer.invoke("memories:forget-conversation", id),
  forgetAllMemories: () => ipcRenderer.invoke("memories:forget-all"),
  restoreAllMemories: () => ipcRenderer.invoke("memories:restore-all"),
  getTodos: () => ipcRenderer.invoke("todo:get"),
  createTodo: (todo) => ipcRenderer.invoke("todo:create", todo),
  saveTodo: (todo) => ipcRenderer.invoke("todo:save", todo),
  saveTodoGoal: (goal) => ipcRenderer.invoke("todo:save-goal", goal),
  archiveTodoGoal: (id) => ipcRenderer.invoke("todo:archive-goal", id),
  deleteTodo: (id) => ipcRenderer.invoke("todo:delete", id),
  toggleTodo: (id, completed) => ipcRenderer.invoke("todo:toggle", { id, completed }),
  toggleTodoSubtask: (todoId, subtaskId, completed) =>
    ipcRenderer.invoke("todo:toggle-subtask", { todoId, subtaskId, completed }),
  startTodoTimer: (id, targetMinutes) => ipcRenderer.invoke("todo:start-timer", { id, targetMinutes }),
  stopTodoTimer: (id) => ipcRenderer.invoke("todo:stop-timer", id),
  pauseTodoTimer: () => ipcRenderer.invoke("todo:pause-timer"),
  resumeTodoTimer: () => ipcRenderer.invoke("todo:resume-timer"),
  completeTodoTimer: () => ipcRenderer.invoke("todo:complete-timer"),
  abandonTodoTimer: () => ipcRenderer.invoke("todo:abandon-timer"),
  setTodoFocusDefault: (minutes) => ipcRenderer.invoke("todo:set-focus-default", minutes),
  saveTodoReview: (review) => ipcRenderer.invoke("todo:save-review", review),
  clearCompletedTodos: () => ipcRenderer.invoke("todo:clear-completed"),
  setAllTodosCompleted: (completed) => ipcRenderer.invoke("todo:set-all-completed", completed),
  saveTodoCategory: (category) => ipcRenderer.invoke("todo:save-category", category),
  renameTodoCategory: (category) => ipcRenderer.invoke("todo:rename-category", category),
  deleteTodoCategory: (name) => ipcRenderer.invoke("todo:delete-category", name),
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
  reindexKnowledgeFile: (knowledgeBaseId, fileId) => ipcRenderer.invoke("knowledge:reindex-file", { knowledgeBaseId, fileId }),
  searchKnowledgeBase: (knowledgeBaseId, query, options) =>
    ipcRenderer.invoke("knowledge:search", { knowledgeBaseId, query, options }),
  searchKnowledgeMemories: (knowledgeBaseId, query, options) =>
    ipcRenderer.invoke("knowledge:search-memories", { knowledgeBaseId, query, options }),
  getKnowledgeMindMap: (knowledgeBaseId, fileId) => ipcRenderer.invoke("knowledge:mind-map", { knowledgeBaseId, fileId }),
  getKnowledgeGraph: (knowledgeBaseId, fileId) => ipcRenderer.invoke("knowledge:graph", { knowledgeBaseId, fileId }),
  onSettingsUpdated: (callback) => {
    ipcRenderer.removeAllListeners("settings:updated");
    ipcRenderer.on("settings:updated", (_event, settings) => callback(settings));
  },
  onConversationsUpdated: (callback) => {
    ipcRenderer.removeAllListeners("conversations:updated");
    ipcRenderer.on("conversations:updated", (_event, store) => callback(store));
  },
  onMemoriesUpdated: (callback) => {
    ipcRenderer.removeAllListeners("memories:updated");
    ipcRenderer.on("memories:updated", (_event, store) => callback(store));
  },
  onTodosUpdated: (callback) => {
    ipcRenderer.removeAllListeners("todo:updated");
    ipcRenderer.on("todo:updated", (_event, store) => callback(store));
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

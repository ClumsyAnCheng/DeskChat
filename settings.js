const providerPresets = {
  openai: {
    providerName: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5.5",
    supportsVision: true
  },
  deepseek: {
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    supportsVision: false
  },
  custom: {
    providerName: "兼容接口",
    baseUrl: "https://你的中转站域名/v1/chat/completions",
    model: "gpt-5.5",
    supportsVision: true
  }
};

const defaultSystemPrompt =
  "你是一个运行在用户电脑上的桌面 AI 助手。你可以分析用户上传的图片和截图，也可以在用户明确要求时调用工具执行命令、移动鼠标或点击。调用命令和鼠标工具前先简短说明意图。";

const defaultMemoryConfig = {
  enabled: true,
  rememberAssistant: true,
  recallEnabled: true,
  recallLimit: 6,
  minMessageChars: 8,
  minChunkChars: 24
};

const els = {
  form: document.getElementById("settingsForm"),
  configSelect: document.getElementById("configSelect"),
  newConfig: document.getElementById("newConfig"),
  deleteConfig: document.getElementById("deleteConfig"),
  configName: document.getElementById("configName"),
  provider: document.getElementById("provider"),
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  systemPrompt: document.getElementById("systemPrompt"),
  enableTools: document.getElementById("enableTools"),
  supportsVision: document.getElementById("supportsVision"),
  ragflowEnabled: document.getElementById("ragflowEnabled"),
  ragflowBaseUrl: document.getElementById("ragflowBaseUrl"),
  ragflowApiKey: document.getElementById("ragflowApiKey"),
  ragflowDatasetId: document.getElementById("ragflowDatasetId"),
  memoryEnabled: document.getElementById("memoryEnabled"),
  memoryRecallEnabled: document.getElementById("memoryRecallEnabled"),
  memoryRememberAssistant: document.getElementById("memoryRememberAssistant"),
  memoryRecallLimit: document.getElementById("memoryRecallLimit"),
  memoryMinMessageChars: document.getElementById("memoryMinMessageChars"),
  memoryMinChunkChars: document.getElementById("memoryMinChunkChars"),
  resetProvider: document.getElementById("resetProvider"),
  saveSettings: document.getElementById("saveSettings"),
  settingsStatus: document.getElementById("settingsStatus")
};

let settingsStore = {
  activeConfigId: "default-openai",
  apiConfigs: [],
  ragflow: {
    enabled: false,
    baseUrl: "http://localhost:9380",
    apiKey: "",
    datasetId: ""
  },
  memory: { ...defaultMemoryConfig }
};
let activeConfigId = "default-openai";
let contextMenu = null;

function makeId() {
  return `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function showSettingsStatus(message, kind = "info", timeout = 1600) {
  if (!els.settingsStatus) return;
  els.settingsStatus.textContent = message || "";
  els.settingsStatus.dataset.kind = kind;
  if (timeout > 0) {
    setTimeout(() => {
      if (els.settingsStatus.textContent === message) {
        els.settingsStatus.textContent = "";
        els.settingsStatus.dataset.kind = "";
      }
    }, timeout);
  }
}

function activeConfig() {
  return settingsStore.apiConfigs.find((config) => config.id === activeConfigId) || settingsStore.apiConfigs[0] || null;
}

function normalizeConfig(config, index = 0) {
  const preset = providerPresets[config && config.provider] || providerPresets.openai;
  return {
    id: (config && config.id) || makeId(),
    name: (config && config.name) || (config && config.providerName) || preset.providerName || `API ${index + 1}`,
    provider: (config && config.provider) || "openai",
    providerName: (config && config.providerName) || preset.providerName,
    baseUrl: (config && config.baseUrl) || preset.baseUrl,
    apiKey: (config && config.apiKey) || "",
    model: (config && config.model) || preset.model,
    systemPrompt: (config && config.systemPrompt) || defaultSystemPrompt,
    enableTools: config && config.enableTools !== undefined ? Boolean(config.enableTools) : true,
    supportsVision: config && config.supportsVision !== undefined ? Boolean(config.supportsVision) : preset.supportsVision
  };
}

function applySettings(next) {
  const configs = Array.isArray(next.apiConfigs) ? next.apiConfigs : [next];
  settingsStore = {
    activeConfigId: next.activeConfigId || next.id || (configs[0] && configs[0].id) || "default-openai",
    apiConfigs: configs.map(normalizeConfig),
    ragflow: normalizeRagflow(next.ragflow),
    memory: normalizeMemoryConfig(next.memory)
  };
  activeConfigId = settingsStore.activeConfigId;
  if (!settingsStore.apiConfigs.some((config) => config.id === activeConfigId)) {
    activeConfigId = settingsStore.apiConfigs[0] && settingsStore.apiConfigs[0].id;
  }
  renderConfigSelect();
  fillForm(activeConfig());
  fillRagflowForm(settingsStore.ragflow);
  fillMemoryForm(settingsStore.memory);
}

function normalizeRagflow(config) {
  return {
    enabled: Boolean(config && config.enabled),
    baseUrl: (config && config.baseUrl) || "http://localhost:9380",
    apiKey: (config && config.apiKey) || "",
    datasetId: (config && config.datasetId) || ""
  };
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

function renderConfigSelect() {
  els.configSelect.innerHTML = "";
  for (const config of settingsStore.apiConfigs) {
    const option = document.createElement("option");
    option.value = config.id;
    option.textContent = config.name || config.providerName || "未命名配置";
    els.configSelect.appendChild(option);
  }
  els.configSelect.value = activeConfigId;
  els.deleteConfig.disabled = settingsStore.apiConfigs.length <= 1;
}

function fillForm(config) {
  const next = normalizeConfig(config || {});
  els.configName.value = next.name || "";
  els.provider.value = next.provider || "custom";
  els.baseUrl.value = next.baseUrl || "";
  els.apiKey.value = next.apiKey || "";
  els.model.value = next.model || "";
  els.systemPrompt.value = next.systemPrompt || "";
  els.enableTools.checked = Boolean(next.enableTools);
  els.supportsVision.checked = next.supportsVision !== false;
}

function normalizeChatCompletionsUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  if (!/\/v\d+(\/|$)/.test(trimmed)) return `${trimmed}/v1/chat/completions`;
  return trimmed;
}

function collectFormConfig() {
  const preset = providerPresets[els.provider.value] || providerPresets.custom;
  return normalizeConfig({
    ...activeConfig(),
    id: activeConfigId,
    name: els.configName.value.trim() || preset.providerName,
    provider: els.provider.value,
    providerName: preset.providerName,
    baseUrl: normalizeChatCompletionsUrl(els.baseUrl.value),
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim(),
    systemPrompt: els.systemPrompt.value,
    enableTools: els.enableTools.checked,
    supportsVision: els.supportsVision.checked
  });
}

function fillRagflowForm(config) {
  const next = normalizeRagflow(config);
  els.ragflowEnabled.checked = next.enabled;
  els.ragflowBaseUrl.value = next.baseUrl;
  els.ragflowApiKey.value = next.apiKey;
  els.ragflowDatasetId.value = next.datasetId;
}

function collectRagflowConfig() {
  return normalizeRagflow({
    enabled: els.ragflowEnabled.checked,
    baseUrl: els.ragflowBaseUrl.value.trim().replace(/\/+$/, ""),
    apiKey: els.ragflowApiKey.value.trim(),
    datasetId: els.ragflowDatasetId.value.trim()
  });
}

function fillMemoryForm(config) {
  const next = normalizeMemoryConfig(config);
  els.memoryEnabled.checked = next.enabled;
  els.memoryRecallEnabled.checked = next.recallEnabled;
  els.memoryRememberAssistant.checked = next.rememberAssistant;
  els.memoryRecallLimit.value = String(next.recallLimit);
  els.memoryMinMessageChars.value = String(next.minMessageChars);
  els.memoryMinChunkChars.value = String(next.minChunkChars);
}

function collectMemoryConfig() {
  return normalizeMemoryConfig({
    enabled: els.memoryEnabled.checked,
    recallEnabled: els.memoryRecallEnabled.checked,
    rememberAssistant: els.memoryRememberAssistant.checked,
    recallLimit: els.memoryRecallLimit.value,
    minMessageChars: els.memoryMinMessageChars.value,
    minChunkChars: els.memoryMinChunkChars.value
  });
}

function updateActiveConfigFromForm() {
  const index = settingsStore.apiConfigs.findIndex((config) => config.id === activeConfigId);
  const nextConfig = collectFormConfig();
  if (index >= 0) {
    settingsStore.apiConfigs[index] = nextConfig;
  } else {
    settingsStore.apiConfigs.push(nextConfig);
  }
  settingsStore.activeConfigId = activeConfigId;
  settingsStore.ragflow = collectRagflowConfig();
  settingsStore.memory = collectMemoryConfig();
}

function applyProviderDefaults() {
  const preset = providerPresets[els.provider.value] || providerPresets.custom;
  els.baseUrl.value = preset.baseUrl;
  els.model.value = preset.model;
  els.supportsVision.checked = preset.supportsVision;
  if (!els.configName.value.trim()) els.configName.value = preset.providerName;
}

async function saveStore() {
  updateActiveConfigFromForm();
  return persistSettingsStoreOnly();
}

async function persistSettingsStoreOnly() {
  const saved = await window.deskchat.saveSettings(settingsStore);
  applySettings(saved);
  return saved;
}

function createNewConfig() {
  updateActiveConfigFromForm();
  const preset = providerPresets.openai;
  const config = normalizeConfig({
    id: makeId(),
    name: `新配置 ${settingsStore.apiConfigs.length + 1}`,
    provider: "openai",
    providerName: preset.providerName,
    baseUrl: preset.baseUrl,
    model: preset.model,
    supportsVision: preset.supportsVision
  });
  settingsStore.apiConfigs.push(config);
  activeConfigId = config.id;
  settingsStore.activeConfigId = activeConfigId;
  renderConfigSelect();
  fillForm(config);
}

function duplicateActiveConfig() {
  updateActiveConfigFromForm();
  const current = activeConfig();
  if (!current) return;
  const config = normalizeConfig({
    ...current,
    id: makeId(),
    name: `${current.name || current.providerName || "配置"} 副本`
  }, settingsStore.apiConfigs.length);
  settingsStore.apiConfigs.push(config);
  activeConfigId = config.id;
  settingsStore.activeConfigId = activeConfigId;
  renderConfigSelect();
  fillForm(config);
}

async function deleteActiveConfig() {
  if (settingsStore.apiConfigs.length <= 1) return;
  const current = activeConfig();
  if (!(await confirmAction(`删除配置「${(current && current.name) || "未命名配置"}」？`, { confirmLabel: "删除" }))) return;
  settingsStore.apiConfigs = settingsStore.apiConfigs.filter((config) => config.id !== activeConfigId);
  activeConfigId = settingsStore.apiConfigs[0].id;
  settingsStore.activeConfigId = activeConfigId;
  renderConfigSelect();
  fillForm(activeConfig());
  await persistSettingsStoreOnly();
}

function currentConfigSummary() {
  const config = collectFormConfig();
  return [
    `配置：${config.name || "未命名配置"}`,
    `服务商：${config.providerName || config.provider || "custom"}`,
    `API 地址：${config.baseUrl || ""}`,
    `模型：${config.model || ""}`,
    `工具调用：${config.enableTools ? "开启" : "关闭"}`,
    `图片输入：${config.supportsVision ? "支持" : "不支持"}`
  ].join("\n");
}

function ragflowSummary() {
  const ragflow = collectRagflowConfig();
  return [
    `RAGFlow：${ragflow.enabled ? "开启" : "关闭"}`,
    `Base URL：${ragflow.baseUrl || ""}`,
    `Dataset ID：${ragflow.datasetId || ""}`,
    `API Key：${ragflow.apiKey ? "已填写" : "未填写"}`
  ].join("\n");
}

function memorySummary() {
  const memory = collectMemoryConfig();
  return [
    `长期记忆索引：${memory.enabled ? "开启" : "关闭"}`,
    `自动召回：${memory.recallEnabled ? "开启" : "关闭"}`,
    `记住助手回复：${memory.rememberAssistant ? "开启" : "关闭"}`,
    `召回条数：${memory.recallLimit}`,
    `单条消息最少字数：${memory.minMessageChars}`,
    `索引片段最少字数：${memory.minChunkChars}`
  ].join("\n");
}

async function copyCurrentConfigSummary() {
  await window.deskchat.copyText(currentConfigSummary());
  showSettingsStatus("已复制配置摘要", "success");
}

async function copyRagflowSummary() {
  await window.deskchat.copyText(ragflowSummary());
  showSettingsStatus("已复制 RAGFlow 摘要", "success");
}

async function copyMemorySummary() {
  await window.deskchat.copyText(memorySummary());
  showSettingsStatus("已复制记忆设置摘要", "success");
}

function toggleCheckbox(input) {
  if (!input) return;
  input.checked = !input.checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

els.provider.addEventListener("change", () => {
  applyProviderDefaults();
});

els.configSelect.addEventListener("change", () => {
  updateActiveConfigFromForm();
  activeConfigId = els.configSelect.value;
  settingsStore.activeConfigId = activeConfigId;
  fillForm(activeConfig());
});

els.newConfig.addEventListener("click", createNewConfig);

els.deleteConfig.addEventListener("click", deleteActiveConfig);

bindContextMenu(els.configSelect.closest(".settings-inline"), () => [
  { label: "新增配置", action: createNewConfig },
  { label: "复制当前配置", action: duplicateActiveConfig },
  { label: "保存配置", action: saveStore },
  { label: "复制配置摘要", action: copyCurrentConfigSummary },
  { type: "separator" },
  {
    label: "删除当前配置",
    danger: true,
    disabled: settingsStore.apiConfigs.length <= 1,
    action: deleteActiveConfig
  }
]);

els.resetProvider.addEventListener("click", () => {
  applyProviderDefaults();
});

bindContextMenu(els.form, () => [
  { label: "保存配置", action: saveStore },
  { label: "恢复当前服务商默认值", action: applyProviderDefaults },
  { label: "复制配置摘要", action: copyCurrentConfigSummary },
  { type: "separator" },
  { label: els.enableTools.checked ? "关闭工具调用" : "开启工具调用", action: () => toggleCheckbox(els.enableTools) },
  { label: els.supportsVision.checked ? "关闭图片输入" : "开启图片输入", action: () => toggleCheckbox(els.supportsVision) },
  { label: els.ragflowEnabled.checked ? "关闭 RAGFlow" : "开启 RAGFlow", action: () => toggleCheckbox(els.ragflowEnabled) },
  { type: "separator" },
  { label: "新增配置", action: createNewConfig },
  { label: "复制当前配置", action: duplicateActiveConfig },
  {
    label: "删除当前配置",
    danger: true,
    disabled: settingsStore.apiConfigs.length <= 1,
    action: deleteActiveConfig
  }
]);

bindContextMenu(els.ragflowEnabled.closest(".settings-section"), () => [
  { label: els.ragflowEnabled.checked ? "关闭 RAGFlow" : "开启 RAGFlow", action: () => toggleCheckbox(els.ragflowEnabled) },
  { label: "复制 RAGFlow 摘要", action: copyRagflowSummary },
  { label: "保存配置", action: saveStore },
  { type: "separator" },
  {
    label: "恢复 RAGFlow 默认地址",
    action: () => {
      els.ragflowBaseUrl.value = "http://localhost:9380";
      showSettingsStatus("已恢复 RAGFlow 默认地址", "success");
    }
  }
]);

bindContextMenu(els.memoryEnabled.closest(".settings-section"), () => [
  { label: els.memoryEnabled.checked ? "关闭长期记忆索引" : "开启长期记忆索引", action: () => toggleCheckbox(els.memoryEnabled) },
  { label: els.memoryRecallEnabled.checked ? "关闭自动召回" : "开启自动召回", action: () => toggleCheckbox(els.memoryRecallEnabled) },
  { label: els.memoryRememberAssistant.checked ? "不记住助手回复" : "记住助手回复", action: () => toggleCheckbox(els.memoryRememberAssistant) },
  { label: "复制记忆设置摘要", action: copyMemorySummary },
  { label: "保存配置", action: saveStore },
  { type: "separator" },
  {
    label: "恢复记忆默认值",
    action: () => {
      fillMemoryForm(defaultMemoryConfig);
      showSettingsStatus("已恢复记忆默认值", "success");
    }
  }
]);

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.saveSettings.disabled = true;
  try {
    await saveStore();
    showSettingsStatus("已保存", "success");
  } catch (error) {
    showSettingsStatus(`保存失败：${error.message}`, "error", 2600);
  } finally {
    els.saveSettings.disabled = false;
  }
});

document.addEventListener("contextmenu", (event) => {
  if (event.target && event.target.closest && event.target.closest("input, textarea")) {
    openContextMenu(event, []);
  }
});

document.addEventListener("click", (event) => {
  if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && contextMenu) closeContextMenu();
});

window.deskchat.onSettingsUpdated(applySettings);

window.deskchat.getSettings().then(applySettings).catch(() => {
  applySettings(normalizeConfig({ id: "default-openai", ...providerPresets.openai }));
});

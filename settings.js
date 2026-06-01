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
  resetProvider: document.getElementById("resetProvider"),
  saveSettings: document.getElementById("saveSettings")
};

let settingsStore = {
  activeConfigId: "default-openai",
  apiConfigs: []
};
let activeConfigId = "default-openai";

function makeId() {
  return `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    apiConfigs: configs.map(normalizeConfig)
  };
  activeConfigId = settingsStore.activeConfigId;
  if (!settingsStore.apiConfigs.some((config) => config.id === activeConfigId)) {
    activeConfigId = settingsStore.apiConfigs[0] && settingsStore.apiConfigs[0].id;
  }
  renderConfigSelect();
  fillForm(activeConfig());
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

function updateActiveConfigFromForm() {
  const index = settingsStore.apiConfigs.findIndex((config) => config.id === activeConfigId);
  const nextConfig = collectFormConfig();
  if (index >= 0) {
    settingsStore.apiConfigs[index] = nextConfig;
  } else {
    settingsStore.apiConfigs.push(nextConfig);
  }
  settingsStore.activeConfigId = activeConfigId;
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
  const saved = await window.deskchat.saveSettings(settingsStore);
  applySettings(saved);
  return saved;
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

els.newConfig.addEventListener("click", () => {
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
});

els.deleteConfig.addEventListener("click", async () => {
  if (settingsStore.apiConfigs.length <= 1) return;
  settingsStore.apiConfigs = settingsStore.apiConfigs.filter((config) => config.id !== activeConfigId);
  activeConfigId = settingsStore.apiConfigs[0].id;
  settingsStore.activeConfigId = activeConfigId;
  await saveStore();
});

els.resetProvider.addEventListener("click", () => {
  applyProviderDefaults();
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.saveSettings.disabled = true;
  try {
    await saveStore();
    els.saveSettings.textContent = "已保存";
    setTimeout(() => {
      els.saveSettings.textContent = "保存配置";
    }, 1200);
  } finally {
    els.saveSettings.disabled = false;
  }
});

window.deskchat.onSettingsUpdated(applySettings);

window.deskchat.getSettings().then(applySettings).catch(() => {
  applySettings(normalizeConfig({ id: "default-openai", ...providerPresets.openai }));
});

// popup.js

import { DEFAULT_MENU_ITEMS } from "./menu-defaults.js";
import { DEFAULT_AI_PROVIDER, PROVIDER_CONFIG } from "./provider-defaults.js";

const keyInput = document.getElementById("api-key");
const apiKeyGroup = document.getElementById("api-key-group");
const apiKeyLabel = document.getElementById("api-key-label");
const providerSelect = document.getElementById("ai-provider");
const providerSubtitle = document.getElementById("provider-subtitle");
const modelInput = document.getElementById("model-input");
const modelStatusGroup = document.getElementById("model-status-group");
const modelStatusDot = document.getElementById("model-status-dot");
const modelStatusText = document.getElementById("model-status-text");
const modelStatusMeta = document.getElementById("model-status-meta");
const baseUrlGroup = document.getElementById("base-url-group");
const baseUrlInput = document.getElementById("base-url-input");
const saveBtn  = document.getElementById("save-btn");
const status   = document.getElementById("status");
const menuList = document.getElementById("menu-list");
const menuStatus = document.getElementById("menu-status");
const customTitle = document.getElementById("custom-title");
const customPrompt = document.getElementById("custom-prompt");
const addMenuBtn = document.getElementById("add-menu-btn");
const resetMenuBtn = document.getElementById("reset-menu-btn");
const MENU_ITEMS_STORAGE_KEY = "menuItems";
const AI_PROVIDER_STORAGE_KEY = "aiProvider";
const PROVIDER_SETTINGS_STORAGE_KEY = "providerSettings";
const LEGACY_API_KEY_STORAGE_KEY = "apiKey";
const HUGGING_FACE_PROVIDER = "huggingface";
const HUGGING_FACE_STATUS_MESSAGE = "GET_SMOLLM2_STATUS";
const MODEL_STATUS_POLL_MS = 1500;

let menuItems = [];
let selectedProvider = DEFAULT_AI_PROVIDER;
let providerSettings = {};
let modelStatusTimer = null;

chrome.storage.sync.get([
  LEGACY_API_KEY_STORAGE_KEY,
  AI_PROVIDER_STORAGE_KEY,
  PROVIDER_SETTINGS_STORAGE_KEY,
  MENU_ITEMS_STORAGE_KEY,
], ({
  apiKey,
  aiProvider,
  providerSettings: storedProviderSettings,
  menuItems: storedMenuItems,
}) => {
  selectedProvider = sanitizeProvider(aiProvider);
  providerSettings = sanitizeProviderSettings(storedProviderSettings, apiKey);

  renderProviderSettings();
  refreshModelStatus({ warm: selectedProvider === HUGGING_FACE_PROVIDER });
  menuItems = sanitizeMenuItems(storedMenuItems);
  renderMenuItems();

  if (!storedProviderSettings || aiProvider !== selectedProvider) {
    saveProviderSettings({ quiet: true });
  }

  if (!Array.isArray(storedMenuItems)) {
    saveMenuItems({ quiet: true });
  }
});

saveBtn.addEventListener("click", () => {
  saveProviderSettings();
});

function setStatus(msg, isError) {
  status.textContent = msg;
  status.className = "status" + (isError ? " error" : "");
}

providerSelect.addEventListener("change", () => {
  updateCurrentProviderSettingsFromInputs();
  selectedProvider = sanitizeProvider(providerSelect.value);
  renderProviderSettings();
  refreshModelStatus({ warm: selectedProvider === HUGGING_FACE_PROVIDER });
  setStatus("", false);
});

function cloneProviderSettingsDefaults() {
  return Object.fromEntries(
    Object.entries(PROVIDER_CONFIG).map(([provider, config]) => [
      provider,
      {
        apiKey: "",
        model: config.defaultModel,
        baseUrl: config.defaultBaseUrl,
      },
    ])
  );
}

function sanitizeProvider(provider) {
  return PROVIDER_CONFIG[provider] ? provider : DEFAULT_AI_PROVIDER;
}

function sanitizeProviderSettings(settings, legacyApiKey = "") {
  const defaults = cloneProviderSettingsDefaults();
  const source = settings && typeof settings === "object" ? settings : {};

  Object.keys(defaults).forEach(provider => {
    const providerSettings = source[provider] && typeof source[provider] === "object"
      ? source[provider]
      : {};

    defaults[provider] = {
      apiKey: typeof providerSettings.apiKey === "string" ? providerSettings.apiKey.trim() : "",
      model: typeof providerSettings.model === "string" && providerSettings.model.trim()
        ? providerSettings.model.trim()
        : defaults[provider].model,
      baseUrl: typeof providerSettings.baseUrl === "string" && providerSettings.baseUrl.trim()
        ? normalizeBaseUrl(providerSettings.baseUrl)
        : defaults[provider].baseUrl,
    };
  });

  if (legacyApiKey && !defaults.groq.apiKey) {
    defaults.groq.apiKey = legacyApiKey.trim();
  }

  return defaults;
}

function renderProviderSettings() {
  const config = PROVIDER_CONFIG[selectedProvider];
  const settings = providerSettings[selectedProvider] || {};

  providerSelect.value = selectedProvider;
  providerSubtitle.textContent = `Provider: ${config.label}`;
  apiKeyLabel.textContent = config.apiKeyLabel;
  keyInput.placeholder = config.apiKeyPlaceholder;
  keyInput.value = settings.apiKey || "";
  apiKeyGroup.hidden = config.showApiKey === false;
  modelInput.value = settings.model || config.defaultModel;
  baseUrlInput.value = settings.baseUrl || config.defaultBaseUrl;
  baseUrlGroup.hidden = !config.showBaseUrl;
  modelStatusGroup.hidden = selectedProvider !== HUGGING_FACE_PROVIDER;
}

function updateCurrentProviderSettingsFromInputs() {
  providerSettings[selectedProvider] = {
    apiKey: keyInput.value.trim(),
    model: modelInput.value.trim(),
    baseUrl: normalizeBaseUrl(baseUrlInput.value || PROVIDER_CONFIG[selectedProvider].defaultBaseUrl),
  };
}

function saveProviderSettings(options = {}) {
  updateCurrentProviderSettingsFromInputs();
  providerSettings = sanitizeProviderSettings(providerSettings);

  const config = PROVIDER_CONFIG[selectedProvider];
  const settings = providerSettings[selectedProvider];

  if (!options.quiet) {
    if (config.apiKeyRequired && !settings.apiKey) {
      setStatus(`Please enter a ${config.label} API key.`, true);
      return;
    }

    if (config.apiKeyPrefix && settings.apiKey && !settings.apiKey.startsWith(config.apiKeyPrefix)) {
      setStatus(`${config.label} keys should start with ${config.apiKeyPrefix}.`, true);
      return;
    }

    if (!settings.model) {
      setStatus(`Please enter a ${config.label} model.`, true);
      return;
    }

    if (config.showBaseUrl && !settings.baseUrl) {
      setStatus("Please enter a local AI base URL.", true);
      return;
    }
  }

  chrome.storage.sync.set({
    [AI_PROVIDER_STORAGE_KEY]: selectedProvider,
    [PROVIDER_SETTINGS_STORAGE_KEY]: providerSettings,
    [LEGACY_API_KEY_STORAGE_KEY]: providerSettings.groq.apiKey,
  }, () => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }

    if (!options.quiet) {
      setStatus(`${config.label} settings saved.`, false);
    }

    if (selectedProvider === HUGGING_FACE_PROVIDER) {
      refreshModelStatus({ warm: true });
    }
  });
}

function refreshModelStatus(options = {}) {
  stopModelStatusPolling();

  if (selectedProvider !== HUGGING_FACE_PROVIDER) {
    modelStatusGroup.hidden = true;
    return;
  }

  modelStatusGroup.hidden = false;

  if (options.showChecking !== false) {
    renderModelStatusChecking();
  }

  chrome.runtime.sendMessage({
    type: HUGGING_FACE_STATUS_MESSAGE,
    warm: Boolean(options.warm),
  }, response => {
    if (selectedProvider !== HUGGING_FACE_PROVIDER) return;

    if (chrome.runtime.lastError) {
      renderModelStatusError(chrome.runtime.lastError.message);
      return;
    }

    if (!response?.ok) {
      renderModelStatusError(response?.error || "Could not read SmolLM2 status.");
      return;
    }

    renderModelStatus(response.status);

    if (shouldPollModelStatus(response.status)) {
      scheduleModelStatusPolling();
    }
  });
}

function renderModelStatusChecking() {
  modelStatusDot.className = "model-status-dot loading";
  modelStatusText.textContent = "Checking SmolLM2 status...";
  modelStatusMeta.textContent = "Downloaded: checking | Ready: checking";
}

function renderModelStatusError(errorMessage) {
  modelStatusDot.className = "model-status-dot error";
  modelStatusText.textContent = "SmolLM2 status unavailable";
  modelStatusMeta.textContent = errorMessage || "Could not contact the background worker.";
}

function renderModelStatus(modelStatus) {
  const downloaded = Boolean(modelStatus?.downloaded || modelStatus?.cachedFiles > 0);
  const ready = Boolean(modelStatus?.ready);
  const loading = Boolean(modelStatus?.loading);
  const hasError = Boolean(modelStatus?.error);
  const backend = modelStatus?.device ? ` (${modelStatus.device})` : "";

  modelStatusDot.className = "model-status-dot";

  if (hasError) {
    modelStatusDot.classList.add("error");
    modelStatusText.textContent = "SmolLM2 unavailable";
  } else if (ready) {
    modelStatusDot.classList.add("ready");
    modelStatusText.textContent = `SmolLM2 ready${backend}`;
  } else if (loading) {
    modelStatusDot.classList.add("loading");
    modelStatusText.textContent = downloaded ? "SmolLM2 loading from cache" : "SmolLM2 downloading";
  } else {
    modelStatusText.textContent = downloaded ? "SmolLM2 downloaded, not ready" : "SmolLM2 not downloaded";
  }

  const details = [
    `Downloaded: ${downloaded ? "yes" : "no"}`,
    `Ready: ${ready ? "yes" : "no"}`,
  ];

  if (loading) details.push("Loading: yes");
  if (modelStatus?.device) details.push(`Backend: ${modelStatus.device}`);
  if (modelStatus?.cacheChecked) {
    details.push(`Cached files: ${Number(modelStatus.cachedFiles || 0)}`);
  } else {
    details.push("Cache: unavailable");
  }
  if (modelStatus?.fallback) details.push("Fallback: wasm");

  const progressText = formatModelProgress(modelStatus?.progress);
  if (progressText) details.push(progressText);
  if (modelStatus?.error) details.push(modelStatus.error);

  modelStatusMeta.textContent = details.join(" | ");
}

function shouldPollModelStatus(modelStatus) {
  return selectedProvider === HUGGING_FACE_PROVIDER &&
    Boolean(modelStatus?.loading) &&
    !modelStatus?.ready &&
    !modelStatus?.error;
}

function scheduleModelStatusPolling() {
  stopModelStatusPolling();
  modelStatusTimer = setTimeout(() => {
    refreshModelStatus({ showChecking: false });
  }, MODEL_STATUS_POLL_MS);
}

function stopModelStatusPolling() {
  if (!modelStatusTimer) return;
  clearTimeout(modelStatusTimer);
  modelStatusTimer = null;
}

function formatModelProgress(progress) {
  if (!progress) return "";

  const label = progress.file || "Model file";

  if (Number.isFinite(progress.progress)) {
    return `${label}: ${Math.round(progress.progress)}%`;
  }

  if (Number.isFinite(progress.loaded) && Number.isFinite(progress.total) && progress.total > 0) {
    return `${label}: ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`;
  }

  return progress.status ? `${label}: ${progress.status}` : "";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

menuList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const index = Number(button.dataset.index);
  const action = button.dataset.action;

  if (action === "up" && index > 0) {
    [menuItems[index - 1], menuItems[index]] = [menuItems[index], menuItems[index - 1]];
  }

  if (action === "down" && index < menuItems.length - 1) {
    [menuItems[index + 1], menuItems[index]] = [menuItems[index], menuItems[index + 1]];
  }

  if (action === "remove") {
    menuItems.splice(index, 1);
  }

  saveMenuItems();
});

addMenuBtn.addEventListener("click", () => {
  const title = customTitle.value.trim();
  const prompt = customPrompt.value.trim();

  if (!title || !prompt) {
    setMenuStatus("Enter a name and prompt.", true);
    return;
  }

  menuItems.push({
    id: createCustomMenuId(),
    title,
    prompt: `${prompt}\n\n`,
  });

  customTitle.value = "";
  customPrompt.value = "";
  saveMenuItems();
});

resetMenuBtn.addEventListener("click", () => {
  menuItems = cloneDefaultMenuItems();
  saveMenuItems();
});

function cloneDefaultMenuItems() {
  return DEFAULT_MENU_ITEMS.map(item => ({ ...item }));
}

function sanitizeMenuItems(items) {
  if (!Array.isArray(items)) return cloneDefaultMenuItems();

  const seenIds = new Set();

  return items
    .map((item, index) => {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      const prompt = typeof item?.prompt === "string" ? item.prompt : "";
      let id = typeof item?.id === "string" ? item.id.trim() : "";

      if (!title || !prompt) return null;
      if (!id || seenIds.has(id)) id = `custom-${Date.now()}-${index}`;

      seenIds.add(id);

      return { id, title, prompt };
    })
    .filter(Boolean);
}

function renderMenuItems() {
  menuList.innerHTML = "";

  if (!menuItems.length) {
    const empty = document.createElement("div");
    empty.className = "menu-empty";
    empty.textContent = "No actions added.";
    menuList.appendChild(empty);
    return;
  }

  menuItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "menu-item";

    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = item.title;

    const controls = document.createElement("div");
    controls.className = "menu-controls";

    controls.appendChild(createMenuButton("Up", "up", index, index === 0));
    controls.appendChild(createMenuButton("Down", "down", index, index === menuItems.length - 1));
    controls.appendChild(createMenuButton("Remove", "remove", index, false));

    row.appendChild(title);
    row.appendChild(controls);
    menuList.appendChild(row);
  });
}

function createMenuButton(label, action, index, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-btn";
  button.dataset.action = action;
  button.dataset.index = String(index);
  button.disabled = disabled;
  button.textContent = label;
  return button;
}

function saveMenuItems(options = {}) {
  menuItems = sanitizeMenuItems(menuItems);
  renderMenuItems();

  chrome.storage.sync.set({ [MENU_ITEMS_STORAGE_KEY]: menuItems }, () => {
    if (chrome.runtime.lastError) {
      setMenuStatus(chrome.runtime.lastError.message, true);
      return;
    }

    notifyContextMenuRebuild();

    if (!options.quiet) {
      setMenuStatus("Menu saved.", false);
    }
  });
}

function notifyContextMenuRebuild() {
  chrome.runtime.sendMessage({ type: "REBUILD_CONTEXT_MENUS" }, () => {
    if (chrome.runtime.lastError) return;

    // The storage change listener also rebuilds menus. This message wakes the
    // service worker when the popup saves while it is inactive.
  });
}

function setMenuStatus(msg, isError) {
  menuStatus.textContent = msg;
  menuStatus.className = "menu-status" + (isError ? " error" : "");
}

function createCustomMenuId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `custom-${Date.now().toString(36)}-${random}`;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

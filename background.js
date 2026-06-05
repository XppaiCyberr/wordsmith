// background.js - Service Worker

import { DEFAULT_MENU_ITEMS } from "./menu-defaults.js";
import { DEFAULT_AI_PROVIDER, PROVIDER_CONFIG } from "./provider-defaults.js";

const MENU_ITEMS_STORAGE_KEY = "menuItems";
const AI_PROVIDER_STORAGE_KEY = "aiProvider";
const PROVIDER_SETTINGS_STORAGE_KEY = "providerSettings";
const LEGACY_API_KEY_STORAGE_KEY = "apiKey";
let rebuildContextMenusQueue = Promise.resolve();

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

async function getMenuItems() {
  const stored = await chrome.storage.sync.get(MENU_ITEMS_STORAGE_KEY);
  return sanitizeMenuItems(stored[MENU_ITEMS_STORAGE_KEY]);
}

async function ensureMenuItemsConfigured() {
  const stored = await chrome.storage.sync.get(MENU_ITEMS_STORAGE_KEY);

  if (!Array.isArray(stored[MENU_ITEMS_STORAGE_KEY])) {
    await chrome.storage.sync.set({
      [MENU_ITEMS_STORAGE_KEY]: cloneDefaultMenuItems(),
    });
  }
}

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

async function ensureProviderSettingsConfigured() {
  const stored = await chrome.storage.sync.get([
    AI_PROVIDER_STORAGE_KEY,
    PROVIDER_SETTINGS_STORAGE_KEY,
    LEGACY_API_KEY_STORAGE_KEY,
  ]);

  const provider = sanitizeProvider(stored[AI_PROVIDER_STORAGE_KEY]);
  const providerSettings = sanitizeProviderSettings(
    stored[PROVIDER_SETTINGS_STORAGE_KEY],
    stored[LEGACY_API_KEY_STORAGE_KEY]
  );

  const updates = {};

  if (stored[AI_PROVIDER_STORAGE_KEY] !== provider) {
    updates[AI_PROVIDER_STORAGE_KEY] = provider;
  }

  if (!stored[PROVIDER_SETTINGS_STORAGE_KEY]) {
    updates[PROVIDER_SETTINGS_STORAGE_KEY] = providerSettings;
  }

  if (Object.keys(updates).length) {
    await chrome.storage.sync.set(updates);
  }
}

async function getAiConfig() {
  const stored = await chrome.storage.sync.get([
    AI_PROVIDER_STORAGE_KEY,
    PROVIDER_SETTINGS_STORAGE_KEY,
    LEGACY_API_KEY_STORAGE_KEY,
  ]);

  const provider = sanitizeProvider(stored[AI_PROVIDER_STORAGE_KEY]);
  const allSettings = sanitizeProviderSettings(
    stored[PROVIDER_SETTINGS_STORAGE_KEY],
    stored[LEGACY_API_KEY_STORAGE_KEY]
  );

  return {
    provider,
    providerConfig: PROVIDER_CONFIG[provider],
    settings: allSettings[provider],
  };
}

function removeAllContextMenus() {
  return new Promise(resolve => chrome.contextMenus.removeAll(resolve));
}

async function rebuildContextMenus() {
  const menuItems = await getMenuItems();

  await removeAllContextMenus();

  if (!menuItems.length) return;

  chrome.contextMenus.create({
    id: "refactor-parent",
    title: "Wordsmith",
    contexts: ["selection"],
  });

  menuItems.forEach(item => {
    chrome.contextMenus.create({
      id: item.id,
      parentId: "refactor-parent",
      title: item.title,
      contexts: ["selection"],
    });
  });
}

function queueContextMenuRebuild() {
  rebuildContextMenusQueue = rebuildContextMenusQueue.then(
    rebuildContextMenus,
    rebuildContextMenus
  );

  return rebuildContextMenusQueue;
}

chrome.runtime.onInstalled.addListener(() => {
  Promise.all([
    ensureMenuItemsConfigured(),
    ensureProviderSettingsConfigured(),
  ]).then(queueContextMenuRebuild);
});

chrome.runtime.onStartup.addListener(() => {
  queueContextMenuRebuild();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "REBUILD_CONTEXT_MENUS") return false;

  queueContextMenuRebuild()
    .then(() => sendResponse({ ok: true }))
    .catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[MENU_ITEMS_STORAGE_KEY]) {
    queueContextMenuRebuild();
  }
});

// Handle menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItems = await getMenuItems();
  const menuItem = menuItems.find(m => m.id === info.menuItemId);
  if (!menuItem || !info.selectionText) return;

  const selectedText = info.selectionText.trim();

  // Tell the content script to show loading state
  chrome.tabs.sendMessage(tab.id, {
    type: "SHOW_LOADING",
    originalText: selectedText,
    action: menuItem.title,
  });

  try {
    const result = await generateText(menuItem.prompt + selectedText);

    chrome.tabs.sendMessage(tab.id, {
      type: "SHOW_RESULT",
      originalText: selectedText,
      resultText: result,
      action: menuItem.title,
    });
  } catch (err) {
    chrome.tabs.sendMessage(tab.id, {
      type: "SHOW_ERROR",
      error: err.message,
    });
  }
});

async function generateText(prompt) {
  const aiConfig = await getAiConfig();
  validateAiConfig(aiConfig);

  if (aiConfig.provider === "anthropic") {
    return generateAnthropicText(prompt, aiConfig);
  }

  return generateOpenAiCompatibleText(prompt, aiConfig);
}

function validateAiConfig({ provider, providerConfig, settings }) {
  if (providerConfig.apiKeyRequired && !settings.apiKey) {
    throw new Error(`No API key set. Click the extension icon to add your ${providerConfig.label} API key.`);
  }

  if (
    providerConfig.apiKeyPrefix &&
    settings.apiKey &&
    !settings.apiKey.startsWith(providerConfig.apiKeyPrefix)
  ) {
    throw new Error(`${providerConfig.label} keys should start with ${providerConfig.apiKeyPrefix}.`);
  }

  if (!settings.model) {
    throw new Error(`No model set for ${providerConfig.label}.`);
  }

  if (provider === "local" && !settings.baseUrl) {
    throw new Error("No local AI base URL set.");
  }
}

async function generateOpenAiCompatibleText(prompt, { provider, providerConfig, settings }) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  const body = {
    model: settings.model,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  if (provider === "local") {
    body.max_tokens = 1024;
  } else {
    body.max_completion_tokens = 1024;
  }

  const response = await fetch(buildChatCompletionsUrl(settings.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await getProviderErrorMessage(response, providerConfig.label));
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content?.trim() || "";

  if (!result) {
    throw new Error(`${providerConfig.label} returned an empty response.`);
  }

  return result;
}

async function generateAnthropicText(prompt, { providerConfig, settings }) {
  const response = await fetch(`${settings.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await getProviderErrorMessage(response, providerConfig.label));
  }

  const data = await response.json();
  const result = data.content
    ?.filter(part => part?.type === "text")
    .map(part => part.text)
    .join("")
    .trim() || "";

  if (!result) {
    throw new Error(`${providerConfig.label} returned an empty response.`);
  }

  return result;
}

async function getProviderErrorMessage(response, providerLabel) {
  const errorText = await response.text();
  let errorMessage = `${providerLabel} API request failed`;

  try {
    const err = JSON.parse(errorText);
    errorMessage = err?.error?.message || err?.message || errorMessage;
  } catch (_) {
    if (errorText) errorMessage = errorText;
  }

  return errorMessage;
}

function buildChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (normalizedBaseUrl.endsWith("/chat/completions")) {
    return normalizedBaseUrl;
  }

  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/chat/completions`;
  }

  return `${normalizedBaseUrl}/v1/chat/completions`;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

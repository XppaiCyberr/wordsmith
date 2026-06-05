// background.js - Service Worker

import { env, pipeline, TextStreamer } from "@huggingface/transformers";
import { DEFAULT_MENU_ITEMS } from "./menu-defaults.js";
import { DEFAULT_AI_PROVIDER, PROVIDER_CONFIG } from "./provider-defaults.js";

const MENU_ITEMS_STORAGE_KEY = "menuItems";
const AI_PROVIDER_STORAGE_KEY = "aiProvider";
const PROVIDER_SETTINGS_STORAGE_KEY = "providerSettings";
const LEGACY_API_KEY_STORAGE_KEY = "apiKey";
const HUGGING_FACE_PROVIDER = "huggingface";
const HUGGING_FACE_STATUS_MESSAGE = "GET_SMOLLM2_STATUS";
const HUGGING_FACE_CACHE_NAME = "transformers-cache";
const HUGGING_FACE_DTYPE = "q4";
const HUGGING_FACE_MAX_NEW_TOKENS = 512;
let rebuildContextMenusQueue = Promise.resolve();
let huggingFaceGeneratorPromise = null;
let huggingFaceGeneratorModel = "";
let huggingFaceGenerationQueue = Promise.resolve();
let huggingFaceStatus = createHuggingFaceStatus();

configureTransformersEnvironment();

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
  ]).then(() => {
    queueContextMenuRebuild();
    warmHuggingFaceGeneratorIfSelected();
  });
});

chrome.runtime.onStartup.addListener(() => {
  queueContextMenuRebuild();
  warmHuggingFaceGeneratorIfSelected();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REBUILD_CONTEXT_MENUS") {
    queueContextMenuRebuild()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === HUGGING_FACE_STATUS_MESSAGE) {
    getHuggingFaceStatus({ warm: Boolean(message.warm) })
      .then(status => sendResponse({ ok: true, status }))
      .catch(error => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "REWRITE_TEXT") {
    handleRewriteTextMessage(message, _sender, sendResponse);
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[MENU_ITEMS_STORAGE_KEY]) {
    queueContextMenuRebuild();
  }

  if (
    areaName === "sync" &&
    (changes[AI_PROVIDER_STORAGE_KEY] || changes[PROVIDER_SETTINGS_STORAGE_KEY])
  ) {
    warmHuggingFaceGeneratorIfSelected();
  }
});

// Handle menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItems = await getMenuItems();
  const menuItem = menuItems.find(m => m.id === info.menuItemId);
  if (!menuItem || !info.selectionText) return;

  const selectedText = info.selectionText.trim();
  const tabId = tab?.id;

  await ensureTabContentScript(tabId);

  // Tell the content script to show loading state
  await sendTabMessage(tabId, {
    type: "SHOW_LOADING",
    originalText: selectedText,
    action: menuItem.title,
  });

  try {
    const streamChunk = createTabStreamChunkSender(tabId, selectedText, menuItem.title);
    const result = await generateText(menuItem.prompt + selectedText, streamChunk);

    sendTabMessage(tabId, {
      type: "SHOW_RESULT",
      originalText: selectedText,
      resultText: result,
      action: menuItem.title,
    });
  } catch (err) {
    sendTabMessage(tabId, {
      type: "SHOW_ERROR",
      error: err.message,
    });
  }
});

async function handleRewriteTextMessage(message, sender, sendResponse) {
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const prompt = typeof message.prompt === "string" && message.prompt.trim()
    ? message.prompt
    : text;

  if (!prompt) {
    sendResponse({ ok: false, error: "No text provided." });
    return;
  }

  const tabId = sender.tab?.id || message.tabId;
  const action = typeof message.action === "string" && message.action.trim()
    ? message.action.trim()
    : "Rewrite";
  const streamChunk = tabId ? createTabStreamChunkSender(tabId, text, action) : null;

  try {
    const resultText = await generateText(prompt, streamChunk);
    sendResponse({ ok: true, resultText });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}

async function generateText(prompt, streamChunk) {
  const aiConfig = await getAiConfig();
  validateAiConfig(aiConfig);

  if (aiConfig.provider === "anthropic") {
    return generateAnthropicText(prompt, aiConfig);
  }

  if (aiConfig.provider === HUGGING_FACE_PROVIDER) {
    return generateHuggingFaceText(prompt, aiConfig, streamChunk);
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

async function generateHuggingFaceText(prompt, { settings }, streamChunk) {
  return queueHuggingFaceGeneration(async () => {
    const { generator, device } = await getHuggingFaceGenerator(settings.model);
    let streamedText = "";
    let didStartStream = false;

    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      callback_function: chunk => {
        if (!chunk) return;

        streamedText += chunk;

        if (streamChunk) {
          if (!didStartStream) {
            streamChunk({ type: "start", device });
            didStartStream = true;
          }

          streamChunk({ type: "chunk", chunk });
        }
      },
    });

    const output = await generator(
      [{ role: "user", content: prompt }],
      {
        max_new_tokens: HUGGING_FACE_MAX_NEW_TOKENS,
        do_sample: false,
        temperature: 0.2,
        streamer,
      }
    );
    const result = extractGeneratedText(output, streamedText);

    if (!result) {
      throw new Error("SmolLM2 returned an empty response.");
    }

    return result;
  });
}

function queueHuggingFaceGeneration(task) {
  huggingFaceGenerationQueue = huggingFaceGenerationQueue.then(task, task);
  return huggingFaceGenerationQueue;
}

function createHuggingFaceStatus(model = PROVIDER_CONFIG[HUGGING_FACE_PROVIDER].defaultModel) {
  return {
    model,
    downloaded: false,
    ready: false,
    loading: false,
    device: "",
    progress: null,
    cacheChecked: false,
    cachedFiles: 0,
    fallback: false,
    fallbackReason: "",
    error: "",
    updatedAt: 0,
  };
}

function setHuggingFaceStatus(patch) {
  huggingFaceStatus = {
    ...huggingFaceStatus,
    ...patch,
    updatedAt: Date.now(),
  };
}

function resetHuggingFaceStatus(model, patch = {}) {
  huggingFaceStatus = {
    ...createHuggingFaceStatus(model),
    ...patch,
    updatedAt: Date.now(),
  };
}

async function getHuggingFaceStatus({ warm = false } = {}) {
  const stored = await chrome.storage.sync.get([
    AI_PROVIDER_STORAGE_KEY,
    PROVIDER_SETTINGS_STORAGE_KEY,
    LEGACY_API_KEY_STORAGE_KEY,
  ]);
  const selectedProvider = sanitizeProvider(stored[AI_PROVIDER_STORAGE_KEY]);
  const providerSettings = sanitizeProviderSettings(
    stored[PROVIDER_SETTINGS_STORAGE_KEY],
    stored[LEGACY_API_KEY_STORAGE_KEY]
  );
  const modelId = providerSettings[HUGGING_FACE_PROVIDER].model ||
    PROVIDER_CONFIG[HUGGING_FACE_PROVIDER].defaultModel;

  if (huggingFaceStatus.model !== modelId) {
    resetHuggingFaceStatus(modelId);
  }

  if (warm && selectedProvider === HUGGING_FACE_PROVIDER && !huggingFaceStatus.ready) {
    void getHuggingFaceGenerator(modelId).catch(error => {
      console.warn("SmolLM2 status warmup failed.", error);
    });
  }

  const cacheInfo = await getHuggingFaceCacheInfo(modelId);

  setHuggingFaceStatus({
    model: modelId,
    cacheChecked: cacheInfo.cacheChecked,
    cachedFiles: cacheInfo.cachedFiles,
    downloaded: huggingFaceStatus.ready || huggingFaceStatus.downloaded || cacheInfo.downloaded,
    loading: huggingFaceStatus.loading || (
      Boolean(huggingFaceGeneratorPromise) &&
      huggingFaceGeneratorModel === modelId &&
      !huggingFaceStatus.ready &&
      !huggingFaceStatus.error
    ),
  });

  return { ...huggingFaceStatus };
}

async function getHuggingFaceCacheInfo(modelId) {
  if (!("caches" in globalThis)) {
    return { cacheChecked: false, cachedFiles: 0, downloaded: false };
  }

  try {
    const cache = await caches.open(HUGGING_FACE_CACHE_NAME);
    const requests = await cache.keys();
    const modelNeedle = modelId.toLowerCase();
    const encodedModelNeedle = encodeURIComponent(modelId).toLowerCase();
    const cachedFiles = requests.filter(request => {
      const url = request.url.toLowerCase();
      return url.includes(modelNeedle) || url.includes(encodedModelNeedle);
    }).length;

    return {
      cacheChecked: true,
      cachedFiles,
      downloaded: cachedFiles > 0,
    };
  } catch (error) {
    console.warn("Could not inspect SmolLM2 cache.", error);
    return { cacheChecked: false, cachedFiles: 0, downloaded: false };
  }
}

function handleHuggingFaceProgress(progress, modelId, device) {
  if (!progress?.status) return;

  const normalizedProgress = normalizeHuggingFaceProgress(progress);

  if (progress.status === "ready") {
    console.debug(`SmolLM2 ${device} pipeline ready.`);
    setHuggingFaceStatus({
      model: modelId,
      downloaded: true,
      ready: true,
      loading: false,
      device,
      progress: null,
      error: "",
    });
    return;
  }

  if (["initiate", "download", "progress", "done"].includes(progress.status)) {
    setHuggingFaceStatus({
      model: modelId,
      ready: false,
      loading: true,
      device,
      progress: normalizedProgress,
      error: "",
    });
  }
}

function normalizeHuggingFaceProgress(progress) {
  return {
    status: progress.status,
    file: progress.file || progress.name || "",
    progress: Number.isFinite(progress.progress) ? progress.progress : null,
    loaded: Number.isFinite(progress.loaded) ? progress.loaded : null,
    total: Number.isFinite(progress.total) ? progress.total : null,
  };
}

async function getHuggingFaceGenerator(model) {
  const modelId = model || PROVIDER_CONFIG[HUGGING_FACE_PROVIDER].defaultModel;

  if (huggingFaceGeneratorPromise && huggingFaceGeneratorModel === modelId) {
    return huggingFaceGeneratorPromise;
  }

  huggingFaceGeneratorModel = modelId;
  resetHuggingFaceStatus(modelId, {
    loading: true,
    device: "webgpu",
  });

  huggingFaceGeneratorPromise = loadHuggingFaceGenerator(modelId, "webgpu")
    .catch(async webgpuError => {
      console.warn("SmolLM2 WebGPU initialization failed. Falling back to wasm.", webgpuError);
      setHuggingFaceStatus({
        model: modelId,
        ready: false,
        loading: true,
        device: "wasm",
        fallback: true,
        fallbackReason: getErrorMessage(webgpuError),
        error: "",
      });
      return loadHuggingFaceGenerator(modelId, "wasm");
    })
    .then(result => {
      setHuggingFaceStatus({
        model: modelId,
        downloaded: true,
        ready: true,
        loading: false,
        device: result.device,
        progress: null,
        error: "",
      });
      return result;
    })
    .catch(error => {
      huggingFaceGeneratorPromise = null;
      huggingFaceGeneratorModel = "";
      setHuggingFaceStatus({
        model: modelId,
        ready: false,
        loading: false,
        progress: null,
        error: getErrorMessage(error),
      });
      throw error;
    });

  return huggingFaceGeneratorPromise;
}

async function loadHuggingFaceGenerator(modelId, device) {
  const generator = await pipeline(
    "text-generation",
    modelId,
    {
      device,
      dtype: HUGGING_FACE_DTYPE,
      progress_callback: progress => {
        handleHuggingFaceProgress(progress, modelId, device);
      },
    }
  );

  return { generator, device };
}

async function warmHuggingFaceGeneratorIfSelected() {
  try {
    const aiConfig = await getAiConfig();

    if (aiConfig.provider === HUGGING_FACE_PROVIDER) {
      await getHuggingFaceGenerator(aiConfig.settings.model);
    }
  } catch (error) {
    console.warn("SmolLM2 warmup failed.", error);
  }
}

function extractGeneratedText(output, streamedText) {
  const firstOutput = Array.isArray(output) ? output[0] : output;
  const generatedText = firstOutput?.generated_text;

  if (Array.isArray(generatedText)) {
    const assistantMessage = [...generatedText]
      .reverse()
      .find(message => message?.role === "assistant" && typeof message.content === "string");

    if (assistantMessage) return assistantMessage.content.trim();
  }

  if (typeof generatedText === "string") {
    return generatedText.trim();
  }

  return String(streamedText || "").trim();
}

function createTabStreamChunkSender(tabId, originalText, action) {
  return event => {
    if (event.type === "start") {
      sendTabMessage(tabId, {
        type: "SHOW_STREAM_START",
        originalText,
        action,
        device: event.device,
      });
      return;
    }

    if (event.type === "chunk") {
      sendTabMessage(tabId, {
        type: "SHOW_STREAM_CHUNK",
        chunk: event.chunk,
      });
    }
  };
}

function sendTabMessage(tabId, message) {
  if (!tabId) return Promise.resolve(false);

  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, () => {
      const error = chrome.runtime.lastError;
      resolve(!error);
    });
  });
}

async function ensureTabContentScript(tabId) {
  if (!tabId) return false;
  if (await pingTabContentScript(tabId)) return true;

  try {
    await injectDeclaredContentScripts(tabId);
  } catch (error) {
    console.warn("Could not inject Wordsmith content script.", error);
    return false;
  }

  return pingTabContentScript(tabId);
}

function pingTabContentScript(tabId) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: "WORDSMITH_PING" }, response => {
      const error = chrome.runtime.lastError;
      resolve(!error && response?.ok === true);
    });
  });
}

async function injectDeclaredContentScripts(tabId) {
  const contentScript = chrome.runtime.getManifest().content_scripts?.[0];
  const cssFiles = contentScript?.css || [];
  const jsFiles = contentScript?.js || [];

  if (!jsFiles.length) {
    throw new Error("No content script files are declared in the extension manifest.");
  }

  if (cssFiles.length) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: cssFiles,
    });
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: jsFiles,
  });
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

function getErrorMessage(error) {
  return error?.message || String(error || "Unknown error.");
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

function configureTransformersEnvironment() {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.logLevel = "error";
  env.backends.onnx.wasm ??= {};
  env.backends.onnx.wasm.proxy = false;
}

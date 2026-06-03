// background.js - Service Worker

importScripts("menu-defaults.js");

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MENU_ITEMS_STORAGE_KEY = "menuItems";
let rebuildContextMenusQueue = Promise.resolve();

function cloneDefaultMenuItems() {
  return globalThis.DEFAULT_MENU_ITEMS.map(item => ({ ...item }));
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
  ensureMenuItemsConfigured().then(queueContextMenuRebuild);
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
    // Get the API key from storage
    const { apiKey } = await chrome.storage.sync.get("apiKey");

    if (!apiKey) {
      chrome.tabs.sendMessage(tab.id, {
        type: "SHOW_ERROR",
        error: "No API key set. Click the extension icon to add your Groq API key.",
      });
      return;
    }

    if (!apiKey.startsWith("gsk_")) {
      chrome.tabs.sendMessage(tab.id, {
        type: "SHOW_ERROR",
        error: "Invalid Groq API key. Groq keys should start with gsk_.",
      });
      return;
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_completion_tokens: 1024,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: menuItem.prompt + selectedText,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = "Groq API request failed";

      try {
        const err = JSON.parse(errorText);
        errorMessage = err?.error?.message || errorMessage;
      } catch (_) {
        if (errorText) errorMessage = errorText;
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim() || "";

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

// popup.js

const keyInput = document.getElementById("api-key");
const saveBtn  = document.getElementById("save-btn");
const status   = document.getElementById("status");
const menuList = document.getElementById("menu-list");
const menuStatus = document.getElementById("menu-status");
const customTitle = document.getElementById("custom-title");
const customPrompt = document.getElementById("custom-prompt");
const addMenuBtn = document.getElementById("add-menu-btn");
const resetMenuBtn = document.getElementById("reset-menu-btn");
const MENU_ITEMS_STORAGE_KEY = "menuItems";

let menuItems = [];

chrome.storage.sync.get(["apiKey", MENU_ITEMS_STORAGE_KEY], ({ apiKey, menuItems: storedMenuItems }) => {
  if (apiKey?.startsWith("gsk_")) {
    keyInput.value = apiKey;
    setStatus("API key saved", false);
  } else if (apiKey) {
    setStatus("Enter a Groq API key.", true);
  }

  menuItems = sanitizeMenuItems(storedMenuItems);
  renderMenuItems();

  if (!Array.isArray(storedMenuItems)) {
    saveMenuItems({ quiet: true });
  }
});

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    setStatus("Please enter a valid API key.", true);
    return;
  }
  if (!key.startsWith("gsk_")) {
    setStatus("Key should start with gsk_...", true);
    return;
  }
  chrome.storage.sync.set({ apiKey: key }, () => {
    setStatus("Saved. You're ready to go.", false);
  });
});

function setStatus(msg, isError) {
  status.textContent = msg;
  status.className = "status" + (isError ? " error" : "");
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

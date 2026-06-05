import { readFileSync } from "node:fs";
import { defineManifest } from "@crxjs/vite-plugin";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineManifest({
  manifest_version: 3,
  name: "Wordsmith",
  version: pkg.version,
  description: pkg.description,
  permissions: [
    "contextMenus",
    "activeTab",
    "scripting",
    "storage",
  ],
  host_permissions: [
    "https://api.groq.com/*",
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
    "https://huggingface.co/*",
    "https://*.huggingface.co/*",
    "https://*.hf.co/*",
    "http://localhost/*",
    "http://127.0.0.1/*",
  ],
  background: {
    service_worker: "background.js",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      css: ["content.css"],
    },
  ],
  action: {
    default_popup: "popup.html",
    default_icon: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
  icons: {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
});

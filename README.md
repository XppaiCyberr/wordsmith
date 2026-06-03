# Wordsmith

Wordsmith is a Chrome extension for polishing selected text with your preferred AI provider. Highlight text on any webpage, right-click, choose a writing action, then copy or replace the result.

Current version: `1.1.0`

## Features

- Rewrite selected text for clarity.
- Make text professional, casual, shorter, or formal.
- Fix grammar and spelling.
- Fix grammar while keeping the original writing style.
- Explain selected text like you are 5.
- Add, remove, reset, and reorder context-menu actions from the popup.
- Use custom prompts for your own text actions.
- Choose Groq, OpenAI, Anthropic, or a local OpenAI-compatible AI server.

## Setup

1. Choose an AI provider in the popup.
2. Open Chrome and go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder.
6. Click the Wordsmith extension icon.
7. Enter the API key, model, and local base URL if needed.
8. Click `Save AI Settings`.

## AI Providers

Wordsmith supports:

- `Groq` using `https://api.groq.com/openai/v1`.
- `OpenAI` using `https://api.openai.com/v1`.
- `Anthropic` using `https://api.anthropic.com/v1`.
- `Local AI` using an OpenAI-compatible local endpoint.

Default models:

- Groq: `llama-3.3-70b-versatile`
- OpenAI: `gpt-4o-mini`
- Anthropic: `claude-sonnet-4-20250514`
- Local AI: `llama3.2`

For Ollama, use:

```text
Base URL: http://localhost:11434/v1
Model: llama3.2
```

## Usage

1. Highlight text on a webpage.
2. Right-click the selected text.
3. Open `Wordsmith`.
4. Choose an action.
5. Copy the result or replace the selected text on the page.

## Customizing Actions

Open the extension popup and use the `Context menu` section.

- `Up` and `Down` change the order of actions.
- `Remove` hides an action from the context menu.
- `Reset` restores the built-in actions.
- `Add Action` creates a new custom action from a name and prompt.

Changes are saved in Chrome sync storage and apply to the right-click menu automatically.

## Built-In Actions

- `Refactor & Improve`
- `Make Professional`
- `Make Casual & Friendly`
- `Make Shorter`
- `Make Formal`
- `Fix Grammar & Spelling`
- `Fix Grammar, Keep Style`
- `Explain Like I'm 5`

## Project Files

- `manifest.json` configures the Chrome extension.
- `background.js` creates context menus and calls the selected AI provider.
- `menu-defaults.js` stores the built-in action definitions.
- `provider-defaults.js` stores the built-in provider defaults.
- `popup.html` and `popup.js` handle provider settings and menu customization.
- `content.js` and `content.css` show the result modal on webpages.
- `icons/` contains the extension icons.

## Permissions

Wordsmith uses:

- `contextMenus` to add right-click actions.
- `activeTab` and `scripting` for page interaction.
- `storage` to save provider settings and menu configuration.
- `https://api.groq.com/*` to call Groq.
- `https://api.openai.com/*` to call OpenAI.
- `https://api.anthropic.com/*` to call Anthropic.
- `http://localhost/*` and `http://127.0.0.1/*` to call local AI servers.

## Author

Created by XppaiCyber.

- X: [@OppaiCyber](https://x.com/OppaiCyber)
- Farcaster: [xppaicyber.eth](https://farcaster.xyz/xppaicyber.eth)
- Donate: `xppaicyber.eth` / `0xE11018C82D4405bDBc7414eC988Fd08351666666`

## Changelog

### 1.1.0

- Added AI provider selection for Groq, OpenAI, Anthropic, and local OpenAI-compatible servers.
- Added model and local base URL settings in the popup.
- Expanded extension permissions for the supported AI providers.

### 1.0.0

- Initial Wordsmith release with context-menu text actions and customizable prompts.

## Development

After editing files, reload the extension from `chrome://extensions`.

Quick syntax checks:

```powershell
node --check background.js
node --check content.js
node --check popup.js
node --check menu-defaults.js
node --check provider-defaults.js
```

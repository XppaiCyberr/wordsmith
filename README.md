# Wordsmith

Wordsmith is a Chrome extension for polishing selected text with Groq. Highlight text on any webpage, right-click, choose a writing action, then copy or replace the result.

## Features

- Rewrite selected text for clarity.
- Make text professional, casual, shorter, or formal.
- Fix grammar and spelling.
- Fix grammar while keeping the original writing style.
- Explain selected text like you are 5.
- Add, remove, reset, and reorder context-menu actions from the popup.
- Use custom prompts for your own text actions.

## Setup

1. Get a Groq API key from [console.groq.com/keys](https://console.groq.com/keys).
2. Open Chrome and go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder.
6. Click the Wordsmith extension icon.
7. Paste your Groq API key. It should start with `gsk_`.
8. Click `Save Key`.

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
- `background.js` creates context menus and calls Groq.
- `menu-defaults.js` stores the built-in action definitions.
- `popup.html` and `popup.js` handle API key entry and menu customization.
- `content.js` and `content.css` show the result modal on webpages.
- `icons/` contains the extension icons.

## Model

Wordsmith uses Groq's OpenAI-compatible chat completions endpoint:

```text
https://api.groq.com/openai/v1/chat/completions
```

The current model is:

```text
llama-3.3-70b-versatile
```

## Permissions

Wordsmith uses:

- `contextMenus` to add right-click actions.
- `activeTab` and `scripting` for page interaction.
- `storage` to save the API key and menu configuration.
- `https://api.groq.com/*` to call Groq.

## Author

Created by XppaiCyber.

- X: [@OppaiCyber](https://x.com/OppaiCyber)
- Farcaster: [xppaicyber.eth](https://farcaster.xyz/xppaicyber.eth)
- Donate: `xppaicyber.eth` / `0xE11018C82D4405bDBc7414eC988Fd08351666666`

## Development

After editing files, reload the extension from `chrome://extensions`.

Quick syntax checks:

```powershell
node --check background.js
node --check content.js
node --check popup.js
node --check menu-defaults.js
```

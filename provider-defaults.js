export const DEFAULT_AI_PROVIDER = "groq";

export const PROVIDER_CONFIG = {
  groq: {
    label: "Groq",
    apiKeyLabel: "Groq API Key",
    apiKeyPlaceholder: "gsk_...",
    apiKeyPrefix: "gsk_",
    apiKeyRequired: true,
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    showBaseUrl: false,
  },
  openai: {
    label: "OpenAI",
    apiKeyLabel: "OpenAI API Key",
    apiKeyPlaceholder: "sk-...",
    apiKeyPrefix: "sk-",
    apiKeyRequired: true,
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    showBaseUrl: false,
  },
  anthropic: {
    label: "Anthropic",
    apiKeyLabel: "Anthropic API Key",
    apiKeyPlaceholder: "sk-ant-...",
    apiKeyPrefix: "sk-ant-",
    apiKeyRequired: true,
    defaultModel: "claude-sonnet-4-20250514",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    showBaseUrl: false,
  },
  local: {
    label: "Local AI",
    apiKeyLabel: "Local API Key",
    apiKeyPlaceholder: "Optional",
    apiKeyPrefix: "",
    apiKeyRequired: false,
    defaultModel: "llama3.2",
    defaultBaseUrl: "http://localhost:11434/v1",
    showBaseUrl: true,
  },
};

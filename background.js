/**
 * Context Counter - Background Service Worker
 *
 * Handles state management, model detection, and messaging with content scripts.
 * Maintains per-tab token state and broadcasts updates.
 *
 * @author Remix Partners (https://remixpartners.ai)
 * @version 1.0.0
 */

// =============================================================================
// MODEL CONFIGURATION (January 2026)
// =============================================================================

const MODEL_LIMITS = {
  // OpenAI GPT-5.2 Family
  'gpt-5.2': { context: 400000, name: 'GPT-5.2' },
  'gpt-5.2-instant': { context: 128000, name: 'GPT-5.2 Instant' },
  'gpt-5.2-thinking': { context: 196000, name: 'GPT-5.2 Thinking' },
  'gpt-5.2-pro': { context: 2000000, name: 'GPT-5.2 Pro' },
  'gpt-5.2-codex': { context: 400000, name: 'GPT-5.2 Codex' },
  'gpt-5-mini': { context: 128000, name: 'GPT-5 Mini' },
  // Legacy OpenAI
  'gpt-4o': { context: 128000, name: 'GPT-4o' },
  'gpt-4o-mini': { context: 128000, name: 'GPT-4o Mini' },
  'gpt-4-turbo': { context: 128000, name: 'GPT-4 Turbo' },

  // Anthropic Claude 4.5 Family
  'claude-opus-4-5': { context: 200000, name: 'Claude Opus 4.5' },
  'claude-sonnet-4-5': { context: 200000, name: 'Claude Sonnet 4.5' },
  'claude-haiku-4-5': { context: 200000, name: 'Claude Haiku 4.5' },
  'claude-opus-4-1': { context: 200000, name: 'Claude Opus 4.1' },
  'claude-sonnet-4': { context: 200000, name: 'Claude Sonnet 4' },
  // Legacy Claude
  'claude-3-haiku': { context: 200000, name: 'Claude 3 Haiku' },
  'claude-3-7-sonnet': { context: 200000, name: 'Claude 3.7 Sonnet' },

  // Google Gemini 3 Family
  'gemini-3-pro': { context: 1000000, name: 'Gemini 3 Pro' },
  'gemini-3-deep-think': { context: 1000000, name: 'Gemini 3 Deep Think' },
  'gemini-3-flash': { context: 1000000, name: 'Gemini 3 Flash' },
  'gemini-2.5-flash': { context: 1000000, name: 'Gemini 2.5 Flash' },
  // Legacy Gemini
  'gemini-2.0-flash': { context: 1000000, name: 'Gemini 2.0 Flash' },
  'gemini-1.5-pro': { context: 2000000, name: 'Gemini 1.5 Pro' },
};

const DEFAULT_LIMITS = {
  chatgpt: { context: 128000, name: 'ChatGPT' },
  claude: { context: 200000, name: 'Claude' },
  gemini: { context: 1000000, name: 'Gemini 3' }
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const tabState = {};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Detect platform from URL
 */
function getPlatform(url) {
  if (!url) return null;
  if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('gemini.google.com')) return 'gemini';
  return null;
}

/**
 * Get model limit with fuzzy matching
 */
function getModelLimit(modelId, platform) {
  if (!modelId) {
    const defaults = DEFAULT_LIMITS[platform] || { context: 128000, name: 'Unknown Model' };
    return { limit: defaults.context, modelName: defaults.name };
  }

  const lowerModelId = modelId.toLowerCase();

  // Exact match
  if (MODEL_LIMITS[lowerModelId]) {
    return {
      limit: MODEL_LIMITS[lowerModelId].context,
      modelName: MODEL_LIMITS[lowerModelId].name,
    };
  }

  // Fuzzy match
  for (const [key, value] of Object.entries(MODEL_LIMITS)) {
    if (lowerModelId.includes(key) || key.includes(lowerModelId)) {
      return { limit: value.context, modelName: value.name };
    }
  }

  // Platform defaults
  const defaults = DEFAULT_LIMITS[platform] || { context: 128000, name: 'Unknown Model' };
  return { limit: defaults.context, modelName: modelId };
}

/**
 * Send update to content script
 */
function sendUpdate(tabId, data) {
  chrome.tabs.sendMessage(tabId, { type: 'CONTEXT_UPDATE', data }).catch(() => {});
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// Initialize tab state on page load
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type !== 'main_frame') return;

    const platform = getPlatform(details.url);
    if (!platform) return;

    tabState[details.tabId] = {
      platform,
      modelId: null,
      modelName: DEFAULT_LIMITS[platform]?.name || 'Unknown',
      contextLimit: DEFAULT_LIMITS[platform]?.context || 128000,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      lastUpdate: Date.now(),
    };
  },
  { urls: ['*://chat.openai.com/*', '*://chatgpt.com/*', '*://claude.ai/*', '*://gemini.google.com/*'] }
);

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ success: false, error: 'No tab ID' });
    return true;
  }

  if (message.type === 'TOKEN_DATA') {
    const state = tabState[tabId] || {};
    const platform = state.platform || getPlatform(sender.tab.url);

    if (message.modelId) {
      const { limit, modelName } = getModelLimit(message.modelId, platform);
      state.modelId = message.modelId;
      state.modelName = modelName;
      state.contextLimit = limit;
    }

    if (message.inputTokens !== undefined) state.inputTokens = message.inputTokens;
    if (message.outputTokens !== undefined) state.outputTokens = message.outputTokens;
    if (message.totalTokens !== undefined) state.totalTokens = message.totalTokens;

    state.lastUpdate = Date.now();
    state.platform = platform;
    tabState[tabId] = state;

    sendUpdate(tabId, state);
    sendResponse({ success: true });
  } else if (message.type === 'GET_STATE') {
    sendResponse({ success: true, state: tabState[tabId] || null });
  }

  return true;
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabState[tabId];
});

// Reset on navigation
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;

  const tabId = details.tabId;
  const platform = getPlatform(details.url);

  if (platform && tabState[tabId]) {
    tabState[tabId] = {
      ...tabState[tabId],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      lastUpdate: Date.now(),
    };
    sendUpdate(tabId, tabState[tabId]);
  }
});

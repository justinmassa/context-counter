/**
 * Context Counter - Content Script
 *
 * Displays a real-time context window usage overlay for ChatGPT, Claude, and Gemini.
 * Uses Shadow DOM for complete CSS isolation from host pages.
 *
 * @author Remix Partners (https://remixpartners.ai)
 * @version 1.0.0
 */

(function() {
  'use strict';

  // Platform detection from hostname
  const hostname = window.location.hostname;
  let platform = null;
  if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) {
    platform = 'chatgpt';
  } else if (hostname.includes('claude.ai')) {
    platform = 'claude';
  } else if (hostname.includes('gemini.google.com')) {
    platform = 'gemini';
  }

  if (!platform) return;

  // Debug mode - set to true for verbose logging
  const DEBUG = false;
  const log = (...args) => DEBUG && log('', ...args);

  // State object for tracking token usage
  // Context limits vary by platform AND plan level (especially ChatGPT)
  // Using conservative (free tier) defaults until plan is detected
  const platformNames = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini 3' };
  const defaultLimits = { chatgpt: 16000, claude: 200000, gemini: 1000000 }; // Gemini 3 is 1M for paid
  const state = {
    model: platformNames[platform] || 'Context', // Default to platform name
    plan: null, // 'free', 'plus', 'pro', 'team', 'enterprise', 'ultra'
    contextLimit: defaultLimits[platform] || 128000,
    segments: { system: 0, tools: 0, thinking: 0, conversation: 0 },
    total: 0
  };

  let overlayElement = null;
  let lastUpdateTime = 0;
  const UPDATE_THROTTLE_MS = 500; // Don't update more than twice per second

  // Format token count for display (e.g., 84000 -> "84K", 1200000 -> "1.2M")
  function formatTokens(count) {
    if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toString();
  }

  // Create the overlay DOM element using Shadow DOM for isolation
  let shadowRoot = null;

  function createOverlay() {
    const existingHost = document.getElementById('context-window-host');
    if (existingHost) {
      shadowRoot = existingHost.shadowRoot;
      return shadowRoot.getElementById('context-window-overlay');
    }

    // Create host element for Shadow DOM
    const host = document.createElement('div');
    host.id = 'context-window-host';
    host.style.cssText = 'position: fixed !important; bottom: 16px !important; right: 16px !important; z-index: 2147483647 !important;';
    document.body.appendChild(host);

    // Attach shadow DOM (closed mode for better isolation)
    shadowRoot = host.attachShadow({ mode: 'open' });

    // Theme colors
    const themes = {
      chatgpt: { bg: '#202123', border: '#40414F', text: '#ECECF1', progressBg: '#40414F', conversationColor: '#10B981', tooltipBg: '#343541' },
      claude: { bg: '#F5F4EF', border: '#E5E4DF', text: '#1A1915', progressBg: '#E5E4DF', conversationColor: '#D97706', tooltipBg: '#FFFFFF' },
      gemini: { bg: '#1e1e1e', border: '#3c4043', text: '#e8eaed', progressBg: '#3c4043', conversationColor: '#4285f4', tooltipBg: '#292929' }
    };
    const theme = themes[platform] || themes.chatgpt;

    // Inject all styles directly into shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      #context-window-overlay {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        background: ${theme.bg};
        border: 1px solid ${theme.border};
        color: ${theme.text};
        border-radius: 8px;
        padding: 8px 12px;
        min-width: 160px;
        max-width: 220px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        user-select: none;
        position: relative;
      }
      .cw-tooltip {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        margin-bottom: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 11px;
        background: ${theme.tooltipBg};
        border: 1px solid ${theme.border};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
      }
      #context-window-overlay:hover .cw-tooltip {
        opacity: 1;
        visibility: visible;
      }
      .cw-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
        gap: 12px;
      }
      .cw-model-name { font-weight: 500; font-size: 11px; opacity: 0.7; }
      .cw-token-count { font-weight: 600; font-size: 12px; }
      .cw-progress-container {
        height: 12px;
        border-radius: 6px;
        overflow: hidden;
        background: ${theme.progressBg};
      }
      .cw-progress-bar { display: flex; height: 100%; width: 100%; }
      .cw-segment { height: 100%; transition: width 0.3s; }
      .cw-segment-system { background: #6B7280; }
      .cw-segment-tools { background: #3B82F6; }
      .cw-segment-thinking { background: #8B5CF6; }
      .cw-segment-conversation { background: ${theme.conversationColor}; }
      .cw-tooltip-row { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; }
      .cw-tooltip-label { display: flex; align-items: center; gap: 6px; }
      .cw-tooltip-dot { width: 8px; height: 8px; border-radius: 50%; }
      .cw-tooltip-dot.system { background: #6B7280; }
      .cw-tooltip-dot.tools { background: #3B82F6; }
      .cw-tooltip-dot.thinking { background: #8B5CF6; }
      .cw-tooltip-dot.conversation { background: ${theme.conversationColor}; }
      .cw-tooltip-value { font-weight: 500; opacity: 0.8; }
      .cw-tooltip-divider { height: 1px; background: currentColor; opacity: 0.2; margin: 6px 0; }
      .cw-tooltip-total { font-weight: 600; }
      .cw-tooltip-note { font-size: 9px; opacity: 0.5; text-align: center; margin-top: 6px; font-style: italic; }
      .cw-attribution { margin-top: 8px; padding-top: 6px; border-top: 1px solid currentColor; opacity: 0.15; text-align: center; font-size: 9px; }
      .cw-attribution a { color: inherit; text-decoration: none; }
      .cw-attribution a:hover { opacity: 1; text-decoration: underline; }
      .warning .cw-progress-container { animation: pulse-warning 1.5s ease-in-out infinite; }
      .critical .cw-token-count { color: #EF4444; }
      .critical .cw-progress-container { animation: pulse-critical 1s ease-in-out infinite; }
      @keyframes pulse-warning { 0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4); } 50% { box-shadow: 0 0 0 4px rgba(251, 191, 36, 0); } }
      @keyframes pulse-critical { 0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 50% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0); } }
    `;
    shadowRoot.appendChild(style);

    // Create overlay element
    const overlay = document.createElement('div');
    overlay.id = 'context-window-overlay';
    overlay.innerHTML = `
      <div class="cw-tooltip">
        <div class="cw-tooltip-row">
          <span class="cw-tooltip-label"><span class="cw-tooltip-dot system"></span><span>OS Tax</span></span>
          <span class="cw-tooltip-value" data-segment="system">0</span>
        </div>
        <div class="cw-tooltip-row">
          <span class="cw-tooltip-label"><span class="cw-tooltip-dot tools"></span><span>Tools</span></span>
          <span class="cw-tooltip-value" data-segment="tools">0</span>
        </div>
        <div class="cw-tooltip-row">
          <span class="cw-tooltip-label"><span class="cw-tooltip-dot thinking"></span><span>Thinking</span></span>
          <span class="cw-tooltip-value" data-segment="thinking">0</span>
        </div>
        <div class="cw-tooltip-row">
          <span class="cw-tooltip-label"><span class="cw-tooltip-dot conversation"></span><span>Conversation</span></span>
          <span class="cw-tooltip-value" data-segment="conversation">0</span>
        </div>
        <div class="cw-tooltip-divider"></div>
        <div class="cw-tooltip-row cw-tooltip-total">
          <span>Total (est.)</span>
          <span class="cw-tooltip-total-value">0 / ${formatTokens(state.contextLimit)}</span>
        </div>
        <div class="cw-tooltip-note">Values are estimated from visible text</div>
        <div class="cw-attribution">
          <a href="https://remixpartners.ai" target="_blank" rel="noopener">Created by remixpartners.ai</a>
        </div>
      </div>
      <div class="cw-header">
        <span class="cw-model-name">${state.model}</span>
        <span class="cw-token-count">0 / ${formatTokens(state.contextLimit)}</span>
      </div>
      <div class="cw-progress-container">
        <div class="cw-progress-bar">
          <div class="cw-segment cw-segment-system" style="width: 0%"></div>
          <div class="cw-segment cw-segment-tools" style="width: 0%"></div>
          <div class="cw-segment cw-segment-thinking" style="width: 0%"></div>
          <div class="cw-segment cw-segment-conversation" style="width: 0%"></div>
        </div>
      </div>
    `;

    shadowRoot.appendChild(overlay);
    return overlay;
  }

  // Update the overlay with current state values
  function updateOverlay() {
    if (!overlayElement || !shadowRoot) return;

    const { total, contextLimit: limit } = state;
    const percentage = (total / limit) * 100;

    // Update header - show plan level if detected (helps users understand their limits)
    // Query from shadowRoot since overlay is in Shadow DOM
    const modelNameEl = shadowRoot.querySelector('.cw-model-name');
    const tokenCountEl = shadowRoot.querySelector('.cw-token-count');
    if (modelNameEl) {
      let displayName = state.model;
      // Show plan only for ChatGPT where it significantly affects context limit
      // Gemini 3 is 1M across all modes for paid users, so no need to show plan
      if (state.plan && platform === 'chatgpt') {
        displayName = `${state.model} (${state.plan})`;
      }
      modelNameEl.textContent = displayName;
    }
    if (tokenCountEl) tokenCountEl.textContent = `${formatTokens(total)} / ${formatTokens(limit)}`;

    // Update progress bar segments
    const segments = ['system', 'tools', 'thinking', 'conversation'];
    segments.forEach(seg => {
      const el = shadowRoot.querySelector(`.cw-segment-${seg}`);
      if (el) el.style.width = `${Math.min((state.segments[seg] / limit) * 100, 100)}%`;
    });

    // Update tooltip values
    segments.forEach(seg => {
      const el = shadowRoot.querySelector(`[data-segment="${seg}"]`);
      if (el) el.textContent = formatTokens(state.segments[seg]);
    });

    // Update tooltip total
    const totalEl = shadowRoot.querySelector('.cw-tooltip-total-value');
    if (totalEl) totalEl.textContent = `${formatTokens(total)} / ${formatTokens(limit)}`;

    // Handle warning/critical states
    const overlay = shadowRoot.getElementById('context-window-overlay');
    if (overlay) {
      overlay.classList.remove('warning', 'critical');
      if (percentage >= 90) overlay.classList.add('critical');
      else if (percentage >= 75) overlay.classList.add('warning');
    }
  }

  // Estimate tokens from text (roughly 4 chars per token for English)
  function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  // Get conversation text from DOM for token estimation
  function getConversationText() {
    let text = '';

    if (platform === 'chatgpt') {
      // ChatGPT - look for message containers AND thinking sidebar
      const selectors = [
        '[data-message-author-role]',
        '.markdown',
        '.whitespace-pre-wrap',
        '.text-base',
        '.min-h-8',
        // Thinking trace sidebar selectors
        '[class*="thinking"]',
        '[class*="thought"]',
        '[class*="reasoning"]',
        '[class*="sidebar"]',
        '[class*="trace"]',
        '[class*="chain"]'
      ];
      text = getTextFromSelectors(selectors);

      // If selectors didn't find much, fallback to body text like Claude
      if (text.length < 100) {
        try {
          const bodyText = document.body.innerText || '';
          const lines = bodyText.split('\n').filter(line => line.trim().length > 20);
          text = lines.join(' ');
          log(' ChatGPT fallback: found', lines.length, 'lines,', text.length, 'chars');
        } catch (e) {
          log('ERROR: ChatGPT fallback error:', e);
        }
      }
    } else if (platform === 'claude') {
      // Claude - simple approach: get all visible text, subtract UI elements
      try {
        // Get all text from the page
        const bodyText = document.body.innerText || '';

        // The conversation is usually the bulk of the text
        // Just filter out very short lines (UI elements tend to be short)
        const lines = bodyText.split('\n');
        const contentLines = lines.filter(line => {
          const trimmed = line.trim();
          // Keep lines that are likely conversation content (longer than 20 chars)
          // or are part of a message
          return trimmed.length > 20;
        });

        text = contentLines.join(' ');
        log(' Claude: found', contentLines.length, 'content lines,', text.length, 'chars');
      } catch (e) {
        log('ERROR: Claude text detection error:', e);
        text = '';
      }
    } else if (platform === 'gemini') {
      // Gemini - simple approach like Claude: get body text and filter
      // Shadow DOM isolates our overlay, so innerText should be clean
      try {
        const bodyText = document.body.innerText || '';
        const lines = bodyText.split('\n');
        const contentLines = lines.filter(line => {
          const trimmed = line.trim();
          // Skip short lines (UI elements)
          if (trimmed.length < 20) return false;
          // Skip common Gemini UI text
          if (trimmed.includes('Enter a prompt') ||
              trimmed.includes('Where should we start') ||
              trimmed.includes('Create image') ||
              trimmed.includes('Write anything') ||
              trimmed.includes('Help me learn') ||
              trimmed.includes('Boost my day')) {
            return false;
          }
          return true;
        });
        text = contentLines.join(' ');
        log(' Gemini: found', contentLines.length, 'content lines,', text.length, 'chars');
      } catch (e) {
        log('ERROR: Gemini text detection error:', e);
        text = '';
      }
    }

    return text.trim();
  }

  // Helper to get text from a list of selectors
  function getTextFromSelectors(selectors) {
    const seenElements = new Set();
    let allText = '';

    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (seenElements.has(el)) return;
          if (el.closest('nav, aside, header, [role="navigation"], [class*="sidebar"], [class*="menu"]')) return;
          seenElements.add(el);
          const text = el.textContent?.trim();
          if (text && text.length > 10) {
            allText += text + ' ';
          }
        });
      } catch (e) {
        // Skip invalid selectors
      }
    }
    return allText;
  }

  // Detect ChatGPT plan level from UI
  // Returns: 'free', 'plus', 'pro', 'team', 'enterprise', or null if unknown
  function detectChatGPTPlan() {
    if (platform !== 'chatgpt') return null;

    // Strategy 1: Look for "Upgrade" button - if present, user is on Free tier
    const upgradeSelectors = [
      'a[href*="upgrade"]',
      'button:contains("Upgrade")',
      '[data-testid*="upgrade"]',
      '[class*="upgrade"]',
      'a[href*="/pricing"]',
    ];

    // Check for upgrade button/link text
    const allButtons = document.querySelectorAll('button, a');
    for (const btn of allButtons) {
      const text = btn.textContent?.toLowerCase() || '';
      if (text.includes('upgrade') && !text.includes('upgraded')) {
        log(' Detected FREE tier (upgrade button found)');
        return 'free';
      }
    }

    // Strategy 2: Look for plan badges/indicators
    const pageText = document.body?.innerText?.toLowerCase() || '';

    // Check for specific plan indicators in common locations
    const planIndicators = [
      { plan: 'pro', patterns: ['chatgpt pro', 'pro plan', 'pro subscriber'] },
      { plan: 'plus', patterns: ['chatgpt plus', 'plus plan', 'plus subscriber'] },
      { plan: 'team', patterns: ['chatgpt team', 'team plan', 'team workspace'] },
      { plan: 'enterprise', patterns: ['chatgpt enterprise', 'enterprise plan'] },
    ];

    // Check profile/settings area specifically
    const profileArea = document.querySelector('[class*="profile"], [class*="account"], [class*="settings"], [class*="user-menu"]');
    const profileText = profileArea?.textContent?.toLowerCase() || '';

    for (const { plan, patterns } of planIndicators) {
      for (const pattern of patterns) {
        if (profileText.includes(pattern)) {
          console.log(`[Context Window] Detected ${plan.toUpperCase()} tier from profile area`);
          return plan;
        }
      }
    }

    // Strategy 3: Check model selector - certain models indicate paid tiers
    const modelSelector = document.querySelector('[data-testid="model-switcher"], [class*="model-selector"], [class*="model-switcher"]');
    const modelText = modelSelector?.textContent?.toLowerCase() || '';

    // GPT-5.2 Pro, o3-pro typically indicate Pro tier
    if (modelText.includes('pro') || modelText.includes('o3')) {
      log(' Detected PRO tier (pro model available)');
      return 'pro';
    }

    // Strategy 4: No upgrade button found, assume paid (Plus as default paid tier)
    // This is a heuristic - paid users don't see upgrade prompts
    const hasNoUpgradeButton = !document.body?.innerText?.toLowerCase().includes('upgrade to');
    if (hasNoUpgradeButton) {
      // Check for any plan-specific UI elements before defaulting
      const navItems = document.querySelectorAll('nav a, [role="navigation"] a');
      for (const item of navItems) {
        const text = item.textContent?.toLowerCase() || '';
        if (text.includes('plus')) return 'plus';
        if (text.includes('pro')) return 'pro';
        if (text.includes('team')) return 'team';
      }
    }

    // Default: couldn't determine, return null
    log(' Could not determine ChatGPT plan level');
    return null;
  }

  // Detect Gemini plan level from UI
  // Returns: 'free', 'pro', 'ultra', or null if unknown
  function detectGeminiPlan() {
    if (platform !== 'gemini') return null;

    // Strategy 1: Check for premium model indicators first (more reliable)
    // If user can access Deep Think or 2.0 Flash, they're on a paid plan
    const pageText = document.body?.innerText?.toLowerCase() || '';

    // Check for Ultra tier indicators
    if (pageText.includes('ai ultra') || pageText.includes('gemini ultra subscription')) {
      log(' Detected Gemini ULTRA tier');
      return 'ultra';
    }

    // Check for Pro tier - look for "AI Pro", "Advanced", or access to premium features
    // "Google One AI Premium" is the actual subscription name
    if (pageText.includes('google one ai') || pageText.includes('ai premium')) {
      log(' Detected Gemini PRO tier (Google One AI)');
      return 'pro';
    }

    // Strategy 2: Check model selector for premium models
    // Free users only get limited access to Gemini 3 Pro, paid get full access
    const modelButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of modelButtons) {
      const text = btn.textContent?.toLowerCase() || '';
      // "Deep Think" and "2.0 Flash" in model selector usually means paid
      if (text.includes('deep think') || text.includes('2.5') || text.includes('flash')) {
        // But only if it's selectable (not grayed out)
        if (!btn.disabled && !btn.classList.contains('disabled')) {
          log(' Detected Gemini PRO tier (premium model available)');
          return 'pro';
        }
      }
    }

    // Strategy 3: Look for "Upgrade" prominently displayed - indicates free tier
    // Only check prominent upgrade buttons, not small links
    const upgradeButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of upgradeButtons) {
      const text = btn.textContent?.toLowerCase() || '';
      // Only if it's a primary upgrade CTA, not a small "try" link
      if ((text.includes('upgrade') || text === 'try pro' || text === 'get pro') && text.length < 30) {
        log(' Detected Gemini FREE tier (upgrade button found)');
        return 'free';
      }
    }

    // Strategy 4: If we got here and can use any Gemini, assume Pro (conservative for paid users)
    // Most Gemini users accessing the site are on some paid tier
    log(' Gemini plan unclear, assuming Pro');
    return 'pro';
  }

  // Get context limit based on platform and plan
  // Based on January 2026 research - limits vary significantly by plan
  function getContextLimitForPlan(detectedPlan) {
    if (platform === 'chatgpt') {
      // GPT-5.2 context limits by plan (January 2026)
      // Note: Actual limit depends on model variant (Instant/Thinking/Pro/Codex)
      // Using GPT-5.2 Instant as default since it's most common
      switch (detectedPlan) {
        case 'free': return 16000;       // GPT-5.2 Instant free tier
        case 'plus': return 32000;       // GPT-5.2 Instant Plus (up to 196K with Thinking, 400K with Codex)
        case 'pro': return 128000;       // GPT-5.2 Instant Pro (up to 2M with GPT-5.2 Pro model!)
        case 'team': return 128000;      // Team tier
        case 'enterprise': return 128000; // Enterprise (up to 2M with Pro model)
        default: return 16000;           // Conservative default (free tier)
      }
    } else if (platform === 'claude') {
      // Claude 4.5 context limits (January 2026)
      // Standard 200K, Enterprise Sonnet gets 500K
      switch (detectedPlan) {
        case 'free': return 200000;      // May be reduced during high demand
        case 'pro': return 200000;
        case 'team': return 200000;
        case 'enterprise': return 500000; // Enterprise Sonnet gets 500K
        default: return 200000;
      }
    } else if (platform === 'gemini') {
      // Gemini 3 context limits (January 2026)
      // Free: 32K, Paid: 1M (industry-leading for paid tiers)
      switch (detectedPlan) {
        case 'free': return 32000;       // Limited to 32K
        case 'pro': return 1000000;      // 1M tokens at $20/mo - best value!
        case 'ultra': return 1000000;    // 1M tokens
        default: return 32000;           // Conservative default (free tier)
      }
    }
    return 128000; // Fallback
  }

  // Detect model from page UI
  function detectModelFromUI() {
    let modelText = '';

    if (platform === 'chatgpt') {
      // Look for model selector or header - ChatGPT shows model name prominently
      // The model name like "ChatGPT 5.2 Instant" appears in multiple locations
      const selectors = [
        '[data-testid="model-switcher"]',
        '.model-switcher',
        'button[aria-haspopup="menu"]',
        // ChatGPT often shows model in header/title area
        '[class*="model"]',
        // Look for buttons/dropdowns containing GPT text
        'button'
      ];

      // First try specific selectors
      for (const sel of selectors) {
        try {
          const elements = document.querySelectorAll(sel);
          for (const el of elements) {
            const text = el.textContent?.trim() || '';
            // Look for text that contains ChatGPT/GPT and a version number
            if ((text.includes('ChatGPT') || text.includes('GPT-')) &&
                (text.includes('5.2') || text.includes('4o') || text.includes('4-') || text.includes('Mini'))) {
              // Extract just the model name part (before any newlines or extra content)
              const cleanText = text.split('\n')[0].trim();
              if (cleanText.length < 50) { // Sanity check - model names aren't that long
                modelText = cleanText;
                log(' Found ChatGPT model via selector:', sel, '->', modelText);
                break;
              }
            }
          }
          if (modelText) break;
        } catch (e) { /* skip invalid selector */ }
      }

      // Fallback: scan page text for model pattern
      if (!modelText) {
        const pageText = document.body?.innerText || '';
        // Look for "ChatGPT X.X Model" pattern at start of text (usually in header)
        const modelMatch = pageText.match(/ChatGPT\s+[\d.]+\s+(Instant|Pro|Thinking|Codex|Mini)/i);
        if (modelMatch) {
          modelText = modelMatch[0];
          log(' Found ChatGPT model via regex:', modelText);
        }
      }
    } else if (platform === 'claude') {
      // Look for model indicator
      const selectors = ['[class*="model"]', 'button:has([class*="model"])', '[data-testid="model-selector"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.toLowerCase().includes('claude') || el?.textContent?.toLowerCase().includes('opus') || el?.textContent?.toLowerCase().includes('sonnet')) {
          modelText = el.textContent;
          break;
        }
      }
    } else if (platform === 'gemini') {
      // Look for model indicator - but only accept text that looks like a Gemini model name
      const selectors = ['[class*="model"]', '.model-picker', 'button[aria-label*="model"]', '[class*="gemini"]'];
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          const text = el?.textContent?.trim() || '';
          // Only accept if it looks like a model name (contains Gemini, Pro, Flash, etc.)
          if (text && (text.includes('Gemini') || text.includes('Pro') || text.includes('Flash') || text.includes('Ultra'))) {
            modelText = text;
            break;
          }
        } catch (e) { /* skip invalid selector */ }
      }
    }

    // Return detected model or empty string (will use default platform name)
    return modelText.trim();
  }

  // Update token count from DOM observation (throttled)
  function updateFromDOM() {
    // Throttle updates to prevent performance issues
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_THROTTLE_MS) {
      return; // Skip this update, too soon
    }
    lastUpdateTime = now;

    const text = getConversationText();
    // System "OS Tax" - tools, MCPs, system prompts, connectors
    // Based on January 2026 research:
    // - ChatGPT: 2K-5K typical (system prompt + custom instructions + few tools)
    // - Claude: 60K typical (system prompt + MCP servers - single GitHub MCP = ~55K!)
    // - Gemini: 5K typical (system prompt + extensions)
    // Note: Claude overhead can be 100K+ with heavy MCP use
    const systemOverheads = { chatgpt: 5000, claude: 60000, gemini: 5000 };
    const systemOverhead = systemOverheads[platform] || 5000;

    // Detect plan level first (affects context limit significantly)
    if (!state.plan) {
      let detectedPlan = null;

      if (platform === 'chatgpt') {
        detectedPlan = detectChatGPTPlan();
      } else if (platform === 'gemini') {
        detectedPlan = detectGeminiPlan();
      }
      // Claude doesn't vary much by plan (200K for most, 500K Enterprise Sonnet)
      // We default to 200K which is correct for most users

      if (detectedPlan) {
        state.plan = detectedPlan;
        state.contextLimit = getContextLimitForPlan(detectedPlan);
        console.log(`[Context Window] ${platform} plan: ${detectedPlan}, context limit: ${state.contextLimit}`);
        updateOverlay();
      }
    }

    // Always check for model changes (user may switch models during conversation)
    const detectedModel = detectModelFromUI();
    if (detectedModel && detectedModel !== state.model) {
      log(' Model changed:', state.model, '->', detectedModel);
      state.model = detectedModel;

      // Recalculate context limit based on new model
      if (platform === 'claude') {
        state.contextLimit = 200000; // Claude is always 200K (500K for Enterprise Sonnet)
      } else if (platform === 'gemini') {
        // Gemini limits depend on plan, not model (32K free, 1M paid)
        // Plan detection handles this - don't override here
      }
      // For ChatGPT: model can significantly change limits, especially for Pro tier
      else if (platform === 'chatgpt') {
        const modelLower = detectedModel.toLowerCase();
        // GPT-5.2 Pro model on Pro tier = 2M context!
        if (state.plan === 'pro' && (modelLower.includes('pro') || modelLower.includes('5.2 pro'))) {
          state.contextLimit = 2000000; // 2M for GPT-5.2 Pro
          log(' Detected GPT-5.2 Pro on Pro tier: 2M context');
        }
        // Thinking model = 196K
        else if (modelLower.includes('thinking') || modelLower.includes('thought')) {
          state.contextLimit = 196000;
          log(' Detected Thinking model: 196K context');
        }
        // Codex = 400K
        else if (modelLower.includes('codex')) {
          state.contextLimit = 400000;
          log(' Detected Codex model: 400K context');
        }
        // Default: use plan-based limit for Instant or other models
        else {
          state.contextLimit = getContextLimitForPlan(state.plan);
          log(' Model changed to', detectedModel, ', context limit:', state.contextLimit);
        }
      }

      updateOverlay();
    }

    const estimatedTokens = estimateTokens(text);

    // Only show OS Tax if there's actual conversation content (tokens > 100)
    // This prevents showing 65K used on an empty chat
    if (estimatedTokens > 100) {
      const newTotal = estimatedTokens + systemOverhead;

      // Only update if this is a meaningful change
      if (newTotal > state.total || state.total === 0) {
        state.total = newTotal;
        state.segments.system = systemOverhead;
        state.segments.conversation = estimatedTokens;
        updateOverlay();
        log(' DOM estimate:', estimatedTokens, 'tokens + OS Tax:', systemOverhead);
      }
    } else if (state.total === 0) {
      // No conversation yet - show 0
      state.segments.system = 0;
      state.segments.conversation = 0;
      updateOverlay();
    }
  }

  // Parse API response text for token data
  function parseResponseForTokens(text, url) {
    if (!text || typeof text !== 'string') return null;

    let modelId = null;
    let usage = null;
    let hasThinking = false;

    try {
      const lines = text.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const data = JSON.parse(jsonStr);

          // Extract model ID
          if (data.model && !modelId) modelId = data.model;

          // Check for thinking/reasoning content
          if (data.delta?.thinking || data.delta?.reasoning_content) hasThinking = true;
          if (data.choices?.[0]?.delta?.reasoning_content) hasThinking = true;

          // Extract usage data based on platform
          if (platform === 'chatgpt' && data.usage) {
            usage = {
              inputTokens: data.usage.prompt_tokens || 0,
              outputTokens: data.usage.completion_tokens || 0,
              totalTokens: data.usage.total_tokens || 0
            };
          } else if (platform === 'claude' && data.usage) {
            usage = {
              inputTokens: data.usage.input_tokens || 0,
              outputTokens: data.usage.output_tokens || 0,
              totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
            };
          }
        } catch (e) { continue; }
      }
    } catch (error) {
      log('ERROR: Error parsing response:', error);
      return null;
    }

    return (modelId || usage) ? { modelId, usage, hasThinking } : null;
  }

  // Check if URL is relevant for token capture
  function isRelevantUrl(url) {
    if (platform === 'chatgpt') return url.includes('/conversation') || url.includes('/completions') || url.includes('/backend-api');
    if (platform === 'claude') return url.includes('/api/') || url.includes('chat_conversation') || url.includes('/messages');
    if (platform === 'gemini') return url.includes('batchexecute') || url.includes('/generate') || url.includes('streamGenerate');
    return false;
  }

  // Fetch interception - override window.fetch to capture API responses
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (!isRelevantUrl(url)) return response;

    log(' Intercepted relevant URL:', url);

    try {
      const clonedResponse = response.clone();
      clonedResponse.text().then(text => {
        log(' Response length:', text.length);
        const parsed = parseResponseForTokens(text, url);
        log(' Parsed data:', parsed);
        if (parsed) {
          chrome.runtime.sendMessage({
            type: 'TOKEN_DATA',
            modelId: parsed.modelId,
            inputTokens: parsed.usage?.inputTokens,
            outputTokens: parsed.usage?.outputTokens,
            totalTokens: parsed.usage?.totalTokens,
            hasThinking: parsed.hasThinking
          });
        }
      }).catch(err => {
        log(' Parse error:', err);
      });
    } catch (error) {
      log(' Fetch error:', error);
    }

    return response;
  };

  // EventSource interception for SSE streams
  const OriginalEventSource = window.EventSource;
  window.EventSource = function(url, config) {
    log(' EventSource URL:', url);
    const es = new OriginalEventSource(url, config);

    es.addEventListener('message', (event) => {
      if (event.data) {
        const parsed = parseResponseForTokens(event.data, url);
        if (parsed) {
          log(' EventSource parsed:', parsed);
          chrome.runtime.sendMessage({
            type: 'TOKEN_DATA',
            modelId: parsed.modelId,
            inputTokens: parsed.usage?.inputTokens,
            outputTokens: parsed.usage?.outputTokens,
            totalTokens: parsed.usage?.totalTokens,
            hasThinking: parsed.hasThinking
          });
        }
      }
    });

    return es;
  };
  window.EventSource.prototype = OriginalEventSource.prototype;
  window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
  window.EventSource.OPEN = OriginalEventSource.OPEN;
  window.EventSource.CLOSED = OriginalEventSource.CLOSED;

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CONTEXT_UPDATE') {
      const data = message.data;
      if (!data || typeof data !== 'object') {
        return;
      }
      // Only update model name if it's specific (not generic "Unknown")
      if (data.modelName && !data.modelName.includes('Unknown')) {
        state.model = data.modelName;
      }
      if (data.contextLimit) state.contextLimit = data.contextLimit;

      if (data.inputTokens !== undefined) {
        state.total = data.totalTokens || (data.inputTokens + (data.outputTokens || 0));
        // System overhead (Jan 2026): ChatGPT ~5K, Claude ~60K (MCP heavy), Gemini ~5K
        const systemOverheads = { chatgpt: 5000, claude: 60000, gemini: 5000 };
        const systemOverhead = systemOverheads[platform] || 5000;
        state.segments.system = state.total > 0 ? systemOverhead : 0;
        state.segments.conversation = Math.max(0, state.total - systemOverhead);
      }

      updateOverlay();
    }
    sendResponse({ received: true });
    return true;
  });

  // Reset state for new conversation
  function resetForNewChat() {
    state.total = 0;
    state.segments = { system: 0, tools: 0, thinking: 0, conversation: 0 };
    // Keep model and plan - they don't change
    updateOverlay();
    log(' Reset for new chat');
  }

  // Track URL for SPA navigation detection
  let lastUrl = window.location.href;

  // Check if URL changed (SPA navigation)
  function checkForNavigation() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      log(' URL changed:', lastUrl, '->', currentUrl);
      lastUrl = currentUrl;

      // Reset counter on navigation (new chat)
      resetForNewChat();
    }
  }

  // Initialize the content script
  function init() {
    overlayElement = createOverlay();
    updateOverlay();

    // Start DOM observation for token estimation
    updateFromDOM();

    // Set up MutationObserver to watch for conversation changes
    const observer = new MutationObserver(() => {
      updateFromDOM();
    });

    // Observe the main content area
    const targetNode = document.body;
    if (targetNode) {
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    // Also update periodically as a fallback (less frequent since MutationObserver handles most cases)
    setInterval(() => {
      checkForNavigation();  // Check for SPA navigation (new chat)
      updateFromDOM();
    }, 2000);  // Check every 2 seconds for navigation

    // Request initial state from background
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response?.success && response.state) {
        const data = response.state;
        // Only update model name if it's specific (not generic "Unknown")
      if (data.modelName && !data.modelName.includes('Unknown')) {
        state.model = data.modelName;
      }
        if (data.contextLimit) state.contextLimit = data.contextLimit;
        if (data.totalTokens) {
          state.total = data.totalTokens;
          // System overhead (Jan 2026): ChatGPT ~5K, Claude ~60K (MCP heavy), Gemini ~5K
          const systemOverheads = { chatgpt: 5000, claude: 60000, gemini: 5000 };
          const systemOverhead = systemOverheads[platform] || 5000;
          state.segments.system = systemOverhead;
          state.segments.conversation = Math.max(0, data.totalTokens - systemOverhead);
        }
        updateOverlay();
      }
    });
  }

  // Wait for DOM before creating overlay, but intercept fetch/EventSource immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  log(' Content script loaded for', platform);
  log(' Initial state:', JSON.stringify(state));
  log(' Default limit for platform:', defaultLimits[platform]);
})();

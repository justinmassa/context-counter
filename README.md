# Context Counter

**Built by [Remix Partners](https://remixpartners.ai)**

Website: [remixpartners.ai](https://remixpartners.ai)
Email: [info@remixpartners.ai](mailto:info@remixpartners.ai)

---

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL REMIX PARTNERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

This extension is provided free of charge for informational purposes only. Use at your own risk. We make no guarantees regarding accuracy, reliability, availability, or fitness for any particular purpose. Token counts are estimates and may not reflect actual API usage. Context window limits are subject to change by platform providers without notice.

---

## Privacy

**Your data stays in your browser.** This extension does not collect, transmit, or store any personal data, conversation content, or usage information. All processing happens locally in your browser. No data is sent to Remix Partners or any third party.

---

## What It Does

A Chrome extension that displays real-time context window usage for ChatGPT, Claude, and Gemini. See at a glance how much of your context window you've used in any conversation.

## Features

- **Real-time token tracking** - See your context window usage as you chat
- **Platform-adaptive theming** - Automatically matches ChatGPT (dark), Claude (light), and Gemini (dark) aesthetics
- **Visual progress bar** - Segmented display showing OS Tax, Tools, Thinking, and Conversation tokens
- **Hover tooltip** - Detailed breakdown of token usage by category
- **Warning indicators** - Visual alerts at 75% (warning) and 90% (critical) usage
- **Auto-reset** - Counter resets when starting a new conversation
- **Model detection** - Automatically detects model changes and adjusts context limits

## Context Window Limits (January 2026)

### ChatGPT (GPT-5.2)
| Plan | Instant | Thinking | Pro | Codex |
|------|---------|----------|-----|-------|
| Free | 16K | - | - | - |
| Plus ($20) | 32K | 196K | - | 400K |
| Pro ($200) | 128K | 196K | **2M** | 400K |

### Claude (4.5)
| Plan | All Models |
|------|------------|
| Free | 200K |
| Pro ($20) | 200K |
| Enterprise | 500K (Sonnet) |

### Gemini (3)
| Plan | All Models |
|------|------------|
| Free | 32K |
| Pro ($20) | **1M** |
| Ultra ($250) | **1M** |

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select the `context-window-extension` folder
6. Navigate to ChatGPT, Claude, or Gemini to see the overlay

## Usage

The overlay appears in the bottom-right corner of supported AI chat interfaces:

- **Main display**: Shows model name and current/max tokens
- **Progress bar**: Visual representation of context usage
- **Hover for details**: Shows breakdown by category (OS Tax, Tools, Thinking, Conversation)

### Token Categories

| Category | Description | Typical Size |
|----------|-------------|--------------|
| **OS Tax** | System prompts, MCPs, custom instructions | 5K-60K |
| **Tools** | Enabled plugins and extensions | Variable |
| **Thinking** | Chain-of-thought (Pro models) | Variable |
| **Conversation** | Your messages + AI responses | Growing |

## Support

For questions or feedback, contact us at [info@remixpartners.ai](mailto:info@remixpartners.ai).

---

*Copyright 2026 [Remix Partners](https://remixpartners.ai). All rights reserved.*

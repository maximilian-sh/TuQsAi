# TuQsAi

AI-powered Moodle quiz assistant. Works on TUWEL and other Moodle instances.

## Quick Setup

1. **Install Tampermonkey** browser extension (on iOS: Tampermonkey for Safari from the App Store)
2. **Install script**: Click "Raw" on `TuQsAi.user.js` → Install in Tampermonkey
3. **Get API key**: [Mistral console](https://console.mistral.ai/api-keys) (Le Chat Pro includes $15/month API credits)
4. **First use**: Open a quiz → Enter API key when prompted

## Usage

- **`S`** - Solve next question
- **`Q`** - Solve all questions (press again to stop)
- **`R`** - Redo last processed question
- **`Escape`** - Stop processing

### iPhone / iPad (Safari + Tampermonkey)

Same functions via touch gestures, nothing is shown on screen:

- **Two-finger tap on a question** - Solve that question (redo it if it is already answered)
- **Two-finger tap outside a question** - Solve next question
- **Two-finger double tap** - Solve all questions (do it again to stop)

Open the quiz in Safari (not the Moodle app). Without a console you only see the result: answers get selected. If nothing happens, you are probably rate-limited, so wait a bit and try again.

## Features

- Multiple choice, true/false, short answer, numerical, drag & drop
- Image support
- Rate limiting
- Silent operation (no UI clutter)
- Manual control only
- Redo functionality - reapply last question's solution

## Advanced: Model & Settings

Backend: Mistral Conversations API (`api.mistral.ai/v1/conversations`).

Default model: `mistral-large-4` (Mistral's flagship, GA, image input, 1M context, lowest hallucination rate of the options below).

**Tampermonkey menu:**

- `TuQsAi: Set Mistral API Key`
- `TuQsAi: Set Model` (leave empty to go back to the default)
- `TuQsAi: Toggle Web Search` (on by default)

**Web search**: The model gets Mistral's built-in `web_search` tool and decides per question whether to search (e.g. for specific facts, figures, recent information). Searches add ~5–10 s and extra cost (search results count as connector tokens, plus a per-call fee). Turn it off for pure calculation/logic quizzes. Searches are logged in the console (F12).

**Reasoning effort (optional)**: Tampermonkey → Storage → `mistral_reasoning_effort` = `low`, `medium` or `high`. Empty uses the model default.

### Models (via Mistral API)

Prices per 1M tokens (input / output), from the Mistral docs (last checked `2026-11-17`).

| Model | Model ID | Images | Web search | Price | Notes |
| --- | --- | --- | --- | --- | --- |
| Mistral Large 4 | `mistral-large-4` | Yes | Yes | $0.70 / $2.10 | Default. GA, rarely makes things up |
| DeepSeek V4.1 Flash | `deepseek-v4-1-flash-1017` | Yes | Built-in tools listed | $0.30 / $1.20 | Slightly more knowledge, faster, cheaper, but hallucinates much more often. Public preview |
| Mistral Medium 3.5 | `mistral-medium-latest` | Yes | Yes | — | Cheaper Mistral model |
| Z.ai GLM 5.3 | `zai-glm-5-3` | **No** | No | $1.40 / $4.40 | Strong reasoning, but text only: image questions will fail |

Old Gemini settings (`gemini_api_key`, `gemini_model`, `gemini_thinking_level`) are removed automatically on first run of 2.0.0.

## Troubleshooting

- **Rate limits (429)**: "Solve all" pauses automatically and continues. Limits depend on your Mistral workspace tier (console.mistral.ai → Limits).
- **"Invalid Mistral API key" (401)**: Set a new key via `TuQsAi: Set Mistral API Key`.
- **"credits exhausted" (402)**: Check billing / remaining credits in the Mistral console.
- **Server error (5xx)**: The script retries automatically with backoff.
- **"Model ... is not available"**: The stored model was retired or misspelled. Reset it via `TuQsAi: Set Model` (leave empty).
- **Not working**: Check console (F12) for errors
- **Other Moodle**: May work but not guaranteed

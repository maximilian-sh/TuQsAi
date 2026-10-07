# TuQsAi

AI-powered Moodle quiz assistant. Works on TUWEL and other Moodle instances.

## Quick Setup

1. **Install Tampermonkey** browser extension
2. **Install script**: Click "Raw" on `TuQsAi.user.js` → Install in Tampermonkey
3. **Get API key**: [Google AI Studio](https://aistudio.google.com/apikey) (free)
4. **First use**: Open a quiz → Enter API key when prompted

## Usage

- **`S`** - Solve next question
- **`Q`** - Solve all questions (press again to stop)
- **`R`** - Redo last processed question
- **`Escape`** - Stop processing

## Features

- Multiple choice, true/false, short answer, numerical, drag & drop
- Image support
- Rate limiting
- Silent operation (no UI clutter)
- Manual control only
- Redo functionality - reapply last question's solution

## Advanced: Change AI Model

Default: `gemini-3.8-flash` (stable, free tier available)

**To use a different model**: Tampermonkey menu → `TuQsAi: Set Model` (leave empty to go back to the default), or Tampermonkey → Storage → `gemini_model`.

- Recommended default: `gemini-3.8-flash` (newest Flash, best quality/speed/price, free tier)
- Cheaper / faster: `gemini-3.5-flash-lite` or `gemini-3.1-flash-lite`
- Highest reasoning quality on hard, knowledge-heavy questions: `gemini-3.1-pro-preview` (paid only, preview)
- Auto-follow the newest Flash: `gemini-flash-latest` (alias, can change without a script update)
- You can set any Gemini model name manually

Installs that still have an old default stored (e.g. `gemini-3-flash-preview`, `gemini-2.5-flash`) are switched to the new default automatically.

**Thinking level (optional)**: Tampermonkey → Storage → `gemini_thinking_level` = `low`, `medium` or `high`. Empty uses the model default (`medium` on Gemini 3.x Flash). `high` is more accurate on tricky questions but slower; `minimal` is not supported by `gemini-3.8-flash`.

### Model Availability (Free vs Paid)

Source: Gemini Developer API models and pricing pages (last checked `2026-10-07`). Prices are per 1M tokens (input / output) on the paid tier.

| Model | Model ID | Free Tier | Paid price | Status |
| --- | --- | --- | --- | --- |
| Gemini 3.8 Flash | `gemini-3.8-flash` | Yes | $0.75 / $3.75 | Stable (default) |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | Yes | $0.30 / $2.50 | Stable |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | Yes | $0.25 / $1.50 | Stable |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | No (paid only) | $2.00 / $12.00 | Preview |
| Gemini 3 Flash Preview | `gemini-3-flash-preview` | — | — | Deprecated, use `gemini-3.8-flash` |
| Gemini 2.5 (Flash / Pro) | `gemini-2.5-*` | — | — | Limited to legacy users |

## Troubleshooting

- **Rate limits**: Free limits vary by model and change over time. Check the Gemini pricing page.
- **"Model is currently overloaded" (503)**: The script retries automatically with backoff. If it keeps happening, try again later or switch to another model.
- **"Model ... is not available" (404)**: The stored model was retired or misspelled. Reset it via `TuQsAi: Set Model` (leave empty).
- **Not working**: Check console (F12) for errors
- **Other Moodle**: May work but not guaranteed

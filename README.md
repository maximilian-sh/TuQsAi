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

Default: `gemini-3-flash-preview`

**To use different models**: Tampermonkey → Storage → `gemini_model`

- Recommended default: `gemini-3-flash-preview` (free tier available, strong quality/speed)
- Cheaper option: `gemini-3.1-flash-lite-preview`
- Higher reasoning quality: `gemini-3.1-pro-preview` (paid only)
- You can set any Gemini model name manually

### Model Availability (Free vs Paid)

Source: Gemini Developer API pricing page (last updated `2026-03-03`).

Main multimodal Gemini models only (new generation):

| Model | Model ID | Free Tier | Status |
| --- | --- | --- | --- |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | No (paid only) | Current (preview) |
| Gemini 3.1 Flash-Lite Preview | `gemini-3.1-flash-lite-preview` | Yes | Current (preview) |
| Gemini 3 Flash Preview | `gemini-3-flash-preview` | Yes | Current (preview) |

## Troubleshooting

- **Rate limits**: Free limits vary by model and change over time. Check the Gemini pricing page.
- **Not working**: Check console (F12) for errors
- **Other Moodle**: May work but not guaranteed

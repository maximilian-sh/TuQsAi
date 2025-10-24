# TuQsAi

AI-powered Moodle quiz assistant. Works on TUWEL and other Moodle instances.

## Quick Setup

1. **Install Tampermonkey** browser extension
2. **Install script**: Click "Raw" on `TuQsAi.user.js` → Install in Tampermonkey
3. **Get API key**: [Google AI Studio](https://aistudio.google.com/apikey) (free)
4. **First use**: Open a quiz → Enter API key when prompted

## Usage

-   **`S`** - Solve next question
-   **`Q`** - Solve all questions (press again to stop)
-   **`R`** - Redo last processed question
-   **`Escape`** - Stop processing

## Features

-   Multiple choice, true/false, short answer, numerical, drag & drop
-   Image support
-   Rate limiting
-   Silent operation (no UI clutter)
-   Manual control only
-   Redo functionality - reapply last question's solution

## Advanced: Change AI Model

Default: `gemini-2.5-flash`

**To use different models**: Tampermonkey → Storage → `gemini_model`

-   `gemini-2.5-flash-lite` (faster, less accurate)
-   `gemini-2.5-pro` (slower, more accurate)
-   Any other Gemini model name

## Troubleshooting

-   **Rate limits**: Free tier = 10 requests/minute. Wait or upgrade.
-   **Not working**: Check console (F12) for errors
-   **Other Moodle**: May work but not guaranteed

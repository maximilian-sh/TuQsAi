# TuQsAi UserScript

This is a Tampermonkey UserScript designed to assist with quizzes on Moodle platforms (specifically tested on TUWEL, TU Wien's Moodle instance). It uses Google's free Gemini API to fetch suggestions for multiple-choice, true/false, short answer, numerical, and drag-and-drop onto text questions.

**Disclaimer:** This script is intended as an educational tool and assistant. Relying solely on its suggestions without understanding the material is discouraged. Accuracy depends heavily on the chosen LLM and the quality of the question/options provided. Use responsibly.

## Features

-   Fetches answer suggestions for Multiple Choice (single/multi-select), True/False, Short Answer, and Numerical questions.
-   Provides suggestions as hints for Drag-and-Drop onto Text (Cloze) questions.
-   Supports multimodal input (text and images in questions).
-   Configurable API Key and LLM Model.
-   Uses Google's free Gemini API for fast LLM inference.

## Installation

1.  **Install a UserScript Manager:** You need a browser extension to manage UserScripts. [Tampermonkey](https://www.tampermonkey.net/) is recommended (available for Chrome, Firefox, Edge, Safari, Opera).
2.  **Install the Script:**
    -   Navigate to the `TuQsAi.user.js` file in this repository on GitHub.
    -   Click the "Raw" button.
    -   Tampermonkey should automatically detect the UserScript and prompt you to install it. Click "Install".

## Configuration

1.  **Gemini API Key:**

    -   You need a **free** API key from [Google AI Studio](https://aistudio.google.com/apikey).
    -   The first time you open a Moodle quiz page (`attempt.php`) after installing the script, it will prompt you to enter your Gemini API Key.
    -   Paste your key and click "OK". The key will be stored securely by Tampermonkey for future use.
    -   If you need to change the key later, you can edit the script via the Tampermonkey dashboard, find the `gemini_api_key` in the "Storage" tab, and modify its value.

2.  **LLM Model (Optional):**
    -   The script defaults to using the `gemini-2.5-flash-preview-09-2025` model, which supports multimodal input (text and images).
    -   To change the model, open the Tampermonkey dashboard, find this script, go to the "Storage" tab, and look for the `gemini_model` key.
    -   If it doesn't exist, create a new entry with the name `gemini_model`.
    -   Set its value to any Gemini model available through the API (e.g., `gemini-2.0-flash`, `gemini-1.5-pro`). Make sure the model supports the features you need.

## Usage

Once installed and configured, the script will automatically run when you are on a Moodle quiz attempt page (`.../mod/quiz/attempt.php?...`).

-   For multiple-choice, true/false, short answer, or numerical questions, a status box will appear below the question text indicating it's fetching suggestions. Once received, it will display the suggested answer and automatically select/fill the corresponding option(s) or input field.
-   For drag-and-drop onto text questions, it will display the LLM's suggested word/phrase pairings as hints next to each drop zone. It will _not_ automatically fill them in.
-   The script supports questions with images - it will automatically extract and send images to the Gemini API for multimodal analysis.
-   The script status (fetching, success, error) and the chosen model name will be logged in the browser's developer console (F12).

## Contributing / Issues

Feel free to open issues or pull requests on the GitHub repository if you encounter bugs or have suggestions for improvements. Remember to update the `@homepageURL` in the script metadata if you fork or host it elsewhere.

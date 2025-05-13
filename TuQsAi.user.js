// ==UserScript==
// @name         TuQsAi
// @version      0.3
// @description  Uses the Gemini API (via an OpenAI-compatible endpoint) to suggest answers for Moodle (Tuwel) quizzes.
// @author       maximilian
// @copyright    2025 maximilian, Adapted from Jakob Kinne's script
// @require      http://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js
// @require      https://raw.githubusercontent.com/blueimp/JavaScript-MD5/refs/heads/master/js/md5.min.js
// @match        https://tuwel.tuwien.ac.at/mod/quiz/view.php*
// @match        https://tuwel.tuwien.ac.at/mod/quiz/attempt.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tuwel.tuwien.ac.at
// @homepageURL  https://github.com/maximilian-sh/TuQsAi
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      generativelanguage.googleapis.com
// ==/UserScript==

(function () {
    'use strict';

    // --- Configuration Keys (for GM_getValue/GM_setValue) ---
    const GEMINI_API_KEY = 'gemini_api_key';
    const GEMINI_MODEL = 'gemini_model';
    const DEFAULT_MODEL = 'gemini-2.5-flash-preview-04-17';
    const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

    // --- Get Configuration --- 
    let llmApiKey = GM_getValue(GEMINI_API_KEY, null);
    let llmModel = GM_getValue(GEMINI_MODEL, DEFAULT_MODEL);

    // --- Constants ---
    const STATES = {
        viewQuiz: "viewQuiz",
        answerQuiz: "answerQuiz"
    };

    const HREF = new URL(window.location.toString());
    const STATE = (HREF.pathname.includes("view.php")) ? STATES.viewQuiz : STATES.answerQuiz;

    const QUESTION_TYPES = {
        multiplechoice: "multichoice",        // Single or multiple correct answers (radio/checkbox)
        truefalse: "truefalse",                // True/false (radio)
        ddwtos: "ddwtos"                    // Drag and drop words onto text
        // Add other types here if the LLM should handle them and logic is implemented
        // multiplechoiceset: "multichoiceset", // Usually same as multichoice
        // select: "match",
        // multianswer: "multianswer",
        // dragndropimage: "ddimageortext",
        // dragndroptext: "ddwtos",
        // shortanswer: "shortanswer",
    };

    // Only handle types we have implemented logic for
    const AVAILABLE_TYPES = [
        QUESTION_TYPES.truefalse,
        QUESTION_TYPES.multiplechoice,
        QUESTION_TYPES.ddwtos // Add new type here
    ];

    // --- Global Variables ---
    let question_type = getQuestionType();
    let question_text = $(".qtext")?.text()?.trim();
    let answer_options = getAnswerOptions(); // Holds { id: string, text: string } for each option

    // --- Functions ---

    function getQuestionType() {
        let question = $(".que");
        if (!question.length) return null;

        for (const type of Object.values(QUESTION_TYPES)) {
            if (question.hasClass(type)) {
                return type;
            }
        }
        console.warn("TuQS LLM: Unknown question type.");
        return null;
    }

    function isQuestionAnswerable() {
        return AVAILABLE_TYPES.includes(question_type);
    }

    // Extracts answer options { id: unique hash, text: display text }
    function getAnswerOptions() {
        const options = [];
        const answerElements = $(".answer > div"); // Common structure for choices

        if (!answerElements.length) return options;

        answerElements.each(function () {
            let textElement, inputElement;
            let text = '';

            // Find input (radio/checkbox) and text label/container
            inputElement = $(this).find("input[type='radio'], input[type='checkbox']");

            // ---- UPDATED SELECTOR LOGIC based on example.html ----
            // Prioritize the specific structure found: <div class="flex-fill ms-1">
            textElement = $(this).find("div.flex-fill.ms-1");

            // Fallback to previous attempts if the primary selector fails
            if (!textElement.length) {
                textElement = $(this).find(".ml-1, label"); // Original fallback
            }
            if (!textElement.length) {
                textElement = $(this).find("div.flex-grow-1"); // Another original fallback
            }
             if (!textElement.length) {
                 // Final fallback: check the direct label (for very simple true/false?)
                 textElement = $(this).find("label");
             }
            // ---- END UPDATED SELECTOR LOGIC ----

            text = textElement.first().text()?.trim();

            if (inputElement.length && text) {
                const id = md5(text + inputElement.attr('name') + inputElement.attr('value')); // Create a unique enough ID
                 options.push({
                     id: id, // Using md5 hash of text as a simple ID
                     text: text,
                     inputElement: inputElement // Store the jQuery object for the input
                 });
            } else {
                 console.warn("TuQS LLM: Could not extract input or text for an answer option:", $(this).html());
            }
        });
         console.log("TuQS LLM: Extracted Options:", options);
        return options;
    }

    // Extracts data for drag-and-drop onto text questions
    function getDragDropTextData() {
        const questionElement = $(".que.ddwtos");
        if (!questionElement.length) return null;

        const questionText = questionElement.find(".qtext").text()?.trim();
        const dropZones = [];
        const draggableOptions = [];

        // Find drop zones (spans with class like place1, place2)
        questionElement.find("span.drop.active[class*='place']").each(function() {
            const classes = $(this).attr('class').split(' ');
            const placeClass = classes.find(cls => cls.startsWith('place'));
            if (placeClass) {
                const id = placeClass.replace('place', ''); // Extract number
                dropZones.push({ id: id, element: $(this) });
            }
        });

        // Find draggable options (unplaced items)
        questionElement.find("span.draghome.unplaced").each(function() {
             // Filter out placeholder elements if they exist
             if(!$(this).hasClass('dragplaceholder')){
                 const text = $(this).text()?.trim();
                 if (text) {
                     draggableOptions.push(text);
                 }
             }
        });

        console.log("TuQS LLM (DDWTOS): Extracted Drop Zones:", dropZones.map(z => z.id));
        console.log("TuQS LLM (DDWTOS): Extracted Draggable Options:", draggableOptions);

        if (dropZones.length === 0 || draggableOptions.length === 0) {
            console.error("TuQS LLM (DDWTOS): Could not extract sufficient drop zones or draggable options.");
            return null;
        }

        return {
            questionText: questionText,
            dropZones: dropZones, // Array of { id: string, element: jQueryObject }
            draggableOptions: draggableOptions // Array of strings
        };
    }

    // Function to send data to LLM and get suggestions
    async function getLlmSuggestions(question, options) {
        return new Promise((resolve, reject) => {
            if (!question || options.length === 0) {
                return reject("Missing question or options for LLM.");
            }
            if (!llmApiKey) {
                 llmApiKey = prompt("Gemini API Key not found. Please enter your Gemini API key:");
                 if (llmApiKey && llmApiKey.trim()) {
                      GM_setValue(GEMINI_API_KEY, llmApiKey.trim());
                      console.log("TuQS LLM: Gemini API Key saved.");
                 } else {
                     alert("No API Key provided. Script cannot get suggestions.");
                     return reject("API Key not configured.");
                 }
            }

            const optionsText = options.map((opt, index) => `${index + 1}. ${opt.text}`).join('\n');
            // V2 Prompt: Emphasize single choice unless multiple are clearly required.
            const llmPrompt = `Given the following multiple-choice question from an online quiz, please identify the NUMBER of the correct answer(s).\n\nQuestion:\n${question}\n\nAvailable Options:\n${optionsText}\n\nConsider the context of a university course quiz. Respond ONLY with the number(s) corresponding to the correct option(s) from the list above.\n*   If it is likely a single-choice question, provide ONLY the single best answer number.\n*   If it is clearly a multiple-choice/select-all-that-apply question, list each correct number on a new line.\n\nDo not include the option text, introductory phrases like "The correct answer is:", or any explanations. \n**IMPORTANT: Do NOT include any reasoning, chain-of-thought, or XML/HTML tags (like <think>) in your response.** Just the raw number(s).`;

            console.log("TuQsAi: Sending prompt to LLM (asking for number):\n", llmPrompt);

            // --- GM_xmlhttpRequest Configuration ---
            GM_xmlhttpRequest({
                method: "POST",
                url: GEMINI_API_ENDPOINT, // Use constant endpoint
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${llmApiKey}` // Use stored/prompted key
                },
                data: JSON.stringify({
                    messages: [
                       { role: "system", content: "You are an AI assistant helping a student with a multiple-choice quiz. Provide only the exact text of the correct answer(s) based on the options given in the user prompt. Copy the text character-for-character." },
                       { role: "user", content: llmPrompt } // Use renamed variable
                    ],
                     model: llmModel, // Use stored/default model
                    // max_tokens: 150, // Optional: Groq might have defaults
                     temperature: 0.1, // Keep low for factual answers
                    // stop: ["\n\n"] // Optional stop sequences
                    // --- End of LLM API specific payload ---
                }),
                timeout: 60000, // 60 seconds timeout (increased from 30)
                onload: function (response) {
                    try {
                        console.log("TuQS LLM: Raw LLM response:", response.responseText);
                        const responseData = JSON.parse(response.responseText);

                        // --- Adjust response parsing based on your LLM API's output structure ---
                        // Example for OpenAI-compatible API like Groq:
                        let rawCompletion = '';
                        if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message) {
                           rawCompletion = responseData.choices[0].message.content;
                        } else {
                             // Add fallbacks or checks for other possible Groq response structures if necessary
                             console.error("TuQS LLM: LLM response format unexpected:", responseData);
                             throw new Error("LLM response format unexpected. Check Gemini API documentation.");
                         }
                        // --- End of LLM API specific parsing ---

                        if (!rawCompletion) {
                            throw new Error("LLM response format unexpected or empty completion.");
                        }

                        // Remove <think> blocks before parsing
                        let cleanedCompletion = rawCompletion.replace(/<think>.*?<\/think>/gs, '').trim();

                        // Parse response for option indices
                        const numOptions = options.length;
                        const finalSuggestions = cleanedCompletion.split('\n')
                            .map(s => {
                                // Clean string: trim, remove trailing dots/junk
                                const cleaned = s.trim().replace(/[.,;:!?]$/, '').trim();
                                // Try to parse the beginning as an integer
                                const potentialIndexNum = parseInt(cleaned, 10);
                                // Validate: Is it a number and within the valid range of option indices?
                                if (!isNaN(potentialIndexNum) && potentialIndexNum >= 1 && potentialIndexNum <= numOptions) {
                                    return potentialIndexNum.toString();
                                }
                                return null; // Invalid index
                            })
                            .filter(s => s !== null); // Remove nulls (invalid indices)

                        if (finalSuggestions.length === 0 && cleanedCompletion) {
                            // Log only if the cleaned response wasn't empty but yielded no valid numbers
                            console.warn("TuQS LLM: LLM response did not yield a valid option index:", cleanedCompletion);
                        }

                        console.log("TuQS LLM: Parsed suggested answer number(s):", finalSuggestions);

                        resolve(finalSuggestions); // Resolve with the cleaned array of suggested number strings

                    } catch (error) {
                        console.error("TuQS LLM: Error parsing LLM response:", error);
                        console.error("TuQS LLM: Raw response text for debugging:", response.responseText);
                        reject("Failed to parse LLM response: " + error.message);
                    }
                },
                onerror: function (error) {
                    console.error("TuQS LLM: LLM request error:", error);
                    reject("LLM request failed: " + JSON.stringify(error));
                },
                ontimeout: function () {
                    console.error("TuQS LLM: LLM request timed out.");
                    reject("LLM request timed out.");
                }
            });
        });
    }

    // Function to send data to LLM for cloze/drag-drop questions
    async function getLlmClozeSuggestions(question, dropZoneIds, draggableOptions) {
        return new Promise((resolve, reject) => {
            if (!question || dropZoneIds.length === 0 || draggableOptions.length === 0) {
                return reject("Missing question, drop zones, or options for LLM cloze request.");
            }
            if (!llmApiKey) {
                 // Check if API key was set via prompt in a previous call within the same page load
                 llmApiKey = GM_getValue(GEMINI_API_KEY, null);
                 if (!llmApiKey) {
                     // If still null, prompt again (should be rare unless first prompt was cancelled)
                     llmApiKey = prompt("Gemini API Key not found. Please enter your Gemini API key:");
                     if (llmApiKey && llmApiKey.trim()) {
                         GM_setValue(GEMINI_API_KEY, llmApiKey.trim());
                         console.log("TuQS LLM: Gemini API Key saved.");
                     } else {
                         alert("No API Key provided. Script cannot get suggestions.");
                         return reject("API Key not configured.");
                     }
                 }
            }

            const optionsList = draggableOptions.map(opt => `- "${opt}"`).join('\n');
            const placeholders = dropZoneIds.map(id => `Placeholder ${id}`).join(', ');

            // --- Specific Prompt for Cloze/DDWTOS --- 
            const llmPrompt = `The following is a question with placeholders (e.g., "Placeholder 1", "Placeholder 2") that need to be filled using items from a list of draggable options.\n\nQuestion Context & Placeholders:\n${question}\n(Identify where "Placeholder 1", "Placeholder 2", etc. fit in the above text/code)\n\nAvailable Draggable Options:\n${optionsList}\n\nYour task is to determine which draggable option fits best into each placeholder. Respond ONLY with a valid JSON object mapping each placeholder ID (as a string key, e.g., "1", "2") to the exact text of the draggable option that should go there (as a string value).\n\nExample Response Format:\n{\n  "1": "SELECT",\n  "2": "x.speciality",\n  "3": "COUNT(*)"\n  ...\n}\n\nDo not include any other text, explanations, or markdown formatting outside the JSON object.`;

            console.log("TuQsAi (Cloze): Sending prompt:\n", llmPrompt);

            GM_xmlhttpRequest({
                method: "POST",
                url: GEMINI_API_ENDPOINT,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${llmApiKey}` // Use stored/prompted key
                },
                data: JSON.stringify({
                    messages: [
                       // Note: System message might need adjustment for this task type
                       { role: "system", content: "You are an AI assistant helping fill in blanks in a quiz question. Respond only with the requested JSON object mapping placeholders to the provided options." },
                       { role: "user", content: llmPrompt } // Use renamed variable
                    ],
                    model: llmModel, // Use stored/default model
                    temperature: 0.2, // Slightly higher temp might help with matching tasks
                    // IMPORTANT: Request JSON output if the API supports it!
                    response_format: { "type": "json_object" }, // Uncomment/adjust if your LLM API supports forced JSON output
                }),
                timeout: 45000, // Increased timeout for potentially more complex task
                onload: function (response) {
                    try {
                        console.log("TuQS LLM (Cloze): Raw LLM response:", response.responseText);
                        
                        // 1. Parse the outer Groq API response
                        const apiResponse = JSON.parse(response.responseText);

                        // 2. Extract the nested content string
                        let contentString = apiResponse?.choices?.[0]?.message?.content;
                        if (!contentString || typeof contentString !== 'string') {
                           throw new Error("Could not find valid LLM message content in API response.");
                        }

                        // 3. Clean potential markdown wrappers from the content string
                        contentString = contentString.trim();
                        const jsonMatch = contentString.match(/```json\n(\{.*?\})\n```/s);
                        if (jsonMatch && jsonMatch[1]) {
                            contentString = jsonMatch[1];
                        }

                        // 4. Parse the content string as the final JSON suggestion map
                        const responseData = JSON.parse(contentString); // Expecting { "1": "text", "2": "text", ... }
                        
                        // Basic validation: Check if it's an object
                        if (typeof responseData !== 'object' || responseData === null) {
                           throw new Error("LLM response was not a valid JSON object.");
                        }

                        console.log("TuQS LLM (Cloze): Parsed suggestions:", responseData);
                        resolve(responseData); // Resolve with the mapping object

                    } catch (error) {
                        console.error("TuQS LLM (Cloze): Error parsing LLM JSON response:", error);
                        console.error("TuQS LLM (Cloze): Raw response text for debugging:", response.responseText);
                        reject("Failed to parse LLM JSON response: " + error.message);
                    }
                },
                onerror: function (error) {
                    console.error("TuQS LLM (Cloze): LLM request error:", error);
                    reject("LLM request failed: " + JSON.stringify(error));
                },
                ontimeout: function () {
                    console.error("TuQS LLM (Cloze): LLM request timed out.");
                    reject("LLM request timed out.");
                }
             });
        });
    }




     // --- Question Type Handlers ---

     // Helper function to normalize text for comparison (lowercase, collapse whitespace)
     function normalizeTextForComparison(text) {
         if (typeof text !== 'string') return '';
         // Replace various whitespace chars (including non-breaking space \u00A0) with regular space, then collapse multiple spaces, then trim.
         return text.toLowerCase().replace(/[\s\u00A0]+/g, ' ').trim();
     }

     // Helper function to extract EN text or full text
     function extractAndNormalizeText(element) {
         const rawText = element.text();
         if (typeof rawText !== 'string') {
             return { full: '', english: null, german: null };
         }

         // --- ADDED: Strip leading markers (e.g., "a.", "1.") from page option text --- 
         const cleanedRawText = rawText.trim().replace(/^\s*(([0-9]+|[a-zA-Z])[.)]|[-*])\s*/, '').trim();

         const normalizedFullText = normalizeTextForComparison(cleanedRawText);
         let normalizedEnglishText = null;
         let normalizedGermanText = null;
         const lowerCleanedRawText = cleanedRawText.toLowerCase(); // Use cleaned text for finding markers too

         const enMarker = 'en:';
         const deMarker = 'de:';
         const enIndex = lowerCleanedRawText.indexOf(enMarker);
         const deIndex = lowerCleanedRawText.indexOf(deMarker);

         if (enIndex !== -1) {
              const englishPart = cleanedRawText.substring(enIndex + enMarker.length);
              normalizedEnglishText = normalizeTextForComparison(englishPart);
         }

         if (deIndex !== -1) {
             // Extract German part: starts after "de:", ends before "en:" if it exists, or at the end.
             const germanPartEnd = (enIndex !== -1 && enIndex > deIndex) ? enIndex : cleanedRawText.length;
             const germanPart = cleanedRawText.substring(deIndex + deMarker.length, germanPartEnd);
             normalizedGermanText = normalizeTextForComparison(germanPart);
         }

         // If only one language marker exists, assume the full text IS that language if not otherwise specified
         if (normalizedEnglishText && !normalizedGermanText && deIndex === -1) {
             normalizedGermanText = null; // Explicitly null if only EN found
         }
         if (normalizedGermanText && !normalizedEnglishText && enIndex === -1) {
             normalizedEnglishText = null; // Explicitly null if only DE found
         }

         // Fallback: If NO language markers found, the full text is used for all checks
         // (This is handled implicitly as english/german parts remain null if markers aren't found)

         return { full: normalizedFullText, english: normalizedEnglishText, german: normalizedGermanText };
     }


    class BaseQuestionHandler {
        constructor(options) {
            // this.answerElements = $(".answer > div"); // No longer needed if options have elements
            this.options = options; // Now stores { id, text, inputElement }
        }

        // Default implementation (should be overridden)
        selectAnswers(suggestedIdentifiers) {
            console.warn("TuQS LLM: selectAnswers not implemented for this question type.");
        }
    }


    class truefalse extends BaseQuestionHandler {
        selectAnswers(suggestedIdentifiers) {
            if (!suggestedIdentifiers || suggestedIdentifiers.length === 0) {
                console.log("TuQS LLM: No suggestions provided for true/false.");
                return;
            }
            const targetIdentifier = suggestedIdentifiers[0]; // Use the first suggestion
            // console.log(`TuQS LLM (True/False): Target identifier: "${targetIdentifier}"`); // Redundant

            this.options.forEach((option, index) => {
                const input = option.inputElement;
                if (!input || !input.length) return; // Skip if no input element

                const currentIdentifier = (index + 1).toString();
                // console.log(`TuQS LLM (True/False): Comparing target "${targetIdentifier}" with option index+1 "${currentIdentifier}"`); // Too verbose

                if (currentIdentifier === targetIdentifier) {
                    input.prop("checked", true);
                    console.log(`TuQS LLM (True/False): Selecting option #${currentIdentifier}`);
                } else {
                    input.prop("checked", false);
                }
            });
        }
    }

    class multichoice extends BaseQuestionHandler {
         selectAnswers(targetIdentifiers) {
             // console.log(`TuQS LLM (MultiChoice): Target identifiers:`, targetIdentifiers); // Redundant with Parsed log

             // Handle Single-Choice (Radio) Constraint
             const firstInput = this.options.length > 0 ? this.options[0].inputElement : null;
             const isRadio = firstInput ? firstInput.is(':radio') : false;
             let effectiveTargetIdentifiers = targetIdentifiers;

             if (isRadio && targetIdentifiers && targetIdentifiers.length > 1) {
                 console.warn(`TuQS LLM (MultiChoice): Multiple suggestions for radio question. Using only first: ${targetIdentifiers[0]}`);
                 effectiveTargetIdentifiers = [targetIdentifiers[0]];
             }

             if (!Array.isArray(effectiveTargetIdentifiers)) {
                 effectiveTargetIdentifiers = [];
             }

             let selectedOptions = []; // Keep track of selections for logging

             this.options.forEach((option, index) => {
                 const input = option.inputElement;
                 if (!input || !input.length) return; // Skip if no input element

                 const currentIdentifier = (index + 1).toString();
                 // console.log(`TuQS LLM (MultiChoice): Comparing targets with option index+1 "${currentIdentifier}"`); // Too verbose

                 const isMatch = effectiveTargetIdentifiers.includes(currentIdentifier);

                 if (isMatch) {
                     input.prop("checked", true);
                     selectedOptions.push(currentIdentifier);
                     // console.log(`TuQS LLM (MultiChoice): Selecting option with index+1 "${currentIdentifier}"`); // Logged collectively below
                 } else {
                     if (input.is(':checkbox')) {
                         // Optionally uncheck non-suggested checkboxes
                         // input.prop("checked", false);
                     }
                 }
             });

             if (selectedOptions.length > 0) {
                 console.log(`TuQS LLM (MultiChoice): Selected option(s) #${selectedOptions.join(', #')}`);
             } else {
                 console.log("TuQS LLM (MultiChoice): No suggested options were selected.");
             }
         }
     }

    // --- NEW Handler for Drag-Drop Onto Text ---
    class ddwtos {
        constructor(data) {
            this.questionText = data.questionText;
            this.dropZones = data.dropZones; // Array of { id: string, element: jQueryObject }
            this.draggableOptions = data.draggableOptions;
            this.statusDiv = $("#llm-status"); // Assume status div exists
        }

        async displaySuggestions() {
            try {
                this.statusDiv.html("<i>Asking LLM for cloze suggestions...</i>");
                const dropZoneIds = this.dropZones.map(z => z.id);
                const suggestions = await getLlmClozeSuggestions(this.questionText, dropZoneIds, this.draggableOptions);
                // suggestions should be like { "1": "text", "2": "text", ... }

                let suggestionsHtml = '<i>LLM Suggestions:</i><ul style="margin: 0; padding-left: 20px; font-size: 0.9em;">';
                let suggestionsApplied = 0;

                this.dropZones.forEach(zone => {
                    const suggestedText = suggestions[zone.id];
                    if (suggestedText) {
                        suggestionsApplied++;
                        suggestionsHtml += `<li>Placeholder ${zone.id}: <b>${suggestedText}</b></li>`;
                        
                        // Create and append the suggestion hint near the drop zone
                        const hint = $('<div class="llm-suggestion-hint"></div>')
                            .css({
                                fontSize: '0.8em',
                                color: '#006400', // Dark green
                                border: '1px dashed #006400',
                                padding: '1px 3px',
                                marginTop: '2px',
                                display: 'inline-block',
                                marginLeft: '5px' // Add some space
                            })
                            .html(`Suggest: <b>${suggestedText}</b>`);
                        zone.element.after(hint); // Place the hint after the drop zone span
                    }
                });
                suggestionsHtml += '</ul>';

                if (suggestionsApplied > 0) {
                    this.statusDiv.html(suggestionsHtml);
                    this.statusDiv.css({ borderColor: "#28a745", backgroundColor: "#e9f7ec" });
                } else {
                    this.statusDiv.html("<i>LLM did not provide valid suggestions for placeholders.</i>");
                    this.statusDiv.css({ borderColor: "#ffc107", backgroundColor: "#fff8e1" }); // Warning color
                }

            } catch (error) {
                console.error("TuQS LLM (DDWTOS): Error getting or displaying suggestions:", error);
                this.statusDiv.html(`<i>Error getting cloze suggestions: ${error}</i>`);
                this.statusDiv.css({ borderColor: "#dc3545", backgroundColor: "#f8d7da" });
            }
        }
    }
    // --- END DDWTOS Handler ---

    // --- Main Execution Logic ---

    async function handleQuizPage() {
        console.log("TuQSLLM: Handling quiz attempt page.");

        // --- Check if question type is supported --- 
        if (!isQuestionAnswerable()) {
            console.log("TuQSLLM: Question type not supported or not found:", question_type);
            return;
        }

        // --- Check if basic question text was found --- 
        if (!question_text) { // Check only question_text initially
            console.error("TuQSLLM: Could not extract question text (.qtext).");
            return;
        }

        // Create a placeholder for status/results - Do this early
        let statusDiv = document.createElement("div");
        statusDiv.id = "llm-status";
        statusDiv.style.marginTop = "10px";
        statusDiv.style.padding = "8px";
        statusDiv.style.border = "1px solid #ddd";
        statusDiv.style.backgroundColor = "#f9f9f9";
        statusDiv.style.fontSize = "small";
        statusDiv.innerHTML = "<i>Asking LLM for suggestions...</i>";
        // Try to insert after the question text container
        $(".formulation.clearfix").after(statusDiv);


        try {
             console.log("TuQSLLM: Requesting LLM suggestions for:", question_text.substring(0, 100) + "...");

             // --- Logic modification: Handle different question types ---
             if (question_type === QUESTION_TYPES.ddwtos) {
                 // Handle drag-and-drop onto text (display suggestions)
                 const ddData = getDragDropTextData();
                 if (ddData) {
                     const controller = new ddwtos(ddData);
                     await controller.displaySuggestions(); // Call the new method
                 } else {
                      statusDiv.innerHTML = `<i>Error: Could not extract data for drag-and-drop question.</i>`;
                      statusDiv.style.borderColor = "#dc3545";
                      statusDiv.style.backgroundColor = "#f8d7da";
                 }
             } else if ([QUESTION_TYPES.truefalse, QUESTION_TYPES.multiplechoice].includes(question_type)) {
                 // --- Add check for standard answer options HERE --- 
                 if (answer_options.length === 0) {
                     console.error("TuQSLLM: Could not extract standard answer options for this question type.");
                     statusDiv.innerHTML = `<i>Error: Could not find answer options.</i>`;
                     statusDiv.style.borderColor = "#dc3545";
                     statusDiv.style.backgroundColor = "#f8d7da";
                     return; 
                 }
                 // --- End check ---

                 // Handle standard multiple choice / true/false (select answer)
                 const suggestedNumbers = await getLlmSuggestions(question_text, answer_options); // Renamed variable
                 console.log("TuQSLLM: Received suggested number(s):", suggestedNumbers);

                 // --- V3: Display TEXT in status, not numbers --- 
                 let suggestionText = 'None';
                 let effectiveNumbers = suggestedNumbers; // Default to original suggestions

                 // Determine effective numbers *before* generating text (respecting radio constraint)
                 const firstInput = answer_options.length > 0 ? answer_options[0].inputElement : null;
                 const isRadio = firstInput ? firstInput.is(':radio') : false;
                 if (isRadio && question_type === QUESTION_TYPES.multiplechoice && suggestedNumbers && suggestedNumbers.length > 1) {
                    effectiveNumbers = [suggestedNumbers[0]]; // Use only first for display if radio + multi-suggest
                 }

                 if (effectiveNumbers && effectiveNumbers.length > 0) {
                     suggestionText = effectiveNumbers.map(numStr => {
                         const index = parseInt(numStr, 10) - 1; // Convert to 0-based index
                         if (index >= 0 && index < answer_options.length) {
                             // Truncate long text for display
                             const fullText = answer_options[index].text;
                             return `"${fullText.length > 70 ? fullText.substring(0, 67) + '...' : fullText}"`;
                         } else {
                             return `(Invalid option number: ${numStr})`;
                         }
                     }).join('<br>'); // Display each suggestion on a new line if multiple are effective
                 }
                 
                 statusDiv.innerHTML = `<i>LLM suggested selecting:</i><br><b>${suggestionText}</b>`;
                 statusDiv.style.borderColor = "#28a745"; // Green border for success
                 statusDiv.style.backgroundColor = "#e9f7ec";
                 // --- End V3 Status Text ---

                 // Dynamically create the correct handler instance based on question type
                 let controller;
                 // const HandlerClass = window[question_type]; // Access class by string name (ensure classes are globally accessible or refactor)

                 if (question_type === QUESTION_TYPES.truefalse) {
                      controller = new truefalse(answer_options);
                 } else if (question_type === QUESTION_TYPES.multiplechoice) {
                      controller = new multichoice(answer_options);
                 }
                 // Add other types here if needed:
                 // else if (question_type === QUESTION_TYPES.select) { controller = new select(answer_options); }

                 if (controller && typeof controller.selectAnswers === 'function') {
                    controller.selectAnswers(suggestedNumbers); // Pass original numbers to handler
                } else {
                     console.error("TuQSLLM: No valid controller/handler found for type:", question_type);
                     statusDiv.innerHTML = `<i>Error: Could not find handler for question type '${question_type}'. Cannot select answers.</i>`;
                     statusDiv.style.borderColor = "#dc3545"; // Red border for error
                     statusDiv.style.backgroundColor = "#f8d7da";
                 }
            } else {
                 // Handle unsupported but detected types gracefully
                 statusDiv.innerHTML = `<i>Question type '${question_type}' is recognized but not automatically handled by this script.</i>`;
                 statusDiv.style.borderColor = "#ffc107"; // Warning color
                 statusDiv.style.backgroundColor = "#fff8e1";
             }
             // --- End Logic modification ---

        } catch (error) {
            console.error("TuQSLLM: Failed to get or apply LLM suggestions:", error);
            statusDiv.innerHTML = `<i>Error processing LLM suggestion: ${error}</i>`;
            statusDiv.style.borderColor = "#dc3545"; // Red border for error
            statusDiv.style.backgroundColor = "#f8d7da";

        }
    }

    // --- Script Entry Point ---

    // Using $(document).ready ensures jQuery is loaded and basic DOM is ready
    $(document).ready(function () {
        console.log("TuQsAi Script Loaded. Version 0.4. State:", STATE);
        console.log(`TuQsAi: Using Model: ${llmModel}`);

        // Configuration Check
        if (!GM_getValue(GEMINI_API_KEY, null)) {
            console.warn("TuQsAi: Gemini API Key not set. Will prompt on first use.");
        }

        if (STATE === STATES.answerQuiz) {
            // Use a slightly longer delay for dynamic content loading
            setTimeout(handleQuizPage, 750); // 750ms delay
        } else if (STATE === STATES.viewQuiz) {
            console.log("TuQsAi: On quiz view page. No actions taken.");
        }
    });

})(); 
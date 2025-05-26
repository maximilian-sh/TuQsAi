// ==UserScript==
// @name         TuQsAi
// @version      0.5
// @description  Solve Moodle (Tuwel) quizzes with ai.
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

// Wrap entire script in an async IIFE to use await at the top level
(async function () {
    'use strict';

    // --- Configuration Keys (for GM_getValue/GM_setValue) ---
    const CONFIG_API_KEY = 'gemini_api_key'; // Standardized key
    const CONFIG_MODEL = 'gemini_model';   // Standardized key
    const DEFAULT_MODEL = 'gemini-2.5-flash-preview-05-20'; // Model supporting multimodal
    const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

    // --- Get Configuration ---
    let llmApiKey = GM_getValue(CONFIG_API_KEY, null);
    let llmModel = GM_getValue(CONFIG_MODEL, DEFAULT_MODEL);

    // --- Constants ---
    const STATES = {
        viewQuiz: "viewQuiz",
        answerQuiz: "answerQuiz"
    };

    const HREF = new URL(window.location.toString());
    const STATE = (HREF.pathname.includes("view.php")) ? STATES.viewQuiz : STATES.answerQuiz;

    const QUESTION_TYPES = {
        multiplechoice: "multichoice",
        truefalse: "truefalse",
        ddwtos: "ddwtos"
    };

    const AVAILABLE_TYPES = [
        QUESTION_TYPES.truefalse,
        QUESTION_TYPES.multiplechoice,
        QUESTION_TYPES.ddwtos
    ];

    // --- Helper Functions for Image Processing ---
    function getImageMimeType(url) {
        if (typeof url !== 'string') return 'application/octet-stream';
        const extension = url.substring(url.lastIndexOf('.') + 1).toLowerCase();
        switch (extension) {
            case 'png': return 'image/png';
            case 'jpg':
            case 'jpeg': return 'image/jpeg';
            case 'gif': return 'image/gif';
            case 'webp': return 'image/webp';
            default: return 'application/octet-stream'; // Fallback
        }
    }

    async function fetchImageAsBase64(imageUrl) {
        return new Promise((resolve, reject) => {
            if (!imageUrl) {
                return reject(new Error('Image URL is null or empty.'));
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: imageUrl,
                responseType: 'blob',
                onload: function(response) {
                    if (response.status === 200 && response.response) {
                        const blob = response.response;
                        const reader = new FileReader();
                        reader.onloadend = function() {
                            const base64data = reader.result.split(',')[1];
                            resolve({
                                mimeType: blob.type && blob.type !== 'application/octet-stream' ? blob.type : getImageMimeType(imageUrl),
                                data: base64data
                            });
                        };
                        reader.onerror = function(e) {
                            console.error('FileReader error for image:', imageUrl, e);
                            reject(new Error('FileReader error for image: ' + imageUrl));
                        };
                        reader.readAsDataURL(blob);
                    } else {
                        console.error(`Failed to fetch image ${imageUrl}: Status ${response.status}`, response);
                        reject(new Error(`Failed to fetch image ${imageUrl}: ${response.statusText || response.status}`));
                    }
                },
                onerror: function(error) {
                    console.error(`GM_xmlhttpRequest error for image ${imageUrl}:`, error);
                    reject(new Error(`GM_xmlhttpRequest error for image ${imageUrl}`));
                },
                ontimeout: function() {
                    console.error(`Timeout fetching image ${imageUrl}`);
                    reject(new Error(`Timeout fetching image ${imageUrl}`));
                }
            });
        });
    }


    // --- Functions ---

    function getQuestionType() {
        let question = $(".que");
        if (!question.length) return null;
        for (const type of Object.values(QUESTION_TYPES)) {
            if (question.hasClass(type)) return type;
        }
        console.warn("TuQS LLM: Unknown question type.");
        return null;
    }

    function isQuestionAnswerable() {
        return AVAILABLE_TYPES.includes(question_type);
    }

    // Extracts question text and fetches image data from the question body
    async function getQuestionData() {
        const qtextElement = $(".qtext").first();
        if (!qtextElement.length) return { textForPrompt: "", imagesData: [] };

        // For text, clone the element, remove images, then get text to avoid alt text duplication
        const qtextCloneForText = qtextElement.clone();
        qtextCloneForText.find('img').remove(); // Remove images before getting text
        const textForPrompt = qtextCloneForText.text()?.trim() || "";

        const imagesData = [];
        const imageElements = qtextElement.find('img');

        for (const imgEl of imageElements.get()) {
            const $img = $(imgEl);
            const imageUrl = $img.attr('src');
            if (imageUrl) {
                try {
                    const absoluteImageUrl = new URL(imageUrl, window.location.href).href;
                    const imageData = await fetchImageAsBase64(absoluteImageUrl);
                    if (imageData) imagesData.push(imageData);
                } catch (e) {
                    console.warn(`TuQS LLM: Failed to fetch question image data for ${imageUrl}:`, e.message);
                }
            }
        }
        // console.log("TuQS LLM: Extracted Question Data - Text:", textForPrompt, "Images found:", imagesData.length);
        return { textForPrompt, imagesData };
    }


    // Extracts answer options { id, text, inputElement, imageData? }
    async function getAnswerOptions() {
        const options = [];
        const answerElements = $(".answer > div");

        if (!answerElements.length) return options;

        for (const element of answerElements.get()) {
            const $this = $(element);
            let textElement, inputElement;
            let text = '';
            let imageData = null;

            inputElement = $this.find("input[type='radio'], input[type='checkbox']");
            textElement = $this.find("div.flex-fill.ms-1");
            if (!textElement.length) textElement = $this.find(".ml-1, label");
            if (!textElement.length) textElement = $this.find("div.flex-grow-1");
            if (!textElement.length) textElement = $this.find("label");

            const imgElement = textElement.find("img").first();
            if (imgElement.length) {
                const imageUrl = imgElement.attr('src');
                text = imgElement.attr('alt')?.trim() || (imageUrl ? `[Image Option (src: ${imageUrl.substring(0,30)+'...'})]` : "[Image Option]");

                if (imageUrl) {
                    try {
                        const absoluteImageUrl = new URL(imageUrl, window.location.href).href;
                        imageData = await fetchImageAsBase64(absoluteImageUrl);
                    } catch (e) {
                        console.warn(`TuQS LLM: Failed to fetch answer image data for ${imageUrl}:`, e.message);
                    }
                }
            } else {
                text = textElement.first().text()?.trim();
            }

            if (inputElement.length && text) {
                const id = md5(text + inputElement.attr('name') + inputElement.attr('value'));
                options.push({
                    id: id,
                    text: text,
                    inputElement: inputElement,
                    imageData: imageData
                });
            } else {
                console.warn("TuQS LLM: Could not extract input or meaningful text/image for an answer option:", $this.html());
            }
        }
        // console.log("TuQS LLM: Extracted Options (with image data if available):", options.map(o => ({text: o.text, hasImage: !!o.imageData}));
        return options;
    }

    // Extracts data for drag-and-drop onto text questions (remains unchanged for now)
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

    // Function to send data to LLM and get suggestions (MULTIMODAL)
    async function getLlmSuggestions(questionTextForPrompt, questionImagesData, optionsWithImageData) {
        return new Promise((resolve, reject) => {
            if (!questionTextForPrompt && (!questionImagesData || questionImagesData.length === 0)) {
                return reject("Missing question text and images for LLM.");
            }
            if (!optionsWithImageData || optionsWithImageData.length === 0) {
                return reject("Missing options for LLM.");
            }

            if (!llmApiKey) {
                 llmApiKey = prompt("Gemini API Key not found. Please enter your Google AI Studio API key:");
                 if (llmApiKey && llmApiKey.trim()) {
                      GM_setValue(CONFIG_API_KEY, llmApiKey.trim());
                      console.log("TuQS LLM: Gemini API Key saved.");
                 } else {
                     alert("No API Key provided. Script cannot get suggestions.");
                     return reject("API Key not configured.");
                 }
            }

            const llmParts = [];
            const systemInstructionText = "You are an AI assistant helping a student with a multiple-choice quiz. Images may be provided for the question or options. Provide only the number(s) of the correct answer(s) based on the text and images given. Consider all provided information.";

            // Part 1: Question Text
            if (questionTextForPrompt) {
                llmParts.push({ text: `Question:\n${questionTextForPrompt}\n\n` });
            }

            // Part 2: Question Images
            if (questionImagesData && questionImagesData.length > 0) {
                questionImagesData.forEach((imgData, idx) => {
                    if (imgData && imgData.mimeType && imgData.data) {
                        // llmParts.push({ text: `[Context for Question Image ${idx + 1} follows]\n` });
                        llmParts.push({ inlineData: { mimeType: imgData.mimeType, data: imgData.data } });
                    }
                });
            }
            llmParts.push({ text: "\nAvailable Options:\n" });

            // Part 3 & 4: Options text and images
            optionsWithImageData.forEach((opt, index) => {
                llmParts.push({ text: `${index + 1}. ${opt.text}\n` });
                if (opt.imageData && opt.imageData.mimeType && opt.imageData.data) {
                    // llmParts.push({ text: `[Context for Option ${index + 1} Image follows]\n` });
                    llmParts.push({ inlineData: { mimeType: opt.imageData.mimeType, data: opt.imageData.data } });
                }
            });

            llmParts.push({ text: `\nConsider the context of a university course quiz. Respond ONLY with the number(s) corresponding to the correct option(s) from the list above.\n*   If it is likely a single-choice question, provide ONLY the single best answer number.\n*   If it is clearly a multiple-choice/select-all-that-apply question, list each correct number on a new line.\n\nDo not include the option text, introductory phrases like "The correct answer is:", or any explanations. \n**IMPORTANT: Do NOT include any reasoning, chain-of-thought, or XML/HTML tags (like <think>) in your response.** Just the raw number(s).` });

            const apiUrl = `${GEMINI_API_BASE_URL}${llmModel}:generateContent?key=${llmApiKey}`;

            // console.log("TuQsAi: Sending multimodal prompt to Gemini. Number of parts:", llmParts.length);
            // For brevity, log only text parts or image placeholders
            // console.log("TuQsAi: Prompt Parts Overview:", llmParts.map(p => p.text ? {text: p.text.substring(0,100) + "..."} : {inlineData: `(${p.inlineData.mimeType})`}));


            GM_xmlhttpRequest({
                method: "POST",
                url: apiUrl,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({
                    contents: [{ role: "user", parts: llmParts }],
                    systemInstruction: { parts: [{ text: systemInstructionText }] },
                    generationConfig: {
                        temperature: 0.1,
                        // maxOutputTokens: 50, // Optional
                    }
                }),
                timeout: 60000, // Increased timeout for potentially larger payloads
                onload: function (response) {
                    try {
                        // console.log("TuQS LLM: Raw Gemini response:", response.responseText);
                        const responseData = JSON.parse(response.responseText);

                        let rawCompletion = '';
                        if (responseData.candidates && responseData.candidates.length > 0 &&
                            responseData.candidates[0].content && responseData.candidates[0].content.parts &&
                            responseData.candidates[0].content.parts.length > 0 && responseData.candidates[0].content.parts[0].text) {
                           rawCompletion = responseData.candidates[0].content.parts[0].text;
                        } else if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
                            const blockReason = responseData.promptFeedback.blockReason;
                            const safetyRatings = responseData.promptFeedback.safetyRatings || [];
                            let blockDetails = `Block reason: ${blockReason}.`;
                            if (safetyRatings.length > 0) {
                                blockDetails += ` Safety ratings: ${safetyRatings.map(r => `${r.category} - ${r.probability}`).join(', ')}`;
                            }
                            console.error("TuQS LLM: Prompt blocked by Gemini.", blockDetails, "Full feedback:", responseData.promptFeedback);
                            throw new Error(`LLM prompt blocked: ${blockReason}. Check console for details.`);
                        } else {
                             console.error("TuQS LLM: Gemini response format unexpected:", responseData);
                             throw new Error("Gemini response format unexpected. Check API documentation or raw response.");
                         }

                        if (!rawCompletion && !(responseData.promptFeedback && responseData.promptFeedback.blockReason)) {
                            throw new Error("LLM response format unexpected or empty completion, and not blocked.");
                        }

                        let cleanedCompletion = rawCompletion.replace(/<think>.*?<\/think>/gs, '').trim();
                        console.log("TuQS LLM: Cleaned completion from LLM:", cleanedCompletion); // Log the direct text from LLM

                        const numOptions = optionsWithImageData.length;
                        const finalSuggestions = cleanedCompletion.split(/\r\n|\r|\n/) // Use regex to split by any common newline
                            .map(s => {
                                const cleaned = s.trim().replace(/[.,;:!?]$/, '').trim();
                                const potentialIndexNum = parseInt(cleaned, 10);
                                if (!isNaN(potentialIndexNum) && potentialIndexNum >= 1 && potentialIndexNum <= numOptions) {
                                    return potentialIndexNum.toString();
                                }
                                return null;
                            })
                            .filter(s => s !== null);

                        if (finalSuggestions.length === 0 && cleanedCompletion) {
                            console.warn("TuQS LLM: Gemini response did not yield a valid option index from:", cleanedCompletion);
                        }

                        // console.log("TuQS LLM: Parsed suggested answer number(s):", finalSuggestions);
                        resolve(finalSuggestions);

                    } catch (error) {
                        console.error("TuQS LLM: Error parsing Gemini response:", error);
                        console.error("TuQS LLM: Raw response text for debugging:", response.responseText);
                        reject("Failed to parse Gemini response: " + error.message);
                    }
                },
                onerror: function (error) {
                    console.error("TuQS LLM: Gemini request error:", error);
                    reject("Gemini request failed: " + JSON.stringify(error));
                },
                ontimeout: function () {
                    console.error("TuQS LLM: Gemini request timed out.");
                    reject("Gemini request timed out.");
                }
            });
        });
    }

    // Function to send data to LLM for cloze/drag-drop questions
    // NOTE: This function has NOT been updated for multimodal input.
    // If ddwtos questions can contain images that need to be sent to the LLM,
    // this function will require similar modifications to fetch images and adjust the API call.
    async function getLlmClozeSuggestions(question, dropZoneIds, draggableOptions) {
        return new Promise((resolve, reject) => {
            if (!question || dropZoneIds.length === 0 || draggableOptions.length === 0) {
                return reject("Missing question, drop zones, or options for LLM cloze request.");
            }
            if (!llmApiKey) {
                 llmApiKey = GM_getValue(CONFIG_API_KEY, null); // Corrected constant
                 if (!llmApiKey) {
                     llmApiKey = prompt("Gemini API Key not found. Please enter your Google AI Studio API key:");
                     if (llmApiKey && llmApiKey.trim()) {
                         GM_setValue(CONFIG_API_KEY, llmApiKey.trim()); // Corrected constant
                         console.log("TuQS LLM: Gemini API Key saved.");
                     } else {
                         alert("No API Key provided. Script cannot get suggestions for drag & drop.");
                         return reject("API Key not configured for drag & drop.");
                     }
                 }
            }
            // Ensure llmModel is available
            if (!llmModel) {
                llmModel = GM_getValue(CONFIG_MODEL, DEFAULT_MODEL);
            }

            const optionsList = draggableOptions.map(opt => `- "${opt}"`).join('\\n');
            const systemInstructionText = "You are an AI assistant helping fill in blanks in a quiz question. Respond ONLY with the requested JSON object mapping placeholders to the provided options.";
            const llmPrompt = `The following is a question with placeholders (e.g., "Placeholder 1", "Placeholder 2") that need to be filled using items from a list of draggable options.\\n\\nQuestion Context & Placeholders:\\n${question}\\n(Identify where "Placeholder 1", "Placeholder 2", etc. fit in the above text/code based on the dropZoneIds: ${dropZoneIds.join(', ')})\\n\\nAvailable Draggable Options:\\n${optionsList}\\n\\nYour task is to determine which draggable option fits best into each placeholder. Respond ONLY with a valid JSON object mapping each placeholder ID (as a string key, e.g., "1", "2") to the exact text of the draggable option that should go there (as a string value).\\n\\nExample Response Format:\\n{\\n  "1": "SELECT",\\n  "2": "x.speciality",\\n  "3": "COUNT(*)"\\n  ...\\n}\\n\\nDo not include any other text, explanations, or markdown formatting outside the JSON object. The JSON should be the only content in your response.`;

            // console.log("TuQsAi (Cloze): Sending prompt to Gemini:\\n", llmPrompt);
            const apiUrl = `${GEMINI_API_BASE_URL}${llmModel}:generateContent?key=${llmApiKey}`;

            GM_xmlhttpRequest({
                method: "POST",
                url: apiUrl, // Corrected API URL
                headers: {
                    "Content-Type": "application/json",
                },
                data: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: llmPrompt }] }],
                    systemInstruction: { parts: [{ text: systemInstructionText }] },
                    generationConfig: {
                        temperature: 0.1,
                    }
                }),
                timeout: 60000,
                onload: function (response) {
                    try {
                        // console.log("TuQS LLM (Cloze): Raw Gemini response:", response.responseText);
                        const responseData = JSON.parse(response.responseText);

                        let rawCompletion = '';
                        if (responseData.candidates && responseData.candidates.length > 0 &&
                            responseData.candidates[0].content && responseData.candidates[0].content.parts &&
                            responseData.candidates[0].content.parts.length > 0 && responseData.candidates[0].content.parts[0].text) {
                           rawCompletion = responseData.candidates[0].content.parts[0].text;
                        } else if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
                            const blockReason = responseData.promptFeedback.blockReason;
                            const safetyRatings = responseData.promptFeedback.safetyRatings || [];
                            let blockDetails = `Block reason: ${blockReason}.`;
                            if (safetyRatings.length > 0) {
                                blockDetails += ` Safety ratings: ${safetyRatings.map(r => `${r.category} - ${r.probability}`).join(', ')}`;
                            }
                            console.error("TuQS LLM (Cloze): Prompt blocked by Gemini.", blockDetails, "Full feedback:", responseData.promptFeedback);
                            throw new Error(`LLM cloze prompt blocked: ${blockReason}. Check console for details.`);
                        } else {
                             console.error("TuQS LLM (Cloze): Gemini response format unexpected:", responseData);
                             throw new Error("Gemini cloze response format unexpected. Check API or raw response.");
                         }

                        if (!rawCompletion && !(responseData.promptFeedback && responseData.promptFeedback.blockReason)) {
                            throw new Error("LLM cloze response format unexpected or empty completion, and not blocked.");
                        }
                        
                        let jsonString = rawCompletion.trim();
                        const jsonMatch = jsonString.match(/```json\\n(\{[\s\S]*?\})\\n```/s);
                        if (jsonMatch && jsonMatch[1]) {
                            jsonString = jsonMatch[1];
                        } else {
                            const firstBrace = jsonString.indexOf('{');
                            const lastBrace = jsonString.lastIndexOf('}');
                            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                                jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                            }
                        }
                        
                        const suggestionsMap = JSON.parse(jsonString);

                        if (typeof suggestionsMap !== 'object' || suggestionsMap === null) {
                           throw new Error("LLM cloze response was not a valid JSON object after cleaning.");
                        }

                        // console.log("TuQS LLM (Cloze): Parsed suggestions map:", suggestionsMap);
                        resolve(suggestionsMap);

                    } catch (error) {
                        console.error("TuQS LLM (Cloze): Error parsing Gemini JSON response:", error);
                        console.error("TuQS LLM (Cloze): Raw response text for debugging:", response.responseText);
                        reject("Failed to parse Gemini JSON response for cloze: " + error.message);
                    }
                },
                onerror: function (error) {
                    console.error("TuQS LLM (Cloze): LLM request error:", error);
                    reject("Gemini cloze request failed: " + JSON.stringify(error));
                },
                ontimeout: function () {
                    console.error("TuQS LLM (Cloze): LLM request timed out.");
                    reject("Gemini cloze request timed out.");
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
            this.options = options; // Now stores { id, text, inputElement, imageData? }
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
    window.truefalse = truefalse; // Assign class to window

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
    window.multichoice = multichoice; // Assign class to window object

    // --- NEW Handler for Drag-Drop Onto Text ---
    class ddwtos {
        constructor(data) {
            this.questionText = data.questionText;
            this.dropZones = data.dropZones; // Array of { id: string, element: jQueryObject }
            this.draggableOptions = data.draggableOptions;
            // this.statusDiv removed
        }

        async displaySuggestions(suggestions) { // Takes suggestions as argument
            if (!suggestions || Object.keys(suggestions).length === 0) {
                displayStatus("<i>LLM did not provide valid suggestions for placeholders or the response was empty.</i>", "warning");
                return;
            }

            let suggestionsHtml = '<i>LLM Suggestions (Drag & Drop):</i><ul style="margin: 0; padding-left: 20px; font-size: 0.9em;">';
            let suggestionsAppliedCount = 0;

            this.dropZones.forEach(zone => {
                const suggestedText = suggestions[zone.id];
                if (suggestedText) {
                    suggestionsAppliedCount++;
                    suggestionsHtml += `<li>Placeholder ${zone.id}: <b>${suggestedText}</b></li>`;
                    
                    // Remove any pre-existing hint for this zone to avoid duplicates
                    zone.element.next('.llm-suggestion-hint').remove();

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

            if (suggestionsAppliedCount > 0) {
                displayStatus(suggestionsHtml, "success");
            } else {
                displayStatus("<i>LLM provided suggestions, but none matched the current placeholders.</i>", "warning");
            }
        }
    }
    window.ddwtos = ddwtos; // Assign class to window object
    // --- END DDWTOS Handler ---

    // --- UI Functions (Placeholder - adapt to your existing UI logic) ---
    function displayStatus(message, type = "info") {
        let statusDiv = $('#llm-status');
        const questionBlock = $('.que').first();
        let contentBlock; // Declare here to check its existence later

        if (questionBlock.length) {
            contentBlock = questionBlock.find('.content').first();
        }

        if (!statusDiv.length) {
            if (contentBlock && contentBlock.length) {
                statusDiv = $('<div id="llm-status"></div>');
                contentBlock.append(statusDiv); // Append inside the .content block

                statusDiv.css({
                    'width': '100%', // Takes full width of the parent .content's content area
                    'margin-top': '15px',      // Space from elements above it within .content
                    'margin-bottom': '10px',   // Space below the status message within .content
                    'padding': '10px',
                    'border': '1px solid #ccc',
                    'background-color': '#f0f0f0',
                    'box-sizing': 'border-box' // Padding and border included in 100% width
                });
            } else if (questionBlock.length) {
                // Fallback: if .content not found, append to .que (less ideal for specific width)
                statusDiv = $('<div id="llm-status"></div>');
                questionBlock.append(statusDiv);
                console.warn("TuQS LLM: '.content' div not found within '.que'. Status div appended to '.que'. Width might not match '.content' precisely.");
                statusDiv.css({
                    'width': '100%', // Full width of .que's content area
                    'margin-top': '15px',
                    'margin-bottom': '0',
                    'padding': '10px',
                    'border': '1px solid #ccc',
                    'background-color': '#f0f0f0',
                    'box-sizing': 'border-box'
                });
            } else {
                // Ultimate Fallback: append to body
                statusDiv = $('<div id="llm-status"></div>').appendTo('body');
                statusDiv.css({
                    'margin-top': '15px',
                    'padding': '10px',
                    'border': '1px solid #ccc',
                    'background-color': '#f0f0f0'
                });
            }
        }

        // Determine text color based on type - background and border are fixed now
        let textColor = 'black'; // Default for info
        switch (type) {
            case "error":
                textColor = 'red';
                break;
            case "success":
                textColor = 'green';
                break;
            case "warning":
                textColor = 'orange';
                break;
            // No need for info/default case as textColor is already black
        }

        // Update content with the determined text color
        statusDiv.html(`<span style="color: ${textColor};">${message}</span>`);
        console.log(`TuQS LLM Status (${type}): ${message}`);
    }


    // --- Global Variables Initialization (within async function) ---
    let question_type = getQuestionType();
    let questionDataGlobal = { textForPrompt: "", imagesData: [] };
    let answer_options_data_global = [];

    if (STATE === STATES.answerQuiz && isQuestionAnswerable()) {
        displayStatus("<i>Extracting question and answer data...</i>", "info");
        try {
            questionDataGlobal = await getQuestionData();
            answer_options_data_global = await getAnswerOptions();
            // console.log("TuQS LLM: Successfully fetched question and answer data.");
        } catch (e) {
            console.error("TuQS LLM: Error during initial data extraction:", e);
            displayStatus(`<i>Error extracting page data: ${e.message}</i>`, "error");
        }
    }


    // --- Main Script Logic ---
    $(document).ready(async function () { // Ensure DOM is ready, though script is at end.
        console.log("TuQsAi Script Loaded. Version 0.5. State:", STATE);
        if (llmModel) console.log("TuQsAi: Using Model:", llmModel);


        if (STATE === STATES.answerQuiz) {
            console.log("TuQSLLM: Handling quiz attempt page.");

            if (isQuestionAnswerable()) {
                if ((questionDataGlobal.textForPrompt || (questionDataGlobal.imagesData && questionDataGlobal.imagesData.length > 0)) && answer_options_data_global.length > 0) {
                    displayStatus("<i>Getting suggestions from LLM...</i>", "info");
                    try {
                        const suggestions = await getLlmSuggestions(questionDataGlobal.textForPrompt, questionDataGlobal.imagesData, answer_options_data_global);
                        if (suggestions && suggestions.length > 0) {
                            displayStatus(`LLM suggests option(s): ${suggestions.join(', ')}`, "success");
                            // Ensure the correct class (truefalse or multichoice) is instantiated
                            if (window[question_type]) {
                                const handler = new window[question_type](answer_options_data_global);
                                handler.selectAnswers(suggestions);
                            } else {
                                console.error(`TuQS LLM: No handler found for question type: ${question_type}`);
                                displayStatus(`<i>Error: No handler for question type ${question_type}</i>`, "error");
                            }
                        } else {
                            displayStatus("LLM did not provide a suggestion or it was invalid.", "warning");
                        }
                    } catch (error) {
                        console.error("TuQSLLM: Error getting LLM suggestions:", error);
                        displayStatus(`<i>Error from LLM: ${error.message || error}</i>`, "error");
                    }
                } else {
                    displayStatus("<i>Error: Could not extract sufficient question or answer data. Cannot contact LLM.</i>", "error");
                    console.error("TuQSLLM: Missing question text/images or answer options for LLM.");
                }
            } else if (question_type === QUESTION_TYPES.ddwtos) {
                // DDWTOS Logic
                const ddwtosData = getDragDropTextData();
                if (ddwtosData) {
                    displayStatus("<i>Getting suggestions for drag & drop...</i>", "info");
                    try {
                        const clozeSuggestions = await getLlmClozeSuggestions(
                            ddwtosData.questionText,
                            ddwtosData.dropZones.map(dz => dz.id),
                            ddwtosData.draggableOptions
                        );
                        
                        const handler = new window.ddwtos(ddwtosData);
                        await handler.displaySuggestions(clozeSuggestions); 
                        // Status messages are now handled within displaySuggestions

                    } catch (error) {
                        console.error("TuQSLLM: Error in DDWTOS suggestion process:", error);
                        displayStatus(`<i>Error (drag & drop): ${error.message || error}</i>`, "error");
                    }
                } else {
                    displayStatus("<i>Error: Could not extract drag & drop data.</i>", "error");
                }

            } else {
                console.log("TuQSLLM: Question type not supported or no question found on this page.");
                // Optionally display a status if no actionable question is found
                // displayStatus("<i>No answerable question type found on this page.</i>", "info");
            }
        } else if (STATE === STATES.viewQuiz) {
            console.log("TuQSLLM: On quiz view page. No actions taken for suggestions.");
            // Potentially add features for the viewQuiz page here later
        }
    });

})().catch(e => console.error("TuQS LLM: Critical error in main async execution:", e));

// Ensure GM_setValue uses the correct constant if used elsewhere.
// Ensure `displayStatus` function is robust or uses your existing UI logic.
// The classes `truefalse`, `multichoice`, `ddwtos` should be defined in your script.
// If `ddwtos` handler or its methods like `displaySuggestions` are not defined,
// those parts will cause errors.
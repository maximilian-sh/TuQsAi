// ==UserScript==
// @name         TuQsAi
// @version      1.2
// @description  Solve Moodle quizzes with AI (originally for TUWEL, supports other Moodle instances).
// @author       maximilian
// @copyright    2025 maximilian, Adapted from Jakob Kinne's script
// @require      http://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js
// @require      https://raw.githubusercontent.com/blueimp/JavaScript-MD5/refs/heads/master/js/md5.min.js
// @match        https://tuwel.tuwien.ac.at/mod/quiz/view.php*
// @match        https://tuwel.tuwien.ac.at/mod/quiz/attempt.php*
// @match        https://*/mod/quiz/view.php*
// @match        https://*/mod/quiz/attempt.php*
// @match        http://*/mod/quiz/view.php*
// @match        http://*/mod/quiz/attempt.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tuwel.tuwien.ac.at
// @homepageURL  https://github.com/maximilian-sh/TuQsAi
// @downloadURL  https://raw.githubusercontent.com/maximilian-sh/TuQsAi/main/TuQsAi.user.js
// @updateURL    https://raw.githubusercontent.com/maximilian-sh/TuQsAi/main/TuQsAi.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      generativelanguage.googleapis.com
// ==/UserScript==

(async function () {
    "use strict";

    const CONFIG_API_KEY = "gemini_api_key";
    const CONFIG_MODEL = "gemini_model";
    const DEFAULT_MODEL = "gemini-2.5-flash";
    const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

    let llmApiKey = GM_getValue(CONFIG_API_KEY, null);
    let llmModel = GM_getValue(CONFIG_MODEL, null);

    if (!llmModel) {
        llmModel = DEFAULT_MODEL;
        GM_setValue(CONFIG_MODEL, DEFAULT_MODEL);
    }
    const STATES = {
        viewQuiz: "viewQuiz",
        answerQuiz: "answerQuiz",
    };

    const HREF = new URL(window.location.toString());
    const STATE = HREF.pathname.includes("view.php") ? STATES.viewQuiz : STATES.answerQuiz;

    const isTUWEL = HREF.hostname.includes("tuwel.tuwien.ac.at");
    const isMoodle = HREF.pathname.includes("/mod/quiz/");
    const MOODLE_INSTANCE = isTUWEL ? "TUWEL" : isMoodle ? "Moodle" : "Unknown";

    const QUESTION_TYPES = {
        multiplechoice: "multichoice",
        multichoiceset: "multichoiceset",
        truefalse: "truefalse",
        ddwtos: "ddwtos",
        shortanswer: "shortanswer",
        numerical: "numerical",
    };

    const AVAILABLE_TYPES = [
        QUESTION_TYPES.truefalse,
        QUESTION_TYPES.multiplechoice,
        QUESTION_TYPES.multichoiceset,
        QUESTION_TYPES.ddwtos,
        QUESTION_TYPES.shortanswer,
        QUESTION_TYPES.numerical,
    ];
    function getImageMimeType(url) {
        if (typeof url !== "string") return null;

        if (url.includes("pluginfile.php")) {
            const extension = url.split(".").pop().toLowerCase();
            switch (extension) {
                case "png":
                    return "image/png";
                case "jpg":
                case "jpeg":
                    return "image/jpeg";
                case "gif":
                    return "image/gif";
                case "webp":
                    return "image/webp";
                case "svg":
                    return "image/svg+xml";
                default:
                    return "image/png";
            }
        }

        const extension = url.substring(url.lastIndexOf(".") + 1).toLowerCase();
        switch (extension) {
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "svg":
                return "image/svg+xml";
            default:
                return null;
        }
    }

    async function convertSvgToPng(svgUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";

            img.onload = function () {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                try {
                    const pngData = canvas.toDataURL("image/png").split(",")[1];
                    resolve({
                        mimeType: "image/png",
                        data: pngData,
                    });
                } catch (e) {
                    reject(new Error("Failed to convert SVG to PNG: " + e.message));
                }
            };

            img.onerror = function () {
                reject(new Error("Failed to load SVG image"));
            };

            img.src = svgUrl;
        });
    }

    async function fetchImageAsBase64(imageUrl) {
        return new Promise((resolve, reject) => {
            let sanitizedUrl = imageUrl;
            try {
                if (imageUrl.startsWith("/")) {
                    sanitizedUrl = new URL(imageUrl, window.location.origin).href;
                } else if (imageUrl.includes("pluginfile.php")) {
                    if (!imageUrl.startsWith("http")) {
                        sanitizedUrl = new URL(imageUrl, window.location.origin).href;
                    }
                } else if (!imageUrl.startsWith("http")) {
                    sanitizedUrl = new URL(imageUrl, window.location.href).href;
                }
            } catch (e) {
                console.warn(`TuQS LLM: Error sanitizing URL ${imageUrl}:`, e);
                sanitizedUrl = imageUrl;
            }

            const mimeType = getImageMimeType(sanitizedUrl);

            if (!mimeType) {
                console.warn(`TuQS LLM: Unsupported image type for ${sanitizedUrl}`);
                reject(new Error(`Unsupported image type: ${sanitizedUrl}`));
                return;
            }

            if (mimeType === "image/svg+xml") {
                convertSvgToPng(sanitizedUrl)
                    .then(resolve)
                    .catch((error) => {
                        console.warn(`TuQS LLM: Failed to convert SVG to PNG for ${sanitizedUrl}:`, error.message);
                        reject(error);
                    });
                return;
            }

            console.log(`TuQS LLM: Fetching image from ${sanitizedUrl} with MIME type ${mimeType}`);

            GM_xmlhttpRequest({
                method: "GET",
                url: sanitizedUrl,
                responseType: "arraybuffer",
                timeout: 10000,
                onload: function (response) {
                    if (response.status === 200) {
                        const base64 = btoa(new Uint8Array(response.response).reduce((data, byte) => data + String.fromCharCode(byte), ""));
                        resolve({
                            mimeType: mimeType,
                            data: base64,
                        });
                    } else {
                        console.error(`TuQS LLM: Failed to fetch image ${sanitizedUrl}: ${response.status} ${response.statusText}`);
                        reject(new Error(`Failed to fetch image: ${response.status} ${response.statusText}`));
                    }
                },
                onerror: function (error) {
                    console.error(`TuQS LLM: Error fetching image ${sanitizedUrl}:`, error);
                    reject(new Error(`Failed to fetch image: ${error.message}`));
                },
                ontimeout: function () {
                    console.error(`TuQS LLM: Timeout fetching image ${sanitizedUrl}`);
                    reject(new Error(`Timeout fetching image ${sanitizedUrl}`));
                },
            });
        });
    }

    function normalizeTextForComparison(text) {
        if (typeof text !== "string") return "";
        return text
            .toLowerCase()
            .replace(/[\s\u00A0]+/g, " ")
            .trim();
    }

    function extractAndNormalizeText(element) {
        const rawText = element.text();
        if (typeof rawText !== "string") {
            return { full: "", english: null, german: null };
        }

        const cleanedRawText = rawText
            .trim()
            .replace(/^\s*(([0-9]+|[a-zA-Z])[.)]|[-*])\s*/, "")
            .trim();

        const normalizedFullText = normalizeTextForComparison(cleanedRawText);
        let normalizedEnglishText = null;
        let normalizedGermanText = null;
        const lowerCleanedRawText = cleanedRawText.toLowerCase();

        const enMarker = "en:";
        const deMarker = "de:";
        const enIndex = lowerCleanedRawText.indexOf(enMarker);
        const deIndex = lowerCleanedRawText.indexOf(deMarker);

        if (enIndex !== -1) {
            const englishPart = cleanedRawText.substring(enIndex + enMarker.length);
            normalizedEnglishText = normalizeTextForComparison(englishPart);
        }

        if (deIndex !== -1) {
            const germanPartEnd = enIndex !== -1 && enIndex > deIndex ? enIndex : cleanedRawText.length;
            const germanPart = cleanedRawText.substring(deIndex + deMarker.length, germanPartEnd);
            normalizedGermanText = normalizeTextForComparison(germanPart);
        }

        if (normalizedEnglishText && !normalizedGermanText && deIndex === -1) {
            normalizedGermanText = null;
        }
        if (normalizedGermanText && !normalizedEnglishText && enIndex === -1) {
            normalizedEnglishText = null;
        }

        return { full: normalizedFullText, english: normalizedEnglishText, german: normalizedGermanText };
    }

    function getQuestionType(questionElement) {
        if (!questionElement || !questionElement.length) return null;
        for (const type of Object.values(QUESTION_TYPES)) {
            if (questionElement.hasClass(type)) return type;
        }
        console.warn("TuQS LLM: Unknown question type.");
        return null;
    }

    function isQuestionAnswerable(questionType) {
        return AVAILABLE_TYPES.includes(questionType);
    }

    async function getQuestionData(questionElement) {
        const qtextElement = questionElement.find(".qtext").first();
        if (!qtextElement.length) return { textForPrompt: "", imagesData: [] };

        const qtextCloneForText = qtextElement.clone();
        qtextCloneForText.find("img").remove();
        const textForPrompt = qtextCloneForText.text()?.trim() || "";

        const imagesData = [];
        const imageElements = qtextElement.find("img");

        for (const imgEl of imageElements.get()) {
            const $img = $(imgEl);
            const imageUrl = $img.attr("src");
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
        return { textForPrompt, imagesData };
    }

    async function getAnswerOptions(questionElement) {
        const questionType = getQuestionType(questionElement);

        if (questionType === QUESTION_TYPES.shortanswer || questionType === QUESTION_TYPES.numerical) {
            const inputElement = questionElement.find("input[type='text']");
            if (inputElement.length) {
                return [
                    {
                        id: "1",
                        text: questionType,
                        inputElement: inputElement,
                    },
                ];
            }
            console.warn(`TuQS LLM: Could not find input element for ${questionType} question`);
            return [];
        }

        const options = [];
        const answerElements = questionElement.find(".answer > div");

        if (!answerElements.length) return options;

        for (const element of answerElements.get()) {
            const $this = $(element);
            let textElement, inputElement;
            let text = "";
            let imageData = null;

            inputElement = $this.find("input[type='radio'], input[type='checkbox']");
            textElement = $this.find("div.flex-fill.ms-1");
            if (!textElement.length) textElement = $this.find(".ml-1, label");
            if (!textElement.length) textElement = $this.find("div.flex-grow-1");
            if (!textElement.length) textElement = $this.find("label");

            const imgElement = textElement.find("img").first();
            if (imgElement.length) {
                const imageUrl = imgElement.attr("src");
                text =
                    imgElement.attr("alt")?.trim() ||
                    (imageUrl ? `[Image Option (src: ${imageUrl.substring(0, 30) + "..."})]` : "[Image Option]");

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
                const id = md5(text + inputElement.attr("name") + inputElement.attr("value"));
                options.push({
                    id: id,
                    text: text,
                    inputElement: inputElement,
                    imageData: imageData,
                });
            } else {
                console.warn("TuQS LLM: Could not extract input or meaningful text/image for an answer option:", $this.html());
            }
        }
        return options;
    }

    async function getDragDropTextData(questionElement) {
        const qtextElement = questionElement.find(".qtext").first();
        const questionText = qtextElement.text()?.trim();

        const imagesData = [];
        const imageElements = qtextElement.find("img");
        for (const imgEl of imageElements.get()) {
            const $img = $(imgEl);
            const imageUrl = $img.attr("src");
            if (imageUrl) {
                try {
                    const absoluteImageUrl = new URL(imageUrl, window.location.href).href;
                    const imageData = await fetchImageAsBase64(absoluteImageUrl);
                    if (imageData) imagesData.push(imageData);
                } catch (e) {
                    console.warn(`TuQS LLM: Failed to fetch drag & drop question image data for ${imageUrl}:`, e.message);
                }
            }
        }

        const dropZones = [];
        const draggableOptions = [];

        questionElement.find("span.drop.active[class*='place']").each(function () {
            const classes = $(this).attr("class").split(" ");
            const placeClass = classes.find((cls) => cls.startsWith("place"));
            if (placeClass) {
                const id = placeClass.replace("place", "");
                dropZones.push({ id: id, element: $(this) });
            }
        });

        questionElement.find("span.draghome.unplaced").each(function () {
            if (!$(this).hasClass("dragplaceholder")) {
                const text = $(this).text()?.trim();
                if (text) {
                    draggableOptions.push({
                        text: text,
                        element: $(this),
                    });
                }
            }
        });

        console.log(
            "TuQS LLM (DDWTOS): Extracted Drop Zones:",
            dropZones.map((z) => z.id)
        );
        console.log(
            "TuQS LLM (DDWTOS): Extracted Draggable Options:",
            draggableOptions.map((o) => o.text)
        );

        if (dropZones.length === 0 || draggableOptions.length === 0) {
            console.error("TuQS LLM (DDWTOS): Could not extract sufficient drop zones or draggable options.");
            return null;
        }

        return {
            questionText: questionText,
            imagesData: imagesData,
            dropZones: dropZones,
            draggableOptions: draggableOptions,
        };
    }

    async function getLlmSuggestions(
        questionTextForPrompt,
        questionImagesData,
        optionsWithImageData,
        responseFormat = "array",
        dropZoneIds = null
    ) {
        return new Promise((resolve, reject) => {
            if (!questionTextForPrompt && (!questionImagesData || questionImagesData.length === 0)) {
                return reject("Missing question text and images for LLM.");
            }

            const isDragAndDrop = responseFormat === "json";
            const isShortAnswer = !isDragAndDrop && optionsWithImageData.length === 1 && optionsWithImageData[0].text === "shortanswer";

            if (isShortAnswer || isDragAndDrop) {
            } else if (!optionsWithImageData || optionsWithImageData.length === 0) {
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
            let systemInstructionText;
            if (isDragAndDrop) {
                systemInstructionText =
                    "You are an AI assistant helping fill in blanks in a quiz question. Images may be provided. Respond ONLY with the requested JSON object mapping placeholders to the provided options.";
            } else if (isShortAnswer) {
                systemInstructionText =
                    "You are an AI assistant helping a student with a short answer quiz question. Images may be provided. For numerical questions, provide ONLY the numerical answer without any units or explanations. For text questions, provide ONLY the exact text required. Do not include any explanations, units, or additional text.";
            } else {
                systemInstructionText =
                    "You are an AI assistant helping a student with a multiple-choice quiz. Images may be provided for the question or options. Provide only the number(s) of the correct answer(s) based on the text and images given. Consider all provided information.";
            }

            if (questionTextForPrompt) {
                if (isDragAndDrop) {
                    const optionsList = optionsWithImageData
                        .map((opt) => {
                            const text = typeof opt === "string" ? opt : opt.text;
                            return `- "${text}"`;
                        })
                        .join("\\n");
                    llmParts.push({
                        text: `The following is a question with placeholders (e.g., "Placeholder 1", "Placeholder 2") that need to be filled using items from a list of draggable options.\\n\\nQuestion Context & Placeholders:\\n${questionTextForPrompt}\\n(Identify where "Placeholder 1", "Placeholder 2", etc. fit in the above text/code based on the dropZoneIds: ${
                            dropZoneIds ? dropZoneIds.join(", ") : ""
                        })\\n\\nAvailable Draggable Options:\\n${optionsList}\\n\\nYour task is to determine which draggable option fits best into each placeholder. Respond ONLY with a valid JSON object mapping each placeholder ID (as a string key, e.g., "1", "2") to the exact text of the draggable option that should go there (as a string value).\\n\\nExample Response Format:\\n{\\n  "1": "SELECT",\\n  "2": "x.speciality",\\n  "3": "COUNT(*)"\\n  ...\\n}\\n\\nDo not include any other text, explanations, or markdown formatting outside the JSON object. The JSON should be the only content in your response.`,
                    });
                } else {
                    llmParts.push({ text: `Question:\n${questionTextForPrompt}\n\n` });
                }
            }

            if (questionImagesData && questionImagesData.length > 0) {
                questionImagesData.forEach((imgData, idx) => {
                    if (imgData && imgData.mimeType && imgData.data) {
                        llmParts.push({ inlineData: { mimeType: imgData.mimeType, data: imgData.data } });
                    }
                });
            }

            if (isDragAndDrop) {
            } else if (!isShortAnswer) {
                llmParts.push({ text: "\nAvailable Options:\n" });

                optionsWithImageData.forEach((opt, index) => {
                    llmParts.push({ text: `${index + 1}. ${opt.text}\n` });
                    if (opt.imageData && opt.imageData.mimeType && opt.imageData.data) {
                        llmParts.push({ inlineData: { mimeType: opt.imageData.mimeType, data: opt.imageData.data } });
                    }
                });

                llmParts.push({
                    text: `\nConsider the context of a university course quiz. Respond ONLY with the number(s) corresponding to the correct option(s) from the list above.\n*   If it is likely a single-choice question, provide ONLY the single best answer number.\n*   If it is clearly a multiple-choice/select-all-that-apply question, list each correct number on a new line.\n\nDo not include the option text, introductory phrases like "The correct answer is:", or any explanations. \n**IMPORTANT: Do NOT include any reasoning, chain-of-thought, or XML/HTML tags (like <think>) in your response.** Just the raw number(s).`,
                });
            } else {
                llmParts.push({
                    text: `\nFor this question, provide ONLY the numerical answer or exact text required. Do not include any explanations, units, or additional text. If the answer is a number, provide it as a plain number without any units or formatting.`,
                });
            }

            const apiUrl = `${GEMINI_API_BASE_URL}${llmModel}:generateContent?key=${llmApiKey}`;
            const maxRetries = 2;
            let retryCount = 0;

            function makeRequest() {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: apiUrl,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({
                        contents: [{ role: "user", parts: llmParts }],
                        systemInstruction: { parts: [{ text: systemInstructionText }] },
                        generationConfig: {
                            temperature: 0.1,
                        },
                    }),
                    timeout: 120000,
                    onload: function (response) {
                        try {
                            const responseData = JSON.parse(response.responseText);

                            if (responseData.error) {
                                const errorCode = responseData.error.code;
                                const errorMessage = responseData.error.message;

                                if (errorCode === 429) {
                                    const retryDelay =
                                        responseData.error.details?.find((d) => d["@type"]?.includes("RetryInfo"))?.retryDelay || "8s";
                                    console.warn(`TuQS LLM: Rate limit exceeded. Retry in ${retryDelay}. Message: ${errorMessage}`);
                                    throw new Error(
                                        `Rate limit exceeded. Please wait ${retryDelay} before trying again. Consider upgrading to paid tier for higher limits.`
                                    );
                                } else if (errorCode === 503) {
                                    console.warn(`TuQS LLM: Model overloaded. Message: ${errorMessage}`);
                                    throw new Error(`Model is currently overloaded. Please try again in a few minutes.`);
                                } else {
                                    console.error(`TuQS LLM: API Error ${errorCode}: ${errorMessage}`);
                                    throw new Error(`API Error ${errorCode}: ${errorMessage}`);
                                }
                            }

                            let rawCompletion = "";
                            if (
                                responseData.candidates &&
                                responseData.candidates.length > 0 &&
                                responseData.candidates[0].content &&
                                responseData.candidates[0].content.parts &&
                                responseData.candidates[0].content.parts.length > 0 &&
                                responseData.candidates[0].content.parts[0].text
                            ) {
                                rawCompletion = responseData.candidates[0].content.parts[0].text;
                            } else if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
                                const blockReason = responseData.promptFeedback.blockReason;
                                const safetyRatings = responseData.promptFeedback.safetyRatings || [];
                                let blockDetails = `Block reason: ${blockReason}.`;
                                if (safetyRatings.length > 0) {
                                    blockDetails += ` Safety ratings: ${safetyRatings
                                        .map((r) => `${r.category} - ${r.probability}`)
                                        .join(", ")}`;
                                }
                                console.error(
                                    "TuQS LLM: Prompt blocked by Gemini.",
                                    blockDetails,
                                    "Full feedback:",
                                    responseData.promptFeedback
                                );
                                throw new Error(`LLM prompt blocked: ${blockReason}. Check console for details.`);
                            } else {
                                console.error("TuQS LLM: Gemini response format unexpected:", responseData);
                                throw new Error("Gemini response format unexpected. Check API documentation or raw response.");
                            }

                            if (!rawCompletion && !(responseData.promptFeedback && responseData.promptFeedback.blockReason)) {
                                throw new Error("LLM response format unexpected or empty completion, and not blocked.");
                            }

                            let cleanedCompletion = rawCompletion.replace(/<think>.*?<\/think>/gs, "").trim();
                            console.log("TuQS LLM: Cleaned completion from LLM:", cleanedCompletion);

                            if (isDragAndDrop) {
                                let jsonString = cleanedCompletion.trim();
                                const jsonMatch = jsonString.match(/```json\\n(\{[\s\S]*?\})\\n```/s);
                                if (jsonMatch && jsonMatch[1]) {
                                    jsonString = jsonMatch[1];
                                } else {
                                    const firstBrace = jsonString.indexOf("{");
                                    const lastBrace = jsonString.lastIndexOf("}");
                                    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                                        jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                                    }
                                }

                                try {
                                    const suggestionsMap = JSON.parse(jsonString);
                                    if (typeof suggestionsMap !== "object" || suggestionsMap === null) {
                                        throw new Error("LLM response was not a valid JSON object after cleaning.");
                                    }
                                    resolve(suggestionsMap);
                                } catch (parseError) {
                                    console.error("TuQS LLM: Error parsing JSON response for drag-and-drop:", parseError);
                                    reject("Failed to parse Gemini JSON response: " + parseError.message);
                                }
                            } else if (isShortAnswer) {
                                resolve([cleanedCompletion]);
                            } else {
                                const numOptions = optionsWithImageData.length;
                                const finalSuggestions = cleanedCompletion
                                    .split(/\r\n|\r|\n/)
                                    .map((s) => {
                                        const cleaned = s
                                            .trim()
                                            .replace(/[.,;:!?]$/, "")
                                            .trim();
                                        const potentialIndexNum = parseInt(cleaned, 10);
                                        if (!isNaN(potentialIndexNum) && potentialIndexNum >= 1 && potentialIndexNum <= numOptions) {
                                            return potentialIndexNum.toString();
                                        }
                                        return null;
                                    })
                                    .filter((s) => s !== null);

                                if (finalSuggestions.length === 0 && cleanedCompletion) {
                                    console.warn("TuQS LLM: Gemini response did not yield a valid option index from:", cleanedCompletion);
                                    resolve([cleanedCompletion]);
                                } else {
                                    resolve(finalSuggestions);
                                }
                            }
                        } catch (error) {
                            console.error("TuQS LLM: Error parsing Gemini response:", error);
                            console.error("TuQS LLM: Raw response text for debugging:", response.responseText);

                            if (
                                retryCount < maxRetries &&
                                (error.message.includes("timeout") ||
                                    error.message.includes("network") ||
                                    error.message.includes("INVALID_ARGUMENT"))
                            ) {
                                retryCount++;
                                console.log(`TuQS LLM: Retrying request (${retryCount}/${maxRetries})...`);
                                setTimeout(makeRequest, 2000 * retryCount);
                            } else {
                                reject("Failed to parse Gemini response: " + error.message);
                            }
                        }
                    },
                    onerror: function (error) {
                        console.error("TuQS LLM: Gemini request error:", error);

                        if (retryCount < maxRetries) {
                            retryCount++;
                            console.log(`TuQS LLM: Retrying request after error (${retryCount}/${maxRetries})...`);
                            setTimeout(makeRequest, 2000 * retryCount);
                        } else {
                            reject("Gemini request failed: " + JSON.stringify(error));
                        }
                    },
                    ontimeout: function () {
                        console.error("TuQS LLM: Gemini request timed out.");

                        if (retryCount < maxRetries) {
                            retryCount++;
                            console.log(`TuQS LLM: Retrying request after timeout (${retryCount}/${maxRetries})...`);
                            setTimeout(makeRequest, 2000 * retryCount);
                        } else {
                            reject("Gemini request timed out.");
                        }
                    },
                });
            }

            makeRequest();
        });
    }

    async function getLlmClozeSuggestions(question, dropZoneIds, draggableOptions, questionImagesData = []) {
        if (!question || dropZoneIds.length === 0 || draggableOptions.length === 0) {
            return Promise.reject("Missing question, drop zones, or options for LLM cloze request.");
        }
        return getLlmSuggestions(question, questionImagesData, draggableOptions, "json", dropZoneIds);
    }

    class BaseQuestionHandler {
        constructor(options) {
            this.options = options;
        }

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
            const targetIdentifier = suggestedIdentifiers[0];

            this.options.forEach((option, index) => {
                const input = option.inputElement;
                if (!input || !input.length) return;

                const currentIdentifier = (index + 1).toString();

                if (currentIdentifier === targetIdentifier) {
                    input.prop("checked", true);
                    console.log(`TuQS LLM (True/False): Selecting option #${currentIdentifier}`);
                } else {
                    input.prop("checked", false);
                }
            });
        }
    }
    window.truefalse = truefalse;

    class multichoice extends BaseQuestionHandler {
        selectAnswers(targetIdentifiers) {
            const firstInput = this.options.length > 0 ? this.options[0].inputElement : null;
            const isRadio = firstInput ? firstInput.is(":radio") : false;
            let effectiveTargetIdentifiers = targetIdentifiers;

            if (isRadio && targetIdentifiers && targetIdentifiers.length > 1) {
                console.warn(`TuQS LLM (MultiChoice): Multiple suggestions for radio question. Using only first: ${targetIdentifiers[0]}`);
                effectiveTargetIdentifiers = [targetIdentifiers[0]];
            }

            if (!Array.isArray(effectiveTargetIdentifiers)) {
                effectiveTargetIdentifiers = [];
            }

            let selectedOptions = [];

            this.options.forEach((option, index) => {
                const input = option.inputElement;
                if (!input || !input.length) return;

                const currentIdentifier = (index + 1).toString();

                const isMatch = effectiveTargetIdentifiers.includes(currentIdentifier);

                if (isMatch) {
                    input.prop("checked", true);
                    selectedOptions.push(currentIdentifier);
                } else if (isRadio) {
                    input.prop("checked", false);
                }
            });

            if (selectedOptions.length > 0) {
                console.log(`TuQS LLM (MultiChoice): Selected option(s) #${selectedOptions.join(", #")}`);
            } else {
                console.log("TuQS LLM (MultiChoice): No suggested options were selected.");
            }
        }
    }
    window.multichoice = multichoice;
    window.multichoiceset = multichoice;

    class ddwtos {
        constructor(data) {
            this.questionText = data.questionText;
            this.dropZones = data.dropZones;
            this.draggableOptions = data.draggableOptions;
        }

        selectAnswers(suggestions) {
            if (!suggestions || Object.keys(suggestions).length === 0) {
                console.log("TuQS LLM: No valid suggestions for drag & drop");
                return;
            }

            let placedCount = 0;

            this.dropZones.forEach((zone) => {
                const suggestedText = suggestions[zone.id];
                if (!suggestedText) {
                    return;
                }

                const matchingOption = this.draggableOptions.find((opt) => {
                    const optText = typeof opt === "string" ? opt : opt.text;
                    return normalizeTextForComparison(optText) === normalizeTextForComparison(suggestedText);
                });

                if (!matchingOption) {
                    console.warn(`TuQS LLM (DDWTOS): Could not find draggable option matching "${suggestedText}" for zone ${zone.id}`);
                    return;
                }

                const draggableElement = typeof matchingOption === "string" ? null : matchingOption.element;
                if (!draggableElement || !draggableElement.length) {
                    console.warn(`TuQS LLM (DDWTOS): Draggable element not found for "${suggestedText}"`);
                    return;
                }

                const dropZoneElement = zone.element;
                if (!dropZoneElement || !dropZoneElement.length) {
                    console.warn(`TuQS LLM (DDWTOS): Drop zone element not found for zone ${zone.id}`);
                    return;
                }

                try {
                    const dragEl = draggableElement[0];
                    const dropEl = dropZoneElement[0];

                    const dragStartEvent = new DragEvent("dragstart", {
                        bubbles: true,
                        cancelable: true,
                        dataTransfer: new DataTransfer(),
                    });
                    dragEl.dispatchEvent(dragStartEvent);

                    const dragOverEvent = new DragEvent("dragover", {
                        bubbles: true,
                        cancelable: true,
                        dataTransfer: dragStartEvent.dataTransfer,
                    });
                    dropEl.dispatchEvent(dragOverEvent);

                    const dropEvent = new DragEvent("drop", {
                        bubbles: true,
                        cancelable: true,
                        dataTransfer: dragStartEvent.dataTransfer,
                    });
                    dropEl.dispatchEvent(dropEvent);

                    draggableElement.trigger("dragstart");
                    dropZoneElement.trigger("dragover");
                    dropZoneElement.trigger("drop");

                    if (typeof draggableElement.click === "function") {
                        draggableElement[0].click();
                        setTimeout(() => {
                            if (typeof dropZoneElement.click === "function") {
                                dropZoneElement[0].click();
                            }
                        }, 100);
                    }

                    placedCount++;
                    console.log(`TuQS LLM (DDWTOS): Placed "${suggestedText}" into zone ${zone.id}`);
                } catch (error) {
                    console.error(`TuQS LLM (DDWTOS): Error placing "${suggestedText}" into zone ${zone.id}:`, error);
                }
            });

            if (placedCount > 0) {
                console.log(`TuQS LLM (DDWTOS): Successfully placed ${placedCount} answer(s)`);
            } else {
                console.warn("TuQS LLM (DDWTOS): No answers were placed. Drag-and-drop may require manual interaction.");
            }
        }
    }
    window.ddwtos = ddwtos;

    class shortanswer extends BaseQuestionHandler {
        constructor(options) {
            super(options);
            this.inputElement = options[0]?.inputElement;
        }

        selectAnswers(suggestedAnswer) {
            if (!suggestedAnswer || !suggestedAnswer[0] || !this.inputElement) {
                console.log("TuQS LLM: No suggestion or input element for short answer.");
                return;
            }

            this.inputElement.val(suggestedAnswer[0]);
            console.log(`TuQS LLM (ShortAnswer): Set answer to "${suggestedAnswer[0]}"`);
        }
    }
    window.shortanswer = shortanswer;

    class numerical extends BaseQuestionHandler {
        constructor(options) {
            super(options);
            this.inputElement = options[0]?.inputElement;
        }

        selectAnswers(suggestedAnswer) {
            if (!suggestedAnswer || !suggestedAnswer[0] || !this.inputElement) {
                console.log("TuQS LLM: No suggestion or input element for numerical answer.");
                return;
            }

            let answer = suggestedAnswer[0].trim();
            answer = answer.replace(/[^0-9.,-]/g, "");
            answer = answer.replace(",", ".");

            this.inputElement.val(answer);
            console.log(`TuQS LLM (Numerical): Set answer to "${answer}"`);
        }
    }
    window.numerical = numerical;

    let isProcessing = false;
    let lastProcessedQuestionIndex = null;
    async function processQuestion(questionElement, questionIndex) {
        const $question = $(questionElement);
        const questionType = getQuestionType($question);

        if (isQuestionAnswerable(questionType)) {
            console.log(`TuQS LLM: Processing question ${questionIndex + 1} (${questionType})`);
            try {
                const questionData = await getQuestionData($question);
                const answerOptions = await getAnswerOptions($question);

                if (
                    (questionData.textForPrompt || (questionData.imagesData && questionData.imagesData.length > 0)) &&
                    answerOptions.length > 0
                ) {
                    console.log(`TuQS LLM: Getting suggestions for question ${questionIndex + 1}...`);
                    try {
                        const suggestions = await getLlmSuggestions(questionData.textForPrompt, questionData.imagesData, answerOptions);
                        if (suggestions && suggestions.length > 0) {
                            console.log(`TuQS LLM: Question ${questionIndex + 1} - LLM suggests option(s): ${suggestions.join(", ")}`);
                            if (window[questionType]) {
                                const handler = new window[questionType](answerOptions);
                                handler.selectAnswers(suggestions);

                                lastProcessedQuestionIndex = questionIndex;

                                return true; // Successfully processed
                            } else {
                                console.error(`TuQS LLM: No handler found for question type: ${questionType}`);
                            }
                        } else {
                            console.log(`TuQS LLM: Question ${questionIndex + 1} - No valid suggestions received`);
                        }
                    } catch (error) {
                        console.error(`TuQSLLM: Error getting LLM suggestions for question ${questionIndex + 1}:`, error);
                    }
                } else {
                    console.error(`TuQSLLM: Question ${questionIndex + 1} - Missing question text/images or answer options for LLM.`);
                }
            } catch (e) {
                console.error(`TuQSLLM: Error during data extraction for question ${questionIndex + 1}:`, e);
            }
        } else if (questionType === QUESTION_TYPES.ddwtos) {
            console.log(`TuQS LLM: Processing drag & drop question ${questionIndex + 1}`);
            try {
                const ddwtosData = await getDragDropTextData($question);
                if (ddwtosData) {
                    console.log(`TuQS LLM: Getting suggestions for drag & drop question ${questionIndex + 1}...`);
                    try {
                        const clozeSuggestions = await getLlmClozeSuggestions(
                            ddwtosData.questionText,
                            ddwtosData.dropZones.map((dz) => dz.id),
                            ddwtosData.draggableOptions,
                            ddwtosData.imagesData
                        );

                        if (clozeSuggestions && Object.keys(clozeSuggestions).length > 0) {
                            console.log(`TuQS LLM: Question ${questionIndex + 1} - LLM suggests drag & drop answers:`, clozeSuggestions);
                            const handler = new window.ddwtos(ddwtosData);
                            handler.selectAnswers(clozeSuggestions);

                            lastProcessedQuestionIndex = questionIndex;

                            return true; // Successfully processed
                        } else {
                            console.log(`TuQS LLM: Question ${questionIndex + 1} - No valid drag & drop suggestions received`);
                        }
                    } catch (error) {
                        console.error(`TuQSLLM: Error in DDWTOS suggestion process for question ${questionIndex + 1}:`, error);
                    }
                } else {
                    console.error(`TuQSLLM: Question ${questionIndex + 1} - Could not extract drag & drop data.`);
                }
            } catch (e) {
                console.error(`TuQSLLM: Error during drag & drop data extraction for question ${questionIndex + 1}:`, e);
            }
        } else {
            console.log(`TuQSLLM: Question type ${questionType} not supported or no question found.`);
        }
        return false; // Not processed or failed
    }

    function isQuestionAnswered(questionElement) {
        const $question = $(questionElement);
        const questionType = getQuestionType($question);

        if (questionType === QUESTION_TYPES.shortanswer || questionType === QUESTION_TYPES.numerical) {
            const input = $question.find("input[type='text']");
            return input.length > 0 && input.val().trim() !== "";
        } else if (questionType === QUESTION_TYPES.ddwtos) {
            return $question.find("span.drop.active[class*='place']").length > 0;
        } else {
            return $question.find("input[type='radio']:checked, input[type='checkbox']:checked").length > 0;
        }
    }

    async function solveNextQuestion() {
        const questions = $(".que");
        for (let i = 0; i < questions.length; i++) {
            if (!isQuestionAnswered(questions[i])) {
                console.log(`TuQS LLM: Solving next unsolved question (${i + 1})...`);
                await processQuestion(questions[i], i);
                return;
            }
        }
        console.log("TuQS LLM: No unsolved questions found.");
    }

    async function solveAllQuestions() {
        const questions = $(".que");
        console.log(`TuQS LLM: Solving all ${questions.length} questions...`);
        isProcessing = true;

        for (let i = 0; i < questions.length; i++) {
            if (!isProcessing) {
                console.log("TuQS LLM: Processing stopped by user.");
                return;
            }

            if (!isQuestionAnswered(questions[i])) {
                console.log(`TuQS LLM: Processing question ${i + 1}...`);
                await processQuestion(questions[i], i);

                if (i < questions.length - 1 && isProcessing) {
                    console.log(`TuQSLLM: Waiting 2 seconds before processing next question...`);
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            } else {
                console.log(`TuQS LLM: Question ${i + 1} already answered, skipping.`);
            }
        }
        isProcessing = false;
        console.log("TuQS LLM: Finished processing all questions.");
    }

    function stopProcessing() {
        if (isProcessing) {
            isProcessing = false;
            console.log("TuQS LLM: Stopping processing...");
        } else {
            console.log("TuQS LLM: No processing currently active.");
        }
    }

    async function redoLastQuestion() {
        if (lastProcessedQuestionIndex === null) {
            console.log("TuQS LLM: No previous question to redo.");
            return;
        }

        const questions = $(".que");
        if (lastProcessedQuestionIndex >= questions.length) {
            console.log("TuQS LLM: Last processed question index is invalid.");
            return;
        }

        console.log(`TuQS LLM: Redoing last processed question (${lastProcessedQuestionIndex + 1}) with full AI processing...`);

        try {
            const questionElement = questions[lastProcessedQuestionIndex];
            const $question = $(questionElement);
            const questionType = getQuestionType($question);

            if (questionType === QUESTION_TYPES.shortanswer || questionType === QUESTION_TYPES.numerical) {
                $question.find("input[type='text']").val("");
            } else if (questionType === QUESTION_TYPES.ddwtos) {
                console.log("TuQS LLM: Note - Drag & drop questions cannot be cleared, proceeding with redo...");
            } else {
                $question.find("input[type='radio'], input[type='checkbox']").prop("checked", false);
            }

            await processQuestion(questionElement, lastProcessedQuestionIndex);
            console.log("TuQS LLM: Redo completed with full AI processing.");
        } catch (error) {
            console.error("TuQS LLM: Error during redo:", error);
        }
    }

    $(document).ready(async function () {
        console.log(`TuQsAi Script Loaded. Version 1.0. State: ${STATE}, Instance: ${MOODLE_INSTANCE}`);
        if (llmModel) console.log("TuQsAi: Using Model:", llmModel);

        if (STATE === STATES.answerQuiz) {
            console.log("TuQSLLM: Handling quiz attempt page.");

            if (!isTUWEL && isMoodle) {
                console.log("TuQsAi: Running on generic Moodle instance. Compatibility not guaranteed.");
                console.log("TuQsAi: Originally designed for TUWEL. If issues occur, please report them.");
            }

            console.log("TuQS LLM: Keyboard shortcuts available:");
            console.log("  - Press 'S': Solve next unsolved question");
            console.log("  - Press 'Q': Solve all remaining questions (or stop if processing)");
            console.log("  - Press 'R': Redo last processed question");
            console.log("  - Press 'Escape': Stop current processing");

            $(document).keydown(function (e) {
                if (e.keyCode === 27) {
                    e.preventDefault();
                    console.log("TuQS LLM: Stop processing shortcut triggered (Escape key)");
                    stopProcessing();
                    return;
                }

                if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && !e.target.isContentEditable) {
                    if (e.keyCode === 83) {
                        e.preventDefault();
                        console.log("TuQS LLM: Next question shortcut triggered (S key)");
                        solveNextQuestion();
                    } else if (e.keyCode === 81) {
                        e.preventDefault();
                        if (isProcessing) {
                            console.log("TuQS LLM: Stop processing shortcut triggered (Q key)");
                            stopProcessing();
                        } else {
                            console.log("TuQS LLM: Solve all questions shortcut triggered (Q key)");
                            solveAllQuestions();
                        }
                    } else if (e.keyCode === 82) {
                        e.preventDefault();
                        console.log("TuQS LLM: Redo last question shortcut triggered (R key)");
                        redoLastQuestion();
                    }
                }
            });

            const questions = $(".que");
            console.log(`TuQSLLM: Found ${questions.length} questions on the page.`);
            console.log(
                "TuQS LLM: Ready for manual control. Press 'S' for next question, 'Q' for all questions, or 'R' to redo last question."
            );
        } else if (STATE === STATES.viewQuiz) {
            console.log("TuQSLLM: On quiz view page. No actions taken for suggestions.");
        }
    });
})().catch((e) => console.error("TuQS LLM: Critical error in main async execution:", e));

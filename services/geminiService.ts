/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { GoogleGenAI, GenerateContentResponse, Tool, HarmCategory, HarmBlockThreshold, Content } from "@google/genai";
import { UrlContextMetadataItem, KnowledgeItem } from '../types';

// IMPORTANT: The API key MUST be set as an environment variable `process.env.API_KEY`
const API_KEY = process.env.API_KEY;

let ai: GoogleGenAI;

// Model supporting URL context, consistent with user examples and documentation.
const MODEL_NAME = "gemini-2.5-flash"; 

const getAiInstance = (): GoogleGenAI => {
  if (!API_KEY) {
    console.error("API_KEY is not set in environment variables. Please set process.env.API_KEY.");
    throw new Error("Gemini API Key not configured. Set process.env.API_KEY.");
  }
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  }
  return ai;
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

interface GeminiResponse {
  text: string;
  urlContextMetadata?: UrlContextMetadataItem[];
}

const buildPromptWithContext = (prompt: string, items: KnowledgeItem[]): { fullPrompt: string, tools: Tool[] } => {
  const urls = items
    .filter((item): item is { type: 'url'; value: string } => item.type === 'url')
    .map(item => item.value);
  
  // FIX: The type predicate was missing the `mimeType` property, which is required for
  // file-type KnowledgeItems. This caused a type error and prevented correct type
  // narrowing, leading to subsequent errors when accessing `file.name` or `file.content`.
  const files = items
    .filter((item): item is { type: 'file'; name: string; content: string; mimeType: string; } => item.type === 'file');

  let contextPrompt = '';
  if (files.length > 0) {
    const fileContent = files.map(file => `--- Local File: ${file.name} ---\n${file.content}`).join('\n\n');
    contextPrompt = `Use the following local file content as primary context:\n${fileContent}\n\n---\n\n`;
  }

  let fullPrompt = contextPrompt + prompt;

  const tools: Tool[] = urls.length > 0 ? [{ urlContext: {} }] : [];
  
  return { fullPrompt, tools };
}


export const generateContentWithKnowledgeContext = async (
  prompt: string,
  items: KnowledgeItem[]
): Promise<GeminiResponse> => {
  const currentAi = getAiInstance();
  
  const { fullPrompt, tools } = buildPromptWithContext(prompt, items);

  const contents: Content[] = [{ role: "user", parts: [{ text: fullPrompt }] }];

  try {
    const response: GenerateContentResponse = await currentAi.models.generateContent({
      model: MODEL_NAME,
      contents: contents,
      config: { 
        tools: tools,
        safetySettings: safetySettings,
      },
    });

    // Explicitly check for blocked responses or empty candidates, which can happen with safety settings.
    if (!response.candidates || response.candidates.length === 0) {
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Request was blocked by the API. Reason: ${response.promptFeedback.blockReason}. ${response.promptFeedback.blockReasonMessage || ''}`);
      } else {
        throw new Error("The model returned an empty response. This could be due to safety filters or other configuration issues.");
      }
    }

    const text = response.text;
    const candidate = response.candidates?.[0];
    let extractedUrlContextMetadata: UrlContextMetadataItem[] | undefined = undefined;

    if (candidate && candidate.urlContextMetadata && candidate.urlContextMetadata.urlMetadata) {
      console.log("Raw candidate.urlContextMetadata.urlMetadata from API/SDK:", JSON.stringify(candidate.urlContextMetadata.urlMetadata, null, 2));
      extractedUrlContextMetadata = candidate.urlContextMetadata.urlMetadata as UrlContextMetadataItem[];
    } else if (candidate && candidate.urlContextMetadata) {
      console.warn("candidate.urlContextMetadata is present, but 'urlMetadata' field is missing or empty:", JSON.stringify(candidate.urlContextMetadata, null, 2));
    }
    
    return { text, urlContextMetadata: extractedUrlContextMetadata };

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
      if (error.message.includes("API key not valid")) {
         throw new Error("Invalid API Key. Please ensure your API_KEY environment variable is set correctly.");
      }
      if (error.message.includes("quota")) {
        throw new Error("API quota exceeded. Please check your project's usage and billing on the Google AI Platform console.");
      }
      if (error.message.includes("model not found")) {
        throw new Error(`The model "${MODEL_NAME}" was not found. Please check if the model name is correct.`);
      }

      // Check for Google-specific error type for more detailed messages.
      const googleError = error as any;
      if (googleError.type === 'GoogleGenAIError' && googleError.message) {
        throw new Error(`An API error occurred: ${googleError.message}`);
      }

      // Fallback for other errors.
      throw new Error(`Failed to get response from AI: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API.");
  }
};

export const getInitialSuggestions = async (items: KnowledgeItem[]): Promise<GeminiResponse> => {
  if (items.length === 0) {
    return { text: JSON.stringify({ suggestions: ["Add some documents to get topic suggestions."] }) };
  }
  const currentAi = getAiInstance();
  
  // FIX: Replaced unsafe type assertions with type predicates for better type safety
  // and consistency. The type for file items was also missing the `mimeType` property.
  const urls = items
    .filter((item): item is { type: 'url'; value: string } => item.type === 'url')
    .map(item => item.value);
  const files = items
    .filter((item): item is { type: 'file'; name: string; content: string; mimeType: string } => item.type === 'file');

  let fileContext = '';
  if (files.length > 0) {
      const fileContent = files.map(file => `--- Local File: ${file.name} ---\n${file.content}`).join('\n\n');
      fileContext = `Local File Context:\n${fileContent}\n\n`;
  }

  let urlContext = '';
  if (urls.length > 0) {
      urlContext = `Relevant URLs:\n${urls.join('\n')}`;
  }
  
  const promptText = `Based on the content of the following documentation, provide 3-4 concise and actionable questions a developer might ask to explore these documents. These questions should be suitable as quick-start prompts. Return ONLY a JSON object with a key "suggestions" containing an array of these question strings. For example: {"suggestions": ["What are the rate limits?", "How do I get an API key?", "Explain model X."]}

${fileContext}${urlContext}`;

  const contents: Content[] = [{ role: "user", parts: [{ text: promptText }] }];

  try {
    const response: GenerateContentResponse = await currentAi.models.generateContent({
      model: MODEL_NAME,
      contents: contents,
      config: {
        safetySettings: safetySettings,
        responseMimeType: "application/json",
      },
    });

    if (!response.candidates || response.candidates.length === 0) {
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Suggestion request was blocked. Reason: ${response.promptFeedback.blockReason}. ${response.promptFeedback.blockReasonMessage || ''}`);
      } else {
        throw new Error("The model returned an empty response for suggestions.");
      }
    }

    const text = response.text;
    return { text };

  } catch (error) {
    console.error("Error calling Gemini API for initial suggestions:", error);
    if (error instanceof Error) {
      if (error.message.includes("API key not valid")) {
        throw new Error("Invalid API Key. Please check your API_KEY to fetch suggestions.");
      }
      if (error.message.includes("quota")) {
        throw new Error("API quota exceeded while fetching suggestions.");
      }
      if (error.message.includes("Tool use with a response mime type: 'application/json' is unsupported")) {
        throw new Error("API Configuration Error: Tools cannot be used when 'application/json' is the response MIME type.");
      }

      const googleError = error as any;
      if (googleError.type === 'GoogleGenAIError' && googleError.message) {
        throw new Error(`API error fetching suggestions: ${googleError.message}`);
      }
      
      throw new Error(`Failed to get initial suggestions: ${error.message}`);
    }
    throw new Error("An unknown error occurred while fetching suggestions.");
  }
};

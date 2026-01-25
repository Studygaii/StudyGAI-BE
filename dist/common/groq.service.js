"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqService = void 0;
// src/common/groq.service.ts
const common_1 = require("@nestjs/common");
const Groq = require('groq-sdk');
let GroqService = class GroqService {
    constructor() {
        this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        // Use updated model from env or default to llama-3.3-70b-versatile
        this.modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    }
    async getGroqChatCompletion(messages) {
        try {
            return await this.groq.chat.completions.create({
                messages: [...messages],
                model: this.modelName,
                temperature: 0.7,
                max_completion_tokens: 2048,
            });
        }
        catch (err) {
            // Surface helpful error message when model is decommissioned
            const errBody = err?.response?.data || err?.message || err;
            if (errBody && typeof errBody === 'object' && errBody.error && errBody.error.code === 'model_decommissioned') {
                throw new Error(`Groq model "${this.modelName}" is decommissioned: ${errBody.error.message}. Set a supported model in GROQ_MODEL (see https://console.groq.com/docs/deprecations)`);
            }
            // Re-throw original error for other cases
            throw err;
        }
    }
    async chatWithPDF(pdfContent, messages) {
        try {
            // Keep PDF context small to avoid hitting Groq token limits.
            // We'll try to extract the most relevant snippets based on the last user query.
            const globalMaxChars = 20000; // conservative char limit for pdf context
            const getLastUserText = (msgs) => {
                for (let i = msgs.length - 1; i >= 0; i--) {
                    if (msgs[i].role === 'user' && typeof msgs[i].content === 'string')
                        return msgs[i].content;
                }
                return '';
            };
            const lastUserText = getLastUserText(messages) || '';
            // Simple keyword extraction: take words longer than 4 chars, remove common stopwords
            const stopwords = new Set(['which', 'that', 'this', 'there', 'where', 'when', 'what', 'your', 'would', 'could', 'should', 'about', 'because', 'while', 'their', 'those', 'these', 'with', 'from', 'have', 'like', 'just', 'also', 'into', 'than', 'then', 'such']);
            const words = lastUserText
                .replace(/[^a-zA-Z0-9\s]/g, ' ')
                .split(/\s+/)
                .map(w => w.toLowerCase())
                .filter(w => w.length > 4 && !stopwords.has(w));
            const uniqueWords = Array.from(new Set(words)).slice(0, 8);
            const gatherSnippets = (text, keywords, maxChars) => {
                if (!keywords.length)
                    return text.substring(0, Math.min(1000, maxChars));
                const snippets = [];
                const window = Math.floor(maxChars / Math.max(1, keywords.length));
                for (const kw of keywords) {
                    const idx = text.toLowerCase().indexOf(kw.toLowerCase());
                    if (idx !== -1) {
                        const start = Math.max(0, idx - Math.floor(window / 2));
                        const snip = text.substring(start, Math.min(text.length, start + window));
                        snippets.push(snip.trim());
                    }
                }
                // If no snippets found, fallback to start of document
                if (snippets.length === 0)
                    return text.substring(0, Math.min(maxChars, 2000));
                // Join snippets with separators and ensure total length <= maxChars
                let joined = snippets.join('\n\n[...snip...]\n\n');
                if (joined.length > maxChars)
                    joined = joined.substring(0, maxChars);
                return joined;
            };
            const truncatedPdfContent = gatherSnippets(pdfContent, uniqueWords, globalMaxChars);
            // Add system message with PDF context
            const systemMessage = {
                role: 'system',
                content: `You are SAGE, a helpful study assistant. Answer questions based on the following study material.

Study Material:
${truncatedPdfContent}

Instructions:
- Answer questions based ONLY on the study material provided above
- If the answer is not in the material, politely say "I don't see that information in the study material"
- Keep answers clear, educational, and concise
- Use examples from the material when helpful
- If asked to explain concepts, break them down step by step
- Be encouraging and supportive to help students learn`,
            };
            // Combine system message with user messages
            const fullMessages = [systemMessage, ...messages];
            return await this.groq.chat.completions.create({
                messages: fullMessages,
                model: this.modelName,
                temperature: 0.5, // Lower temperature for more focused, accurate answers
                max_completion_tokens: 1024,
                top_p: 1,
            });
        }
        catch (err) {
            const errBody = err?.response?.data || err?.message || err;
            if (errBody && typeof errBody === 'object' && errBody.error && errBody.error.code === 'model_decommissioned') {
                throw new Error(`Groq model "${this.modelName}" is decommissioned: ${errBody.error.message}. Set a supported model in GROQ_MODEL`);
            }
            throw err;
        }
    }
    async getGroqChatCompletionStream(messages) {
        try {
            return await this.groq.chat.completions.create({
                messages: [...messages],
                model: this.modelName,
                temperature: 0.7,
                max_completion_tokens: 2048,
                stream: true, // Enable streaming
            });
        }
        catch (err) {
            const errBody = err?.response?.data || err?.message || err;
            if (errBody && typeof errBody === 'object' && errBody.error && errBody.error.code === 'model_decommissioned') {
                throw new Error(`Groq model "${this.modelName}" is decommissioned: ${errBody.error.message}`);
            }
            throw err;
        }
    }
    async chatWithPDFStream(pdfContent, messages) {
        try {
            const maxPdfChars = 400000;
            const truncatedPdfContent = pdfContent.length > maxPdfChars
                ? pdfContent.substring(0, maxPdfChars) + '\n\n[Content truncated due to length...]'
                : pdfContent;
            const systemMessage = {
                role: 'system',
                content: `You are SAGE, a helpful study assistant. Answer questions based on the following study material.

Study Material:
${truncatedPdfContent}

Instructions:
- Answer based on the study material provided
- If the answer is not in the material, say so politely
- Keep answers clear and educational
- Use examples from the material when helpful`,
            };
            const fullMessages = [systemMessage, ...messages];
            return await this.groq.chat.completions.create({
                messages: fullMessages,
                model: this.modelName,
                temperature: 0.5,
                max_completion_tokens: 2048,
                stream: true,
            });
        }
        catch (err) {
            const errBody = err?.response?.data || err?.message || err;
            if (errBody && typeof errBody === 'object' && errBody.error && errBody.error.code === 'model_decommissioned') {
                throw new Error(`Groq model "${this.modelName}" is decommissioned: ${errBody.error.message}`);
            }
            throw err;
        }
    }
    async generateFlashcardsFromPDF(pdfContent, courseTitle) {
        try {
            const maxPdfChars = 400000;
            const truncatedPdfContent = pdfContent.length > maxPdfChars
                ? pdfContent.substring(0, maxPdfChars) + '\n\n[Content truncated due to length...]'
                : pdfContent;
            const prompt = `You are an expert educator. Based on the following study material, generate 10-15 high-quality flashcard pairs in JSON format.

Study Material:
${truncatedPdfContent}

Generate flashcards that:
- Test key concepts and definitions
- Include both basic and advanced questions
- Have clear, concise answers (1-3 sentences max)
- Cover different topics from the material
- Are suitable for spaced repetition learning

IMPORTANT: Return ONLY valid JSON in this exact format, no markdown, no code blocks:
{
  "flashcards": [
    {
      "front": "Question or concept to learn",
      "back": "Clear, concise answer",
      "tags": ["topic1", "topic2"]
    },
    ...
  ]
}`;
            const response = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert at creating educational flashcards. Return ONLY valid JSON format.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                model: this.modelName,
                temperature: 0.7,
                max_completion_tokens: 4096,
            });
            const content = response.choices[0]?.message?.content || '';
            // Parse JSON response robustly (handle code fences and trailing text)
            let flashcardData;
            try {
                // Remove common markdown fences
                const cleaned = content.replace(/```(?:json|js|typescript)?\n?/gi, '').replace(/```/g, '').trim();
                // Helper: extract single JSON object/array by balancing braces/brackets
                const extractJson = (text) => {
                    const startIdx = text.search(/[\[{]/);
                    if (startIdx === -1)
                        return null;
                    const openChar = text[startIdx];
                    const closeChar = openChar === '{' ? '}' : ']';
                    let depth = 0;
                    for (let i = startIdx; i < text.length; i++) {
                        const ch = text[i];
                        if (ch === openChar)
                            depth++;
                        else if (ch === closeChar)
                            depth--;
                        if (depth === 0) {
                            return text.substring(startIdx, i + 1);
                        }
                    }
                    return null;
                };
                const jsonStr = extractJson(cleaned);
                if (!jsonStr)
                    throw new Error('No JSON object/array found in AI response');
                flashcardData = JSON.parse(jsonStr);
            }
            catch (parseError) {
                console.error('Failed to parse flashcard JSON:', parseError);
                return {
                    status: 400,
                    error: 'Failed to parse AI response. Please try again.',
                    rawResponse: (response.choices[0]?.message?.content || '').substring(0, 1000),
                };
            }
            if (!flashcardData.flashcards || !Array.isArray(flashcardData.flashcards)) {
                return {
                    status: 400,
                    error: 'Invalid flashcard format in AI response',
                };
            }
            return {
                status: 200,
                message: 'Flashcards generated successfully',
                count: flashcardData.flashcards.length,
                flashcards: flashcardData.flashcards,
            };
        }
        catch (err) {
            console.error('Flashcard generation error:', err);
            const errBody = err?.response?.data || err?.message || err;
            if (errBody && typeof errBody === 'object' && errBody.error && errBody.error.code === 'model_decommissioned') {
                throw new Error(`Groq model "${this.modelName}" is decommissioned. Set a supported model in GROQ_MODEL`);
            }
            throw err;
        }
    }
    async testConnection() {
        try {
            const response = await this.groq.chat.completions.create({
                messages: [{ role: 'user', content: 'Say "API is working"' }],
                model: this.modelName,
                max_completion_tokens: 10,
            });
            return !!response.choices[0]?.message?.content;
        }
        catch (error) {
            console.error('Groq connection test failed:', error);
            return false;
        }
    }
    getModelName() {
        return this.modelName;
    }
};
exports.GroqService = GroqService;
exports.GroqService = GroqService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], GroqService);
//# sourceMappingURL=groq.service.js.map
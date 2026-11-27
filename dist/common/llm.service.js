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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var LlmService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = __importDefault(require("axios"));
const groq_service_1 = require("./groq.service");
/**
 * Multi-Provider LLM Gateway.
 *
 * Defaults to Groq for low-latency RAG Q&A, while seamlessly routing long-context
 * notebook synthesis to Gemini (1M context + prompt caching) or any OpenAI-compatible
 * endpoint (OpenAI, OpenRouter, self-hosted vLLM / Ollama) when configured via env.
 */
let LlmService = LlmService_1 = class LlmService {
    constructor(configService, groqService) {
        this.configService = configService;
        this.groqService = groqService;
        this.logger = new common_1.Logger(LlmService_1.name);
        this.defaultProvider = (this.configService.get('LLM_PROVIDER', 'groq') || 'groq').toLowerCase();
    }
    getActiveConfig(preferLongContext = false) {
        const geminiKey = this.configService.get('GEMINI_API_KEY');
        const openaiKey = this.configService.get('OPENAI_API_KEY');
        const customUrl = this.configService.get('LLM_BASE_URL');
        const customKey = this.configService.get('LLM_API_KEY', '');
        // Automatically leverage Gemini's 1M context window for synthesis when configured
        if ((preferLongContext && geminiKey) ||
            (this.defaultProvider === 'gemini' && geminiKey)) {
            return {
                provider: 'gemini',
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
                apiKey: geminiKey,
                model: this.configService.get('GEMINI_MODEL', 'gemini-2.5-flash'),
                contextWindowTokens: 1000000,
            };
        }
        if (this.defaultProvider === 'openai' && openaiKey) {
            return {
                provider: 'openai',
                baseUrl: this.configService.get('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
                apiKey: openaiKey,
                model: this.configService.get('OPENAI_MODEL', 'gpt-4o-mini'),
                contextWindowTokens: 128000,
            };
        }
        if (this.defaultProvider === 'custom' && customUrl) {
            return {
                provider: 'custom',
                baseUrl: customUrl.replace(/\/$/, ''),
                apiKey: customKey,
                model: this.configService.get('LLM_MODEL', 'llama-3.3-70b-versatile'),
                contextWindowTokens: Number(this.configService.get('LLM_CONTEXT_WINDOW', '65536')),
            };
        }
        return {
            provider: 'groq',
            baseUrl: 'https://api.groq.com/openai/v1',
            apiKey: this.configService.get('GROQ_API_KEY', ''),
            model: this.groqService.getModelName(),
            contextWindowTokens: Number(this.configService.get('GROQ_CONTEXT_WINDOW', '32768')),
        };
    }
    /** Maximum source tokens safe for direct long-context routing on the active provider */
    getLongContextBudgetTokens() {
        const cfg = this.getActiveConfig(true);
        if (cfg.provider === 'gemini')
            return 180000;
        if (cfg.provider === 'openai')
            return 48000;
        return 18000;
    }
    async complete(messages, options = {}) {
        const cfg = this.getActiveConfig(Boolean(options.preferLongContext));
        const model = options.model || cfg.model;
        if (cfg.provider === 'groq') {
            const raw = await this.groqService.getGroqChatCompletion(messages);
            const content = raw?.choices?.[0]?.message?.content || '';
            return { content, model, provider: 'groq', raw };
        }
        const resp = await axios_1.default.post(`${cfg.baseUrl}/chat/completions`, {
            model,
            messages,
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 2048,
        }, {
            headers: {
                'Content-Type': 'application/json',
                ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
            },
            timeout: 120000,
        });
        const raw = resp.data;
        const content = raw?.choices?.[0]?.message?.content || '';
        return { content, model, provider: cfg.provider, raw };
    }
    /**
     * Unified AsyncIterable token stream across Groq, Gemini, OpenAI, and vLLM/Ollama.
     */
    async *stream(messages, options = {}) {
        const cfg = this.getActiveConfig(Boolean(options.preferLongContext));
        const model = options.model || cfg.model;
        if (cfg.provider === 'groq') {
            const groqStream = await this.groqService.getGroqChatCompletionStream(messages);
            for await (const chunk of groqStream) {
                const delta = chunk?.choices?.[0]?.delta?.content || '';
                if (delta)
                    yield delta;
            }
            return;
        }
        const resp = await axios_1.default.post(`${cfg.baseUrl}/chat/completions`, {
            model,
            messages,
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 2048,
            stream: true,
        }, {
            headers: {
                'Content-Type': 'application/json',
                ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
            },
            responseType: 'stream',
            timeout: 120000,
        });
        let buffer = '';
        for await (const rawChunk of resp.data) {
            buffer += rawChunk.toString('utf8');
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:'))
                    continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]')
                    continue;
                try {
                    const parsed = JSON.parse(payload);
                    const delta = parsed?.choices?.[0]?.delta?.content || '';
                    if (delta)
                        yield delta;
                }
                catch {
                    // Ignore partial SSE JSON lines
                }
            }
        }
    }
};
exports.LlmService = LlmService;
exports.LlmService = LlmService = LlmService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        groq_service_1.GroqService])
], LlmService);
//# sourceMappingURL=llm.service.js.map
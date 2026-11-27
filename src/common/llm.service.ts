import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GroqService } from './groq.service';

export type LlmProvider = 'groq' | 'gemini' | 'openai' | 'custom';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  preferLongContext?: boolean;
}

/**
 * Multi-Provider LLM Gateway.
 *
 * Defaults to Groq for low-latency RAG Q&A, while seamlessly routing long-context
 * notebook synthesis to Gemini (1M context + prompt caching) or any OpenAI-compatible
 * endpoint (OpenAI, OpenRouter, self-hosted vLLM / Ollama) when configured via env.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly defaultProvider: LlmProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly groqService: GroqService,
  ) {
    this.defaultProvider = (
      this.configService.get<string>('LLM_PROVIDER', 'groq') || 'groq'
    ).toLowerCase() as LlmProvider;
  }

  getActiveConfig(preferLongContext = false): {
    provider: LlmProvider;
    baseUrl: string;
    apiKey: string;
    model: string;
    contextWindowTokens: number;
  } {
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');
    const customUrl = this.configService.get<string>('LLM_BASE_URL');
    const customKey = this.configService.get<string>('LLM_API_KEY', '');

    // Automatically leverage Gemini's 1M context window for synthesis when configured
    if (
      (preferLongContext && geminiKey) ||
      (this.defaultProvider === 'gemini' && geminiKey)
    ) {
      return {
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: geminiKey,
        model: this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash'),
        contextWindowTokens: 1_000_000,
      };
    }

    if (this.defaultProvider === 'openai' && openaiKey) {
      return {
        provider: 'openai',
        baseUrl: this.configService.get<string>('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
        apiKey: openaiKey,
        model: this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini'),
        contextWindowTokens: 128_000,
      };
    }

    if (this.defaultProvider === 'custom' && customUrl) {
      return {
        provider: 'custom',
        baseUrl: customUrl.replace(/\/$/, ''),
        apiKey: customKey,
        model: this.configService.get<string>('LLM_MODEL', 'llama-3.3-70b-versatile'),
        contextWindowTokens: Number(this.configService.get<string>('LLM_CONTEXT_WINDOW', '65536')),
      };
    }

    return {
      provider: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: this.configService.get<string>('GROQ_API_KEY', ''),
      model: this.groqService.getModelName(),
      contextWindowTokens: Number(this.configService.get<string>('GROQ_CONTEXT_WINDOW', '32768')),
    };
  }

  /** Maximum source tokens safe for direct long-context routing on the active provider */
  getLongContextBudgetTokens(): number {
    const cfg = this.getActiveConfig(true);
    if (cfg.provider === 'gemini') return 180_000;
    if (cfg.provider === 'openai') return 48_000;
    return 18_000;
  }

  async complete(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<{ content: string; model: string; provider: LlmProvider; raw: any }> {
    const cfg = this.getActiveConfig(Boolean(options.preferLongContext));
    const model = options.model || cfg.model;

    if (cfg.provider === 'groq') {
      const raw = await this.groqService.getGroqChatCompletion(messages);
      const content = raw?.choices?.[0]?.message?.content || '';
      return { content, model, provider: 'groq', raw };
    }

    const resp = await axios.post(
      `${cfg.baseUrl}/chat/completions`,
      {
        model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2048,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        timeout: 120_000,
      },
    );

    const raw = resp.data;
    const content = raw?.choices?.[0]?.message?.content || '';
    return { content, model, provider: cfg.provider, raw };
  }

  /**
   * Unified AsyncIterable token stream across Groq, Gemini, OpenAI, and vLLM/Ollama.
   */
  async *stream(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {},
  ): AsyncGenerator<string> {
    const cfg = this.getActiveConfig(Boolean(options.preferLongContext));
    const model = options.model || cfg.model;

    if (cfg.provider === 'groq') {
      const groqStream = await this.groqService.getGroqChatCompletionStream(messages);
      for await (const chunk of groqStream) {
        const delta = chunk?.choices?.[0]?.delta?.content || '';
        if (delta) yield delta;
      }
      return;
    }

    const resp = await axios.post(
      `${cfg.baseUrl}/chat/completions`,
      {
        model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        responseType: 'stream',
        timeout: 120_000,
      },
    );

    let buffer = '';
    for await (const rawChunk of resp.data) {
      buffer += rawChunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (delta) yield delta;
        } catch {
          // Ignore partial SSE JSON lines
        }
      }
    }
  }
}

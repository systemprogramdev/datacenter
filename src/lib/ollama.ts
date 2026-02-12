import type {
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaModel,
} from "./types";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

export interface TokenStats {
  total_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_duration_ms: number;
  started_at: string;
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private stats: TokenStats = {
    total_calls: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    total_duration_ms: 0,
    started_at: new Date().toISOString(),
  };

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = baseUrl || OLLAMA_URL;
    this.model = model || OLLAMA_MODEL;
  }

  async generate(
    prompt: string,
    options?: { format?: "json"; temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const body: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      stream: false,
      format: options?.format,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 512,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Track token usage
    const promptTokens = Number(data.prompt_eval_count) || 0;
    const completionTokens = Number(data.eval_count) || 0;
    const durationNs = Number(data.total_duration) || 0;
    this.stats.total_calls++;
    this.stats.prompt_tokens += promptTokens;
    this.stats.completion_tokens += completionTokens;
    this.stats.total_tokens += promptTokens + completionTokens;
    this.stats.total_duration_ms += Math.round(durationNs / 1_000_000);

    return data.response as string;
  }

  async generateJSON<T = Record<string, unknown>>(
    prompt: string,
    temperature?: number
  ): Promise<T> {
    const raw = await this.generate(prompt, {
      format: "json",
      temperature: temperature ?? 0.5,
    });

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Failed to parse Ollama JSON response: ${raw.slice(0, 200)}`);
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error("Failed to list Ollama models");
    const data = await res.json();
    return data.models || [];
  }

  getModel(): string {
    return this.model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getTokenStats(): TokenStats {
    return { ...this.stats };
  }
}

// Singleton instance
export const ollama = new OllamaClient();

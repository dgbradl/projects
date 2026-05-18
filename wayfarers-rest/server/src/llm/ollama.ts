import type { z } from 'zod';
import { LlmError, type LlmConfig } from './types.ts';

export interface GenerateStructuredInput<T> {
  prompt: string;
  /** JSON Schema-style format object passed to Ollama. */
  schema: Record<string, unknown>;
  /** Zod schema for runtime validation. */
  validator: z.ZodType<T>;
  modelOverride?: string;
  temperature?: number;
  timeoutMs?: number;
}

interface OllamaResponseBody {
  response: string;
  done: boolean;
}

export class OllamaClient {
  constructor(private readonly config: LlmConfig) {}

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? this.config.requestTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: input.modelOverride ?? this.config.model,
          prompt: input.prompt,
          format: input.schema,
          stream: false,
          options: { temperature: input.temperature ?? 0.8 },
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new LlmError('timeout', `request timed out after ${timeoutMs}ms`);
      }
      throw new LlmError(
        'unreachable',
        `cannot reach ${this.config.baseUrl}: ${(err as Error).message}`,
        err,
      );
    }
    clearTimeout(timer);

    if (!res.ok) {
      throw new LlmError(
        'http',
        `${res.status} ${res.statusText} from /api/generate`,
      );
    }

    let body: OllamaResponseBody;
    try {
      body = (await res.json()) as OllamaResponseBody;
    } catch (err) {
      throw new LlmError('parse', 'failed to parse outer response JSON', err);
    }

    let inner: unknown;
    try {
      inner = JSON.parse(body.response);
    } catch (err) {
      throw new LlmError('parse', `model output is not JSON: ${body.response}`, err);
    }

    const validation = input.validator.safeParse(inner);
    if (!validation.success) {
      throw new LlmError(
        'validation',
        `schema validation failed: ${validation.error.message}`,
      );
    }
    return validation.data;
  }

  async healthCheck(timeoutMs = 3000): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      clearTimeout(timer);
      return false;
    }
  }
}

import type { z } from 'zod';
import { RequestGate, type RequestPriority } from './gate.ts';
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
  /** Phase 5: serialization priority. `'high'` jumps ahead of `'normal'`. */
  priority?: RequestPriority;
}

export interface OllamaGenerateResult<T> {
  data: T;
  /** Length of the model's raw response string (for chronicle metrics). */
  completionCharCount: number;
}

interface OllamaResponseBody {
  response: string;
  done: boolean;
}

export class OllamaClient {
  constructor(
    private readonly config: LlmConfig,
    private readonly gate: RequestGate = new RequestGate(),
  ) {}

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    const result = await this.generateStructuredDetailed(input);
    return result.data;
  }

  async generateStructuredDetailed<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<OllamaGenerateResult<T>> {
    const release = await this.gate.acquire(input.priority ?? 'normal');
    try {
      return await this.callOnce(input);
    } finally {
      release();
    }
  }

  private async callOnce<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<OllamaGenerateResult<T>> {
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
    return { data: validation.data, completionCharCount: body.response.length };
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

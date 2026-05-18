import type { FlavorMode } from '@shared/types';

export type LlmErrorKind =
  | 'http'
  | 'timeout'
  | 'parse'
  | 'validation'
  | 'unreachable';

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
}

export type { FlavorMode };

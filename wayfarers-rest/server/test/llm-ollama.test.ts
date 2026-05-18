import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaClient } from '../src/llm/ollama.ts';
import { LlmError } from '../src/llm/types.ts';

const schema = { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } };
const validator = z.object({ n: z.number().int() });

function makeClient() {
  return new OllamaClient({
    baseUrl: 'http://localhost:11434',
    model: 'test-model',
    requestTimeoutMs: 1_000,
  });
}

describe('OllamaClient.generateStructured', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses a valid response and returns the typed object', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ response: '{"n":42}', done: true }), {
        status: 200,
      }),
    ) as unknown as typeof globalThis.fetch;

    const out = await makeClient().generateStructured({
      prompt: 'p',
      schema,
      validator,
    });
    expect(out).toEqual({ n: 42 });
  });

  it('throws LlmError(http) on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('boom', { status: 500, statusText: 'Server Error' }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      makeClient().generateStructured({ prompt: 'p', schema, validator }),
    ).rejects.toMatchObject({ name: 'LlmError', kind: 'http' });
  });

  it('throws LlmError(parse) on malformed JSON in `response`', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ response: 'not-json', done: true }), {
        status: 200,
      }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      makeClient().generateStructured({ prompt: 'p', schema, validator }),
    ).rejects.toMatchObject({ name: 'LlmError', kind: 'parse' });
  });

  it('throws LlmError(validation) when schema mismatches', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ response: '{"n":"hello"}', done: true }), {
        status: 200,
      }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      makeClient().generateStructured({ prompt: 'p', schema, validator }),
    ).rejects.toMatchObject({ name: 'LlmError', kind: 'validation' });
  });

  it('throws LlmError(unreachable) when fetch throws synchronously', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('connection refused');
    }) as unknown as typeof globalThis.fetch;

    await expect(
      makeClient().generateStructured({ prompt: 'p', schema, validator }),
    ).rejects.toMatchObject({ name: 'LlmError', kind: 'unreachable' });
  });
});

describe('OllamaClient.healthCheck', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns true on a successful response', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const ok = await makeClient().healthCheck();
    expect(ok).toBe(true);
  });

  it('returns false on a failing response', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('nope');
    }) as unknown as typeof globalThis.fetch;
    const ok = await makeClient().healthCheck();
    expect(ok).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaClient } from '../src/llm/ollama.ts';
import {
  arrivalPlaceholder,
  arrivalValidator,
  generateArrival,
} from '../src/llm/slots/arrival.ts';
import {
  fragmentPlaceholder,
  fragmentValidator,
  generateFragments,
} from '../src/llm/slots/fragment.ts';
import {
  namePlaceholder,
  nameValidator,
  generateNames,
} from '../src/llm/slots/name.ts';
import {
  generateRumor,
  rumorPlaceholder,
  rumorValidator,
} from '../src/llm/slots/rumor.ts';

const client = new OllamaClient({
  baseUrl: 'http://localhost:11434',
  model: 'test-model',
  requestTimeoutMs: 1_000,
});

function mockFetch(payload: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ response: JSON.stringify(payload), done: true }), {
        status: 200,
      }),
  ) as unknown as typeof globalThis.fetch;
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('arrival slot', () => {
  it('generate returns a valid ArrivalGarnish from a mocked response', async () => {
    globalThis.fetch = mockFetch({
      name: 'Wren Underwood',
      tagline: 'walks with a sealed letter and a tired ankle',
      item: 'a folded letter, unsealed',
    });
    const out = await generateArrival(client, {
      archetype: 'wanderer',
      mood: 'weary',
      originLocationDisplayName: 'Cradle Hollow',
      originLocationKind: 'village',
    });
    expect(out.name).toBe('Wren Underwood');
    expect(arrivalValidator.safeParse(out).success).toBe(true);
  });

  it('placeholder is deterministic given the same seed', () => {
    const a = arrivalPlaceholder({
      archetype: 'merchant',
      mood: 'guarded',
      originLocationDisplayName: 'x',
      originLocationKind: 'town',
      seed: 'fixed-1',
    });
    const b = arrivalPlaceholder({
      archetype: 'merchant',
      mood: 'guarded',
      originLocationDisplayName: 'x',
      originLocationKind: 'town',
      seed: 'fixed-1',
    });
    expect(a).toEqual(b);
  });

  it('validator rejects missing fields', () => {
    expect(arrivalValidator.safeParse({ name: 'x' }).success).toBe(false);
  });
});

describe('rumor slot', () => {
  it('generate returns text from a mocked response', async () => {
    globalThis.fetch = mockFetch({ text: 'They say the marshes have stopped singing.' });
    const out = await generateRumor(client, {
      locationDisplayName: 'The Marshes',
      tagKey: 'something',
      tagValue: 'odd',
    });
    expect(out.text).toMatch(/marshes/i);
    expect(rumorValidator.safeParse(out).success).toBe(true);
  });

  it('placeholder is deterministic given the same seed', () => {
    const a = rumorPlaceholder({
      locationDisplayName: 'L',
      tagKey: 'k',
      tagValue: 'v',
      seed: 's',
    });
    const b = rumorPlaceholder({
      locationDisplayName: 'L',
      tagKey: 'k',
      tagValue: 'v',
      seed: 's',
    });
    expect(a).toEqual(b);
  });
});

describe('fragment slot', () => {
  it('generate returns a fragments array', async () => {
    globalThis.fetch = mockFetch({ fragments: ['one', 'two', 'three'] });
    const out = await generateFragments(client, { batchSize: 3 });
    expect(out.fragments).toHaveLength(3);
    expect(fragmentValidator.safeParse(out).success).toBe(true);
  });

  it('placeholder returns the requested batch size', () => {
    const out = fragmentPlaceholder({ batchSize: 7 });
    expect(out.fragments).toHaveLength(7);
  });
});

describe('name slot', () => {
  it('generate returns a names array', async () => {
    globalThis.fetch = mockFetch({ names: ['Aldred\'s Wheel', 'Two Lanterns'] });
    const out = await generateNames(client, { kind: 'location', batchSize: 2 });
    expect(out.names).toHaveLength(2);
    expect(nameValidator.safeParse(out).success).toBe(true);
  });

  it('placeholder returns the requested batch size', () => {
    const out = namePlaceholder({ kind: 'song', batchSize: 4 });
    expect(out.names).toHaveLength(4);
  });
});

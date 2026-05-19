import { z } from 'zod';
import type { ChroniclePrologue } from '@shared/types';
import type { Clock } from '../lib/clock.ts';
import type { FixtureRegistry } from '../llm/fixtures.ts';
import type { FlavorModeManager } from '../llm/mode.ts';
import type { OllamaClient } from '../llm/ollama.ts';
import type { Persistence } from '../persistence.ts';
import { buildProloguePrompt } from './prompt.ts';

const PROLOGUE_FORMAT = {
  type: 'object',
  required: ['text'],
  properties: { text: { type: 'string', minLength: 50, maxLength: 600 } },
} as const;

const prologueValidator = z.object({
  text: z.string().min(50).max(600),
});

export interface PrologueGeneratorConfig {
  model: string;
  chronicleModel?: string;
  timeoutMs: number;
}

export interface PrologueGeneratorDeps {
  persistence: Persistence;
  clock: Clock;
  client: OllamaClient;
  mode: FlavorModeManager;
  fixtures: FixtureRegistry | null;
}

const MIN_SPAN = 3;

export class PrologueGenerator {
  constructor(
    private readonly deps: PrologueGeneratorDeps,
    private readonly config: PrologueGeneratorConfig,
  ) {}

  /**
   * Returns the prologue for a span, generating it if not already cached.
   * Returns `null` for spans shorter than {@link MIN_SPAN} days.
   */
  async getOrGenerate(
    fromGameDay: number,
    toGameDay: number,
  ): Promise<ChroniclePrologue | null> {
    if (toGameDay - fromGameDay + 1 < MIN_SPAN) return null;
    const cached = this.deps.persistence.loadChroniclePrologue(
      fromGameDay,
      toGameDay,
    );
    if (cached) return cached;

    const chronicles = this.deps.persistence.loadChroniclesBetween(
      fromGameDay,
      toGameDay,
    );
    const headlines: string[] = [];
    for (const c of chronicles) {
      for (const h of c.headlines) headlines.push(h);
    }

    const interventionCount = this.deps.persistence.countInterventionsBetween(
      fromGameDay,
      toGameDay,
    );
    const prompt = buildProloguePrompt({
      fromGameDay,
      toGameDay,
      allHeadlines: headlines,
      interventionCount,
    });
    const nowIso = new Date(this.deps.clock.now()).toISOString();

    const mode = this.deps.mode.getMode();
    if (mode === 'placeholder') {
      return this.fallback(fromGameDay, toGameDay, nowIso, 'placeholder mode');
    }
    if (mode === 'recorded') {
      const fix = this.deps.fixtures?.next<{ text: string }>(
        'prologue',
        prologueValidator,
      );
      if (fix) {
        const prologue: ChroniclePrologue = {
          fromGameDay,
          toGameDay,
          text: fix.text,
          generatedAtRealTs: nowIso,
          status: 'complete',
        };
        this.deps.persistence.upsertChroniclePrologue(prologue);
        return prologue;
      }
      return this.fallback(
        fromGameDay,
        toGameDay,
        nowIso,
        'no recorded fixture',
      );
    }

    try {
      const out = await this.deps.client.generateStructured({
        prompt,
        schema: PROLOGUE_FORMAT,
        validator: prologueValidator,
        modelOverride: this.config.chronicleModel ?? this.config.model,
        temperature: 0.7,
        timeoutMs: this.config.timeoutMs,
        priority: 'high',
      });
      const prologue: ChroniclePrologue = {
        fromGameDay,
        toGameDay,
        text: out.text,
        generatedAtRealTs: nowIso,
        status: 'complete',
      };
      this.deps.persistence.upsertChroniclePrologue(prologue);
      return prologue;
    } catch (err) {
      return this.fallback(
        fromGameDay,
        toGameDay,
        nowIso,
        `LLM failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  private fallback(
    fromGameDay: number,
    toGameDay: number,
    nowIso: string,
    reason: string,
  ): ChroniclePrologue {
    const dayCount = toGameDay - fromGameDay + 1;
    const prologue: ChroniclePrologue = {
      fromGameDay,
      toGameDay,
      text: `Much happened in your ${dayCount} days away. Read on.`,
      generatedAtRealTs: nowIso,
      status: 'fallback',
    };
    this.deps.persistence.upsertChroniclePrologue(prologue);
    // Reason is logged via failureReason on DailyChronicle elsewhere; the
    // prologue row's status carries the user-facing signal.
    void reason;
    return prologue;
  }
}

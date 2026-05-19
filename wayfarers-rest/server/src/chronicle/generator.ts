import { z } from 'zod';
import type {
  DailyChronicle,
  EventLogEntry,
  Npc,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import * as interventionRegistry from '../interventions/registry.ts';
import type { InterventionOptions } from '../interventions/types.ts';
import { LOCATIONS } from '../world/locations.ts';
import type { Clock } from '../lib/clock.ts';
import type { FixtureRegistry } from '../llm/fixtures.ts';
import type { FlavorModeManager } from '../llm/mode.ts';
import type { OllamaClient } from '../llm/ollama.ts';
import { LlmError } from '../llm/types.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import { buildFallbackChronicle } from './fallback.ts';
import {
  buildDailyPrompt,
  reconstructWorldTagsAt,
  type InterventionDescription,
} from './prompt.ts';
import { select } from './salience.ts';
import { DEFAULT_ALARMING_VALUES } from './types.ts';

const CHRONICLE_FORMAT = {
  type: 'object',
  required: ['headlines', 'footnotes'],
  properties: {
    headlines: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 },
    footnotes: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
  },
} as const;

const chronicleValidator = z.object({
  headlines: z.array(z.string().min(1)).min(3).max(5),
  footnotes: z.array(z.string().min(1)).min(3).max(6),
});

export interface ChronicleGeneratorConfig {
  model: string;
  chronicleModel?: string;
  maxEvents: number;
  timeoutMs: number;
}

export interface ChronicleGeneratorDeps {
  persistence: Persistence;
  bus: WorldEventBus;
  clock: Clock;
  client: OllamaClient;
  mode: FlavorModeManager;
  npcManager: NpcManager;
  fixtures: FixtureRegistry | null;
  /** Phase 6: used to read `markedNpcIds` for salience. Optional for older tests. */
  stateManager?: WorldStateManager;
}

const RETRY_DELAY_MS = 3_000;

export class ChronicleGenerator {
  constructor(
    private readonly deps: ChronicleGeneratorDeps,
    private readonly config: ChronicleGeneratorConfig,
  ) {}

  /**
   * Generate the chronicle for `gameDay`. Always returns a chronicle row
   * (status `complete` or `fallback`); throws only on programmer error.
   * Persists the result and emits `chronicle_generated`.
   */
  async generate(gameDay: number): Promise<DailyChronicle> {
    const startedAt = this.deps.clock.now();
    const startedIso = new Date(startedAt).toISOString();

    // Mark in_progress before we begin so the worker doesn't pick it up twice.
    this.deps.persistence.upsertChronicle({
      gameDay,
      generatedAtRealTs: null,
      status: 'in_progress',
      headlines: [],
      footnotes: [],
      modelUsed: null,
      promptCharCount: null,
      completionCharCount: null,
      generationDurationMs: null,
      failureReason: null,
    });

    const allEvents = this.deps.persistence.getEventsSince(0);
    const dayEvents = allEvents.filter(
      (e) => 'gameDay' in e.event && e.event.gameDay === gameDay,
    );

    const npcsById = new Map<string, Npc>(
      this.deps.npcManager.getRoster().map((n) => [n.id, n]),
    );
    // Augment npcsById with departed NPCs we can recover from the event log
    // (their arrival events carry the displayName).
    for (const entry of allEvents) {
      if (entry.event.type !== 'npc_arrived') continue;
      if (npcsById.has(entry.event.npcId)) continue;
      npcsById.set(entry.event.npcId, {
        id: entry.event.npcId,
        displayName: entry.event.displayName,
        status: 'departed',
        position: { x: 0, y: 0 },
        zone: null,
        arrivedGameDay: entry.event.gameDay,
        arrivedSubTick: 0,
        plannedDepartureGameDay: 0,
        plannedDepartureSubTick: 0,
        nextDecisionSubTick: 0,
        carriedRumorIds: [],
      });
    }
    const threadsById = new Map(
      this.deps.persistence.loadAllThreads().map((t) => [t.id, t]),
    );

    const markedNpcIds = new Set(
      this.deps.stateManager?.getState().markedNpcIds ?? [],
    );
    const ctx = {
      npcsById,
      threadsById,
      alarmingValues: DEFAULT_ALARMING_VALUES,
      markedNpcIds,
    };
    const salient = select(dayEvents, ctx, { maxEvents: this.config.maxEvents });

    const tagsAtDawn = reconstructWorldTagsAt(this.deps.persistence, gameDay, 'dawn');
    const tagsAtDusk = reconstructWorldTagsAt(this.deps.persistence, gameDay, 'dusk');

    const yesterday = this.deps.persistence.loadChronicle(gameDay - 1);
    const yesterdayHeadlines = yesterday?.headlines ?? [];

    const activeThreads = this.deps.persistence
      .loadActiveThreads()
      .slice(0, 5);

    // Phase 6: build the "By your hand today" prompt slot.
    const interventionDescriptions = buildInterventionDescriptions(
      this.deps.persistence,
      gameDay,
      this.deps.npcManager,
      this.deps.stateManager,
    );

    const prompt = buildDailyPrompt({
      gameDay,
      salientEvents: salient,
      tagsAtDawn,
      tagsAtDusk,
      yesterdayHeadlines,
      activeThreads,
      npcsById,
      interventionDescriptions,
    });

    const mode = this.deps.mode.getMode();

    // Placeholder mode (or recorded with no fixtures available) → fallback.
    if (mode === 'placeholder') {
      const chron = buildFallbackChronicle({
        gameDay,
        generatedAtRealTs: startedIso,
        salientEvents: salient,
        context: ctx,
        failureReason: 'placeholder mode',
      });
      chron.promptCharCount = prompt.length;
      chron.generationDurationMs = this.deps.clock.now() - startedAt;
      this.deps.persistence.upsertChronicle(chron);
      this.emitGenerated(chron);
      return chron;
    }

    // Recorded mode → try fixtures, fall through to fallback if missing.
    if (mode === 'recorded') {
      const fix = this.deps.fixtures?.next<{ headlines: string[]; footnotes: string[] }>(
        'chronicle',
        chronicleValidator,
      );
      if (fix) {
        const chron: DailyChronicle = {
          gameDay,
          generatedAtRealTs: startedIso,
          status: 'complete',
          headlines: fix.headlines,
          footnotes: fix.footnotes,
          modelUsed: this.modelForUse(),
          promptCharCount: prompt.length,
          completionCharCount: JSON.stringify(fix).length,
          generationDurationMs: this.deps.clock.now() - startedAt,
          failureReason: null,
        };
        this.deps.persistence.upsertChronicle(chron);
        this.emitGenerated(chron);
        return chron;
      }
      const chron = buildFallbackChronicle({
        gameDay,
        generatedAtRealTs: startedIso,
        salientEvents: salient,
        context: ctx,
        failureReason: 'no recorded fixture available',
      });
      chron.promptCharCount = prompt.length;
      chron.generationDurationMs = this.deps.clock.now() - startedAt;
      this.deps.persistence.upsertChronicle(chron);
      this.emitGenerated(chron);
      return chron;
    }

    // LLM mode: call the model, retry once after a short delay, then fallback.
    try {
      const result = await this.callOnce(prompt, gameDay);
      const chron: DailyChronicle = {
        gameDay,
        generatedAtRealTs: startedIso,
        status: 'complete',
        headlines: result.data.headlines,
        footnotes: result.data.footnotes,
        modelUsed: this.modelForUse(),
        promptCharCount: prompt.length,
        completionCharCount: result.completionCharCount,
        generationDurationMs: this.deps.clock.now() - startedAt,
        failureReason: null,
      };
      this.deps.persistence.upsertChronicle(chron);
      this.emitGenerated(chron);
      return chron;
    } catch (firstErr) {
      await delay(RETRY_DELAY_MS);
      try {
        const result = await this.callOnce(prompt, gameDay);
        const chron: DailyChronicle = {
          gameDay,
          generatedAtRealTs: startedIso,
          status: 'complete',
          headlines: result.data.headlines,
          footnotes: result.data.footnotes,
          modelUsed: this.modelForUse(),
          promptCharCount: prompt.length,
          completionCharCount: result.completionCharCount,
          generationDurationMs: this.deps.clock.now() - startedAt,
          failureReason: `retry succeeded after: ${describeError(firstErr)}`,
        };
        this.deps.persistence.upsertChronicle(chron);
        this.emitGenerated(chron);
        return chron;
      } catch (secondErr) {
        const chron = buildFallbackChronicle({
          gameDay,
          generatedAtRealTs: startedIso,
          salientEvents: salient,
          context: ctx,
          failureReason: `LLM failed twice: ${describeError(secondErr)}`,
        });
        chron.promptCharCount = prompt.length;
        chron.generationDurationMs = this.deps.clock.now() - startedAt;
        this.deps.persistence.upsertChronicle(chron);
        this.emitGenerated(chron);
        return chron;
      }
    }
  }

  private async callOnce(prompt: string, _gameDay: number) {
    return this.deps.client.generateStructuredDetailed({
      prompt,
      schema: CHRONICLE_FORMAT,
      validator: chronicleValidator,
      modelOverride: this.modelForUse(),
      temperature: 0.75,
      timeoutMs: this.config.timeoutMs,
      priority: 'high',
    });
  }

  private modelForUse(): string {
    return this.config.chronicleModel ?? this.config.model;
  }

  private emitGenerated(chronicle: DailyChronicle): void {
    this.deps.bus.publish({
      type: 'chronicle_generated',
      gameDay: chronicle.gameDay,
      status: chronicle.status,
      durationMs: chronicle.generationDurationMs ?? 0,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function describeError(err: unknown): string {
  if (err instanceof LlmError) return `${err.kind}: ${err.message}`;
  return (err as Error)?.message ?? String(err);
}

/**
 * Phase 6: for each intervention performed on this day, look up its definition
 * and call describe() to produce the "By your hand today" prompt slot.
 */
function buildInterventionDescriptions(
  persistence: Persistence,
  gameDay: number,
  npcManager: NpcManager,
  stateManager: WorldStateManager | undefined,
): InterventionDescription[] {
  const records = persistence.loadInterventionsForDay(gameDay);
  if (records.length === 0) return [];

  // Lightweight options shape for describe(); we only need the lookups.
  const state = stateManager?.getState();
  const npcsInTavern = npcManager.getRoster().map((n) => ({
    id: n.id,
    displayName: n.displayName,
    archetype: n.archetype ?? 'wanderer',
    status: n.status,
    isMarked: !!state?.markedNpcIds.includes(n.id),
  }));

  const optionsShape: InterventionOptions = {
    state: state ?? ({} as never),
    targets: {
      locations: LOCATIONS.map((l) => ({
        id: l.id,
        displayName: l.displayName,
        kind: l.kind,
      })),
      archetypes: [
        'wanderer',
        'merchant',
        'refugee',
        'pilgrim',
        'soldier',
        'scholar',
        'rogue',
      ],
      activeThreads: persistence.loadAllThreads().map((t) => ({
        id: t.id,
        type: t.type,
        state: t.state,
        describable: '',
        canSway: (t.payload as Record<string, unknown>).swayBias === undefined,
      })),
      worldTags: persistence.getAllWorldTags().map((tag) => ({
        key: tag.key,
        currentValue: tag.value,
        permittedValues: [],
      })),
      npcsInTavern,
    },
    availableRumors: persistence.loadAvailableRumors(),
  };

  const out: InterventionDescription[] = [];
  for (const record of records) {
    const def = interventionRegistry.get(record.kind);
    if (!def) {
      out.push({ text: `(unknown intervention: ${record.kind})` });
      continue;
    }
    try {
      out.push({
        text: def.describe(record.payload as never, optionsShape),
      });
    } catch {
      out.push({ text: `(intervention: ${record.kind})` });
    }
  }
  return out;
}

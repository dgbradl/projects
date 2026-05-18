import type {
  ArrivalGarnish,
  LocationKind,
  NpcArchetype,
  NpcMood,
} from '@shared/types';
import { seededRng, rngPick } from '../world/rng.ts';
import type { FlavorCache } from './cache/manager.ts';
import type { FixtureRegistry } from './fixtures.ts';
import type { FlavorModeManager } from './mode.ts';
import type { OllamaClient } from './ollama.ts';
import {
  arrivalPlaceholder,
  generateArrival,
  type ArrivalInput,
} from './slots/arrival.ts';
import {
  fragmentPlaceholder,
  generateFragments,
  FRAGMENT_BATCH_SIZE,
  type FragmentBatch,
  fragmentValidator,
} from './slots/fragment.ts';
import {
  generateNames,
  NAME_BATCH_SIZE,
  type NameBatch,
  namePlaceholder,
  nameValidator,
  type NameKind,
} from './slots/name.ts';
import {
  generateRumor,
  rumorPlaceholder,
  type RumorInput,
  type RumorOutput,
  rumorValidator,
} from './slots/rumor.ts';
import { arrivalValidator } from './slots/arrival.ts';

const ARCHETYPES: NpcArchetype[] = [
  'wanderer',
  'merchant',
  'refugee',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
];
const MOODS: NpcMood[] = [
  'cheerful',
  'anxious',
  'weary',
  'guarded',
  'desperate',
  'smug',
];
const LOCATION_KINDS: LocationKind[] = [
  'village',
  'town',
  'wilderness',
  'road',
  'landmark',
];
const NAME_KINDS: NameKind[] = ['location', 'faction', 'song', 'dish', 'item'];

/**
 * Build a generator function for the worker. Selects llm / placeholder /
 * recorded behaviour based on the current mode.
 */
function makeGenerator<T>(opts: {
  slot: string;
  mode: FlavorModeManager;
  client: OllamaClient | null;
  fixtures: FixtureRegistry | null;
  llm: () => Promise<T>;
  placeholder: () => T;
  fixtureValidator?: import('zod').ZodType<T>;
}): () => Promise<T> {
  return async () => {
    switch (opts.mode.getMode()) {
      case 'recorded': {
        const recorded = opts.fixtures?.next<T>(
          opts.slot,
          opts.fixtureValidator,
        );
        if (recorded !== undefined) return recorded;
        return opts.placeholder();
      }
      case 'placeholder':
        return opts.placeholder();
      case 'llm':
      default:
        if (!opts.client) return opts.placeholder();
        try {
          return await opts.llm();
        } catch (err) {
          throw err;
        }
    }
  };
}

export interface RegisterAllPoolsOpts {
  cache: FlavorCache;
  mode: FlavorModeManager;
  client: OllamaClient | null;
  fixtures: FixtureRegistry | null;
  worldSeed: string;
}

export function registerAllPools(opts: RegisterAllPoolsOpts): void {
  registerArrivalPools(opts);
  registerRumorPool(opts);
  registerFragmentPool(opts);
  registerNamePools(opts);
}

function registerArrivalPools(opts: RegisterAllPoolsOpts): void {
  for (const archetype of ARCHETYPES) {
    const placeholderInput: ArrivalInput = {
      archetype,
      mood: 'weary',
      originLocationDisplayName: 'somewhere',
      originLocationKind: 'wilderness',
    };
    const generate = makeGenerator<ArrivalGarnish>({
      slot: 'arrival',
      mode: opts.mode,
      client: opts.client,
      fixtures: opts.fixtures,
      fixtureValidator: arrivalValidator,
      llm: () => {
        const rng = seededRng(opts.worldSeed, 'arrival-llm', archetype, Date.now());
        const input: ArrivalInput = {
          archetype,
          mood: rngPick(rng, MOODS),
          originLocationDisplayName: 'distant lands',
          originLocationKind: rngPick(rng, LOCATION_KINDS),
        };
        return generateArrival(opts.client!, input);
      },
      placeholder: () => arrivalPlaceholder(placeholderInput),
    });
    opts.cache.registerPool<ArrivalInput, ArrivalGarnish>(
      {
        kind: 'arrival',
        subKey: archetype,
        targetSize: 5,
        refillThreshold: 2,
        generate,
      },
      { placeholder: arrivalPlaceholder },
    );
  }
}

function registerRumorPool(opts: RegisterAllPoolsOpts): void {
  const generate = makeGenerator<RumorOutput>({
    slot: 'rumor',
    mode: opts.mode,
    client: opts.client,
    fixtures: opts.fixtures,
    fixtureValidator: rumorValidator,
    llm: () => {
      const rng = seededRng(opts.worldSeed, 'rumor-llm', Date.now());
      const input: RumorInput = {
        locationDisplayName: rngPick(rng, [
          'Cradle Hollow',
          'Oldspire',
          'Northern Pass',
          'The Marshes',
          'Bell Ridge',
        ]),
        tagKey: rngPick(rng, [
          'war_in_north',
          'harvest',
          'season',
          'road_safety_south',
        ]),
        tagValue: rngPick(rng, [
          'simmering',
          'escalating',
          'fair',
          'poor',
          'promising',
          'plentiful',
        ]),
      };
      return generateRumor(opts.client!, input);
    },
    placeholder: () =>
      rumorPlaceholder({
        locationDisplayName: 'somewhere distant',
        tagKey: 'something',
        tagValue: 'changing',
      }),
  });
  opts.cache.registerPool<RumorInput, RumorOutput>(
    {
      kind: 'rumor',
      subKey: '',
      targetSize: 8,
      refillThreshold: 3,
      generate,
    },
    { placeholder: rumorPlaceholder },
  );
}

function registerFragmentPool(opts: RegisterAllPoolsOpts): void {
  const generate = makeGenerator<FragmentBatch>({
    slot: 'fragment',
    mode: opts.mode,
    client: opts.client,
    fixtures: opts.fixtures,
    fixtureValidator: fragmentValidator,
    llm: () =>
      generateFragments(opts.client!, { batchSize: FRAGMENT_BATCH_SIZE }),
    placeholder: () =>
      fragmentPlaceholder({ batchSize: FRAGMENT_BATCH_SIZE }),
  });
  // The pool stores strings (individual fragments). The generator returns
  // batches; we expand into the pool via push().
  opts.cache.registerPool<{ seed?: string }, string>(
    {
      kind: 'fragment',
      subKey: '',
      targetSize: 50,
      refillThreshold: 15,
      generate: async () => {
        const batch = await generate();
        return batch.fragments;
      },
    },
    {
      placeholder: (input) =>
        fragmentPlaceholder({ batchSize: 1, seed: input.seed }).fragments[0],
    },
  );
}

function registerNamePools(opts: RegisterAllPoolsOpts): void {
  for (const kind of NAME_KINDS) {
    const generate = makeGenerator<NameBatch>({
      slot: `name.${kind}`,
      mode: opts.mode,
      client: opts.client,
      fixtures: opts.fixtures,
      fixtureValidator: nameValidator,
      llm: () =>
        generateNames(opts.client!, { kind, batchSize: NAME_BATCH_SIZE[kind] }),
      placeholder: () =>
        namePlaceholder({ kind, batchSize: NAME_BATCH_SIZE[kind] }),
    });
    const targets: Record<NameKind, [number, number]> = {
      location: [30, 10],
      faction: [15, 5],
      song: [15, 5],
      dish: [15, 5],
      item: [30, 10],
    };
    const [target, threshold] = targets[kind];
    opts.cache.registerPool<{ seed?: string }, string>(
      {
        kind: `name.${kind}`,
        subKey: '',
        targetSize: target,
        refillThreshold: threshold,
        generate: async () => {
          const batch = await generate();
          return batch.names;
        },
      },
      {
        placeholder: (input) =>
          namePlaceholder({ kind, batchSize: 1, seed: input.seed }).names[0],
      },
    );
  }
}

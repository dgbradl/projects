import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FlavorMode, Npc } from '@shared/types';
import { registerRoutes, type ApiDeps } from './api/routes.ts';
import { FurnitureManager } from './furniture/manager.ts';
import { ZoneManager } from './world/zone-manager.ts';
import { registerSSE } from './api/sse.ts';
import { ChronicleGenerator } from './chronicle/generator.ts';
import { ChroniclePipeline } from './chronicle/pipeline.ts';
import { PrologueGenerator } from './chronicle/prologue.ts';
import { tierForScore } from '@shared/types';
import { closeLedgerForDay } from './economy/ledger.ts';
import { updateProsperityForDay } from './economy/prosperity.ts';
import { WorldEventBus } from './events/emitter.ts';
import { detectInteractions } from './interactions/detector.ts';
import { InteractionResolver } from './interactions/resolver.ts';
import { RealClock } from './lib/clock.ts';
import { FlavorCache } from './llm/cache/manager.ts';
import { FlavorWorker } from './llm/cache/worker.ts';
import { FixtureRegistry } from './llm/fixtures.ts';
import { RequestGate } from './llm/gate.ts';
import { FlavorModeManager } from './llm/mode.ts';
import { OllamaClient } from './llm/ollama.ts';
import { registerAllPools } from './llm/registry.ts';
import {
  FAVORS_MAX_DEFAULT,
  FAVORS_REGEN_PER_DAY_DEFAULT,
  regenerateForDayTick,
} from './interventions/favor.ts';
import './interventions/kinds/index.ts';
import {
  buildMarkNpc,
  buildRestockLarder,
  buildStirWorld,
  buildSwayThread,
  buildUpgradeHearth,
} from './interventions/kinds/index.ts';
import * as interventionRegistry from './interventions/registry.ts';
import { CharacterMemoryRecorder } from './npc/character-memory.ts';
import { NpcManager } from './npc/manager.ts';
import {
  checkObservant,
  computeConflictMitigation,
  computeHospitalityExtension,
  computeThoroughnessBonus,
  processGossipNetwork,
} from './npc/staff-effects.ts';
import { seedStaffIfMissing } from './npc/staff-roster.ts';
import { Persistence } from './persistence.ts';
import { WorldStateManager } from './state.ts';
import { SubTickScheduler } from './subtick.ts';
import './threads/archetypes/index.ts';
import { ThreadRunner } from './threads/runner.ts';
import { TickScheduler } from './tick.ts';
import { RumorsManager } from './world/rumors.ts';
import { WorldTagsManager } from './world/tags.ts';
import { seedPhase3World } from './world/world-init.ts';

const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));
const WORKSPACE_ROOT = resolve(SERVER_DIR, '../..');
const DEFAULT_DB_PATH = resolve(WORKSPACE_ROOT, 'data/world.db');
const DEFAULT_FIXTURES_DIR = resolve(SERVER_DIR, 'llm/fixtures');

const TICK_INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS ?? '3600000', 10);
const SCHEDULER_CHECK_MS = parseInt(process.env.SCHEDULER_CHECK_MS ?? '60000', 10);
const SUBTICK_INTERVAL_MS = parseInt(process.env.SUBTICK_INTERVAL_MS ?? '10000', 10);
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'wayfarers-flavor';
const OLLAMA_REQUEST_TIMEOUT_MS = parseInt(
  process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? '30000',
  10,
);
const FLAVOR_MODE = (process.env.FLAVOR_MODE ?? 'llm') as FlavorMode;
const FLAVOR_FIXTURES_DIR = process.env.FLAVOR_FIXTURES_DIR ?? DEFAULT_FIXTURES_DIR;
const FLAVOR_WORKER_INTERVAL_MS = parseInt(
  process.env.FLAVOR_WORKER_INTERVAL_MS ?? '2000',
  10,
);
const OLLAMA_HEALTH_CHECK_MS = parseInt(
  process.env.OLLAMA_HEALTH_CHECK_MS ?? '30000',
  10,
);
const CHRONICLE_MODEL = process.env.CHRONICLE_MODEL ?? 'wayfarers-keeper';
const CHRONICLE_MAX_EVENTS = parseInt(
  process.env.CHRONICLE_MAX_EVENTS ?? '25',
  10,
);
const CHRONICLE_TIMEOUT_MS = parseInt(
  process.env.CHRONICLE_TIMEOUT_MS ?? '60000',
  10,
);
const PROLOGUE_TIMEOUT_MS = parseInt(
  process.env.PROLOGUE_TIMEOUT_MS ?? '30000',
  10,
);
const CHRONICLE_WORKER_INTERVAL_MS = parseInt(
  process.env.CHRONICLE_WORKER_INTERVAL_MS ?? '1000',
  10,
);

const SUB_TICKS_PER_DAY = Math.max(
  1,
  Math.floor(TICK_INTERVAL_MS / SUBTICK_INTERVAL_MS),
);

async function main(): Promise<void> {
  const dbPathAbs = DB_PATH === ':memory:' ? DB_PATH : resolve(DB_PATH);
  if (dbPathAbs !== ':memory:') {
    mkdirSync(dirname(dbPathAbs), { recursive: true });
  }

  const persistence = new Persistence(dbPathAbs);
  const clock = new RealClock();
  const stateManager = new WorldStateManager(persistence, clock);
  const bus = new WorldEventBus(persistence, clock);

  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const furnitureManager = new FurnitureManager(persistence);
  const zoneManager = new ZoneManager(persistence);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);

  // Phase 7 (A2/B3): keep character memory current as events flow, and spawn
  // relationship threads when an affinity reaches an extreme.
  new CharacterMemoryRecorder(persistence, threadRunner).attach(bus);

  // ----- Phase 4 flavor wiring (Phase 5: shared request gate) -----
  const requestGate = new RequestGate();
  const ollama = new OllamaClient(
    {
      baseUrl: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      requestTimeoutMs: OLLAMA_REQUEST_TIMEOUT_MS,
    },
    requestGate,
  );
  const mode = new FlavorModeManager({
    initialMode: FLAVOR_MODE,
    client: ollama,
    bus,
    healthCheckIntervalMs: OLLAMA_HEALTH_CHECK_MS,
    getGameDay: () => stateManager.getState().gameDay,
  });
  const fixtures =
    FLAVOR_MODE === 'recorded' ? new FixtureRegistry(FLAVOR_FIXTURES_DIR) : null;
  fixtures?.load();

  const flavorCache = new FlavorCache(persistence, bus, mode);
  registerAllPools({
    cache: flavorCache,
    mode,
    client: ollama,
    fixtures,
    worldSeed: stateManager.getState().seed,
  });
  flavorCache.rehydrate();

  rumors.setFlavorCache(flavorCache);

  const flavorWorker = new FlavorWorker(
    flavorCache,
    mode,
    FLAVOR_WORKER_INTERVAL_MS,
    undefined,
    () => stateManager.getState().status,
  );

  // ----- NPC + scheduler wiring (reuses Phase 3 surfaces) -----
  const npcManager = new NpcManager(
    {
      worldSeed: stateManager.getState().seed,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    },
    {
      persistence,
      bus,
      rumors,
      threadRunner,
      flavorCache,
      furnitureManager,
    },
  );
  npcManager.hydrate(persistence.loadRoster());
  // Epic E: create Character records for every staff member on first boot, then
  // place active staff in the roster (idempotent — safe on every restart).
  seedStaffIfMissing(persistence, stateManager.getState().gameDay);
  npcManager.ensureStaffOnDuty(
    stateManager.getState().gameDay,
    stateManager.getState().subTick,
  );

  // Epic E (E2): hospitality — waitstaff extends each new traveler's stay.
  bus.on('world_event', (entry: { event: unknown }) => {
    const ev = entry.event as { type: string; npcId?: string };
    if (ev.type !== 'npc_arrived' && ev.type !== 'npc_returned') return;
    if (!ev.npcId) return;
    const ext = computeHospitalityExtension(npcManager.getRoster());
    if (ext > 0) npcManager.extendDeparture(ev.npcId, ext);
  });

  const interactionResolver = new InteractionResolver(
    bus,
    threadRunner,
    flavorCache,
    persistence,
  );
  const interactionCounter = { value: 0 };

  (npcManager as unknown as {
    deps: { postSubTickHook: typeof postSubTickHook };
  }).deps.postSubTickHook = postSubTickHook;

  function postSubTickHook(gameDay: number, subTick: number, roster: Npc[]) {
    // Epic E (E2): gossip — bartender may share a rumor between bar patrons.
    const gossip = processGossipNetwork(
      roster,
      stateManager.getState().seed,
      gameDay,
      subTick,
    );
    if (gossip) {
      npcManager.applyGossip(gossip.recipientId, gossip.rumorId);
    }

    const candidates = detectInteractions(roster, {
      worldSeed: stateManager.getState().seed,
      gameDay,
      subTick,
      countsToday: npcManager.interactionsToday,
      pairsToday: npcManager.pairsToday,
    });
    if (candidates.length === 0) return;
    // Epic E (E2): conflict mitigation — reduce argument weight if bartender present.
    const staffModifiers = { conflictMitigation: computeConflictMitigation(roster) };
    const npcsById = new Map(roster.map((n) => [n.id, n]));
    for (const candidate of candidates) {
      interactionResolver.resolve(candidate, {
        worldSeed: stateManager.getState().seed,
        gameDay,
        subTick,
        npcsById,
        perDayCounter: interactionCounter,
        staffModifiers,
      });
    }
  }

  npcManager.on('diff', () => persistence.saveRoster(npcManager.snapshot()));

  const scheduler = new TickScheduler(
    stateManager,
    clock,
    {
      tickIntervalMs: TICK_INTERVAL_MS,
      schedulerCheckMs: SCHEDULER_CHECK_MS,
    },
    bus,
  );
  // Phase 6: register the three intervention kinds that need runtime deps.
  // (plant_rumor + beckon self-register on import.)
  interventionRegistry.register(buildSwayThread({ persistence }));
  interventionRegistry.register(buildStirWorld({ persistence }));
  interventionRegistry.register(buildMarkNpc({ npcManager, stateManager, bus }));
  // Economy (E3): the coin-costed economic verbs.
  interventionRegistry.register(buildRestockLarder({ stateManager }));
  interventionRegistry.register(buildUpgradeHearth({ stateManager }));

  // Phase 6: marked-NPC cleanup on departure.
  bus.on('world_event', (entry: { event: unknown }) => {
    const ev = entry.event as { type: string; npcId?: string; displayName?: string; gameDay?: number };
    if (ev.type !== 'npc_departed' || !ev.npcId) return;
    const s = stateManager.getState();
    if (s.markedNpcIds.includes(ev.npcId)) {
      stateManager.setState({
        ...s,
        markedNpcIds: s.markedNpcIds.filter((id) => id !== ev.npcId),
      });
      bus.publish({
        type: 'npc_unmarked',
        gameDay: ev.gameDay ?? s.gameDay,
        npcId: ev.npcId,
        reason: 'departed',
      });
    }

    // Epic E (E3): cleaner observant — overhear something about the departing traveler.
    const observant = checkObservant(
      npcManager.getRoster(),
      ev.npcId,
      ev.displayName ?? 'the traveler',
      s.seed,
      ev.gameDay ?? s.gameDay,
    );
    if (observant) {
      rumors.introduce(
        { text: observant.rumorText },
        ev.gameDay ?? s.gameDay,
      );
    }
  });

  const subTickScheduler = new SubTickScheduler(
    stateManager,
    npcManager,
    clock,
    { subTickIntervalMs: SUBTICK_INTERVAL_MS, subTicksPerDay: SUB_TICKS_PER_DAY },
    threadRunner,
    // Economy (E1): settle the ledger for the day that just ended, then
    // (Phase 6) regenerate one favor at the start of the new game day.
    (newGameDay) => {
      const closingDay = newGameDay - 1;
      // Epic E (E3): thoroughness — emit service income before the ledger closes.
      const thoroughnessBonus = computeThoroughnessBonus(npcManager.getRoster());
      const cleaner = npcManager.getRoster().find((n) => n.isStaff && n.staffRole === 'cleaner');
      if (thoroughnessBonus > 0 && cleaner) {
        bus.publish({
          type: 'staff_service_income',
          gameDay: closingDay,
          staffId: cleaner.id,
          amount: thoroughnessBonus,
          source: 'thoroughness',
        });
      }
      closeLedgerForDay(
        {
          persistence,
          stateManager,
          bus,
          worldSeed: stateManager.getState().seed,
        },
        closingDay,
      );
      // Economy (E2): settle prosperity from the day just closed, then let a
      // renowned tavern's standing speed the keeper's favor regeneration.
      updateProsperityForDay({ persistence, stateManager, bus }, closingDay);
      const renowned =
        tierForScore(stateManager.getState().prosperity) === 'renowned';
      regenerateForDayTick(stateManager, bus, newGameDay, {
        max: FAVORS_MAX_DEFAULT,
        regenPerDay: FAVORS_REGEN_PER_DAY_DEFAULT + (renowned ? 1 : 0),
      });
    },
  );

  // ----- Phase 5: chronicle pipeline -----
  const chronicleGenerator = new ChronicleGenerator(
    {
      persistence,
      bus,
      clock,
      client: ollama,
      mode,
      npcManager,
      fixtures,
      stateManager,
    },
    {
      model: OLLAMA_MODEL,
      chronicleModel: CHRONICLE_MODEL,
      maxEvents: CHRONICLE_MAX_EVENTS,
      timeoutMs: CHRONICLE_TIMEOUT_MS,
    },
  );
  const prologueGenerator = new PrologueGenerator(
    {
      persistence,
      clock,
      client: ollama,
      mode,
      fixtures,
    },
    {
      model: OLLAMA_MODEL,
      chronicleModel: CHRONICLE_MODEL,
      timeoutMs: PROLOGUE_TIMEOUT_MS,
    },
  );
  const chroniclePipeline = new ChroniclePipeline(
    persistence,
    stateManager,
    chronicleGenerator,
    { workerIntervalMs: CHRONICLE_WORKER_INTERVAL_MS },
    () => stateManager.getState().status,
  );

  const app = Fastify({ logger: true });

  const apiDeps: ApiDeps = {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    bus,
    subTickIntervalMs: SUBTICK_INTERVAL_MS,
    subTicksPerDay: SUB_TICKS_PER_DAY,
    flavorCache,
    flavorMode: mode,
    chroniclePipeline,
    prologueGenerator,
    chronicleMaxEvents: CHRONICLE_MAX_EVENTS,
    threadRunner,
    worldTags,
    rumors,
    favorsMax: FAVORS_MAX_DEFAULT,
    subTickScheduler,
    furnitureManager,
    zoneManager,
  };

  app.addHook('onClose', async () => {
    chroniclePipeline.stop();
    flavorWorker.stop();
    mode.stop();
    subTickScheduler.stop();
    scheduler.stop();
    persistence.close();
  });

  registerRoutes(app, apiDeps);
  registerSSE(app, stateManager, npcManager, bus, apiDeps);

  // First boot under Phase 3+: seed world tags and starter threads if absent.
  const isFirstPhase3Boot = persistence.getAllWorldTags().length === 0;
  if (stateManager.isColdStart() || isFirstPhase3Boot) {
    if (stateManager.isColdStart()) {
      bus.publish({ type: 'init', gameDay: stateManager.getState().gameDay });
    }
    if (isFirstPhase3Boot) {
      seedPhase3World({
        worldSeed: stateManager.getState().seed,
        gameDay: stateManager.getState().gameDay,
        worldTags,
        threadRunner,
      });
    }
  }

  if (
    npcManager.getSpawnQueue().length === 0 &&
    npcManager.getRoster().length === 0
  ) {
    npcManager.onMacroTick(stateManager.getState().gameDay);
    persistence.saveRoster(npcManager.snapshot());
  }

  // Phase 4: health-check Ollama and decide initial mode.
  await mode.runBootHealthCheck();
  mode.startPeriodicHealthCheck();

  // Phase 5: catch up any missed chronicles before starting the worker loop.
  chroniclePipeline.runCatchUp();

  scheduler.start();
  subTickScheduler.start();
  flavorWorker.start();
  chroniclePipeline.start();

  await app.listen({ port: PORT, host: HOST });
  app.log.info(
    {
      tickIntervalMs: TICK_INTERVAL_MS,
      schedulerCheckMs: SCHEDULER_CHECK_MS,
      subTickIntervalMs: SUBTICK_INTERVAL_MS,
      subTicksPerDay: SUB_TICKS_PER_DAY,
      dbPath: dbPathAbs,
      flavorMode: mode.getMode(),
      ollamaBaseUrl: OLLAMA_BASE_URL,
      ollamaModel: OLLAMA_MODEL,
    },
    'wayfarers-rest server ready',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

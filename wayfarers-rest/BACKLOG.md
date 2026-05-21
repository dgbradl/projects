# Backlog

Phases 1–6 are complete (see the git history and [README.md](./README.md)).
This file tracks **Phase 7 — "deepen gameplay"**, which turns the tavern from a
stream of strangers into a living community with its own economy.

Phase 7 is five epics. Each epic is sliced into independently shippable steps,
committed in the existing `Phase 7 (xN): …` style.

---

## Epic A — Recurring cast & memory ✅ done

Persistent NPCs that return across days and remember past visits.

- **A1** (`81ec73d`) — durable `Character` identity; returning travellers keep
  their id, display name, and archetype instead of being minted fresh.
- **A2** (`d347801`) — `CharacterMemory`: rumours heard, encounters, times
  beckoned/marked, last destination. A bus recorder folds events into it.
- **A3** (`c7b89bd`) — `npc_returned` event, chronicle salience for regulars,
  recognition-biased interactions, and a client ★ "regular" badge.

## Epic B — NPC relationships ✅ done

NPC-to-NPC affinity that accumulates from interactions.

- **B1** (`2675854`) — an `affinity` score per encounter, nudged by interaction
  kind (drinks warm it, arguments cool it), clamped to ±25.
- **B2** (`ea141b0`) — interaction bias reads affinity: friends drink together,
  rivals fall into arguments, scaled by how strong the bond has grown.
- **B3** (`9548cf4`) — a `relationship` thread archetype spawned when affinity
  reaches an extreme, so feuds and friendships surface in the chronicle.

**Loose end:** B3's production wiring — passing `threadRunner` to the
`CharacterMemoryRecorder` in `server/src/index.ts` so relationship threads
spawn in the live server — is one line, not yet committed (`index.ts` was
mid-edit by concurrent work). The B3 logic and tests are committed and green.

## Epic C — Tavern reputation & prosperity 🔧 in progress

A keeper-facing resource loop: the tavern earns and spends coin, and a
reputation/prosperity measure rises and falls with how the days go, gating
favour regeneration and arrival counts so the five interventions carry stakes.

- `coin` on `WorldState`; a daily ledger of takings and upkeep.
- `ledger_closed` events feed the chronicle.
- Reputation influencing spawn counts and favour regen.

## Epic D — More thread archetypes ⬜ not started

Pure additive content in `server/src/threads/archetypes/` — lowest structural
risk. Each is a new `ThreadDefinition`: a state machine over a few game days.

- **Feud** — a quarrel between locations or factions that escalates.
- **Missing person** — someone fails to arrive; a searcher follows.
- **Festival** — a scheduled celebration that lifts arrivals and mood.
- **War escalation** — a chained arc where a distant conflict reaches the
  region step by step (extends the existing `worldly_event` idea).

## Epic E — Tavern staff 🔧 in progress

Bartenders, waitstaff, and cleaners as a permanent NPC category — always
present, unlike arriving/departing travellers. The keeper can hire and fire
(ties into Epic C's economy). Staff have personalities, interact with guests,
and shape atmosphere and reputation.

---

## Pre-Phase-7 cleanup

Smaller debts noted along the way, worth picking up between epics:

- ~~No project README~~ — added.
- **Client test coverage is thin** relative to the server suite.
- `server/src/index.ts` injects `postSubTickHook` onto `NpcManager` via a
  type-hole cast (`as unknown as { deps: … }`). It wants a real method on
  `NpcManager` instead.
- The art assets under `client/src/assets/tavern/` are only partially wired
  into the UI.

## Sequencing

A → B done. C and E are being built in parallel. D is additive content that
can slot in between epics whenever. Order the rest by appetite: D is the
safe, self-contained pick; C and E are deeper and touch shared state.

# The Wayfarer's Rest

A persistent fantasy tavern simulation. The tavern runs on its own clock —
travellers arrive, drink, argue, carry rumours, and move on while you're away.
Each in-game day is summarised as a short chronicle, and a local LLM supplies
the flavour: names, taglines, overheard fragments, and the daily report.

You are the keeper. You don't control the tavern minute to minute; you nudge it
with a small pool of *interventions* and read back what unfolded.

## Quick start

Prerequisites:

- **Node.js 22+**
- A C toolchain for `better-sqlite3`'s native build (Xcode CLT on macOS,
  `build-essential` on Linux)
- **Ollama** (optional) — for LLM-generated flavour. Without it the sim runs
  in deterministic `placeholder` mode and still works end to end.

```sh
npm install

# Terminal 1 — the simulation server (Fastify, port 3000)
npm run dev

# Terminal 2 — the React client (Vite dev server; proxies the API to :3000)
npm run dev --workspace @wayfarers/client
```

Then open the Vite URL it prints. The server creates a SQLite world at
`data/world.db` on first boot and resumes from it on every restart.

To run with LLM flavour, have Ollama running locally and pull the model named
by `OLLAMA_MODEL` (see below). If Ollama is unreachable the server logs a
`flavor_mode_changed` event and falls back to `placeholder` automatically.

## Layout

An npm workspace with three packages:

| Package | What it is |
|---|---|
| `shared/` | `@wayfarers/shared` — the domain types shared by server and client (`shared/src/types.ts`) |
| `server/` | `@wayfarers/server` — the simulation: Fastify API, tick loop, SQLite persistence, LLM integration |
| `client/` | `@wayfarers/client` — the React + Vite front end |

## How the simulation works

**The clock.** Time advances in two grains. A *macro tick* is one game day:
the spawn queue regenerates, threads advance, a chronicle is generated. A
*sub-tick* is a fine slice within the day: NPCs move between zones, arrive,
interact, and depart. Both run on real-time intervals (configurable below) and
the world catches up on missed ticks after downtime.

**NPCs and characters.** Each visitor in the tavern is an `Npc` — their current
presence. Behind it is a durable `Character` that persists across visits, so a
traveller who leaves can return days later as the same person, remembering past
visits, the rumours they've heard, and whom they've met.

**Threads.** Off-screen storylines (a traveller's journey, an approaching
stranger, a worldly event, a relationship) tick once per day, change world
tags, schedule arrivals, and introduce rumours.

**Flavour cache.** LLM calls are slow, so generated text is produced ahead of
time into per-slot pools (arrival garnish, rumour text, overheard fragments,
names) and drawn from synchronously. A background worker refills them.

**The chronicle.** At the end of each day a salience scorer ranks the day's
events and an LLM writes a short report; a deterministic fallback covers LLM
failure. Returning after several days away yields a "Welcome back" prologue.

**Interventions.** The keeper spends a regenerating pool of *favours* on five
verbs — plant a rumour, beckon someone, sway a thread, stir the world, mark an
NPC — and the chronicle notes what the keeper set in motion.

## Running

Scripts (from the repo root):

| Command | Effect |
|---|---|
| `npm run dev` | Start the simulation server |
| `npm test` | Run the server test suite (Vitest) |
| `npm run dev --workspace @wayfarers/client` | Start the client dev server |
| `npm run build --workspace @wayfarers/client` | Type-check and build the client |

The server is configured entirely through environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` / `HOST` | API server bind address | `3000` / `0.0.0.0` |
| `DB_PATH` | SQLite world file; `:memory:` for an ephemeral world | `data/world.db` |
| `TICK_INTERVAL_MS` | Real time per game day | `3600000` (1h) |
| `SUBTICK_INTERVAL_MS` | Real time per sub-tick | `10000` (10s) |
| `SCHEDULER_CHECK_MS` | How often the tick scheduler wakes | `60000` |
| `FLAVOR_MODE` | `llm`, `placeholder`, or `recorded` | `llm` |
| `OLLAMA_BASE_URL` | Ollama endpoint | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model for flavour slots (a local Ollama model) | see `server/src/index.ts` |
| `CHRONICLE_MODEL` | Model for the daily chronicle, if different | see `server/src/index.ts` |
| `OLLAMA_REQUEST_TIMEOUT_MS` | Per-request LLM timeout | `30000` |
| `OLLAMA_HEALTH_CHECK_MS` | Interval for the Ollama health check | `30000` |
| `CHRONICLE_MAX_EVENTS` | Most events fed to the chronicle prompt | `25` |
| `CHRONICLE_TIMEOUT_MS` / `PROLOGUE_TIMEOUT_MS` | Chronicle / prologue LLM timeouts | `60000` / `30000` |

A faster-than-real clock is handy for development — e.g.
`SUBTICK_INTERVAL_MS=200 TICK_INTERVAL_MS=12000 npm run dev`.

## Development

The server suite is the project's safety net — `npm test` runs it (Vitest,
`server/test/`). Determinism matters: the RNG is seeded and many tests assert
that identical inputs reproduce identical output, so keep new randomness seeded.

The build has grown in numbered phases, visible in the git history:

1. Server foundation — tick loop, persistence, REST + SSE
2. NPCs, sub-tick scheduler, React front end
3. Threads, world state, structured event taxonomy
4. Ollama integration with a cache-fronted flavour pipeline
5. Daily chronicle pipeline and the "Welcome back" view
6. Player interventions — favour pool, five verbs
7. *In progress* — deepening gameplay (recurring cast, NPC relationships, …);
   see [BACKLOG.md](./BACKLOG.md)

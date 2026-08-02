# 🛒 Market Street

An isometric, browser-based **grocery-chain management game**. Start with two
corner stores, and grow into a citywide chain: keep shelves stocked, negotiate
with vendors, run a warehouse and truck fleet, hire people who can make
decisions for you — and out-compete **BuyLow**, the discount rival buying up
the best lots in town.

Vanilla JavaScript + Canvas. No frameworks, no assets — the whole city is
drawn procedurally.

## Play

- **Dev server:** `npm install && npm run dev` → http://localhost:5173
- **Production build:** `npm run build` (output in `dist/`), `npm run preview` to serve it.
- **GitHub Pages:** pushes to `main` build and deploy automatically via
  `.github/workflows/deploy.yml`. Enable it once in the repo settings:
  *Settings → Pages → Source: GitHub Actions.* The game then runs at
  `https://<user>.github.io/market-street/` — including on phones (the layout
  stacks map-over-panels on small screens).

## How the game works

The game runs on a **weekly rhythm**: each week ends in a planning stop — the
wrap-up report shows how the week went, the sim pauses while you adjust
orders, prices, and people, and then you hit **▶ Run the week** to watch the
plan play out. (Continuous play is a settings toggle away.)

Goods flow **vendors → warehouse → trucks → shelves → customers**, and every
link can be the bottleneck.

| System | What you manage |
| --- | --- |
| **Stores** | Staffing, price level, product assortment (limited shelf slots; remodel to widen), reputation, morale |
| **Supply** | Standing orders per product (vendor / reorder point / quantity), warehouse capacity, truck fleet — watch trucks park and unload crate by crate |
| **Vendors** | Six suppliers with different prices, quality, and lead times; haggle at a push-your-luck **dice table** — keep 🤝 leverage, bank 💬 goodwill, and stop pressing before ⚠️ offense outruns the vendor's patience. Negotiate **price** or **delivery** at the dice table with a scarce weekly meeting budget. Vendors remember the last sitting (grudges cost dice, goodwill adds them), deals age −1%/week, counters can carry volume riders, and BuyLow courts your suppliers — close a deal to keep the account |
| **People** | Department heads and store managers hired from candidate pools — each with skill (★–★★★), a salary ask, and a trait with a real mechanical effect. Delegate staffing, pricing, negotiation, sourcing, reorder tuning, even fleet capex |
| **Books** | A real P&L (weighted-average COGS), 30-day profit chart, per-store profitability, activity log |
| **Events** | Cold snaps, heat waves, vendor strikes, roadworks, festivals, price wars, inspections, fridge breakdowns |
| **Stakes** | BuyLow buys lots and siphons shoppers; sister stores cannibalize; wages drift up; debt accrues interest and the bank has limits |

**Win:** 8 stores and $200k banked. **Lose:** the bank calls your debt.
A goal ladder walks you through the systems on the way.

## Development

```sh
npm install
npm run dev        # Vite dev server with hot reload
npm run lint       # ESLint
npm test           # Vitest unit suite over the simulation
npm run build      # production build
npm run test:e2e   # Playwright smoke tests against the built app
```

The simulation (`src/game.js` + `src/defs.js`) is DOM-free and fully unit
tested — economy, logistics, vendors, delegation, stakes, save/load, and a
60-day NaN/crash soak. Rendering (`src/render.js`), panels (`src/ui.js`), and
the game loop (`src/main.js`) are covered by Playwright end-to-end tests,
including the phone-sized layout.

CI (`.github/workflows/ci.yml`) runs lint + unit + build + e2e on every push
and pull request.

### Code layout

| File | Role |
| --- | --- |
| `src/defs.js` | All static data & tuning: products, vendors, city map, districts, events, traits, goals |
| `src/game.js` | The simulation: demand, market, logistics, people, delegation, rival, ledger, persistence |
| `src/render.js` | Procedural isometric renderer: city, day/night, traffic, deliveries, ambience |
| `src/ui.js` | DOM panels: stores / supply / vendors / HQ / books, inspector, overlays |
| `src/main.js` | Fixed-step loop, input, autosave |

## Feature highlights (v0.5)

- **A world, not a void**: full time-of-day sky with a radiant sun, crescent
  moon, twinkling stars, golden-hour horizons, and a parallax skyline whose
  windows light at night — with the whole city presented as a diorama on an
  earth-strata slab
- **Cinematic light**: building faces catch the sun directionally (west in the
  morning, east in the afternoon), shadows track the sun, a warm/cool overlay
  grade ties every frame together, and night lights bloom with radial glow
- **Landmarks**: Old Town's working clock tower, Westside's water tower,
  Riverside's pier with bobbing boats, Downtown's beacon-topped glass towers
- **Texture everywhere**: rolling value-noise terrain, tire-worn roads with
  gutters and stop lines, three tree species with per-tree autumn hues, a
  river with depth, specular, and bank foam
- **Alive**: petals in spring, tumbling leaves in fall, fireflies on summer
  nights, lightning in heavy rain, birds, ducks, real little pedestrians
  everywhere, and storefronts with produce crates and shopping carts

- **A living, sunlit city**: bright grass with mottle texture, concrete
  sidewalks with seams and manholes, gabled roofs with chimneys, apartment
  water towers, parks with animated fountains, hedges, driveways, hydrants,
  and streetlights that pool warm light at night
- **Sim-tied detail**: store parking lots visibly fill as the day's customers
  arrive; the warehouse sits in a fenced container yard; BuyLow is a proper
  grey big-box with a red fascia
- **Dynamic light & weather**: shadows swing with the sun and stretch at
  golden hour, dawn/dusk get an orange grade, rain showers and snowfall roll
  through, birds cross the sky, ducks paddle the river
- **Fast**: the static ground layer renders once to an offscreen cache and
  rebuilds only on zoom/season/unlock changes

- **Seasons**: a 112-day year of four seasons shifting demand (summer beverages,
  winter pantry), spoilage (hot summers), trucking (snowy roads), and procurement
  (produce cheap at harvest, dear in winter) — with the city visibly changing:
  orange falls, snowy winters
- **Holidays**: Spring Festival, Grill-Out Weekend, Harvest Feast, and Winterfest —
  multi-day demand surges announced 5 days ahead so you can stock up against
  vendor lead times; Winterfest is followed by a post-holiday slump
- **More events**: flu season (staff effectiveness −25%), food scares and viral
  recipes (one product craters or soars), fuel spikes (vendor prices +12%),
  port congestion (+1 day on all lead times), farmers markets (cheap produce —
  a buying opportunity); weather events now respect the season

- **Camera**: wheel/pinch-button zoom anchored at the cursor, drag to pan, double-click to reset, and a corner minimap — click it to fly anywhere
- **Title screen**: pick your difficulty at the door; Reset takes you back without losing the running game until you commit
- **Sound**: procedural WebAudio SFX (deals, deliveries, events, fanfares) with a persisted mute
- **Settings**: pause-on-event, weekly report toggle, difficulty presets (Relaxed / Standard / Ruthless), save export/import
- **Vendor contracts**: commit to weekly volume for a locked 20% discount — breach and pay
- **Staff progression**: everyone earns XP and promotes (with raises) at 15/40 XP
- **Store upgrades**: cold storage (half spoilage) and self-checkout (free staffer)
- **Marketing campaigns**: paid district demand boosts on a cooldown
- **Actionable events**: one-click "match prices" during price wars; optional auto-pause on events
- **BuyLow+**: rival stores that survive 20 days upgrade into stronger superstores
- **Books**: per-product margins expose which lines earn their shelf slots
- **Weekly report**: per-store scorecards — profit with week-over-week trend, a daily revenue sparkline, shelf/staff/reputation meters, and plain statements of where problems occurred (missed sales by product, empty-depot vs delivery gaps, fleet saturation)
- **Achievements & records**: 8 trophies plus lifetime stats in HQ
- **Juice**: confetti, truck exhaust, animated event chips

## Roadmap

- Ambient music bed and richer soundscape
- Multi-city expansion — the "board approves multi-state" ending is the hook
- Rival counter-moves (poaching staff, bidding on your lots)

## License

MIT

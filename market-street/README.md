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

Goods flow **vendors → warehouse → trucks → shelves → customers**, and every
link can be the bottleneck.

| System | What you manage |
| --- | --- |
| **Stores** | Staffing, price level, product assortment (limited shelf slots; remodel to widen), reputation, morale |
| **Supply** | Standing orders per product (vendor / reorder point / quantity), warehouse capacity, truck fleet — watch trucks park and unload crate by crate |
| **Vendors** | Six suppliers with different prices, quality, and lead times; relationships and negotiated discounts up to 25% |
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

## Feature highlights (v0.2)

- **Camera**: wheel/pinch-button zoom anchored at the cursor, drag to pan, double-click to reset
- **Sound**: procedural WebAudio SFX (deals, deliveries, events, fanfares) with a persisted mute
- **Settings**: pause-on-event, weekly report toggle, difficulty presets (Relaxed / Standard / Ruthless), save export/import
- **Vendor contracts**: commit to weekly volume for a locked 20% discount — breach and pay
- **Staff progression**: everyone earns XP and promotes (with raises) at 15/40 XP
- **Store upgrades**: cold storage (half spoilage) and self-checkout (free staffer)
- **Marketing campaigns**: paid district demand boosts on a cooldown
- **Actionable events**: one-click "match prices" during price wars; optional auto-pause on events
- **BuyLow+**: rival stores that survive 20 days upgrade into stronger superstores
- **Books**: per-product margins expose which lines earn their shelf slots
- **Weekly report**: a pausing digest of profit, best/worst stores, team activity, and events
- **Achievements & records**: 8 trophies plus lifetime stats in HQ
- **Juice**: confetti, truck exhaust, animated event chips

## Roadmap

- Ambient music bed and richer soundscape
- Multi-city expansion — the "board approves multi-state" ending is the hook
- Rival counter-moves (poaching staff, bidding on your lots)

## License

MIT

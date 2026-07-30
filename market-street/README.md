# Market Street — Grocery Chain Tycoon (prototype)

An isometric, web-based **management** game: you run a small grocery chain from
the head office. Game Dev Story-style people-and-decisions management, with the
Factorio DNA living in the supply chain — goods flow **vendors → warehouse →
trucks → store shelves → customers**, and every link can be the bottleneck.

Start with 2 corner stores in Old Town; end as a citywide chain ready to go
multi-state.

## Run it

No build step, no dependencies — vanilla JS with ES modules (needs any static
server; modules don't load from `file://`):

```sh
cd market-street
python3 -m http.server 8000
# open http://localhost:8000
```

## The game

You watch the city on an isometric map; all decisions happen in the four
office panels on the right.

- **Stores** — Each store serves its neighborhood. Shoppers buy whatever's on
  the shelf; empty shelves mean lost sales and sinking reputation. Per store
  you set staffing (understaffed stores serve fewer customers) and a price
  level (cheaper = more traffic, thinner margins). Buy FOR SALE lots to open
  new stores.
- **Product range** — 11 product lines, from the core six (produce, dairy,
  bakery, meat, frozen, pantry) to optional ones: beverages, snacks,
  household, deli, seafood. Every store has limited shelf slots — pick its
  assortment line by line, and **remodel** (escalating cost) to fit more.
  A wider range means more traffic, but also more staff, more truck volume,
  and more warehouse pressure; deli and seafood have fat margins and brutal
  spoilage. Household goods are only sold by the slow, low-quality national
  distributor — a deliberate monopoly.
- **Supply** — Your warehouse feeds the chain. Set standing orders per
  product: pick a vendor, a reorder point, and an order size, and the office
  reorders automatically. Trucks shuttle stock to whichever store needs it
  most — watch them drive the road grid. Buy trucks and warehouse expansions
  as you grow. Perishables spoil, so overstocking produce is its own tax.
- **Vendors** — Four suppliers with different prices, quality, and delivery
  lead times (the cheap national distributor takes 3 days; local farms
  deliver overnight). Ordering builds relationships; negotiate to lock in
  discounts up to 25%. Failed negotiations sour the relationship.
- **HQ** — Hire department heads from candidate pools: a Head Buyer (better
  negotiation, cheaper goods), a Logistics Manager (faster, bigger trucks),
  and a Marketing Lead (more customer demand). Every candidate has a skill
  level, a salary ask, and a trait with a real mechanical effect (Haggler,
  Tetris master, Couponer, …). Salaries are daily.
- **Store managers & morale** — Each store can hire a named manager who adds
  floor coverage, lifts team morale, and cuts spoilage. Morale rises with
  good staffing and sinks when the team is stretched — and it multiplies
  sales.
- **Delegation** — Your people don't just buff numbers; they can make the
  decisions. Store managers can be trusted with staffing and pricing (they
  cut prices to fight a price war in their district, discount to win back
  shoppers, and hold higher prices when skilled). The Head Buyer can run
  vendor negotiations, switch suppliers on price/quality — re-sourcing
  instantly around strikes — and retune standing orders from measured
  demand. The Logistics Manager can be given capex authority to buy trucks
  and expand the warehouse (off by default). Skill governs how often they
  act and how sharp the calls are: a ★ manager makes rough calls every few
  days, a ★★★ manager plays near-optimally daily. Every decision lands in
  the activity feed with their name on it, and every toggle is yours.
- **Books** — A real P&L: revenue, cost of goods (weighted-average COGS, so
  vendor discounts show up in your margins), rent, wages, salaries, fines;
  today vs yesterday, a 30-day profit chart, per-store profitability, and an
  activity log of everything that happened.
- **City events** — Roughly weekly, something happens: cold snaps and heat
  waves shift demand, vendor strikes freeze deliveries (source elsewhere!),
  roadworks slow trucks, festivals spike a district, discounters start price
  wars you can only win by cutting prices, health inspections reward
  well-staffed stores and fine sloppy ones, and fridges break. Active events
  show as chips on the map with a countdown.

### Expansion arc

Districts unlock as your peak cash grows: **Old Town** (start) → **Westside**
($35k) → **Riverside** ($65k) → **Downtown** ($110k). Win by running **8
stores** with **$200k** banked — at which point the board approves multi-state
expansion (the hook for the next prototype milestone).

Progress autosaves to `localStorage`; **Reset** wipes it.

## Code layout

| File | What it does |
| --- | --- |
| `src/defs.js` | Static data: products, vendors, city map, districts, sites, tuning |
| `src/game.js` | Simulation: store demand, warehouse, truck logistics (BFS road routing), vendors, day cycle, save/load |
| `src/render.js` | Isometric city renderer: roads, districts, stores, warehouse, animated trucks |
| `src/ui.js` | Office panels: stores / supply / vendors / HQ tabs, store inspector |
| `src/main.js` | Fixed-step game loop, map input, autosave |

## Ideas for the next iteration

- Multi-state map: second city with its own warehouse, inter-city freight
- Contracts & promotions: weekly specials that spike demand for one product
- Store formats (corner store / supermarket / superstore) with upgrade paths
- Named store managers with traits, morale, and training (more Game Dev Story)
- Events: road closures, vendor strikes, cold snaps that spike demand
- Competitor chains bidding on the same lots

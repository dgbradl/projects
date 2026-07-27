# Widget Works — Supply Chain Tycoon (prototype)

An isometric, web-based business management game: Game Dev Story-style company
management crossed with Factorio-style flow of goods. Buy raw materials, route
them across conveyors through processing machines, and ship finished products
at market prices that react to how hard you flood the market.

## Run it

No build step, no dependencies — it's vanilla JS with ES modules, so it just
needs any static file server (modules don't load from `file://`):

```sh
cd widget-works
python3 -m http.server 8000
# open http://localhost:8000
```

## How to play

Goal: grow your starting **$1,000** into **$10,000**.

- **Parts/Chips Depots** import raw goods — you pay the fluctuating buy price
  per unit — onto the conveyor tile they face.
- **Conveyors** move goods one tile at a time in the direction they face
  (press **R** while placing to rotate).
- **Assembler** turns 2 Parts into 1 Widget; **Fabricator** turns
  1 Widget + 1 Chip into 1 Gadget. Machines accept inputs from any conveyor
  pointing into them and output onto the tile they face. Each machine needs a
  **worker** or it sits idle.
- **Shipping Dock** sells anything delivered to it at the current market price.
- **Staff**: hire workers ($100 signing bonus, wages paid nightly). Skill
  (★–★★★) makes their machine run faster.

### The economics

Every product has a live market price with a seasonal drift **and** a demand
curve: each unit you sell nudges that product's demand down, and demand
recovers slowly over time. Dumping widgets nonstop tanks the widget price —
higher-tier products and diversified lines are how you keep margins up. Raw
input prices drift too, so your cost basis moves under you.

Progress autosaves to `localStorage` every few seconds; **Reset** wipes it.

## Code layout

| File | What it does |
| --- | --- |
| `src/defs.js` | Static data: goods, recipes, buildings, tuning constants |
| `src/game.js` | Simulation: grid, conveyor flow, machines, market, staff, save/load |
| `src/render.js` | Isometric canvas renderer (tiles, extruded boxes, items, ghosts) |
| `src/ui.js` | DOM panels: build toolbar, market ticker, staff, inspector |
| `src/main.js` | Game loop (fixed-step), mouse/keyboard input, autosave |

## Ideas for the next iteration

- Research/upgrades (faster belts, machine tiers, new product recipes)
- Contracts: bulk orders at locked prices with deadlines
- Worker traits, training, and morale (Game Dev Story-style leveling)
- Splitters/mergers and multi-tile machines for denser factory logistics
- Competitor AI that moves market prices against you

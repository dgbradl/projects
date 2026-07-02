Vale of Embers
==============

A fantasy life simulator: a living, breathing world that shapes itself.
You are its god — you may bless, curse, and portend, but never command.

The folk of the vale live entirely on their own. They forage, farm, hunt and
build; they fall in love (walking to the next village for it, if they must),
marry, raise children, and bury them. They make friends and lifelong enemies,
brawl, murder, exile their killers, found new settlements out of ambition or
resentment, abandon dying ones as refugees, and march to war against their
neighbors — out of hatred, hunger, or a cruel leader's plain greed. In good
years they hold festivals, send food caravans to hungry neighbors, and earn
names for their deeds: Trollsbane, Dragonslayer, the Red-Handed. Their
footsteps wear visible paths into the land.

The wilds live too: deer herds graze and multiply, and wolves hunt the deer
before they hunt people — so when the herds thin in winter, the wolves turn
bold. The world is not kind: winters freeze, droughts starve, plagues burn
through crowded shelters, trolls smash what folk build, and — if the vale
grows rich enough to be worth the trip — a dragon may come. **Extinction is
a real and likely outcome.** Every world's story is written into the
chronicle as it happens, and every person carries their own life story,
told back to you when you click them.

Running it
----------

No build step, no dependencies. Serve the directory and open it:

```
npx http-server -p 8080 .        # or: python3 -m http.server 8080
# then open http://localhost:8080
```

Playing god
-----------

Your only currency is **faith**, earned slowly through the folk's worship —
and quickly through witnessed miracles (or witnessed wrath). Spend it on
divine acts from the left panel: bless the land with bounty, send rain,
heal or inspire a single soul, send omens of peace or war between
settlements, or turn cruel — blight, lightning, wolves, earthquakes.

The folk are never yours to command — but they are always watching, and
**they will invent religion to explain you**. Work miracles and a prophet
will proclaim a Way of mercy; smite and a cult of dread will arise; ignore
them for years and an order will form around the silence itself. Faith
spreads through friendship, marriage and mothers' knees; it softens or
hardens temperaments; it dedicates temples, binds villages of a shared
creed together, and drives holy wars between rival ones. And doctrine cuts
both ways: betray a faith of mercy with cruelty and it will **schism**,
its congregation breaking away to a splinter cult that preaches what you
have actually been doing. The Vale panel tells you what kind of god the
folk currently believe you to be.

- Drag to pan, scroll to zoom, space to pause; the minimap jumps you anywhere.
- Click any person, settlement, herd, or beast to know it: needs,
  personality, bonds, grudges, memories — and their life as the chronicle
  tells it. Press F to follow them as they go about their day.
- Click a chronicle entry to jump to where it happened.

How it works
------------

- `src/core/` — the simulation, pure JS with zero DOM dependencies:
  - `sim.js` orchestrates the day tick; `world.js` generates biomes,
    seasons, and regrowing resources.
  - `character.js` + `ai.js` — every person scores their options daily
    (eat, work, build, rest, court, feud, flee, fight, found a settlement)
    weighted by needs and personality traits. No scripted behavior.
  - `social.js` — compatibility, courtship, marriage, birth, inherited
    temperament, brawls, murder and exile.
  - `settlement.js` — communal stockpiles, need-driven building projects,
    inter-settlement relations.
  - `events.js` — weather, plague, monster spawns, and wars (raids launched
    by hostile, hungry neighbors).
  - `religion.js` — prophets, doctrines (mercy, wrath, silence), conversion,
    temple dedication, fading faiths and schisms — all reactions to how the
    god has actually behaved.
  - `monsters.js` — wolf packs, trolls, dragons, and the heroes who slay them.
  - `god.js` — your powers, and how witnesses interpret them.
- `src/ui/` — canvas renderer and DOM panels.
- The core is fully deterministic per seed and runs headless:

```
npm test                     # sanity + determinism checks
node test/headless.js 42 30  # watch 30 years of seed 42 from the terminal
```

Ideas for later
---------------

Save/load worlds, named heirlooms and lineage records, terrain-altering
powers, ambient audio, seafaring migration.

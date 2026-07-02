Vale of Embers
==============

A fantasy life simulator: a living, breathing world that shapes itself.
You are its god — you may bless, curse, and portend, but never command.

The folk of the vale live entirely on their own. They forage, farm, hunt and
build; they fall in love, marry, raise children, and bury them. They make
friends and lifelong enemies, brawl, murder, exile their killers, found new
settlements out of ambition or resentment, and march to war against their
neighbors. The world is not kind: winters freeze, droughts starve, plagues
burn through crowded shelters, wolves stalk the lonely, trolls smash what
folk build, and — if the vale grows rich enough to be worth the trip — a
dragon may come. **Extinction is a real and likely outcome.** Every world's
story is written into the chronicle as it happens.

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

The folk are never yours to command. They interpret what you do, remember
it, and act on their own judgment. Smite too freely and they will fear you;
save them and they will build temples.

- Drag to pan, scroll to zoom, space to pause.
- Click any person, settlement, or beast to follow their story: needs,
  personality, bonds, grudges and memories.
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

Save/load worlds, trade between friendly settlements, named heirlooms and
lineage records, terrain-altering powers, prophets and religions that
schism, seafaring migration.

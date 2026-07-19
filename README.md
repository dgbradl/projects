# NO FINAL STOP

A party-based survival-horror roguelite — playable in your browser or in the
terminal.

You create a party of three to five ordinary, frightened people who wake in the
last occupied carriage of an impossibly long train. Behind them, a supernatural
darkness — **the Blackout** — is consuming the train carriage by carriage.
Ahead: the engine, and the truth. Every ticket aboard reads **TERMINUS**.

This is the playable vertical slice of the full twenty-four-carriage design:
eight fully developed main carriages, four transitional cars, two mystery
configurations, multiple endings, and a complete run of roughly 60–90 minutes.

## Running the game

Requires Python 3.10+.

**Graphical (recommended)** — a local web app styled like an illustrated
nightmare from an old book; no dependencies beyond the standard library:

```
python -m nofinalstop --web
```

This starts a private server on `127.0.0.1:8337` and opens your browser
(`--port N` to change it, `--no-browser` to just print the URL). Everything —
parchment narrative log, ticket-styled actions, the Blackout meter, party
dossiers, the evidence board — lives in one page. Click a party member's card
to read their full dossier; *Look through their eyes* switches the observer
and visibly rewrites what the room says.

**Terminal** — the same game rendered with `rich`:

```
pip install -r requirements.txt
python -m nofinalstop
```

Useful flags:

| Flag | Effect |
|---|---|
| `--seed N` | reproducible nightmare (same party, same dice) |
| `--plain` | plain-text output, no styling |
| `--party 3..5` | party size for quick start (default 4) |
| `--secret-mode all\|some\|none` | how much you know of your characters' secrets |
| `--auto` | a bot plays a complete run (demo / smoke test) |
| `--save-dir PATH` | where saves go (default `./saves`) |

The game autosaves on entering each carriage; `Continue` on the title menu
resumes. `[s]` saves anywhere, `[q]` saves and quits.

## How to play

Each carriage is a self-contained horror scenario with the same rhythm:
**arrive → investigate → understand the carriage's rule → survive the
escalation → make a permanent choice → move forward.**

- **Numbered keys** inspect points of interest and perform actions.
  Actions cost **time**, and time feeds the Blackout behind you. Escalations
  fire the longer you linger.
- **`[o]` Switch observer** — every scene is described through the eyes of the
  active character. A physician reads a ward differently from a railwayman; a
  character at low **Composure** sees things stable minds are spared (and the
  interface itself stops being reliable). Compare perspectives; no single one
  is guaranteed true.
- **Skill checks** are 2d6 + attribute + skill against a difficulty, modified
  by traits, conditions, fears, scars, and party assists. Partial successes
  succeed at a cost. Failure creates story, not just punishment.
- **`[v]` Evidence board / `[j]` Journal** — clues, testimony, and the Rules of
  the Train you have learned. The engine at the front demands three
  authorizations: *a valid ticket, a remembered name, and a voluntary
  sacrifice* — and everything you gather bears on how the run can end.
- **Party** — trust and strain between characters shift with your choices.
  Injuries persist and bleed. Composure breaks. Survivors can be recruited.
  Scars (permanent, double-edged) mark those who survive the worst of it.

Some doors need keys, some need blood, and one or two need someone the train
has already begun to forget.

## Architecture

Everything the engine runs on is data:

```
nofinalstop/
├── engine/          # content-agnostic systems
│   ├── game.py      #   game state, carriage runtime, Blackout, travel
│   ├── chargen.py   #   procedural character/party generation
│   ├── checks.py    #   2d6 skill resolution + modifier gathering
│   ├── effects.py   #   declarative effect interpreter (~25 effect types)
│   ├── requirements.py  # declarative predicate evaluator (and/or/not, party scopes)
│   ├── perception.py    # observer-dependent text variants & low-composure mislabels
│   ├── models.py    #   Character / Relationship / Party
│   ├── save.py      #   full-state JSON save/load (including RNG state)
│   └── data.py      #   loads the registry below
├── data/
│   ├── carriages/*.json   # 12 carriages: nodes, actions, checks, escalations, exits
│   ├── professions.json   # 20 professions
│   ├── traits.json, fears.json, secrets.json, memories.json, relationships.json
│   ├── items.json, scars.json, conditions.json, rules.json
│   ├── mysteries.json     # 2 mystery configurations (change evidence & endings)
│   ├── endings.json       # 8 endings
│   └── survivors.json     # recruitable NPCs
├── ui/              # rich renderer, interactive & bot controllers, main loop
└── web/             # graphical front-end: stdlib HTTP server + session API
    ├── session.py   #   JSON views; snapshot/replay for mid-effect choices
    ├── server.py    #   ThreadingHTTPServer, /api/view + /api/cmd
    └── static/      #   single-page client (vanilla JS, pure-CSS aesthetic)
```

Both front-ends drive the same engine: the web layer holds a `Session` that
translates commands (`inspect`, `act`, `exit`, `observer`, `choose`, …) into
engine calls and returns a full JSON view. When an effect needs a character
chosen mid-resolution, the session rolls the state back (a deep-frozen
snapshot including the RNG stream), asks the browser, and replays the action
deterministically with the answer queued — so the engine never blocks on I/O.

Adding a carriage, profession, item, scar, rule, survivor, or ending means
adding JSON — the engine interprets `requires` predicates, effect lists, and
perception variants without code changes. Carriages form a graph (the Sleeper
Car is a junction; the Mirror Car's maintenance hatch crawls back to the road
not taken), and the Blackout consumes them by index.

## Tests

```
python -m pytest tests/
```

58 tests: data integrity (every cross-reference in every carriage resolves),
character generation, checks/requirements/effects/perception units, save/load
round-trips, bot-driven **complete playthroughs** through the real game loop
across many seeds, both mysteries, and all party sizes — plus web-session full
runs and a headless-Chromium browser test that plays title → carriage →
sacrifice modal → ending (skipped automatically if Playwright/Chromium are
absent). `python -m nofinalstop --auto` shows a terminal run.

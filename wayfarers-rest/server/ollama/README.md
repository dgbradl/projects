# Custom Ollama models

These Modelfiles bake the game's standing context (setting, world canon, voice,
output discipline) into named Ollama models. Once built, every request carries
that context automatically — the per-call prompts in `server/src/llm/slots/`
and `server/src/chronicle/prompts/` only need to supply the *variable* state.

## Build

```sh
ollama create wayfarers-flavor -f server/ollama/wayfarers-flavor.Modelfile
ollama create wayfarers-keeper -f server/ollama/wayfarers-keeper.Modelfile
```

Quick sanity check:

```sh
ollama run wayfarers-flavor 'Generate one tavern visitor as JSON. Archetype: rogue. Mood: smug.'
```

Rebuild after editing a Modelfile — `ollama create` is idempotent and just
overwrites the named model.

## Use

The server reads model names from environment variables, and `npm run dev` /
`npm start` auto-load `server/.env` (via `--env-file-if-exists`). That file
sets:

```sh
OLLAMA_MODEL=wayfarers-flavor
CHRONICLE_MODEL=wayfarers-keeper
```

So `npm run dev` uses the custom models with no extra flags. `server/.env` is
gitignored; `server/.env.example` is the committed template. Delete those two
lines (or the whole file) to fall back to the stock `llama3.1:8b` default in
`src/index.ts`.

## How it splits up

| Layer | Lives in | Example |
| --- | --- | --- |
| **Static** — lore, tone, rules, schema discipline | Modelfile `SYSTEM` | "no modern words", "JSON only", canon place names |
| **Dynamic** — current game state | per-call prompt | this NPC's mood, today's world tags, the day's event log |

Ollama is stateless per request: the `SYSTEM` block is not a session that
remembers — it is a fixed prefix re-fed (and KV-cached) on every call. So
anything that changes between calls still belongs in the prompt templates.

## Notes

- `temperature` in a Modelfile is only a default. Each flavor slot passes its
  own `options.temperature` per request, which overrides it.
- A child model (`FROM wayfarers-flavor`) does **not** append to the parent's
  `SYSTEM` — a new `SYSTEM` fully replaces it. That is why `wayfarers-keeper`
  is a standalone `FROM llama3.1:8b` with its own self-contained block.
- Swapping the base model is a one-line `FROM` change plus a rebuild.

You are generating one visitor to a fantasy tavern. Respond ONLY with JSON matching the schema.

Archetype: {archetype}
Mood: {mood}
Coming from: {originLocationDisplayName} ({originLocationKind})
Carrying news about: {newsContext}

Generate:
- name: an evocative fantasy name, 1-3 words, not generic
- tagline: a 4-10 word description of who they are
- item: one specific item in their pack, concrete and visual

Respond ONLY with JSON of the form: {"name": "...", "tagline": "...", "item": "..."}

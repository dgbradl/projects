# NPC sprite sheets

One sprite sheet per NPC archetype. Drop a **Mana Seed Farmer Sprite
Customizer** export into the matching folder — any `.png` filename works; the
**folder name** is what gets matched against `Npc.archetype`:

    npc/wanderer/<anything>.png
    npc/merchant/<anything>.png
    npc/refugee/<anything>.png
    npc/pilgrim/<anything>.png
    npc/soldier/<anything>.png
    npc/scholar/<anything>.png
    npc/rogue/<anything>.png
    npc/mage/<anything>.png
    npc/knight/<anything>.png
    npc/bard/<anything>.png
    npc/hunter/<anything>.png

Sheets are the standard **1024x1024**, a 16x16 grid of 64x64 cells (the
Customizer exports exactly this). Until a folder has a sheet, that archetype
renders the old status-coloured dot — so you can add them one at a time.

Tavern staff are named individuals rather than an archetype — their sheets go
in `staff/`, one per person. See `staff/README.md`.

## Animations

Which cells make up walk / idle / sit / drink lives in
`client/src/sprites/npcSheet.ts` (`ANIMATIONS`). The cell indices are read off
the pack's `_supporting files/farmer base animation guide.png`. Adjust there
if you want different poses; side-facing animations are drawn facing right and
flipped horizontally for left.

NPC status drives the pose: `seated` → sit, `at_bar` → drink, moving → walk in
the travel direction, otherwise idle facing the last direction.

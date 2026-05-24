# Staff sprite sheets

Tavern staff are individually-named characters, not a generic archetype, so
each gets their **own** sheet. The filename can be either the staff member's
character id **or just their display name** — whichever you prefer; case and
accents are ignored. So both of these match Mirela:

    staff/Mirela.png
    staff/staff_bartender_mirela.png

**Active roster** (on shift now) — display names you can use as filenames:

    Mirela   — bartender   (id: staff_bartender_mirela)
    Tomás    — waitstaff   (id: staff_waitstaff_tomas)
    Petra    — waitstaff   (id: staff_waitstaff_petra)
    Oskar    — cleaner     (id: staff_cleaner_oskar)

**Replacement pool** (only appear if an active member leaves):

    Corvin   — bartender   (id: staff_bartender_corvin)
    Emmett   — waitstaff   (id: staff_waitstaff_emmett)
    Lenna    — cleaner     (id: staff_cleaner_lenna)

Same format as the archetype sheets — a 1024x1024 Customizer export. A staff
member with no sheet here falls back to their archetype sheet, then to the
status dot. If you'd rather two staff share a look, just export the same sheet
under both filenames.

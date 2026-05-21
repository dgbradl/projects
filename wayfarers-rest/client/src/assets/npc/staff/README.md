# Staff sprite sheets

Tavern staff are individually-named characters, not a generic archetype, so
each gets their **own** sheet. The filename must match the staff member's
character id (from the server's `staff-roster.ts`):

**Active roster** (on shift now):

    staff_bartender_mirela.png    Mirela  — bartender
    staff_waitstaff_tomas.png     Tomás   — waitstaff
    staff_waitstaff_petra.png     Petra   — waitstaff
    staff_cleaner_oskar.png       Oskar   — cleaner

**Replacement pool** (only appear if an active member leaves):

    staff_bartender_corvin.png    Corvin  — bartender
    staff_waitstaff_emmett.png    Emmett  — waitstaff
    staff_cleaner_lenna.png       Lenna   — cleaner

Same format as the archetype sheets — a 1024x1024 Customizer export. A staff
member with no sheet here falls back to their archetype sheet, then to the
status dot. If you'd rather two staff share a look, just export the same sheet
under both filenames.

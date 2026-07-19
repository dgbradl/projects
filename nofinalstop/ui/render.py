"""Terminal presentation. Uses rich when available; degrades to plain text.

The visual direction is 'an illustrated nightmare from an old book':
dirty-ivory text, heavy blacks, desaturated accents, imperfect borders.
"""

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    from rich import box
    HAS_RICH = True
except ImportError:  # pragma: no cover
    HAS_RICH = False

IVORY = "navajo_white1"
DIM_IVORY = "wheat4"
BLOOD = "red3"
BRASS = "dark_goldenrod"
SMOKE = "grey58"
MIND = "medium_purple3"
EVID = "cadet_blue"
GAIN = "dark_sea_green4"

EVENT_STYLES = {
    "text": IVORY,
    "gain": GAIN,
    "loss": "khaki3",
    "harm": BLOOD,
    "death": f"bold {BLOOD}",
    "mind": MIND,
    "alert": f"bold {BRASS}",
    "evidence": EVID,
    "rule": f"bold {EVID}",
    "scar": f"bold {MIND}",
    "bond": "steel_blue",
    "blackout": "bold white on grey11",
    "escalation": f"bold {BLOOD}",
    "check": SMOKE,
    "ending": f"bold {BRASS}",
}

TITLE_ART = r"""
                    ___   ___   ___
      _________..--|___|-|___|-|___|--..________
     |  NO  FINAL  STOP                :::::::: |
  ___|______________________________________ ___|___
   O-O    O-O                O-O    O-O   `O-O   O-O
"""


class Renderer:
    def __init__(self, plain=False, width=None):
        self.plain = plain or not HAS_RICH
        if not self.plain:
            self.console = Console(highlight=False, width=width)

    # ---------------------------------------------------------------- basics
    def _print(self, text, style=None):
        if self.plain:
            print(text)
        else:
            self.console.print(Text(str(text), style=style or IVORY))

    def line(self):
        self._print("")

    def rule(self, title=""):
        if self.plain:
            print(("--- " + title + " ").ljust(72, "-") if title else "-" * 72)
        else:
            self.console.rule(Text(title, style=f"bold {BRASS}"), style=SMOKE)

    def banner(self):
        if self.plain:
            print(TITLE_ART)
            print("A survival-horror journey aboard a train with no destination but TERMINUS.")
        else:
            self.console.print(Text(TITLE_ART, style=f"bold {IVORY}"))
            self.console.print(Text("  A party of strangers. A train that cannot stop. "
                                    "A darkness eating its way forward.", style=SMOKE))
        self.line()

    # ---------------------------------------------------------------- events
    def event(self, e):
        kind = e.get("kind", "text")
        text = e.get("text", "")
        if not text:
            return
        if kind == "arrive":
            self.line()
            if self.plain:
                print("=" * 72)
                print(f"   {text}")
                print("=" * 72)
            else:
                self.console.print(Panel(Text(text, style=f"bold {IVORY}", justify="center"),
                                         box=box.HEAVY, style=BRASS))
            return
        if kind == "ending":
            self.line()
            if self.plain:
                print("#" * 72)
                print(f"   {text}")
                print("#" * 72)
            else:
                self.console.print(Panel(Text(text, style=f"bold {BRASS}", justify="center"),
                                         box=box.DOUBLE, style=BLOOD))
            return
        style = EVENT_STYLES.get(kind, IVORY)
        prefix = {"gain": "  + ", "loss": "  - ", "harm": "  ✗ ", "death": "  ✝ ",
                  "mind": "  ~ ", "evidence": "  ◆ ", "rule": "  § ", "scar": "  ‡ ",
                  "bond": "  ∞ ", "check": "    ", "alert": "  ! ",
                  "blackout": "  ▓ ", "escalation": "  ►► "}.get(kind, "")
        body = text if kind in ("text",) else prefix + text
        if kind == "text":
            self.line()
        self._print(body, style)

    def events(self, evs):
        for e in evs:
            self.event(e)

    # ---------------------------------------------------------------- status
    def status(self, game):
        car = game.carriage()
        dist = game.blackout_distance()
        active = game.party.active
        if dist <= 0:
            meter = "THE BLACKOUT IS HERE"
        else:
            meter = "▓" * min(dist, 8) + f"  {dist} car{'s' if dist != 1 else ''} behind"
        res = game.party.resources
        res_str = "  ".join(f"{k[:4]}:{v}" for k, v in sorted(res.items()) if v > 0) or "nothing"
        obs = f"{active.name} ({active.health}/{active.max_health} hp, {active.composure}/{active.max_composure} comp)" if active else "—"
        if self.plain:
            print(f"[{car['name']} | t+{game.time_in_carriage}m | Blackout: {meter}]")
            print(f"[Observer: {obs} | Supplies: {res_str}]")
        else:
            t = Text()
            t.append(f" {car['name']} ", style=f"bold {IVORY} on grey15")
            t.append(f" t+{game.time_in_carriage}m ", style=f"{SMOKE} on grey15")
            t.append(" Blackout: ", style=f"{SMOKE} on grey15")
            t.append(meter + " ", style=(f"bold {BLOOD} on grey15" if dist <= 1 else f"{DIM_IVORY} on grey15"))
            self.console.print(t)
            t2 = Text()
            t2.append(f" Observer: {obs} ", style=f"{EVID} on grey15")
            t2.append(f" {res_str} ", style=f"{DIM_IVORY} on grey15")
            self.console.print(t2)

    # ---------------------------------------------------------------- menus
    def menu(self, title, options):
        self.line()
        if title:
            self._print(title, f"bold {IVORY}")
        for opt in options:
            label = f"  [{opt['key']}] {opt['label']}"
            if not opt.get("enabled", True):
                self._print(label + ("  — " + opt["note"] if opt.get("note") else ""), SMOKE)
            else:
                style = {"exit": BRASS, "system": DIM_IVORY, "danger": BLOOD}.get(opt.get("tone"), IVORY)
                self._print(label, style)

    def prompt_text(self):
        return "> "

    # ---------------------------------------------------------------- sheets
    def character_sheet(self, registry, c, full=True):
        prof = registry.professions.get(c.profession, {"name": c.profession})
        self.rule(c.name)
        self._print(f"{prof['name']}, {c.age}, {c.pronouns} — from {c.background}", DIM_IVORY)
        self._print(f"Looks: {c.appearance}", SMOKE)
        attrs = "  ".join(f"{a.title()[:4]} {v}" for a, v in c.attrs.items())
        self._print(f"Attributes: {attrs}", IVORY)
        skills = ", ".join(f"{registry.skills.get(s, {'name': s})['name']} {v}"
                           for s, v in sorted(c.skills.items()) if v > 0)
        self._print(f"Skills: {skills}", IVORY)
        tp = registry.traits.get(c.trait_positive, {})
        td = registry.traits.get(c.trait_difficult, {})
        fear = registry.fears.get(c.fear, {})
        self._print(f"Traits: {tp.get('name', '?')} / {td.get('name', '?')}   Fear: {fear.get('name', '?')}", MIND)
        self._print(f"Health {c.health}/{c.max_health}   Composure {c.composure}/{c.max_composure}", GAIN)
        if c.conditions:
            names = [registry.conditions.get(x, {"name": x})["name"] for x in c.conditions]
            self._print("Conditions: " + ", ".join(names), BLOOD)
        if c.scars:
            names = [registry.scars.get(x, {"name": x})["name"] for x in c.scars]
            self._print("Scars: " + ", ".join(names), f"bold {MIND}")
        if full:
            if c.secret_known and c.secret:
                sec = registry.secrets.get(c.secret, {})
                self._print(f"Secret: {sec.get('name', '?')} — {sec.get('desc', '')}", BRASS)
            elif c.secret:
                self._print("Secret: (even you do not know it yet)", SMOKE)
            item = registry.item(c.personal_item) if c.personal_item else None
            if item:
                self._print(f"Carried aboard: {item['name']} — {item.get('desc', '')}", EVID)
            for m in c.memories:
                tag = {"believed": "A memory they believe",
                       "incomplete": "A memory with a hole in it",
                       "contradicting": "A memory that contradicts someone"}.get(m["kind"], m["kind"])
                self._print(f"{tag}: {m['text']}", SMOKE)

    def party_sheet(self, registry, game):
        self.rule("The Party")
        for c in game.party.characters:
            status = ""
            if not c.alive:
                status = f"  [{c.fate or 'dead'}]"
            marker = "▸ " if c.id == game.party.active_id else "  "
            prof = registry.professions.get(c.profession, {"name": c.profession})
            conds = ",".join(registry.conditions.get(x, {"name": x})["name"] for x in c.conditions)
            self._print(f"{marker}{c.name} — {prof['name']} — hp {c.health}/{c.max_health} "
                        f"comp {c.composure}/{c.max_composure}"
                        + (f" [{conds}]" if conds else "") + status,
                        BLOOD if not c.alive else IVORY)
        self.line()
        self._print("Bonds:", f"bold {IVORY}")
        for r in game.party.relationships:
            a, b = game.party.get(r.a), game.party.get(r.b)
            if not a or not b:
                continue
            kind = registry.relationships.get(r.kind, {"name": r.kind})["name"]
            self._print(f"  {a.name} & {b.name} — {kind} — trust {r.trust}/5, strain {r.strain}/5",
                        "steel_blue")

    def inventory_sheet(self, registry, game):
        self.rule("Shared Inventory")
        low = False
        active = game.party.active
        if active and active.composure <= 3:
            low = True
        for iid, count in sorted(game.party.inventory.items()):
            item = registry.item(iid)
            name = item["name"]
            if low and item.get("low_composure_name"):
                name = item["low_composure_name"]
            self._print(f"  {name}" + (f" x{count}" if count > 1 else ""), IVORY)
            if item.get("desc"):
                self._print(f"      {item['desc']}", SMOKE)
        self.line()
        self._print("Supplies: " + ("  ".join(f"{k.replace('_', ' ')}: {v}"
                    for k, v in sorted(game.party.resources.items())) or "none"), DIM_IVORY)

    def evidence_board(self, game):
        self.rule("The Evidence Board")
        if not game.evidence:
            self._print("  Nothing pinned yet. The train is still all questions.", SMOKE)
            return
        by_cat = {}
        for eid, e in game.evidence.items():
            by_cat.setdefault(e.get("category", "observation"), []).append(e)
        order = ["observation", "testimony", "physical", "memory", "rule", "identity", "contradiction", "theory"]
        for cat in order + [c for c in by_cat if c not in order]:
            if cat not in by_cat:
                continue
            self._print(f"— {cat.upper()} —", f"bold {EVID}")
            for e in by_cat[cat]:
                self._print(f"  ◆ {e['title']}", EVID)
                if e.get("text"):
                    self._print(f"      {e['text']}", SMOKE)

    def journal_sheet(self, registry, game):
        self.rule("Passenger Journal")
        if game.rules_known:
            self._print("Rules of the Train:", f"bold {EVID}")
            for rid in game.rules_known:
                rule = registry.rules.get(rid, {"text": rid})
                self._print(f"  § {rule['text']}", EVID)
            self.line()
        mystery = registry.mysteries.get(game.mystery, {})
        self._print(f"Entries ({len(game.journal)}):", f"bold {IVORY}")
        for entry in game.journal:
            self._print(f"  · {entry}", DIM_IVORY)
        self.line()
        self._print(f"Carriages passed: {len(game.visited)}   Time aboard: {game.total_time} min",
                    SMOKE)

    def epilogue(self, registry, game):
        ending = registry.endings.get(game.ending, {})
        self.line()
        self.rule("Epilogue")
        for c in game.party.characters:
            if c.alive:
                fate = "survived to the end of the line"
                if game.ending == "consumed":
                    fate = "was inventoried by the Shape Behind the Train"
                elif game.ending == "the_blackout":
                    fate = "stepped through the door made of dark"
                elif game.ending == "release":
                    fate = "fell into a different night when the train scattered"
                elif game.ending == "mercy":
                    fate = "dissolved smiling, at rest at last"
                elif game.ending == "the_last_stop":
                    fate = "stepped down onto the platform" if c.composure >= 3 else \
                           "stood in the doorway, translucent, waving"
                elif game.ending in ("containment",):
                    fate = "remains aboard, a keeper of the sleep"
                elif game.ending == "new_conductor":
                    fate = "rides on, first class, under new management"
            else:
                fate = c.fate or "died aboard"
            scars = ", ".join(registry.scars.get(s, {"name": s})["name"] for s in c.scars)
            line = f"  {c.name} — {fate}."
            if scars:
                line += f"  Scars carried: {scars}."
            self._print(line, IVORY if c.alive else BLOOD)
        self.line()
        self._print(f"Mystery of this run: {registry.mysteries.get(game.mystery, {}).get('name', '?')}",
                    BRASS)
        truth = registry.mysteries.get(game.mystery, {}).get("truth_text", "")
        if truth and ending.get("victory"):
            self._print(f"  The truth: {truth}", SMOKE)
        self._print(f"Evidence gathered: {len(game.evidence)}   Rules learned: {len(game.rules_known)}   "
                    f"Carriages: {len(game.visited)}   Time aboard: {game.total_time} minutes", SMOKE)

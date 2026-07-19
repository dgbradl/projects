"""Skill check resolution.

2d6 + attribute + skill + situational modifiers vs. a difficulty class.
  - total >= dc            : success   (double sixes: critical success)
  - dc-2 <= total < dc     : partial   (succeed at a cost)
  - total < dc-2           : failure   (double ones: critical failure)

Modifiers come from data: personality traits carry tag-matched bonuses or
penalties, conditions carry global or attribute penalties, an action whose
fear_tags touch the character's fear imposes -2, and another party member
trained in the same skill can assist for +1.
"""

DIFFICULTY = {"easy": 8, "normal": 10, "hard": 12, "extreme": 14}


class CheckResult:
    def __init__(self, tier, total, dc, dice, mods, character, notes=None):
        self.tier = tier            # crit | success | partial | fail | fumble
        self.total = total
        self.dc = dc
        self.dice = dice
        self.mods = mods            # list of (label, value)
        self.character = character
        self.notes = notes or []

    @property
    def success(self):
        return self.tier in ("crit", "success", "partial")


def gather_modifiers(registry, game, character, attr, skill, tags):
    mods = []
    mods.append((attr.title(), character.attrs.get(attr, 0)))
    if skill:
        lvl = character.skill_level(skill)
        if lvl:
            skill_name = registry.skills.get(skill, {}).get("name", skill)
            mods.append((skill_name, lvl))
    tags = set(tags or [])

    for tid in (character.trait_positive, character.trait_difficult):
        trait = registry.traits.get(tid)
        if not trait:
            continue
        cm = trait.get("check_mod")
        if cm and (not cm.get("tags") or tags & set(cm["tags"])):
            mods.append((trait["name"], cm["bonus"]))

    for cid in character.conditions:
        cond = registry.conditions.get(cid, {})
        if cond.get("check_penalty"):
            mods.append((cond.get("name", cid), cond["check_penalty"]))
        ap = cond.get("attr_penalty", {})
        if attr in ap:
            mods.append((cond.get("name", cid), ap[attr]))

    fear = registry.fears.get(character.fear)
    if fear and tags & set(fear.get("tags", [fear["id"]])):
        mods.append(("Fear: " + fear["name"], -2))

    for sid in character.scars:
        scar = registry.scars.get(sid, {})
        cm = scar.get("check_mod")
        if cm and (not cm.get("tags") or tags & set(cm["tags"])):
            mods.append((scar["name"], cm["bonus"]))

    if skill:
        for other in game.party.living:
            if other.id != character.id and other.skill_level(skill) >= 2:
                mods.append(("Assist: " + other.name.split()[0], 1))
                break
    return mods


def run_check(registry, game, character, attr, skill=None, dc=10, tags=None):
    if isinstance(dc, str):
        dc = DIFFICULTY.get(dc, 10)
    rng = game.rng
    d1, d2 = rng.roll_2d6()
    mods = gather_modifiers(registry, game, character, attr, skill, tags)
    total = d1 + d2 + sum(v for _, v in mods)
    notes = []

    def tier_for(t, dice):
        if dice == (1, 1):
            return "fumble"
        if dice == (6, 6):
            return "crit"
        if t >= dc:
            return "success"
        if t >= dc - 2:
            return "partial"
        return "fail"

    tier = tier_for(total, (d1, d2))

    # Out of Time scar: once per carriage, a failed action repeats itself.
    if tier in ("fail", "fumble") and character.has_scar("out_of_time") and not character.used_second_chance:
        character.used_second_chance = True
        character.age += 2
        notes.append(f"Time folds back on itself. {character.name} tries again — and is two years older.")
        d1, d2 = rng.roll_2d6()
        total = d1 + d2 + sum(v for _, v in mods)
        tier = tier_for(total, (d1, d2))

    return CheckResult(tier, total, dc, (d1, d2), mods, character, notes)

"""Declarative effect interpreter.

Carriage data expresses consequences as lists of effect objects.  The engine
interprets them against the game state and returns renderable events, so new
content never requires new code.

Every effect may carry:
  "if": <requirement>   — applied only when it passes (focus = actor)
  "chance": 0.0-1.0     — probability gate

`who` targets: actor | active | party | others | random | chosen |
weakest | strongest | steadiest | shakiest | char:<character-id>
"""

from .requirements import check_requirements
from .perception import resolve_text


def _targets(game, who, actor):
    party = game.party
    living = party.living
    if not living:
        return []
    who = who or "actor"
    if who in ("actor", "active"):
        c = actor if who == "actor" else party.active
        return [c] if c else []
    if who == "party":
        return list(living)
    if who == "others":
        return [c for c in living if actor is None or c.id != actor.id]
    if who == "random":
        return [game.rng.choice(living)]
    if who == "chosen":
        c = party.get(game.last_chosen_id) if game.last_chosen_id else None
        return [c] if c and c.alive else []
    if who == "weakest":
        return [min(living, key=lambda c: c.health)]
    if who == "strongest":
        return [max(living, key=lambda c: c.health)]
    if who == "shakiest":
        return [min(living, key=lambda c: c.composure)]
    if who == "steadiest":
        return [max(living, key=lambda c: c.composure)]
    if who.startswith("char:"):
        c = party.get(who[5:])
        return [c] if c and c.alive else []
    return []


def apply_effects(game, effects, actor=None, events=None):
    """Apply a list of effect dicts. Returns a list of event dicts for the UI."""
    registry = game.registry
    events = events if events is not None else []
    actor = actor or game.party.active
    for eff in effects or []:
        if "if" in eff and not check_requirements(game, eff["if"], actor):
            continue
        if "chance" in eff and not game.rng.chance(eff["chance"]):
            continue
        etype = eff.get("type", "text")
        handler = _HANDLERS.get(etype)
        if handler:
            handler(game, eff, actor, events)
        else:
            events.append({"kind": "alert", "text": f"[unknown effect: {etype}]"})
    return events


def _ev(events, kind, text):
    if text:
        events.append({"kind": kind, "text": text})


# ---------------------------------------------------------------- handlers

def _fx_text(game, eff, actor, events):
    _ev(events, eff.get("style", "text"), resolve_text(game, eff.get("text")))


def _fx_item(game, eff, actor, events):
    if "add" in eff:
        count = eff.get("count", 1)
        game.party.add_item(eff["add"], count)
        item = game.registry.item(eff["add"])
        if not eff.get("silent"):
            _ev(events, "gain", f"Gained: {item['name']}" + (f" x{count}" if count > 1 else ""))
    if "remove" in eff:
        item = game.registry.item(eff["remove"])
        if game.party.remove_item(eff["remove"], eff.get("count", 1)) and not eff.get("silent"):
            _ev(events, "loss", f"Lost: {item['name']}")


def _fx_resource(game, eff, actor, events):
    rid, delta = eff["id"], eff.get("delta", 0)
    game.party.add_resource(rid, delta)
    name = rid.replace("_", " ").title()
    if not eff.get("silent"):
        _ev(events, "gain" if delta > 0 else "loss", f"{name} {'+' if delta > 0 else ''}{delta}")


def _fx_composure(game, eff, actor, events):
    delta = eff.get("delta", -1)
    for c in _targets(game, eff.get("who"), actor):
        before = c.composure
        c.shift_composure(delta)
        if c.composure != before and not eff.get("silent"):
            word = "steadies" if delta > 0 else "slips"
            _ev(events, "mind", f"{c.name}'s composure {word} ({before} → {c.composure}).")
        if c.has_condition("panicked") and before > 0 and c.composure == 0:
            _ev(events, "alert", f"{c.name} is panicking.")


def _fx_harm(game, eff, actor, events):
    amount = eff.get("amount", 1)
    for c in _targets(game, eff.get("who"), actor):
        c.hurt(amount)
        _ev(events, "harm", f"{c.name} takes {amount} harm ({c.health}/{c.max_health}).")
        if not c.alive:
            c.fate = eff.get("fate", c.fate or "died")
            _ev(events, "death", f"{c.name} is dead.")
            game.on_death(c, events)


def _fx_heal(game, eff, actor, events):
    amount = eff.get("amount", 1)
    for c in _targets(game, eff.get("who"), actor):
        before = c.health
        c.heal(amount)
        if c.health != before and not eff.get("silent"):
            _ev(events, "gain", f"{c.name} recovers ({before} → {c.health}).")


def _fx_condition(game, eff, actor, events):
    for c in _targets(game, eff.get("who"), actor):
        if "add" in eff and not c.has_condition(eff["add"]):
            c.add_condition(eff["add"])
            cond = game.registry.conditions.get(eff["add"], {"name": eff["add"]})
            _ev(events, "harm", f"{c.name} is now {cond['name']}.")
        if "remove" in eff and c.has_condition(eff["remove"]):
            c.remove_condition(eff["remove"])
            cond = game.registry.conditions.get(eff["remove"], {"name": eff["remove"]})
            _ev(events, "gain", f"{c.name} is no longer {cond['name']}.")


def _fx_scar(game, eff, actor, events):
    for c in _targets(game, eff.get("who"), actor):
        sid = eff["add"]
        if not c.has_scar(sid):
            c.scars.append(sid)
            scar = game.registry.scars.get(sid, {"name": sid})
            _ev(events, "scar", f"{c.name} gains a Scar: {scar['name']} — {scar.get('desc', '')}")


def _fx_flag(game, eff, actor, events):
    if "set" in eff:
        game.flags.add(eff["set"])
    if "clear" in eff:
        game.flags.discard(eff["clear"])


def _fx_evidence(game, eff, actor, events):
    eid = eff["id"]
    if eid not in game.evidence:
        game.evidence[eid] = {
            "title": resolve_text(game, eff.get("title", eid)),
            "category": eff.get("category", "observation"),
            "text": resolve_text(game, eff.get("text", "")),
            "carriage": game.position,
        }
        _ev(events, "evidence", f"Evidence added to the board: {game.evidence[eid]['title']}")


def _fx_rule(game, eff, actor, events):
    rid = eff["id"]
    if rid not in game.rules_known:
        game.rules_known.append(rid)
        rule = game.registry.rules.get(rid, {"text": rid})
        _ev(events, "rule", f"Rule of the Train learned: “{rule['text']}”")


def _fx_relationship(game, eff, actor, events):
    a_list = _targets(game, eff.get("a", "actor"), actor)
    b_list = _targets(game, eff.get("b", "others"), actor)
    for a in a_list:
        for b in b_list:
            if a.id == b.id:
                continue
            r = game.party.shift_relationship(a.id, b.id,
                                              trust=eff.get("trust", 0),
                                              strain=eff.get("strain", 0))
            if not eff.get("silent"):
                bits = []
                if eff.get("trust"):
                    bits.append(f"trust {'+' if eff['trust'] > 0 else ''}{eff['trust']}")
                if eff.get("strain"):
                    bits.append(f"strain {'+' if eff['strain'] > 0 else ''}{eff['strain']}")
                _ev(events, "bond", f"{a.name} & {b.name}: {', '.join(bits)} (trust {r.trust}, strain {r.strain})")


def _fx_time(game, eff, actor, events):
    game.advance_time(eff.get("minutes", 0), events, from_effect=True)


def _fx_blackout(game, eff, actor, events):
    minutes = eff.get("minutes", 0)
    game.blackout_minutes = max(0, game.blackout_minutes + minutes)
    if minutes < 0:
        _ev(events, "gain", "The darkness behind the train seems to hesitate.")
    elif minutes > 0:
        _ev(events, "alert", "The Blackout surges closer.")
    game.check_blackout(events)


def _fx_unlock_exit(game, eff, actor, events):
    st = game.carriage_state()
    if eff["id"] not in st["unlocked_exits"]:
        st["unlocked_exits"].append(eff["id"])
        if not eff.get("silent"):
            _ev(events, "gain", "A way forward is open.")


def _fx_lock_exit(game, eff, actor, events):
    st = game.carriage_state()
    if eff["id"] in st["unlocked_exits"]:
        st["unlocked_exits"].remove(eff["id"])


def _fx_reveal_node(game, eff, actor, events):
    st = game.carriage_state()
    if eff["id"] not in st["revealed"]:
        st["revealed"].append(eff["id"])


def _fx_hide_node(game, eff, actor, events):
    st = game.carriage_state()
    if eff["id"] not in st["hidden"]:
        st["hidden"].append(eff["id"])


def _fx_recruit(game, eff, actor, events):
    from .chargen import build_survivor
    sid = eff["id"]
    if any(c.id == sid for c in game.party.characters):
        return
    c = build_survivor(game.registry, sid)
    game.party.add(c)
    _ev(events, "gain", f"{c.name} joins the party.")


def _fx_kill(game, eff, actor, events):
    for c in _targets(game, eff.get("who"), actor):
        c.alive = False
        c.health = 0
        c.fate = eff.get("fate", "died")
        _ev(events, "death", f"{c.name} — {c.fate}.")
        game.on_death(c, events)


def _fx_leave(game, eff, actor, events):
    for c in _targets(game, eff.get("who"), actor):
        c.alive = False
        c.fate = eff.get("fate", "left the party")
        _ev(events, "loss", f"{c.name} {c.fate}.")


def _fx_choose_character(game, eff, actor, events):
    prompt = resolve_text(game, eff.get("prompt", "Choose someone."))
    candidates = [c for c in game.party.living
                  if check_requirements(game, eff.get("candidate_if"), c)]
    if not candidates:
        apply_effects(game, eff.get("none_effects", []), actor, events)
        return
    chosen = game.controller.choose_character(game, prompt, candidates,
                                              optional=eff.get("optional", False))
    if chosen is None:
        apply_effects(game, eff.get("skip_effects", []), actor, events)
        return
    game.last_chosen_id = chosen.id
    _ev(events, "text", eff.get("chosen_text", "").replace("{name}", chosen.name)
        if eff.get("chosen_text") else "")
    apply_effects(game, eff.get("effects", []), actor, events)


def _fx_journal(game, eff, actor, events):
    game.journal.append(resolve_text(game, eff.get("text", "")))


def _fx_ending(game, eff, actor, events):
    game.trigger_ending(eff["id"], events)


def _fx_set_active(game, eff, actor, events):
    targets = _targets(game, eff.get("who", "random"), actor)
    if targets:
        game.party.set_active(targets[0].id)


_HANDLERS = {
    "text": _fx_text,
    "item": _fx_item,
    "resource": _fx_resource,
    "composure": _fx_composure,
    "harm": _fx_harm,
    "heal": _fx_heal,
    "condition": _fx_condition,
    "scar": _fx_scar,
    "flag": _fx_flag,
    "evidence": _fx_evidence,
    "rule": _fx_rule,
    "relationship": _fx_relationship,
    "time": _fx_time,
    "blackout": _fx_blackout,
    "unlock_exit": _fx_unlock_exit,
    "lock_exit": _fx_lock_exit,
    "reveal_node": _fx_reveal_node,
    "hide_node": _fx_hide_node,
    "recruit": _fx_recruit,
    "kill": _fx_kill,
    "leave": _fx_leave,
    "choose_character": _fx_choose_character,
    "journal": _fx_journal,
    "ending": _fx_ending,
    "set_active": _fx_set_active,
}

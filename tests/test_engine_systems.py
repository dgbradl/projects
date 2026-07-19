"""Unit tests for checks, requirements, effects, perception, and the Blackout."""

from nofinalstop.engine.rng import Rng
from nofinalstop.engine.game import GameState
from nofinalstop.engine.checks import run_check, gather_modifiers
from nofinalstop.engine.requirements import check_requirements
from nofinalstop.engine.effects import apply_effects
from nofinalstop.engine.perception import resolve_text, display_name


class StubController:
    """Always picks the first candidate."""
    def choose_character(self, game, prompt, candidates, optional=False):
        return candidates[0]


def make_game(registry, seed=42):
    g = GameState(registry, Rng(seed), StubController())
    g.start_new(size=4, events=[])
    return g


# ------------------------------------------------------------------ checks
def test_check_tiers_and_bounds(registry):
    g = make_game(registry)
    c = g.party.active
    seen = set()
    for _ in range(200):
        r = run_check(registry, g, c, "body", None, dc=10)
        assert r.tier in ("crit", "success", "partial", "fail", "fumble")
        assert r.dc == 10
        seen.add(r.tier)
    assert "success" in seen and "fail" in seen


def test_fear_penalty_applies(registry):
    g = make_game(registry)
    c = g.party.active
    c.fear = "darkness"
    fear_tags = registry.fears["darkness"]["tags"]
    mods = gather_modifiers(registry, g, c, "will", None, fear_tags)
    assert any(v == -2 and n.startswith("Fear") for n, v in mods)
    mods_neutral = gather_modifiers(registry, g, c, "will", None, ["social"])
    assert not any(n.startswith("Fear") for n, _ in mods_neutral)


def test_condition_penalty_applies(registry):
    g = make_game(registry)
    c = g.party.active
    c.add_condition("panicked")
    mods = gather_modifiers(registry, g, c, "reason", None, [])
    assert any(v == -2 for n, v in mods if "Panicked" in n)


def test_out_of_time_scar_rerolls_once(registry):
    g = make_game(registry)
    c = g.party.active
    c.scars.append("out_of_time")
    age = c.age
    rerolled = False
    for _ in range(60):
        c.used_second_chance = False
        r = run_check(registry, g, c, "body", None, dc=14)
        if r.notes:
            rerolled = True
            break
    assert rerolled
    assert c.age > age


# ------------------------------------------------------------- requirements
def test_requirements_basics(registry):
    g = make_game(registry)
    g.flags.add("x")
    assert check_requirements(g, {"flag": "x"})
    assert not check_requirements(g, {"flag": "y"})
    assert check_requirements(g, {"not_flag": "y"})
    assert check_requirements(g, {"any": [{"flag": "y"}, {"flag": "x"}]})
    assert not check_requirements(g, {"all": [{"flag": "y"}, {"flag": "x"}]})
    assert not check_requirements(g, {"not": {"flag": "x"}})
    g.party.add_item("lantern")
    assert check_requirements(g, {"item": "lantern"})
    assert not check_requirements(g, {"not_item": "lantern"})


def test_any_party_requirement(registry):
    g = make_game(registry)
    focus = g.party.living[0]
    other = g.party.living[1]
    other.scars.append("hollow_bones")
    assert not check_requirements(g, {"scar": "hollow_bones"}, focus)
    assert check_requirements(g, {"scar": "hollow_bones", "any_party": True}, focus)


def test_visited_requirement(registry):
    g = make_game(registry)
    assert check_requirements(g, {"visited": "rear_carriage"})
    assert check_requirements(g, {"not_visited": "engine"})


# ------------------------------------------------------------------ effects
def test_item_resource_effects(registry):
    g = make_game(registry)
    ev = apply_effects(g, [{"type": "item", "add": "lantern"},
                           {"type": "resource", "id": "food", "delta": 2}])
    assert g.party.has_item("lantern")
    assert g.party.resources["food"] >= 2
    assert any(e["kind"] == "gain" for e in ev)


def test_harm_death_and_grief(registry):
    g = make_game(registry)
    victim = g.party.living[-1]
    before = {c.id: c.composure for c in g.party.living if c.id != victim.id}
    ev = apply_effects(g, [{"type": "harm", "who": f"char:{victim.id}", "amount": 99}])
    assert not victim.alive
    assert any(e["kind"] == "death" for e in ev)
    for c in g.party.living:
        assert c.composure < before[c.id]


def test_composure_clamps_and_panic(registry):
    g = make_game(registry)
    c = g.party.active
    apply_effects(g, [{"type": "composure", "who": "actor", "delta": -99}])
    assert c.composure == 0
    assert c.has_condition("panicked")
    apply_effects(g, [{"type": "composure", "who": "actor", "delta": 99}])
    assert c.composure == c.max_composure
    assert not c.has_condition("panicked")


def test_choose_character_effect(registry):
    g = make_game(registry)
    ev = apply_effects(g, [{
        "type": "choose_character", "prompt": "who?",
        "effects": [{"type": "heal", "who": "chosen", "amount": 1}],
    }])
    assert g.last_chosen_id is not None


def test_evidence_and_rules_dedupe(registry):
    g = make_game(registry)
    eff = [{"type": "evidence", "id": "e1", "title": "T", "text": "x"},
           {"type": "rule", "id": "blood_ticket"}]
    apply_effects(g, eff)
    apply_effects(g, eff)
    assert len([k for k in g.evidence if k == "e1"]) == 1
    assert g.rules_known.count("blood_ticket") == 1


def test_recruit_effect(registry):
    g = make_game(registry)
    apply_effects(g, [{"type": "recruit", "id": "anselm_guard"}])
    assert g.party.get("anselm_guard") is not None
    apply_effects(g, [{"type": "recruit", "id": "anselm_guard"}])
    assert len([c for c in g.party.characters if c.id == "anselm_guard"]) == 1


# --------------------------------------------------------------- perception
def test_perception_variants_by_profession(registry):
    g = make_game(registry)
    c = g.party.active
    text = [{"if": {"profession": c.profession}, "text": "special"}, {"text": "default"}]
    assert resolve_text(g, text, c) == "special"
    c2 = next(x for x in g.party.living if x.profession != c.profession)
    assert resolve_text(g, text, c2) == "default"


def test_low_composure_mislabels(registry):
    g = make_game(registry)
    c = g.party.active
    node = {"id": "n", "name": "A door", "low_composure_name": "A mouth"}
    assert display_name(g, node, c) == "A door"
    c.composure = 2
    assert display_name(g, node, c) == "A mouth"


# ----------------------------------------------------------------- blackout
def test_blackout_advances_with_time(registry):
    g = make_game(registry)
    assert g.blackout_index == -1
    ev = []
    g.advance_time(registry.config["blackout_threshold"], ev)
    assert g.blackout_index == 0
    assert any(e["kind"] == "blackout" for e in ev)


def test_blackout_consumes_party(registry):
    g = make_game(registry)
    ev = []
    g.advance_time(registry.config["blackout_threshold"] * 3, ev)
    assert g.ending == "consumed"


def test_blackout_delay_effect(registry):
    g = make_game(registry)
    g.blackout_minutes = 30
    apply_effects(g, [{"type": "blackout", "minutes": -20}])
    assert g.blackout_minutes == 10


# ------------------------------------------------------------------- travel
def test_item_transforms_on_travel(registry):
    g = make_game(registry)
    g.party.add_item("hunting_knife")
    g.position = "sleeper_car"
    ev = []
    g.travel("hospital_car", 0, ev)
    assert g.party.has_item("surgical_scalpel")
    assert not g.party.has_item("hunting_knife")


def test_bleeding_bites_on_travel(registry):
    g = make_game(registry)
    c = g.party.active
    c.add_condition("bleeding")
    hp = c.health
    g.travel("baggage_car", 0, [])
    assert c.health == hp - 1


def test_bloodless_ignores_bleeding(registry):
    g = make_game(registry)
    c = g.party.active
    c.add_condition("bleeding")
    c.scars.append("bloodless")
    hp = c.health
    g.travel("baggage_car", 0, [])
    assert c.health == hp

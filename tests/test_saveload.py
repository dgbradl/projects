from nofinalstop.engine.rng import Rng
from nofinalstop.engine.game import GameState
from nofinalstop.engine import save as savemod
from nofinalstop.engine.effects import apply_effects


def test_save_load_roundtrip(registry, tmp_path):
    g = GameState(registry, Rng(11))
    g.start_new(size=4, events=[])
    apply_effects(g, [
        {"type": "item", "add": "lantern"},
        {"type": "evidence", "id": "e1", "title": "T", "category": "physical", "text": "body"},
        {"type": "rule", "id": "blood_ticket"},
        {"type": "flag", "set": "test_flag"},
        {"type": "harm", "who": "active", "amount": 2},
        {"type": "composure", "who": "party", "delta": -1},
        {"type": "scar", "who": "active", "add": "two_shadows"},
    ])
    g.advance_time(30, [])
    path = savemod.save_game(g, save_dir=str(tmp_path))
    assert savemod.has_save(save_dir=str(tmp_path))

    g2 = savemod.load_game(registry, save_dir=str(tmp_path))
    assert g2.to_dict() == g.to_dict()
    assert g2.position == g.position
    assert g2.flags == g.flags
    assert g2.party.active.health == g.party.active.health
    assert g2.party.active.scars == g.party.active.scars
    assert "e1" in g2.evidence


def test_rng_state_survives_save(registry, tmp_path):
    g = GameState(registry, Rng(7))
    g.start_new(size=3, events=[])
    savemod.save_game(g, save_dir=str(tmp_path))
    g2 = savemod.load_game(registry, save_dir=str(tmp_path))
    rolls_a = [g.rng.d6() for _ in range(20)]
    rolls_b = [g2.rng.d6() for _ in range(20)]
    assert rolls_a == rolls_b


def test_loaded_game_is_playable(registry, tmp_path):
    g = GameState(registry, Rng(3))
    g.start_new(size=4, events=[])
    savemod.save_game(g, save_dir=str(tmp_path))
    g2 = savemod.load_game(registry, save_dir=str(tmp_path))
    node = g2.visible_nodes()[0]
    acts = g2.available_actions(node)
    assert acts
    events = g2.perform_action(node, acts[0])
    assert events, "acting after load produces events"

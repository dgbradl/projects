"""Validate that all content references resolve — carriages, items, rules,
conditions, scars, endings, survivors. Guards against typos when adding data."""


def iter_effects(obj):
    """Yield every effect dict found anywhere in a carriage structure."""
    if isinstance(obj, dict):
        if "type" in obj and obj.get("type") in (
                "item", "condition", "scar", "rule", "recruit", "ending",
                "unlock_exit", "lock_exit", "reveal_node", "hide_node",
                "resource", "evidence", "flag", "choose_character"):
            yield obj
        for v in obj.values():
            yield from iter_effects(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from iter_effects(v)


def test_all_carriages_have_required_fields(registry):
    for cid, car in registry.carriages.items():
        assert car["id"] == cid
        assert "name" in car and "index" in car and "arrival" in car
        assert isinstance(car.get("nodes", []), list)


def test_exits_point_to_real_carriages(registry):
    for cid, car in registry.carriages.items():
        for ex in car.get("exits", []):
            assert ex["to"] in registry.carriages, f"{cid}: exit {ex['id']} -> {ex['to']}"
            # forward exits must move toward the engine or be deliberate backtracks
            assert "label" in ex


def test_engine_reachable_and_terminal(registry):
    engine = registry.carriages["engine"]
    assert engine["exits"] == []
    # at least one carriage exits into the engine
    sources = [c["id"] for c in registry.carriages.values()
               for ex in c.get("exits", []) if ex["to"] == "engine"]
    assert sources, "no path into the engine"


def test_effect_references_resolve(registry):
    for cid, car in registry.carriages.items():
        exit_ids = {ex["id"] for ex in car.get("exits", [])}
        node_ids = {n["id"] for n in car.get("nodes", [])}
        for eff in iter_effects(car):
            t = eff["type"]
            where = f"{cid}: {eff}"
            if t == "item":
                for key in ("add", "remove"):
                    if key in eff:
                        assert eff[key] in registry.items, where
            elif t == "condition":
                for key in ("add", "remove"):
                    if key in eff:
                        assert eff[key] in registry.conditions, where
            elif t == "scar":
                assert eff["add"] in registry.scars, where
            elif t == "rule":
                assert eff["id"] in registry.rules, where
            elif t == "recruit":
                assert eff["id"] in registry.survivors, where
            elif t == "ending":
                assert eff["id"] in registry.endings, where
            elif t in ("unlock_exit", "lock_exit"):
                assert eff["id"] in exit_ids, where
            elif t in ("reveal_node", "hide_node"):
                assert eff["id"] in node_ids, where


def test_action_consumed_items_exist(registry):
    for cid, car in registry.carriages.items():
        for node in car.get("nodes", []):
            for act in node.get("actions", []):
                if "consumes_item" in act:
                    assert act["consumes_item"] in registry.items, f"{cid}/{act['id']}"


def test_profession_data(registry):
    for pid, prof in registry.professions.items():
        assert prof.get("skills"), pid
        for s in prof["skills"]:
            assert s in registry.skills, f"{pid}: unknown skill {s}"
        if prof.get("item"):
            assert prof["item"] in registry.items, f"{pid}: unknown item {prof['item']}"


def test_item_transforms_resolve(registry):
    for iid, item in registry.items.items():
        for target_car, new_item in item.get("transforms", {}).items():
            assert target_car in registry.carriages, f"{iid} -> {target_car}"
            assert new_item in registry.items, f"{iid} -> {new_item}"


def test_mysteries_reference_real_endings(registry):
    for mid, m in registry.mysteries.items():
        for eid in m.get("endings", []):
            assert eid in registry.endings, f"{mid}: {eid}"


def test_traits_and_fears_shape(registry):
    kinds = {t["type"] for t in registry.traits.values()}
    assert kinds == {"positive", "difficult"}
    assert len([t for t in registry.traits.values() if t["type"] == "positive"]) >= 10
    assert len([t for t in registry.traits.values() if t["type"] == "difficult"]) >= 10
    assert len(registry.fears) >= 10
    assert len(registry.secrets) >= 10


def test_vertical_slice_scope(registry):
    """The milestone: 8 main carriages + 4 transitional, 2 mysteries, 3+ endings."""
    main = [c for c in registry.carriages.values() if not c.get("transitional")]
    trans = [c for c in registry.carriages.values() if c.get("transitional")]
    assert len(main) >= 8
    assert len(trans) >= 4
    assert len(registry.mysteries) >= 2
    victories = [e for e in registry.endings.values() if e.get("victory")]
    assert len(victories) >= 3
    assert len(registry.survivors) >= 1

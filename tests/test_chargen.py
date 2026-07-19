from nofinalstop.engine.rng import Rng
from nofinalstop.engine import chargen
from nofinalstop.engine.models import ATTRIBUTES


def test_party_generation_shape(registry):
    rng = Rng(123)
    party = chargen.generate_party_members(registry, rng, 4)
    assert len(party) == 4
    professions = [c.profession for c in party]
    assert len(set(professions)) == 4, "professions should be distinct"
    names = [c.name.split()[0] for c in party]
    assert len(set(names)) == 4, "first names should be distinct"
    for c in party:
        assert set(c.attrs) == set(ATTRIBUTES)
        assert all(1 <= v <= 5 for v in c.attrs.values())
        assert c.trait_positive in registry.traits
        assert c.trait_difficult in registry.traits
        assert registry.traits[c.trait_positive]["type"] == "positive"
        assert registry.traits[c.trait_difficult]["type"] == "difficult"
        assert c.fear in registry.fears
        assert c.secret in registry.secrets
        assert len(c.memories) == 3
        assert {m["kind"] for m in c.memories} == {"believed", "incomplete", "contradicting"}
        assert c.personal_item in registry.items
        assert registry.items[c.personal_item].get("personal")
        assert c.skills, "every character has skills"
        assert c.health == c.max_health > 0
        assert c.composure == c.max_composure > 0


def test_generation_is_deterministic(registry):
    p1 = chargen.generate_party_members(registry, Rng(99), 4)
    p2 = chargen.generate_party_members(registry, Rng(99), 4)
    assert [c.to_dict() for c in p1] == [c.to_dict() for c in p2]


def test_relationships_connect_everyone(registry):
    rng = Rng(5)
    party = chargen.generate_party_members(registry, rng, 4)
    rels = chargen.generate_relationships(registry, rng, party)
    connected = set()
    for r in rels:
        connected.add(r.a)
        connected.add(r.b)
        assert r.kind in registry.relationships
        assert 0 <= r.trust <= 5 and 0 <= r.strain <= 5
    assert connected == {c.id for c in party}


def test_survivor_instantiation(registry):
    for sid in registry.survivors:
        c = chargen.build_survivor(registry, sid)
        assert c.id == sid
        assert c.recruited
        assert c.profession in registry.professions

"""Procedural character and party generation, driven entirely by data files."""

from .models import Character, Relationship, ATTRIBUTES


def generate_identity(registry, rng, used_names=None):
    names = registry.names
    first = rng.choice(names["first"])
    if used_names:
        pool = [n for n in names["first"] if n not in used_names] or names["first"]
        first = rng.choice(pool)
    last = rng.choice(names["last"])
    return {
        "name": f"{first} {last}",
        "age": rng.randint(19, 64),
        "pronouns": rng.choice(names["pronouns"]),
        "background": rng.choice(names["backgrounds"]),
        "appearance": rng.choice(names["appearances"]),
    }


def generate_attributes(registry, rng, profession):
    attrs = {a: 2 for a in ATTRIBUTES}
    for a, b in profession.get("attr_bonus", {}).items():
        attrs[a] = attrs[a] + b
    for _ in range(4):
        a = rng.choice(ATTRIBUTES)
        if attrs[a] < 4:
            attrs[a] += 1
    return attrs


def generate_skills(registry, rng, profession):
    skills = dict(profession.get("skills", {}))
    pool = [s for s in registry.skills if s not in skills]
    if pool:
        skills[rng.choice(pool)] = 1  # one unusual secondary skill from personal history
    return skills


def generate_character(registry, rng, char_id, profession_id=None, name=None, secret_mode="all",
                       used_names=None):
    prof_ids = list(registry.professions.keys())
    profession = registry.professions[profession_id or rng.choice(prof_ids)]
    ident = generate_identity(registry, rng, used_names)
    if name:
        ident["name"] = name

    positives = [t["id"] for t in registry.traits.values() if t["type"] == "positive"]
    difficults = [t["id"] for t in registry.traits.values() if t["type"] == "difficult"]

    memories = [
        {"kind": "believed", "text": rng.choice(registry.memories["believed"])},
        {"kind": "incomplete", "text": rng.choice(registry.memories["incomplete"])},
        {"kind": "contradicting", "text": rng.choice(registry.memories["contradicting"])},
    ]

    personal_items = [i["id"] for i in registry.items.values() if i.get("personal")]
    secret = rng.choice(list(registry.secrets.keys()))
    secret_known = True if secret_mode == "all" else (rng.chance(0.5) if secret_mode == "some" else False)

    c = Character(
        id=char_id,
        profession=profession["id"],
        attrs=generate_attributes(registry, rng, profession),
        skills=generate_skills(registry, rng, profession),
        trait_positive=rng.choice(positives),
        trait_difficult=rng.choice(difficults),
        fear=rng.choice(list(registry.fears.keys())),
        secret=secret,
        secret_known=secret_known,
        memories=memories,
        personal_item=rng.choice(personal_items),
        **ident,
    )
    return c


def starting_items(registry, character):
    """Items a character contributes to the shared inventory at start."""
    items = []
    prof = registry.professions.get(character.profession, {})
    if prof.get("item"):
        items.append(prof["item"])
    if character.personal_item:
        items.append(character.personal_item)
    return items


def generate_relationships(registry, rng, characters):
    """Chain relationships so everyone is connected to at least one other."""
    rels = []
    templates = list(registry.relationships.values())
    for i in range(len(characters) - 1):
        t = rng.choice(templates)
        rels.append(Relationship(characters[i].id, characters[i + 1].id, t["id"],
                                 trust=t.get("trust", 2), strain=t.get("strain", 1)))
    if len(characters) >= 4:
        t = rng.choice(templates)
        rels.append(Relationship(characters[0].id, characters[-1].id, t["id"],
                                 trust=t.get("trust", 2), strain=t.get("strain", 1)))
    return rels


def generate_party_members(registry, rng, size=4, professions=None, secret_mode="all"):
    """Generate `size` characters with distinct professions."""
    prof_pool = list(registry.professions.keys())
    rng.shuffle(prof_pool)
    chars = []
    used_names = set()
    for i in range(size):
        pid = None
        if professions and i < len(professions) and professions[i]:
            pid = professions[i]
        else:
            pid = prof_pool.pop() if prof_pool else None
        c = generate_character(registry, rng, f"pc{i + 1}", pid, secret_mode=secret_mode,
                               used_names=used_names)
        used_names.add(c.name.split()[0])
        chars.append(c)
    return chars


def build_survivor(registry, survivor_id):
    """Instantiate a recruitable survivor defined in survivors.json."""
    d = dict(registry.survivors[survivor_id])
    d.setdefault("id", survivor_id)
    d["recruited"] = True
    d.pop("recruit_text", None)
    return Character(**d)

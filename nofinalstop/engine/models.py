"""Core runtime models: Character, Relationship, Party."""

ATTRIBUTES = ["body", "agility", "reason", "awareness", "presence", "will"]


class Character:
    def __init__(self, **kw):
        self.id = kw["id"]
        self.name = kw["name"]
        self.age = kw.get("age", 30)
        self.pronouns = kw.get("pronouns", "they/them")
        self.background = kw.get("background", "")
        self.appearance = kw.get("appearance", "")
        self.profession = kw["profession"]
        self.attrs = dict(kw["attrs"])
        self.skills = dict(kw.get("skills", {}))
        self.trait_positive = kw.get("trait_positive")
        self.trait_difficult = kw.get("trait_difficult")
        self.fear = kw.get("fear")
        self.secret = kw.get("secret")
        self.secret_known = kw.get("secret_known", True)
        self.memories = list(kw.get("memories", []))
        self.personal_item = kw.get("personal_item")
        self.max_health = kw.get("max_health", 6 + self.attrs.get("body", 2))
        self.health = kw.get("health", self.max_health)
        self.max_composure = kw.get("max_composure", min(10, 5 + self.attrs.get("will", 2)))
        self.composure = kw.get("composure", self.max_composure)
        self.conditions = list(kw.get("conditions", []))
        self.scars = list(kw.get("scars", []))
        self.alive = kw.get("alive", True)
        self.recruited = kw.get("recruited", False)
        self.fate = kw.get("fate")  # set when dead/lost/transformed
        self.used_second_chance = kw.get("used_second_chance", False)  # Out of Time scar, per carriage

    # -- state helpers -------------------------------------------------
    def has_condition(self, cid):
        return cid in self.conditions

    def add_condition(self, cid):
        if cid not in self.conditions:
            self.conditions.append(cid)

    def remove_condition(self, cid):
        if cid in self.conditions:
            self.conditions.remove(cid)

    def has_scar(self, sid):
        return sid in self.scars

    def skill_level(self, skill_id):
        return self.skills.get(skill_id, 0)

    def hurt(self, amount):
        self.health = max(0, self.health - amount)
        if self.health == 0 and self.alive:
            self.alive = False
            self.fate = self.fate or "died"

    def heal(self, amount):
        if self.alive:
            self.health = min(self.max_health, self.health + amount)

    def shift_composure(self, delta):
        self.composure = max(0, min(self.max_composure, self.composure + delta))
        if self.composure == 0 and "panicked" not in self.conditions:
            self.conditions.append("panicked")
        if self.composure >= 4 and "panicked" in self.conditions:
            self.conditions.remove("panicked")

    def to_dict(self):
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d):
        return cls(**d)


class Relationship:
    def __init__(self, a, b, kind, trust=2, strain=1):
        self.a = a
        self.b = b
        self.kind = kind
        self.trust = trust
        self.strain = strain

    def involves(self, char_id):
        return char_id in (self.a, self.b)

    def other(self, char_id):
        return self.b if char_id == self.a else self.a

    def to_dict(self):
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d):
        return cls(**d)


class Party:
    def __init__(self):
        self.characters = []          # Character objects, in order
        self.active_id = None         # current observer / lead
        self.inventory = {}           # item_id -> count
        self.resources = {}           # resource_id -> amount
        self.relationships = []       # Relationship objects

    # -- membership ----------------------------------------------------
    def add(self, character):
        self.characters.append(character)
        if self.active_id is None:
            self.active_id = character.id

    def get(self, char_id):
        for c in self.characters:
            if c.id == char_id:
                return c
        return None

    @property
    def living(self):
        return [c for c in self.characters if c.alive]

    @property
    def active(self):
        c = self.get(self.active_id)
        if c is None or not c.alive:
            if self.living:
                self.active_id = self.living[0].id
                return self.living[0]
            return None
        return c

    def set_active(self, char_id):
        c = self.get(char_id)
        if c and c.alive:
            self.active_id = char_id
            return True
        return False

    def best_at(self, attr, skill=None):
        """Living character with the highest attr+skill total."""
        pool = self.living
        if not pool:
            return None
        return max(pool, key=lambda c: c.attrs.get(attr, 0) + (c.skill_level(skill) if skill else 0))

    # -- inventory -----------------------------------------------------
    def add_item(self, item_id, count=1):
        self.inventory[item_id] = self.inventory.get(item_id, 0) + count

    def remove_item(self, item_id, count=1):
        if self.inventory.get(item_id, 0) >= count:
            self.inventory[item_id] -= count
            if self.inventory[item_id] <= 0:
                del self.inventory[item_id]
            return True
        return False

    def has_item(self, item_id):
        return self.inventory.get(item_id, 0) > 0

    def add_resource(self, rid, amount):
        self.resources[rid] = max(0, self.resources.get(rid, 0) + amount)

    def spend_resource(self, rid, amount):
        if self.resources.get(rid, 0) >= amount:
            self.resources[rid] -= amount
            return True
        return False

    # -- relationships -------------------------------------------------
    def relation_between(self, a, b):
        for r in self.relationships:
            if {r.a, r.b} == {a, b}:
                return r
        return None

    def relations_of(self, char_id):
        return [r for r in self.relationships if r.involves(char_id)]

    def shift_relationship(self, a, b, trust=0, strain=0):
        r = self.relation_between(a, b)
        if r is None:
            r = Relationship(a, b, "strangers", trust=1, strain=0)
            self.relationships.append(r)
        r.trust = max(0, min(5, r.trust + trust))
        r.strain = max(0, min(5, r.strain + strain))
        return r

    def to_dict(self):
        return {
            "characters": [c.to_dict() for c in self.characters],
            "active_id": self.active_id,
            "inventory": self.inventory,
            "resources": self.resources,
            "relationships": [r.to_dict() for r in self.relationships],
        }

    @classmethod
    def from_dict(cls, d):
        p = cls()
        for cd in d["characters"]:
            p.characters.append(Character.from_dict(cd))
        p.active_id = d.get("active_id")
        p.inventory = dict(d.get("inventory", {}))
        p.resources = dict(d.get("resources", {}))
        p.relationships = [Relationship.from_dict(rd) for rd in d.get("relationships", [])]
        return p

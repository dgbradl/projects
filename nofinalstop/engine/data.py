"""Loads all game content from the JSON data directory into a registry.

Everything the engine runs on — professions, skills, traits, fears, secrets,
items, scars, conditions, relationships, memories, carriages, mysteries,
endings, survivors — is defined in data files.  The engine interprets them;
it never hard-codes content.
"""

import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


class DataRegistry:
    def __init__(self, data_dir=None):
        self.dir = data_dir or DATA_DIR
        self.config = self._load("config.json")
        self.names = self._load("names.json")
        self.skills = self._index(self._load("skills.json"))
        self.professions = self._index(self._load("professions.json"))
        self.traits = self._index(self._load("traits.json"))
        self.fears = self._index(self._load("fears.json"))
        self.secrets = self._index(self._load("secrets.json"))
        self.relationships = self._index(self._load("relationships.json"))
        self.memories = self._load("memories.json")
        self.items = self._index(self._load("items.json"))
        self.scars = self._index(self._load("scars.json"))
        self.conditions = self._index(self._load("conditions.json"))
        self.rules = self._index(self._load("rules.json"))
        self.mysteries = self._index(self._load("mysteries.json"))
        self.endings = self._index(self._load("endings.json"))
        self.survivors = self._index(self._load("survivors.json"))
        self.carriages = {}
        cdir = os.path.join(self.dir, "carriages")
        for fn in sorted(os.listdir(cdir)):
            if fn.endswith(".json"):
                with open(os.path.join(cdir, fn), encoding="utf-8") as f:
                    car = json.load(f)
                self.carriages[car["id"]] = car

    def _load(self, name):
        with open(os.path.join(self.dir, name), encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _index(entries):
        return {e["id"]: e for e in entries}

    def item(self, item_id):
        return self.items.get(item_id, {"id": item_id, "name": item_id.replace("_", " ").title()})

    def carriage(self, cid):
        return self.carriages[cid]


_registry = None


def get_registry():
    global _registry
    if _registry is None:
        _registry = DataRegistry()
    return _registry

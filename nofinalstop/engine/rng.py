"""Seeded random helper with JSON-serializable state."""

import random


class Rng:
    def __init__(self, seed=None):
        self._r = random.Random(seed)
        self.seed = seed

    def d6(self):
        return self._r.randint(1, 6)

    def roll_2d6(self):
        return self._r.randint(1, 6), self._r.randint(1, 6)

    def randint(self, a, b):
        return self._r.randint(a, b)

    def choice(self, seq):
        return self._r.choice(seq)

    def sample(self, seq, k):
        return self._r.sample(seq, k)

    def shuffle(self, seq):
        self._r.shuffle(seq)
        return seq

    def chance(self, p):
        return self._r.random() < p

    def get_state(self):
        return _tuples_to_lists(self._r.getstate())

    def set_state(self, state):
        self._r.setstate(_lists_to_tuples(state))


def _tuples_to_lists(obj):
    if isinstance(obj, tuple):
        return ["__t__"] + [_tuples_to_lists(x) for x in obj]
    if isinstance(obj, list):
        return [_tuples_to_lists(x) for x in obj]
    return obj


def _lists_to_tuples(obj):
    if isinstance(obj, list):
        if obj and obj[0] == "__t__":
            return tuple(_lists_to_tuples(x) for x in obj[1:])
        return [_lists_to_tuples(x) for x in obj]
    return obj

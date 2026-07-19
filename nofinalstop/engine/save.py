"""Save and load: full game state serialized to JSON."""

import json
import os

from .game import GameState

DEFAULT_SAVE_DIR = os.path.join(os.getcwd(), "saves")


def save_path(slot="autosave", save_dir=None):
    return os.path.join(save_dir or DEFAULT_SAVE_DIR, f"{slot}.json")


def save_game(game, slot="autosave", save_dir=None):
    path = save_path(slot, save_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(game.to_dict(), f, indent=1)
    return path


def load_game(registry, slot="autosave", save_dir=None, controller=None):
    path = save_path(slot, save_dir)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return GameState.from_dict(registry, data, controller)


def has_save(slot="autosave", save_dir=None):
    return os.path.exists(save_path(slot, save_dir))

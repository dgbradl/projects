"""Bot-driven complete playthroughs through the REAL game loop and UI."""

import io
import contextlib

import pytest

from nofinalstop.ui.app import App


def play(seed, tmp_path, party=4):
    app = App(seed=seed, plain=True, auto=True, party_size=party,
              save_dir=str(tmp_path / f"s{seed}"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        game = app.run()
    return game, buf.getvalue()


def test_full_run_reaches_an_ending(registry, tmp_path):
    game, out = play(7, tmp_path)
    assert game is not None
    assert game.ending is not None
    assert game.ending in registry.endings
    assert "Epilogue" in out


def test_seed7_reaches_the_last_stop(registry, tmp_path):
    game, out = play(7, tmp_path)
    assert game.ending == "the_last_stop"
    assert len(game.visited) >= 10, "should traverse the whole train"
    assert game.evidence, "evidence board should be populated"
    assert game.rules_known, "train rules should have been learned"


@pytest.mark.parametrize("seed", [1, 2, 3, 11, 21])
def test_many_seeds_terminate(registry, tmp_path, seed):
    game, out = play(seed, tmp_path)
    assert game is not None
    # every run must end — in victory, death, or the dark; never a hang
    assert game.ending in registry.endings


def test_both_mysteries_occur_and_complete(registry, tmp_path):
    seen = {}
    for seed in range(1, 14):
        game, _ = play(seed, tmp_path)
        if game and game.ending:
            seen.setdefault(game.mystery, game.ending)
        if len(seen) == 2:
            break
    assert set(seen) == {"sleeper_below", "ferry_of_the_dead"}


def test_party_sizes_supported(registry, tmp_path):
    for size in (3, 5):
        game, _ = play(31 + size, tmp_path, party=size)
        assert game is not None
        assert game.ending in registry.endings

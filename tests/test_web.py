"""Tests for the web front-end: session API full runs and the HTTP layer."""

import json
import urllib.request

import pytest

from nofinalstop.web.session import Session
from nofinalstop.web.server import serve


class SessionBot:
    """Plays a complete run through the web session API — the same surface
    the browser uses: inspect nodes, take actions, answer pending choices,
    flee the Blackout, walk forward."""

    def __init__(self, session, max_steps=900):
        self.s = session
        self.max_steps = max_steps
        self.tried = set()

    def play(self, size=4):
        v = self.s.cmd({"cmd": "new_quick", "size": size})
        for _ in range(self.max_steps):
            if v["phase"] == "ending":
                return v
            v = self.step(v)
        raise AssertionError("bot exceeded step budget without an ending")

    def step(self, v):
        if v.get("pending"):
            c = min(v["pending"]["candidates"], key=lambda x: x["health"])
            return self.s.cmd({"cmd": "choose", "char": c["id"]})
        st = v["status"]
        carriage = st["carriage"]
        # flee when the dark is in the room
        if st["blackout_distance"] <= 0:
            for x in v["exits"]:
                if x["open"]:
                    return self.s.cmd({"cmd": "exit", "exit": x["id"]})
        # untried action in the open node?
        nd = v.get("node_detail")
        if nd:
            for a in nd["actions"]:
                key = (carriage, nd["id"], a["id"])
                if a["met"] and key not in self.tried:
                    self.tried.add(key)
                    return self.s.cmd({"cmd": "act", "node": nd["id"], "action": a["id"]})
            for a in nd["actions"]:
                # actions we cannot currently take also count as seen
                self.tried.add((carriage, nd["id"], a["id"]))
            return self.s.cmd({"cmd": "close_node"})
        # a node with untried actions?
        for n in v["nodes"]:
            node = self.s._find_node(n["id"])
            for a in self.s.game.available_actions(node):
                if (carriage, n["id"], a["id"]) not in self.tried:
                    return self.s.cmd({"cmd": "inspect", "node": n["id"]})
        # forward, ideally somewhere new
        open_exits = [x for x in v["exits"] if x["open"]]
        for x in open_exits:
            ex = next(e for e in self.s.game.exits() if e["id"] == x["id"])
            if ex["to"] not in self.s.game.visited:
                return self.s.cmd({"cmd": "exit", "exit": x["id"]})
        # stuck: forget this carriage's attempts and retry (failed unlocks)
        stale = {t for t in self.tried if t[0] == carriage}
        if stale:
            self.tried -= stale
            return self.s.cmd({"cmd": "view"})
        if open_exits:
            return self.s.cmd({"cmd": "exit", "exit": open_exits[0]["id"]})
        raise AssertionError(f"bot is stuck in {carriage}")


def test_web_full_run(registry, tmp_path):
    session = Session(seed=7, save_dir=str(tmp_path))
    v = SessionBot(session).play()
    assert v["phase"] == "ending"
    assert v["ending"]["id"] in registry.endings
    assert v["ending"]["epilogue"]
    assert v["status"]["carriage"] == "The Engine"


@pytest.mark.parametrize("seed", [2, 5, 11])
def test_web_runs_terminate(registry, tmp_path, seed):
    session = Session(seed=seed, save_dir=str(tmp_path / str(seed)))
    v = SessionBot(session).play()
    assert v["phase"] == "ending"


def test_pending_choice_roundtrip(registry, tmp_path):
    """The dining car's communion requires a mid-effect character choice:
    verify the snapshot/replay protocol asks, rolls back, and completes."""
    session = Session(seed=7, save_dir=str(tmp_path))
    session.cmd({"cmd": "new_quick", "size": 4})
    g = session.game
    # teleport the party to the dining car with negotiation done
    events = []
    g.flags.add("dining_negotiated")
    g.enter_carriage("dining_car", events)
    v = session.cmd({"cmd": "act", "node": "the_table", "action": "communion_meal"})
    assert v.get("pending"), "should be waiting on a character choice"
    hp_before = {c.id: c.health for c in g.party.characters}
    # state must have rolled back: nobody has eaten yet
    assert session.game.time_in_carriage == 0
    chosen = v["pending"]["candidates"][0]["id"]
    v = session.cmd({"cmd": "choose", "char": chosen})
    assert not v.get("pending")
    c = session.game.party.get(chosen)
    assert c.has_condition("train_fed")
    assert "dining_resolved" in session.game.flags


def test_optional_choice_can_be_skipped(registry, tmp_path):
    session = Session(seed=3, save_dir=str(tmp_path))
    session.cmd({"cmd": "new_quick", "size": 4})
    g = session.game
    g.enter_carriage("engine", [])
    v = session.cmd({"cmd": "act", "node": "the_threshold", "action": "volunteer_sacrifice"})
    assert v.get("pending") and v["pending"]["optional"]
    v = session.cmd({"cmd": "choose", "char": "__skip__"})
    assert not v.get("pending")
    assert all(c.alive for c in session.game.party.characters)
    assert "sacrifice_given" not in session.game.flags


def test_guided_chargen_flow(registry, tmp_path):
    session = Session(seed=9, save_dir=str(tmp_path))
    v = session.cmd({"cmd": "new_guided"})
    assert v["phase"] == "chargen"
    v = session.cmd({"cmd": "chargen_size", "size": 3})
    assert v["chargen"]["candidate"]
    v = session.cmd({"cmd": "chargen_profession", "profession": "physician"})
    assert v["chargen"]["candidate"]["profession"] == "Physician"
    v = session.cmd({"cmd": "chargen_rename", "name": "Ada Test"})
    assert v["chargen"]["candidate"]["name"] == "Ada Test"
    for _ in range(3):
        v = session.cmd({"cmd": "chargen_accept"})
    assert v["phase"] == "play"
    assert session.game.party.characters[0].name == "Ada Test"
    assert session.game.party.characters[0].profession == "physician"
    assert session.game.party.relationships


def test_observer_switch_changes_perception(registry, tmp_path):
    session = Session(seed=7, save_dir=str(tmp_path))
    session.cmd({"cmd": "new_quick", "size": 4})
    v = session.cmd({"cmd": "inspect", "node": "sleeping_passengers"})
    base = v["node_detail"]["description"]
    # shatter the observer's composure: the same room must read differently
    session.game.party.active.composure = 1
    v = session.cmd({"cmd": "view"})
    distorted = v["node_detail"]["description"]
    assert base != distorted


def test_save_and_continue(registry, tmp_path):
    session = Session(seed=4, save_dir=str(tmp_path))
    session.cmd({"cmd": "new_quick", "size": 4})
    session.cmd({"cmd": "inspect", "node": "sleeping_passengers"})
    session.cmd({"cmd": "act", "node": "sleeping_passengers", "action": "check_tickets"})
    time_before = session.game.total_time
    session.cmd({"cmd": "save"})
    session2 = Session(save_dir=str(tmp_path))
    v = session2.cmd({"cmd": "continue"})
    assert v["phase"] == "play"
    assert session2.game.total_time == time_before
    assert "tickets_terminus" in session2.game.evidence


def test_registry_hot_swap_mid_run(registry, tmp_path):
    """Dev reload: fresh content applies to a RUNNING game without losing state."""
    from nofinalstop.engine.data import DataRegistry

    session = Session(seed=7, save_dir=str(tmp_path))
    session.cmd({"cmd": "new_quick", "size": 4})
    session.cmd({"cmd": "inspect", "node": "sleeping_passengers"})
    session.cmd({"cmd": "act", "node": "sleeping_passengers", "action": "check_tickets"})
    time_before = session.game.total_time
    evidence_before = set(session.game.evidence)

    fresh = DataRegistry()
    fresh.carriages["rear_carriage"]["objective"] = "EDITED OBJECTIVE"
    session.apply_registry(fresh)

    v = session.cmd({"cmd": "view"})
    assert v["status"]["objective"] == "EDITED OBJECTIVE", "new content is live"
    assert session.game.total_time == time_before, "game state survived the swap"
    assert set(session.game.evidence) == evidence_before
    node = session._find_node("rear_door")
    assert node and session.game.available_actions(node), "play continues under new content"


def test_devstatus_endpoint(registry, tmp_path):
    httpd, session, url = serve(seed=1, save_dir=str(tmp_path), port=0,
                                open_browser=False, background=True, dev=True)
    try:
        s = json.loads(urllib.request.urlopen(url + "api/devstatus").read())
        assert s["dev"] is True
        assert s["token"] and s["gen"] == 0 and s["assets"] > 0
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_devstatus_off_by_default(registry, tmp_path):
    httpd, session, url = serve(seed=1, save_dir=str(tmp_path), port=0,
                                open_browser=False, background=True)
    try:
        s = json.loads(urllib.request.urlopen(url + "api/devstatus").read())
        assert s == {"dev": False}
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_http_server_serves_page_and_api(registry, tmp_path):
    httpd, session, url = serve(seed=7, save_dir=str(tmp_path), port=0,
                                open_browser=False, background=True)
    try:
        page = urllib.request.urlopen(url).read().decode()
        assert "NO FINAL STOP" in page
        css = urllib.request.urlopen(url + "style.css").read().decode()
        assert "--paper" in css
        req = urllib.request.Request(
            url + "api/cmd", data=json.dumps({"cmd": "new_quick", "size": 4}).encode(),
            headers={"Content-Type": "application/json"})
        v = json.loads(urllib.request.urlopen(req).read())
        assert v["phase"] == "play"
        assert v["status"]["carriage"] == "The Rear Carriage"
        assert len(v["party"]) == 4
        v2 = json.loads(urllib.request.urlopen(url + "api/view").read())
        assert v2["phase"] == "play"
    finally:
        httpd.shutdown()
        httpd.server_close()

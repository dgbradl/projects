"""Web session: turns engine calls into JSON views and back.

The engine occasionally needs a character chosen mid-effect (the dining car's
communion, the engine's sacrifice).  In the terminal that blocks on input; over
HTTP it can't.  The session solves it with snapshot/replay: the full game
state (including the RNG stream) is snapshotted before every action, so when a
choice interrupts effect processing the state is rolled back, the question is
sent to the browser, and on answer the action replays deterministically with
the choice pre-queued.
"""

import json
import threading

from ..engine.data import get_registry
from ..engine.rng import Rng
from ..engine.game import GameState
from ..engine.models import Party
from ..engine import chargen, save as savemod
from ..engine.perception import resolve_text, display_name, observer_tint
from ..ui.render import character_fate


class PendingChoice(Exception):
    def __init__(self, prompt, candidates, optional):
        super().__init__(prompt)
        self.prompt = prompt
        self.candidates = candidates
        self.optional = optional


class WebController:
    """Supplies pre-queued character choices; raises when one is missing."""

    def __init__(self):
        self.queued = []

    def choose_character(self, game, prompt, candidates, optional=False):
        if self.queued:
            cid = self.queued.pop(0)
            if cid == "__skip__" and optional:
                return None
            for c in candidates:
                if c.id == cid:
                    return c
        raise PendingChoice(prompt, candidates, optional)


class Session:
    MAX_LOG = 600

    def __init__(self, seed=None, save_dir=None, secret_mode="all"):
        self.registry = get_registry()
        self.seed = seed
        self.save_dir = save_dir
        self.secret_mode = secret_mode
        self.lock = threading.Lock()
        self.controller = WebController()
        self.game = None
        self.log = []
        self.phase = "title"
        self.pending = None          # {"prompt","candidates","optional","replay","chosen"}
        self.chargen_state = None
        self.open_node = None

    # ------------------------------------------------------------- commands
    def cmd(self, data):
        with self.lock:
            handler = getattr(self, "_cmd_" + str(data.get("cmd", "view")), None)
            if handler is None:
                return self.view(error=f"unknown command {data.get('cmd')}")
            return handler(data)

    def _log(self, events):
        for e in events:
            if e.get("text") or e.get("kind") == "arrive":
                self.log.append({"kind": e.get("kind", "text"), "text": e.get("text", "")})
        del self.log[:-self.MAX_LOG]

    def _autosave(self):
        if self.game:
            savemod.save_game(self.game, save_dir=self.save_dir)

    def _after_change(self):
        if self.game and self.game.ending:
            self.phase = "ending"
            self._autosave()

    # -- title ----------------------------------------------------------
    def _cmd_view(self, data):
        return self.view()

    def _cmd_new_quick(self, data):
        size = int(data.get("size", 4))
        size = max(3, min(5, size))
        rng = Rng(data.get("seed", self.seed))
        self.controller = WebController()
        self.game = GameState(self.registry, rng, self.controller)
        events = []
        self.game.start_new(size=size, secret_mode=self.secret_mode, events=events)
        self.log = []
        self.pending = None
        self.open_node = None
        self._log([{"kind": "check",
                    "text": "How to survive: inspect what the carriage offers and act on it. Every "
                            "action costs minutes, and the minutes feed the darkness behind the train. "
                            "Find and open each forward door. Reach the engine. Click a companion's "
                            "card to see the train through their eyes."}])
        self._log(events)
        self.phase = "play"
        self._autosave()
        return self.view()

    def _cmd_continue(self, data):
        if not savemod.has_save(save_dir=self.save_dir):
            return self.view(error="No saved journey found.")
        self.controller = WebController()
        self.game = savemod.load_game(self.registry, save_dir=self.save_dir,
                                      controller=self.controller)
        self.log = [{"kind": "text",
                     "text": "The train remembers where you were. It always does."}]
        self.pending = None
        self.open_node = None
        self.phase = "ending" if self.game.ending else "play"
        return self.view()

    def _cmd_title(self, data):
        self.phase = "title"
        self.pending = None
        self.chargen_state = None
        self.open_node = None
        return self.view()

    # -- guided character creation --------------------------------------
    def _cmd_new_guided(self, data):
        rng = Rng(data.get("seed", self.seed))
        self.chargen_state = {"rng": rng, "size": None, "index": 0,
                              "party": Party(), "used": set(), "candidate": None}
        self.phase = "chargen"
        return self.view()

    def _cmd_chargen_size(self, data):
        st = self.chargen_state
        st["size"] = max(3, min(5, int(data.get("size", 4))))
        self._new_candidate()
        return self.view()

    def _new_candidate(self, profession=None, keep_name=None):
        st = self.chargen_state
        c = chargen.generate_character(
            self.registry, st["rng"], f"pc{st['index'] + 1}", profession,
            name=keep_name, secret_mode=self.secret_mode, used_names=st["used"])
        st["candidate"] = c

    def _cmd_chargen_reroll(self, data):
        self._new_candidate()
        return self.view()

    def _cmd_chargen_profession(self, data):
        pid = data.get("profession")
        if pid in self.registry.professions:
            self._new_candidate(profession=pid,
                                keep_name=self.chargen_state["candidate"].name)
        return self.view()

    def _cmd_chargen_rename(self, data):
        name = str(data.get("name", "")).strip()[:40]
        if name:
            self.chargen_state["candidate"].name = name
        return self.view()

    def _cmd_chargen_accept(self, data):
        st = self.chargen_state
        c = st["candidate"]
        st["used"].add(c.name.split()[0])
        st["party"].add(c)
        st["index"] += 1
        if st["index"] < st["size"]:
            self._new_candidate()
            return self.view()
        # party complete — board the train
        party = st["party"]
        self.controller = WebController()
        self.game = GameState(self.registry, st["rng"], self.controller)
        events = []
        self.game.start_new(secret_mode=self.secret_mode, party=party, events=events)
        self.log = []
        self._log(events)
        self.chargen_state = None
        self.pending = None
        self.open_node = None
        self.phase = "play"
        self._autosave()
        return self.view()

    # -- play ------------------------------------------------------------
    def _find_node(self, node_id):
        for n in self.game.visible_nodes():
            if n["id"] == node_id:
                return n
        return None

    def _cmd_inspect(self, data):
        node = self._find_node(data.get("node"))
        self.open_node = node["id"] if node else None
        return self.view()

    def _cmd_close_node(self, data):
        self.open_node = None
        return self.view()

    def _cmd_act(self, data):
        node = self._find_node(data.get("node"))
        if node is None:
            return self.view(error="That is no longer there.")
        action = next((a for a in self.game.available_actions(node)
                       if a["id"] == data.get("action")), None)
        if action is None:
            return self.view(error="That moment has passed.")
        self._run_guarded(lambda g: g.perform_action(node, action),
                          replay={"cmd": "act", "node": node["id"], "action": action["id"]})
        return self.view()

    def _cmd_exit(self, data):
        ex = next((e for e in self.game.exits() if e["id"] == data.get("exit")), None)
        if ex is None:
            return self.view(error="There is no such door.")
        if not self.game.exit_open(ex):
            self._log([{"kind": "alert",
                        "text": resolve_text(self.game, ex.get("locked_text", "It will not open."))}])
            return self.view()
        self.open_node = None
        self._run_guarded(lambda g: g.use_exit(ex)[0],
                          replay={"cmd": "exit", "exit": ex["id"]})
        if self.game and not self.game.ending and not self.pending:
            self._autosave()
        return self.view()

    def _freeze(self):
        """Deep-frozen copy of the game state — to_dict() aliases live objects."""
        return json.loads(json.dumps(self.game.to_dict()))

    def _thaw(self, snapshot):
        return GameState.from_dict(self.registry, json.loads(json.dumps(snapshot)),
                                   self.controller)

    def _run_guarded(self, fn, replay):
        """Run an engine mutation; on PendingChoice, roll back and ask the browser."""
        snapshot = self._freeze()
        chosen = self.pending["chosen"] if self.pending else []
        self.controller.queued = list(chosen)
        try:
            events = fn(self.game)
        except PendingChoice as pc:
            self.game = self._thaw(snapshot)
            self.pending = {
                "prompt": pc.prompt,
                "candidates": [{"id": c.id, "name": c.name,
                                "health": c.health, "max_health": c.max_health,
                                "composure": c.composure, "max_composure": c.max_composure}
                               for c in pc.candidates],
                "optional": pc.optional,
                "replay": replay,
                "chosen": chosen,
                "snapshot": snapshot,
            }
            return
        self.pending = None
        self._log(events)
        self._after_change()

    def _cmd_choose(self, data):
        if not self.pending:
            return self.view(error="Nothing waits on a choice.")
        cid = data.get("char", "__skip__")
        pending = self.pending
        pending["chosen"] = pending["chosen"] + [cid]
        replay = pending["replay"]
        # restore pre-action state and replay with the added answer
        self.game = self._thaw(pending["snapshot"])
        self.pending = pending
        if replay["cmd"] == "act":
            node = self._find_node(replay["node"])
            action = next((a for a in self.game.available_actions(node)
                           if a["id"] == replay["action"]), None) if node else None
            if action is None:
                self.pending = None
                return self.view(error="That moment has passed.")
            self._run_guarded(lambda g: g.perform_action(node, action), replay)
        else:
            ex = next((e for e in self.game.exits() if e["id"] == replay["exit"]), None)
            if ex is None:
                self.pending = None
                return self.view(error="There is no such door.")
            self._run_guarded(lambda g: g.use_exit(ex)[0], replay)
        return self.view()

    def _cmd_observer(self, data):
        c = self.game.party.get(data.get("char"))
        if c and c.alive:
            self.game.party.set_active(c.id)
            self._log([{"kind": "mind",
                        "text": f"You now see the train as {c.name} sees it."}])
        return self.view()

    def _cmd_save(self, data):
        self._autosave()
        self._log([{"kind": "check", "text": "Saved. The train pretends not to notice."}])
        return self.view()

    # ------------------------------------------------------------- view
    def view(self, error=None):
        v = {"phase": self.phase, "error": error,
             "has_save": savemod.has_save(save_dir=self.save_dir)}
        if self.phase == "chargen" and self.chargen_state:
            v["chargen"] = self._chargen_view()
        if self.game and self.phase in ("play", "ending"):
            v.update(self._game_view())
        if self.pending:
            v["pending"] = {k: self.pending[k] for k in ("prompt", "candidates", "optional")}
        return v

    def _chargen_view(self):
        st = self.chargen_state
        out = {"size": st["size"], "index": st["index"]}
        if st["size"] is None:
            return out
        out["professions"] = [{"id": p["id"], "name": p["name"], "desc": p["desc"]}
                              for p in self.registry.professions.values()]
        c = st["candidate"]
        if c:
            out["candidate"] = self._character_payload(c, full=True)
        out["accepted"] = [{"name": m.name,
                            "profession": self.registry.professions[m.profession]["name"]}
                           for m in st["party"].characters]
        return out

    def _character_payload(self, c, full=False):
        reg = self.registry
        prof = reg.professions.get(c.profession, {"name": c.profession})
        d = {
            "id": c.id, "name": c.name, "profession": prof["name"],
            "profession_id": c.profession,
            "age": c.age, "pronouns": c.pronouns, "alive": c.alive, "fate": c.fate,
            "health": c.health, "max_health": c.max_health,
            "composure": c.composure, "max_composure": c.max_composure,
            "conditions": [reg.conditions.get(x, {"name": x})["name"] for x in c.conditions],
            "scars": [reg.scars.get(x, {"name": x})["name"] for x in c.scars],
            "active": self.game is not None and c.id == self.game.party.active_id,
            "recruited": c.recruited,
        }
        if full:
            d.update({
                "background": c.background, "appearance": c.appearance,
                "attrs": c.attrs,
                "skills": {reg.skills.get(s, {"name": s})["name"]: v
                           for s, v in sorted(c.skills.items()) if v > 0},
                "trait_positive": reg.traits.get(c.trait_positive, {}).get("name", ""),
                "trait_difficult": reg.traits.get(c.trait_difficult, {}).get("name", ""),
                "fear": reg.fears.get(c.fear, {}).get("name", ""),
                "secret": (reg.secrets.get(c.secret, {}).get("name", "")
                           if c.secret_known else "(unknown even to you)"),
                "secret_desc": (reg.secrets.get(c.secret, {}).get("desc", "")
                                if c.secret_known else ""),
                "memories": c.memories,
                "personal_item": reg.item(c.personal_item)["name"] if c.personal_item else "",
            })
        return d

    def _game_view(self):
        g = self.game
        reg = self.registry
        car = g.carriage()
        active = g.party.active
        low = active is not None and active.composure <= 3
        dist = g.blackout_distance()

        nodes = []
        for n in g.visible_nodes():
            nodes.append({"id": n["id"], "name": display_name(g, n, active),
                          "actions": len(g.available_actions(n))})
        exits = []
        for e in g.exits():
            exits.append({"id": e["id"], "label": resolve_text(g, e.get("label", "A door")),
                          "open": g.exit_open(e)})

        out = {
            "log": self.log,
            "status": {
                "carriage": car["name"],
                "index": car.get("index", 0),
                "time_in_carriage": g.time_in_carriage,
                "total_time": g.total_time,
                "blackout_distance": dist,
                "blackout_index": g.blackout_index,
                "max_index": max(c.get("index", 0) for c in reg.carriages.values()),
                "low_composure": low,
                "observer": active.name if active else None,
                "observer_tint": observer_tint(active),
                "objective": g.current_objective(),
            },
            "nodes": nodes,
            "exits": exits,
            "scene": car.get("scene", {}),
            "party": [self._character_payload(c, full=True) for c in g.party.characters],
            "relationships": [
                {"a": g.party.get(r.a).name, "b": g.party.get(r.b).name,
                 "kind": reg.relationships.get(r.kind, {"name": r.kind})["name"],
                 "trust": r.trust, "strain": r.strain}
                for r in g.party.relationships
                if g.party.get(r.a) and g.party.get(r.b)],
            "inventory": [
                {"name": (reg.item(i).get("low_composure_name")
                          if low and reg.item(i).get("low_composure_name")
                          else reg.item(i)["name"]),
                 "desc": reg.item(i).get("desc", ""), "count": n}
                for i, n in sorted(g.party.inventory.items())],
            "resources": {k.replace("_", " "): v for k, v in sorted(g.party.resources.items())},
            "evidence": [dict(e, id=eid) for eid, e in g.evidence.items()],
            "rules": [reg.rules.get(r, {"text": r})["text"] for r in g.rules_known],
            "journal": list(g.journal),
        }
        if self.open_node:
            node = self._find_node(self.open_node)
            if node:
                out["node_detail"] = {
                    "id": node["id"],
                    "name": display_name(g, node, active),
                    "description": resolve_text(g, node.get("description"), active),
                    "actions": [
                        {"id": a["id"], "label": resolve_text(g, a["label"]),
                         "time": a.get("time", reg.config.get("default_action_time", 4)),
                         "met": g.action_requirement_met(a),
                         "note": resolve_text(g, a.get("requires_text", ""))
                                 if not g.action_requirement_met(a) else "",
                         "check": self._check_hint(a)}
                        for a in g.available_actions(node)],
                }
            else:
                self.open_node = None
        if self.phase == "ending":
            e = reg.endings.get(g.ending, {})
            mystery = reg.mysteries.get(g.mystery, {})
            out["ending"] = {
                "id": g.ending,
                "name": e.get("name", g.ending),
                "victory": bool(e.get("victory")),
                "text": resolve_text(g, e.get("text", "")),
                "epilogue": [
                    {"name": c.name, "fate": character_fate(g, c), "alive": c.alive,
                     "scars": [reg.scars.get(s, {"name": s})["name"] for s in c.scars]}
                    for c in g.party.characters],
                "mystery": mystery.get("name", ""),
                "truth": mystery.get("truth_text", "") if e.get("victory") else "",
                "stats": {"evidence": len(g.evidence), "rules": len(g.rules_known),
                          "carriages": len(g.visited), "minutes": g.total_time},
            }
        return out

    def _check_hint(self, action):
        chk = action.get("check")
        if not chk:
            return None
        skill = self.registry.skills.get(chk.get("skill"), {}).get("name") if chk.get("skill") else None
        return {"attr": chk["attr"].title(), "skill": skill,
                "dc": chk.get("dc", "normal")}

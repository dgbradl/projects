"""Controllers: who makes the choices.

InteractiveController — a human at the terminal.
AutoController — a bot that plays the real game loop end to end (used by
tests and `--auto` demo mode).
"""


def option(key, label, kind, data=None, enabled=True, note=None, tone=None):
    return {"key": str(key), "label": label, "kind": kind, "data": data,
            "enabled": enabled, "note": note, "tone": tone}


class QuitGame(Exception):
    pass


class InteractiveController:
    def __init__(self, renderer, input_fn=None):
        self.renderer = renderer
        self.input_fn = input_fn or input

    def choose(self, game, title, options):
        self.renderer.menu(title, options)
        while True:
            try:
                raw = self.input_fn(self.renderer.prompt_text()).strip().lower()
            except EOFError:
                raise QuitGame()
            for opt in options:
                if raw == opt["key"].lower():
                    if not opt.get("enabled", True):
                        self.renderer._print(opt.get("note") or "That is not possible yet.", "grey58")
                        break
                    return opt
            else:
                self.renderer._print("Choose one of the bracketed keys.", "grey58")

    def choose_character(self, game, prompt, candidates, optional=False):
        opts = [option(i + 1, c.name, "character", c) for i, c in enumerate(candidates)]
        if optional:
            opts.append(option("x", "No one. Step back.", "skip"))
        picked = self.choose(game, prompt, opts)
        return None if picked["kind"] == "skip" else picked["data"]


class AutoController:
    """Plays the game with a simple explorer policy. Deterministic given the
    game's seeded RNG: explore every available action once, then move forward."""

    def __init__(self, renderer=None, verbose=False, max_steps=600):
        self.renderer = renderer
        self.verbose = verbose
        self.max_steps = max_steps
        self.steps = 0
        self.tried = set()          # (carriage, node, action) attempted
        self.log = []

    def _note(self, msg):
        self.log.append(msg)
        if self.verbose and self.renderer:
            self.renderer._print("  [auto] " + msg, "grey42")

    def choose(self, game, title, options):
        self.steps += 1
        if self.steps > self.max_steps:
            raise QuitGame()

        confirm = next((o for o in options if o["kind"] == "confirm_go"), None)
        if confirm:
            return confirm

        # when the Blackout is at the door, run — do not sightsee
        if game is not None and game.blackout_distance() <= 0:
            flee = [o for o in options if o["kind"] == "exit" and game.exit_open(o["data"])
                    and game.carriage_index(o["data"]["to"]) > game.carriage_index()]
            if flee:
                self._note("fleeing the Blackout")
                return flee[0]
            back = next((o for o in options if o["kind"] == "back"), None)
            if back:
                return back

        actions = [o for o in options if o["kind"] == "action" and o.get("enabled")]
        fresh = [o for o in actions
                 if (game.position, o.get("node_id"), o["data"]["id"]) not in self.tried]
        if fresh:
            o = fresh[0]
            self.tried.add((game.position, o.get("node_id"), o["data"]["id"]))
            self._note(f"action: {o['label']}")
            return o

        back = next((o for o in options if o["kind"] == "back"), None)
        in_node_menu = back is not None and not any(o["kind"] in ("node", "exit") for o in options)
        if in_node_menu:
            return back  # nothing new to try inside this node — step out

        nodes = [o for o in options if o["kind"] == "node" and o.get("enabled")]
        for o in nodes:
            node = o["data"]
            for act in game.available_actions(node):
                if (game.position, node["id"], act["id"]) not in self.tried:
                    self._note(f"inspect: {o['label']}")
                    return o

        exits = [o for o in options if o["kind"] == "exit" and o.get("enabled")]
        open_exits = [o for o in exits if game.exit_open(o["data"])]
        forward = [o for o in open_exits
                   if o["data"]["to"] not in game.visited
                   and game.carriage_index(o["data"]["to"]) > game.carriage_index()]
        if forward:
            self._note(f"exit: {forward[0]['label']}")
            return forward[0]
        unvisited = [o for o in open_exits if o["data"]["to"] not in game.visited]
        if unvisited:
            self._note(f"exit: {unvisited[0]['label']}")
            return unvisited[0]

        # stuck in the carriage: allow repeatable actions (failed unlocks) again
        if nodes:
            stale = {t for t in self.tried if t[0] == game.position}
            if stale:
                self.tried -= stale
                for o in nodes:
                    if game.available_actions(o["data"]):
                        self._note(f"re-inspect: {o['label']}")
                        return o

        if open_exits:
            self._note(f"exit (fallback): {open_exits[0]['label']}")
            return open_exits[0]
        if back:
            return back
        for o in options:
            if o["kind"] != "system" and o.get("enabled"):
                return o
        raise QuitGame()

    def choose_character(self, game, prompt, candidates, optional=False):
        # prefer the frailest candidate; never refuse — the run must resolve
        pick = min(candidates, key=lambda c: (c.health, c.max_health))
        self._note(f"chose {pick.name} for: {prompt[:40]}")
        return pick

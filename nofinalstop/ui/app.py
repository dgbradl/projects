"""The playable application: menus, character creation, and the main loop."""

from ..engine.data import get_registry
from ..engine.rng import Rng
from ..engine.game import GameState
from ..engine import chargen, save as savemod
from ..engine.models import Party
from ..engine.perception import resolve_text, display_name, observer_tint
from .render import Renderer
from .controller import InteractiveController, AutoController, QuitGame, option


class App:
    def __init__(self, seed=None, plain=False, auto=False, party_size=4,
                 secret_mode="all", save_dir=None, input_fn=None, verbose_auto=False):
        self.registry = get_registry()
        self.seed = seed
        self.save_dir = save_dir
        self.party_size = party_size
        self.secret_mode = secret_mode
        self.renderer = Renderer(plain=plain)
        if auto:
            self.controller = AutoController(self.renderer, verbose=verbose_auto)
        else:
            self.controller = InteractiveController(self.renderer, input_fn)
        self.auto = auto

    # ------------------------------------------------------------ menus
    def main_menu(self):
        self.renderer.banner()
        opts = [option(1, "Board the train (quick start — a party is generated for you)", "new_quick")]
        opts.append(option(2, "Assemble your party (guided character creation)", "new_guided"))
        if savemod.has_save(save_dir=self.save_dir):
            opts.append(option(3, "Continue from the last save", "continue"))
        opts.append(option("q", "Leave the platform (quit)", "quit", tone="system"))
        picked = self.controller.choose(None, "The platform is cold. The train is waiting.", opts)
        return picked["kind"]

    def run(self):
        try:
            choice = "new_quick" if self.auto else self.main_menu()
            if choice == "quit":
                return None
            if choice == "continue":
                game = savemod.load_game(self.registry, save_dir=self.save_dir,
                                         controller=self.controller)
                self.renderer._print("The train remembers where you were.", "grey58")
            else:
                game = self.new_game(guided=(choice == "new_guided"))
            return self.run_loop(game)
        except QuitGame:
            self.renderer.line()
            self.renderer._print("You step back from the game. The train, of course, keeps moving.",
                                 "grey58")
            return None

    # ------------------------------------------------------------ chargen
    def new_game(self, guided=False):
        rng = Rng(self.seed)
        game = GameState(self.registry, rng, self.controller)
        events = []
        if guided:
            party = self.guided_party(rng)
            game.start_new(secret_mode=self.secret_mode, party=party, events=events)
        else:
            game.start_new(size=self.party_size, secret_mode=self.secret_mode, events=events)
        self.renderer.rule("Your Party")
        for c in game.party.characters:
            self.renderer.character_sheet(self.registry, c)
        self.renderer.party_sheet(self.registry, game)
        self.renderer.line()
        self.renderer._print("How to survive: inspect the numbered points of interest and act on them. "
                             "Every action costs minutes, and the minutes feed the darkness behind the "
                             "train. Find and open each forward door. Reach the engine. "
                             "Switch observers [o] to see what different eyes see.", "grey58")
        savemod.save_game(game, save_dir=self.save_dir)
        self.renderer.events(events)
        return game

    def guided_party(self, rng):
        party = Party()
        used_names = set()
        size = self.party_size
        opts = [option(i, str(i), "size") for i in (3, 4, 5)]
        picked = self.controller.choose(None, "How many souls board together? (4 recommended)", opts)
        size = int(picked["label"])
        for i in range(size):
            c = chargen.generate_character(self.registry, rng, f"pc{i + 1}",
                                           secret_mode=self.secret_mode, used_names=used_names)
            while True:
                self.renderer.character_sheet(self.registry, c)
                picked = self.controller.choose(None, f"Traveler {i + 1} of {size}:", [
                    option(1, "Accept this character", "accept"),
                    option(2, "Reroll everything", "reroll"),
                    option(3, "Choose a different profession", "profession"),
                    option(4, "Rename them", "rename"),
                ])
                if picked["kind"] == "accept":
                    break
                if picked["kind"] == "reroll":
                    c = chargen.generate_character(self.registry, rng, f"pc{i + 1}",
                                                   secret_mode=self.secret_mode,
                                                   used_names=used_names)
                elif picked["kind"] == "profession":
                    profs = list(self.registry.professions.values())
                    popts = [option(j + 1, f"{p['name']} — {p['desc']}", "prof", p)
                             for j, p in enumerate(profs)]
                    pp = self.controller.choose(None, "Their former life:", popts)
                    c = chargen.generate_character(self.registry, rng, f"pc{i + 1}",
                                                   pp["data"]["id"], name=c.name,
                                                   secret_mode=self.secret_mode)
                elif picked["kind"] == "rename":
                    try:
                        new_name = self.controller.input_fn("Name: ").strip()
                    except (EOFError, AttributeError):
                        new_name = ""
                    if new_name:
                        c.name = new_name
            used_names.add(c.name.split()[0])
            party.add(c)
        party.relationships = chargen.generate_relationships(self.registry, rng, party.characters)
        return party

    # ------------------------------------------------------------ main loop
    def run_loop(self, game):
        r = self.renderer
        while not game.ending:
            if not game.party.living:
                break
            r.line()
            r.status(game)
            r.objective(game.current_objective())
            picked = self.controller.choose(game, "", self.carriage_options(game))
            kind = picked["kind"]
            if kind == "node":
                self.node_loop(game, picked["data"])
            elif kind == "exit":
                self.try_exit(game, picked["data"])
            elif kind == "observer":
                self.switch_observer(game)
            elif kind == "party":
                r.party_sheet(self.registry, game)
                self.character_detail(game)
            elif kind == "inventory":
                r.inventory_sheet(self.registry, game)
            elif kind == "evidence":
                r.evidence_board(game)
            elif kind == "journal":
                r.journal_sheet(self.registry, game)
            elif kind == "save":
                path = savemod.save_game(game, save_dir=self.save_dir)
                r._print(f"Saved. ({path})", "grey58")
            elif kind == "quit":
                savemod.save_game(game, save_dir=self.save_dir)
                r._print("Saved. The train continues without your attention.", "grey58")
                raise QuitGame()
        if game.ending:
            savemod.save_game(game, save_dir=self.save_dir)
            ending = self.registry.endings.get(game.ending, {})
            r.epilogue(self.registry, game)
        return game

    def carriage_options(self, game):
        opts = []
        n = 0
        active = game.party.active
        for node in game.visible_nodes():
            n += 1
            opts.append(option(n, display_name(game, node, active), "node", node))
        for ex in game.exits():
            n += 1
            open_ = game.exit_open(ex)
            label = resolve_text(game, ex.get("label", "An exit"))
            if not open_:
                label += "  [locked]"
            opts.append(option(n, label, "exit", ex, tone="exit"))
        opts.append(option("o", "Switch observer (see through other eyes)", "observer", tone="system"))
        opts.append(option("p", "Party", "party", tone="system"))
        opts.append(option("i", "Inventory", "inventory", tone="system"))
        opts.append(option("v", "Evidence board", "evidence", tone="system"))
        opts.append(option("j", "Journal & rules", "journal", tone="system"))
        opts.append(option("s", "Save", "save", tone="system"))
        opts.append(option("q", "Quit (saves first)", "quit", tone="system"))
        return opts

    def node_loop(self, game, node):
        r = self.renderer
        while True:
            active = game.party.active
            r.line()
            r.rule(display_name(game, node, active))
            desc = resolve_text(game, node.get("description"), active)
            if desc:
                r._print(desc)
            tint = observer_tint(active)
            if tint:
                r._print(f"({active.name}: {tint})", "grey58")
            acts = game.available_actions(node)
            if not acts:
                r._print("There is nothing more to be done here.", "grey58")
                return
            opts = []
            for i, act in enumerate(acts):
                met = game.action_requirement_met(act)
                label = resolve_text(game, act["label"])
                o = option(i + 1, label, "action", act,
                           note=None if met else resolve_text(game, act.get("requires_text", "")))
                o["node_id"] = node["id"]
                opts.append(o)
            opts.append(option("b", "Step back", "back", tone="system"))
            picked = self.controller.choose(game, f"({active.name} acts)", opts)
            if picked["kind"] == "back":
                return
            events = game.perform_action(node, picked["data"])
            r.events(events)
            if game.ending:
                return
            acts_left = game.available_actions(node)
            if not acts_left:
                return

    def try_exit(self, game, ex):
        r = self.renderer
        if not game.exit_open(ex):
            r._print(resolve_text(game, ex.get("locked_text", "It will not open.")), "dark_goldenrod")
            return
        opts = [option(1, "Go forward. (Anything abandoned belongs to the train.)", "confirm_go"),
                option(2, "Not yet.", "back", tone="system")]
        picked = self.controller.choose(game, resolve_text(game, ex.get("label", "Depart?")), opts)
        if picked["kind"] != "confirm_go":
            return
        events, moved = game.use_exit(ex)
        r.events(events)
        if moved and not game.ending:
            savemod.save_game(game, save_dir=self.save_dir)

    def switch_observer(self, game):
        living = game.party.living
        opts = [option(i + 1, f"{c.name} — comp {c.composure}/{c.max_composure}", "char", c)
                for i, c in enumerate(living)]
        picked = self.controller.choose(game, "Whose eyes do you look through?", opts)
        game.party.set_active(picked["data"].id)
        self.renderer._print(f"You now see the train as {picked['data'].name} sees it.", "cadet_blue")

    def character_detail(self, game):
        opts = [option(i + 1, c.name, "char", c) for i, c in enumerate(game.party.characters)]
        opts.append(option("b", "Back", "back", tone="system"))
        picked = self.controller.choose(game, "Examine someone closely?", opts)
        if picked["kind"] != "back":
            self.renderer.character_sheet(self.registry, picked["data"])

"""GameState: the running world.

Holds the party, the carriage graph position, the Blackout clock, flags,
evidence, rules and journal; interprets carriage data (nodes, actions,
escalations, exits) through the requirements/effects/checks interpreters.
"""

from .models import Party
from .requirements import check_requirements
from .effects import apply_effects
from .checks import run_check
from .perception import resolve_text
from . import chargen


class GameState:
    def __init__(self, registry, rng, controller=None):
        self.registry = registry
        self.rng = rng
        self.controller = controller
        self.party = Party()
        self.flags = set()
        self.evidence = {}          # id -> {title, category, text, carriage}
        self.rules_known = []
        self.journal = []
        self.mystery = None
        self.position = None        # current carriage id
        self.visited = []
        self.time_in_carriage = 0
        self.total_time = 0
        self.blackout_minutes = 0
        self.blackout_index = -1    # index of the last consumed carriage
        self.carriage_states = {}
        self.last_chosen_id = None
        self.ending = None
        self.secret_mode = "all"

    # ------------------------------------------------------------ setup
    def start_new(self, size=4, professions=None, secret_mode="all", party=None, events=None):
        events = events if events is not None else []
        cfg = self.registry.config
        self.secret_mode = secret_mode
        if party is None:
            members = chargen.generate_party_members(self.registry, self.rng, size,
                                                     professions, secret_mode)
            for c in members:
                self.party.add(c)
            self.party.relationships = chargen.generate_relationships(
                self.registry, self.rng, members)
        else:
            self.party = party
            if not self.party.relationships and len(self.party.characters) > 1:
                self.party.relationships = chargen.generate_relationships(
                    self.registry, self.rng, self.party.characters)
        for c in self.party.characters:
            for item in chargen.starting_items(self.registry, c):
                self.party.add_item(item)
        for rid, amt in cfg.get("starting_resources", {}).items():
            self.party.add_resource(rid, amt)
        self.mystery = self.rng.choice(list(self.registry.mysteries.keys()))
        self.enter_carriage(cfg["start_carriage"], events)
        return events

    # ------------------------------------------------------------ helpers
    def carriage(self):
        return self.registry.carriage(self.position)

    def carriage_index(self, cid=None):
        return self.registry.carriage(cid or self.position).get("index", 0)

    def blackout_distance(self):
        return self.carriage_index() - self.blackout_index

    def current_objective(self):
        """The carriage's data-declared 'way forward', resolved against current
        flags/items/evidence so it updates as the situation changes."""
        return resolve_text(self, self.carriage().get("objective"))

    def carriage_state(self, cid=None):
        cid = cid or self.position
        st = self.carriage_states.get(cid)
        if st is None:
            st = {"used_actions": [], "unlocked_exits": [], "revealed": [],
                  "hidden": [], "fired_escalations": [], "entered": False}
            self.carriage_states[cid] = st
        return st

    # ------------------------------------------------------------ time / blackout
    def advance_time(self, minutes, events, from_effect=False):
        if minutes == 0:
            return
        scale = self.carriage().get("time_scale", 1.0) if not from_effect else 1.0
        m = max(0, round(minutes * scale))
        self.time_in_carriage += m
        self.total_time += m
        self.blackout_minutes += m
        self._fire_escalations(events)
        self.check_blackout(events)

    def _fire_escalations(self, events):
        st = self.carriage_state()
        for esc in self.carriage().get("escalations", []):
            eid = esc.get("id") or f"t{esc.get('at_time', 0)}"
            if eid in st["fired_escalations"]:
                continue
            if self.time_in_carriage >= esc.get("at_time", 0):
                if not check_requirements(self, esc.get("if")):
                    continue
                st["fired_escalations"].append(eid)
                text = resolve_text(self, esc.get("text"))
                if text:
                    events.append({"kind": "escalation", "text": text})
                apply_effects(self, esc.get("effects", []), None, events)
                if self.ending:
                    return

    def check_blackout(self, events):
        threshold = self.registry.config.get("blackout_threshold", 45)
        while self.blackout_minutes >= threshold and not self.ending:
            self.blackout_minutes -= threshold
            self.blackout_index += 1
            dist = self.blackout_distance()
            if dist > 1:
                events.append({"kind": "blackout",
                               "text": "Somewhere behind you, another carriage goes dark. "
                                       f"The Blackout is {dist} car{'s' if dist != 1 else ''} away."})
            elif dist == 1:
                events.append({"kind": "blackout",
                               "text": "The lights in the carriage behind you die. Through the rear "
                                       "door's window there is now only churning black. Something in "
                                       "it keeps pace with the train."})
            elif dist == 0:
                events.append({"kind": "blackout",
                               "text": "The Blackout reaches THIS carriage. The lamps gutter brown. "
                                       "Sound arrives a half-second late. The rear wall is beginning "
                                       "to disappear. GET OUT. NOW."})
                apply_effects(self, [{"type": "composure", "who": "party", "delta": -1}], None, events)
            else:
                events.append({"kind": "blackout",
                               "text": "The floor dissolves into the dark. The Shape Behind the Train "
                                       "unfolds around the carriage, and the carriage stops existing."})
                self.trigger_ending("consumed", events)

    def blackout_pressure(self, events):
        """Called per action while the Blackout occupies the party's carriage."""
        if self.blackout_distance() <= 0 and not self.ending:
            events.append({"kind": "blackout",
                           "text": "The dark eats another span of the carriage. The Shape Behind "
                                   "the Train is very close."})
            apply_effects(self, [
                {"type": "composure", "who": "party", "delta": -1},
                {"type": "harm", "who": "random", "amount": 1, "chance": 0.5,
                 "fate": "taken by the Blackout"},
            ], None, events)

    # ------------------------------------------------------------ nodes & actions
    def visible_nodes(self):
        st = self.carriage_state()
        out = []
        for node in self.carriage().get("nodes", []):
            if node["id"] in st["hidden"]:
                continue
            if node.get("hidden") and node["id"] not in st["revealed"]:
                continue
            if not check_requirements(self, node.get("visible_if")):
                continue
            out.append(node)
        return out

    def available_actions(self, node):
        st = self.carriage_state()
        out = []
        for act in node.get("actions", []):
            key = f"{node['id']}::{act['id']}"
            if act.get("once", True) and key in st["used_actions"]:
                continue
            if not check_requirements(self, act.get("visible_if"), self.party.active):
                continue
            out.append(act)
        return out

    def action_requirement_met(self, action):
        return check_requirements(self, action.get("requires"), self.party.active)

    def perform_action(self, node, action, events=None):
        events = events if events is not None else []
        st = self.carriage_state()
        actor = self.party.active
        if not self.action_requirement_met(action):
            events.append({"kind": "alert",
                           "text": resolve_text(self, action.get("requires_text",
                                                                 "You lack what that would take."))})
            return events
        cost = action.get("cost", {})
        for rid, amt in cost.items():
            if not self.party.spend_resource(rid, amt):
                events.append({"kind": "alert",
                               "text": f"Not enough {rid.replace('_', ' ')}."})
                return events
        if action.get("consumes_item"):
            if not self.party.remove_item(action["consumes_item"]):
                events.append({"kind": "alert", "text": "The needed item is gone."})
                return events
            item = self.registry.item(action["consumes_item"])
            events.append({"kind": "loss", "text": f"Used: {item['name']}"})

        if action.get("once", True):
            st["used_actions"].append(f"{node['id']}::{action['id']}")

        pre = resolve_text(self, action.get("pre_text"))
        if pre:
            events.append({"kind": "text", "text": pre})

        check = action.get("check")
        if check:
            result = run_check(self.registry, self, actor,
                               check["attr"], check.get("skill"),
                               check.get("dc", "normal"), action.get("tags"))
            events.append({"kind": "check", "result": result,
                           "text": self._format_check(result, check)})
            for note in result.notes:
                events.append({"kind": "scar", "text": note})
            branch = {
                "crit": action.get("on_crit") or action.get("on_success"),
                "success": action.get("on_success"),
                "partial": action.get("on_partial") or action.get("on_success"),
                "fail": action.get("on_fail"),
                "fumble": action.get("on_fumble") or action.get("on_fail"),
            }[result.tier]
            if result.tier == "partial" and action.get("on_partial") is None:
                apply_effects(self, action.get("partial_cost",
                              [{"type": "composure", "who": "actor", "delta": -1}]),
                              actor, events)
            apply_effects(self, branch or [], actor, events)
        else:
            apply_effects(self, action.get("effects", []), actor, events)

        # time passes after the deed; the Blackout does not wait
        if not self.ending:
            self.advance_time(action.get("time", self.registry.config.get("default_action_time", 4)),
                              events)
            self.blackout_pressure(events)
        return events

    def _format_check(self, result, check):
        attr = check["attr"].title()
        skill = check.get("skill")
        skill_name = self.registry.skills.get(skill, {}).get("name", skill) if skill else None
        label = f"{attr}" + (f" + {skill_name}" if skill_name else "")
        d1, d2 = result.dice
        mods = " ".join(f"{'+' if v >= 0 else ''}{v} {n}" for n, v in result.mods if v != 0)
        tier_word = {"crit": "CRITICAL SUCCESS", "success": "Success",
                     "partial": "Partial success", "fail": "Failure",
                     "fumble": "DISASTER"}[result.tier]
        return (f"{result.character.name} — {label}: [{d1}][{d2}] {mods} = "
                f"{result.total} vs {result.dc} → {tier_word}")

    # ------------------------------------------------------------ exits & travel
    def exits(self):
        out = []
        for ex in self.carriage().get("exits", []):
            if not check_requirements(self, ex.get("visible_if")):
                continue
            out.append(ex)
        return out

    def exit_open(self, ex):
        st = self.carriage_state()
        if ex["id"] in st["unlocked_exits"]:
            return True
        if "requires" in ex:
            return check_requirements(self, ex["requires"])
        if ex.get("locked"):
            return False
        return True

    def use_exit(self, ex, events=None):
        events = events if events is not None else []
        if not self.exit_open(ex):
            events.append({"kind": "alert",
                           "text": resolve_text(self, ex.get("locked_text", "It will not open."))})
            return events, False
        apply_effects(self, ex.get("effects", []), None, events)
        if self.ending:
            return events, True
        text = resolve_text(self, ex.get("travel_text"))
        if text:
            events.append({"kind": "text", "text": text})
        self.travel(ex["to"], ex.get("time", 3), events)
        return events, True

    def travel(self, to_cid, minutes, events):
        # lingering wounds bite during transit
        for c in list(self.party.living):
            for cid in list(c.conditions):
                cond = self.registry.conditions.get(cid, {})
                ot = cond.get("on_travel")
                if ot:
                    apply_effects(self, ot, c, events)
        if self.ending:
            return
        # some items change between carriages
        for item_id in list(self.party.inventory.keys()):
            item = self.registry.items.get(item_id)
            if item and item.get("transforms", {}).get(to_cid):
                new_id = item["transforms"][to_cid]
                count = self.party.inventory[item_id]
                self.party.remove_item(item_id, count)
                self.party.add_item(new_id, count)
                new_item = self.registry.item(new_id)
                events.append({"kind": "alert",
                               "text": f"In the crossing between cars, the {item['name'].lower()} "
                                       f"becomes {new_item['name'].lower()}. No one saw it change."})
        self.advance_time(minutes, events)
        if not self.ending:
            self.enter_carriage(to_cid, events)

    def enter_carriage(self, cid, events):
        self.position = cid
        self.time_in_carriage = 0
        if cid not in self.visited:
            self.visited.append(cid)
        for c in self.party.characters:
            c.used_second_chance = False
        st = self.carriage_state(cid)
        first = not st["entered"]
        st["entered"] = True
        car = self.carriage()
        events.append({"kind": "arrive", "text": car.get("name", cid)})
        arrival = resolve_text(self, car.get("arrival"))
        if arrival and first:
            events.append({"kind": "text", "text": arrival})
        elif not first:
            events.append({"kind": "text",
                           "text": resolve_text(self, car.get("return_text",
                                                "You have been here before. It has not improved."))})
        if first:
            apply_effects(self, car.get("on_enter", []), None, events)

    # ------------------------------------------------------------ death & endings
    def on_death(self, dead, events):
        for other in self.party.living:
            other.shift_composure(-1)
            r = self.party.relation_between(other.id, dead.id)
            if r and r.trust >= 3:
                other.shift_composure(-1)
                events.append({"kind": "mind",
                               "text": f"{other.name} cannot look away from what is left of {dead.name}."})
        if not self.party.living and not self.ending:
            self.trigger_ending("all_dead", events)

    def trigger_ending(self, ending_id, events):
        if self.ending:
            return
        self.ending = ending_id
        e = self.registry.endings.get(ending_id, {"name": ending_id, "text": ""})
        events.append({"kind": "ending", "text": e.get("name", ending_id)})
        events.append({"kind": "text", "text": resolve_text(self, e.get("text"))})

    # ------------------------------------------------------------ serialization
    def to_dict(self):
        return {
            "version": 1,
            "party": self.party.to_dict(),
            "flags": sorted(self.flags),
            "evidence": self.evidence,
            "rules_known": self.rules_known,
            "journal": self.journal,
            "mystery": self.mystery,
            "position": self.position,
            "visited": self.visited,
            "time_in_carriage": self.time_in_carriage,
            "total_time": self.total_time,
            "blackout_minutes": self.blackout_minutes,
            "blackout_index": self.blackout_index,
            "carriage_states": self.carriage_states,
            "last_chosen_id": self.last_chosen_id,
            "ending": self.ending,
            "secret_mode": self.secret_mode,
            "rng_state": self.rng.get_state(),
        }

    @classmethod
    def from_dict(cls, registry, d, controller=None):
        from .rng import Rng
        rng = Rng()
        rng.set_state(d["rng_state"])
        g = cls(registry, rng, controller)
        g.party = Party.from_dict(d["party"])
        g.flags = set(d.get("flags", []))
        g.evidence = d.get("evidence", {})
        g.rules_known = d.get("rules_known", [])
        g.journal = d.get("journal", [])
        g.mystery = d.get("mystery")
        g.position = d.get("position")
        g.visited = d.get("visited", [])
        g.time_in_carriage = d.get("time_in_carriage", 0)
        g.total_time = d.get("total_time", 0)
        g.blackout_minutes = d.get("blackout_minutes", 0)
        g.blackout_index = d.get("blackout_index", -1)
        g.carriage_states = d.get("carriage_states", {})
        g.last_chosen_id = d.get("last_chosen_id")
        g.ending = d.get("ending")
        g.secret_mode = d.get("secret_mode", "all")
        return g

"""Declarative requirement evaluation.

Requirement objects appear in carriage data as `requires`, `visible_if`,
`locked_unless`, and perception-variant `if` clauses.  They are evaluated
against the game state plus a focus character (usually the active observer
or the character performing an action).

Supported keys (all present keys must pass — AND semantics):

  flag / not_flag            : str or [str] — run flags
  item / not_item            : party inventory
  resource_min               : {resource: amount}
  evidence / not_evidence    : evidence board entry ids
  profession                 : str or [str] — focus character (or any_party)
  skill_min                  : {skill: level}
  attr_min                   : {attr: value}
  trait / fear / secret      : str or [str]
  scar / not_scar            : str or [str]
  condition / not_condition  : str or [str]
  composure_max / composure_min : int (focus character)
  health_max                 : int
  mystery                    : str or [str] — active mystery configuration
  blackout_distance_max      : int — carriages between party and Blackout
  party_min / party_max      : int — number of living characters
  rule_known                 : str — a train rule recorded in the journal
  ending_flag                : reserved for endings
  any_party                  : true — character clauses pass if ANY living
                               member satisfies them (default: focus only)
  any / all / not            : nested requirement lists / object
"""

CHAR_KEYS = ("profession", "skill_min", "attr_min", "trait", "fear", "secret",
             "scar", "not_scar", "condition", "not_condition",
             "composure_max", "composure_min", "health_max")


def _as_list(v):
    return v if isinstance(v, list) else [v]


def check_requirements(game, req, focus=None):
    if not req:
        return True
    if isinstance(req, list):
        return all(check_requirements(game, r, focus) for r in req)

    if "any" in req and not any(check_requirements(game, r, focus) for r in req["any"]):
        return False
    if "all" in req and not all(check_requirements(game, r, focus) for r in req["all"]):
        return False
    if "not" in req and check_requirements(game, req["not"], focus):
        return False

    party = game.party
    if "flag" in req and not all(f in game.flags for f in _as_list(req["flag"])):
        return False
    if "not_flag" in req and any(f in game.flags for f in _as_list(req["not_flag"])):
        return False
    if "item" in req and not all(party.has_item(i) for i in _as_list(req["item"])):
        return False
    if "not_item" in req and any(party.has_item(i) for i in _as_list(req["not_item"])):
        return False
    if "resource_min" in req:
        for rid, amt in req["resource_min"].items():
            if party.resources.get(rid, 0) < amt:
                return False
    if "evidence" in req and not all(e in game.evidence for e in _as_list(req["evidence"])):
        return False
    if "not_evidence" in req and any(e in game.evidence for e in _as_list(req["not_evidence"])):
        return False
    if "mystery" in req and game.mystery not in _as_list(req["mystery"]):
        return False
    if "blackout_distance_max" in req and game.blackout_distance() > req["blackout_distance_max"]:
        return False
    if "party_min" in req and len(party.living) < req["party_min"]:
        return False
    if "party_max" in req and len(party.living) > req["party_max"]:
        return False
    if "rule_known" in req and not all(r in game.rules_known for r in _as_list(req["rule_known"])):
        return False
    if "visited" in req and not all(c in game.visited for c in _as_list(req["visited"])):
        return False
    if "not_visited" in req and any(c in game.visited for c in _as_list(req["not_visited"])):
        return False

    # character-scoped clauses
    char_clauses = {k: req[k] for k in CHAR_KEYS if k in req}
    if char_clauses:
        if req.get("any_party"):
            candidates = party.living
        else:
            candidates = [focus or party.active]
        if not any(c and _char_passes(c, char_clauses) for c in candidates):
            return False
    return True


def _char_passes(c, clauses):
    if "profession" in clauses and c.profession not in _as_list(clauses["profession"]):
        return False
    if "skill_min" in clauses:
        for s, lvl in clauses["skill_min"].items():
            if c.skill_level(s) < lvl:
                return False
    if "attr_min" in clauses:
        for a, v in clauses["attr_min"].items():
            if c.attrs.get(a, 0) < v:
                return False
    if "trait" in clauses and not ({c.trait_positive, c.trait_difficult} & set(_as_list(clauses["trait"]))):
        return False
    if "fear" in clauses and c.fear not in _as_list(clauses["fear"]):
        return False
    if "secret" in clauses and c.secret not in _as_list(clauses["secret"]):
        return False
    if "scar" in clauses and not any(c.has_scar(s) for s in _as_list(clauses["scar"])):
        return False
    if "not_scar" in clauses and any(c.has_scar(s) for s in _as_list(clauses["not_scar"])):
        return False
    if "condition" in clauses and not any(c.has_condition(x) for x in _as_list(clauses["condition"])):
        return False
    if "not_condition" in clauses and any(c.has_condition(x) for x in _as_list(clauses["not_condition"])):
        return False
    if "composure_max" in clauses and c.composure > clauses["composure_max"]:
        return False
    if "composure_min" in clauses and c.composure < clauses["composure_min"]:
        return False
    if "health_max" in clauses and c.health > clauses["health_max"]:
        return False
    return True


def find_qualifier(game, req, prefer=None):
    """Return a living party member who satisfies the character clauses of req
    (used to report WHO makes an any_party requirement pass)."""
    clauses = {k: req[k] for k in CHAR_KEYS if k in (req or {})}
    if not clauses:
        return prefer
    for c in ([prefer] if prefer else []) + game.party.living:
        if c and _char_passes(c, clauses):
            return c
    return None

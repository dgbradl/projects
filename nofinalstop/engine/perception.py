"""Character-specific perception.

Any descriptive text in carriage data may be a plain string, or a list of
variants.  Each variant is either a plain string (the default) or an object
{"if": <requirement>, "text": "..."}.  The first variant whose requirement
passes for the current OBSERVER is chosen, so a physician, a low-Composure
character, or someone with a particular fear can each read a different room.

Low Composure additionally distorts the interface itself: node and item
labels may be replaced with their `low_composure_name`, and at very low
Composure the text is occasionally unreliable.
"""

from .requirements import check_requirements

LOW_COMPOSURE_THRESHOLD = 3


def resolve_text(game, text, observer=None):
    """Resolve a text-variant structure into a string for the observer."""
    observer = observer or game.party.active
    if text is None:
        return ""
    if isinstance(text, str):
        return text
    if isinstance(text, list):
        default = ""
        for variant in text:
            if isinstance(variant, str):
                default = default or variant
                continue
            if "if" in variant:
                if check_requirements(game, variant["if"], observer):
                    return variant.get("text", "")
            else:
                default = default or variant.get("text", "")
        return default
    if isinstance(text, dict):
        return text.get("text", "")
    return str(text)


def display_name(game, entity, observer=None):
    """Name for a node/item dict, honouring low-Composure mislabels."""
    observer = observer or game.party.active
    name = resolve_text(game, entity.get("name", entity.get("id", "?")), observer)
    if observer and observer.composure <= LOW_COMPOSURE_THRESHOLD:
        alt = entity.get("low_composure_name")
        if alt:
            return resolve_text(game, alt, observer)
    return name


def observer_tint(observer):
    """A short parenthetical describing how reliable this observer is."""
    if observer is None:
        return ""
    if observer.composure <= 1:
        return "Their grip on what is real has almost gone."
    if observer.composure <= LOW_COMPOSURE_THRESHOLD:
        return "They are no longer certain what they are seeing."
    return ""

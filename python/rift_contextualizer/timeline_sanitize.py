"""
Type-aware field stripping for the /timeline-window output.

Kept separate from `timeline_window.py` so the windowing/merging logic stays
focused on *what* to include, while this module decides *which fields* to
keep on the items that are included.

Why a dedicated module:
  - The blocklists are data, not code; isolating them makes future tweaks
    (add a field, drop another event type) a one-line change.
  - `timeline_window.extract_window` stays pure and testable independently.
  - Other consumers (e.g. a future debug dump endpoint) can reuse the same
    sanitizers without pulling in the windowing pass.

All functions are intentionally defensive: malformed Riot payloads degrade
to "skip this field" / "skip this event" rather than raising, so one bad
event can never blank the whole window.
"""

from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# Event-level rules
# ---------------------------------------------------------------------------

# Per-event-type list of keys to strip from the emitted event.
# Using `frozenset` for O(1) membership checks and immutability (these
# constants are module-global; we never want them mutated at runtime).
EVENT_FIELD_BLOCKLIST: dict[str, frozenset[str]] = {
    # Champion kills: drop heavy damage breakdowns + multi-kill metadata
    # that the AI Judge doesn't reason over.
    "CHAMPION_KILL": frozenset({
        "victimDamageDealt",
        "victimDamageReceived",
        "killType",
        "multiKillLength",
    }),
    # Building kills: keep only the core (killerId, position, timestamp,
    # teamId). The lane/tower/building taxonomy is redundant with position
    # and adds noise.
    "BUILDING_KILL": frozenset({
        "laneType",
        "towerType",
        "buildingType",
    }),
    # Level / skill events: drop the discriminator strings; the LLM only
    # needs to know "this player leveled" with the timestamp.
    "LEVEL_UP": frozenset({
        "levelUpType",
    }),
    "SKILL_LEVEL_UP": frozenset({
        "levelUpType",
        "skillSlot",
    }),
}


# Event types removed entirely from the output stream. Item churn is huge in
# volume and adds little signal for fault attribution at the macro level.
DROPPED_EVENT_TYPES: frozenset[str] = frozenset({
    "ITEM_PURCHASED",
    "ITEM_DESTROYED",
    "ITEM_SOLD",
    "ITEM_UNDO",
})


def sanitize_event(ev: dict[str, Any]) -> dict[str, Any] | None:
    """
    Decide whether to keep an event and, if so, strip its blocklisted keys.

    Returns:
        - `None` when the event type is in `DROPPED_EVENT_TYPES`. The caller
          should skip the event entirely.
        - A shallow-copied dict with the blocklisted fields removed otherwise.
          Unknown event types pass through untouched (forward-compatible with
          new Riot event types).
    """
    et = ev.get("type")

    # Rule 3: drop item events wholesale.
    if isinstance(et, str) and et in DROPPED_EVENT_TYPES:
        return None

    # No-op for types we don't have a blocklist for. Returning a copy is
    # still safe but skipping the copy avoids needless allocations.
    blocked = EVENT_FIELD_BLOCKLIST.get(et) if isinstance(et, str) else None
    if not blocked:
        return ev

    # Shallow copy so we never mutate the source payload (it may be cached
    # upstream by the Riot client).
    cleaned = dict(ev)
    for key in blocked:
        # `pop(key, None)` is no-op-safe if Riot ever stops sending the field.
        cleaned.pop(key, None)
    return cleaned


# ---------------------------------------------------------------------------
# Frame-level rules
# ---------------------------------------------------------------------------

# Top-level participantFrame keys to drop entirely.
_FRAME_DROP_KEYS: frozenset[str] = frozenset({
    "goldPerSecond",
})

# Nested-stat dicts: which keys to keep. Anything else inside these blocks
# is dropped to slim the payload (championStats and damageStats are by far
# the largest contributors to per-frame size).
_CHAMPION_STATS_KEEP: frozenset[str] = frozenset({"health", "healthMax"})
_DAMAGE_STATS_KEEP: frozenset[str] = frozenset({"totalDamageDoneToChampions"})


def _slim_dict(source: Any, keep: frozenset[str]) -> dict[str, Any]:
    """
    Return a new dict containing only `keep` keys that exist in `source`.

    Defensive: if `source` is missing or not a dict (malformed payload), we
    return an empty dict instead of raising. We deliberately do NOT fabricate
    default values — absent data should look absent downstream.
    """
    if not isinstance(source, dict):
        return {}
    # Iterate over the smaller `keep` set, not the source dict, for speed.
    return {k: source[k] for k in keep if k in source}


def sanitize_frame(frame: dict[str, Any]) -> dict[str, Any]:
    """
    Return a shallow-copied participant frame with noisy fields removed.

    Removed:
      - `goldPerSecond` (top-level, dropped entirely).
    Slimmed:
      - `championStats` → only `health`, `healthMax`.
      - `damageStats`   → only `totalDamageDoneToChampions`.

    All other top-level keys (`currentGold`, `totalGold`, `level`, `xp`,
    `minionsKilled`, `jungleMinionsKilled`, `position`, `participantId`,
    `timeEnemySpentControlled`, ...) pass through unchanged.
    """
    # Guard: caller already checks isinstance(..., dict) before calling, but
    # be defensive in case this function is reused elsewhere later.
    if not isinstance(frame, dict):
        return {}

    cleaned = dict(frame)  # shallow copy → never mutates the source.

    # Drop top-level noisy keys.
    for key in _FRAME_DROP_KEYS:
        cleaned.pop(key, None)

    # Slim the nested stat dicts. We replace the whole sub-dict rather than
    # mutating it, because Riot's stat dicts are often shared object refs
    # across frames in some client caches.
    if "championStats" in cleaned:
        cleaned["championStats"] = _slim_dict(cleaned["championStats"], _CHAMPION_STATS_KEEP)
    if "damageStats" in cleaned:
        cleaned["damageStats"] = _slim_dict(cleaned["damageStats"], _DAMAGE_STATS_KEEP)

    return cleaned

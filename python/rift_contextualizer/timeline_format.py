"""
Timeline timestamp formatting.

Converts raw Riot game-time millisecond integers into the human-friendly
`[mm:ss]` string format used by the `/timeline-window` JSON response.

Design notes:

- This module is intentionally pure (no I/O, no Riot client). It runs as the
  very last pass on the merged window list so the rest of the pipeline
  (sanitize, humanize, sort, lookback) keeps working in raw integer ms —
  which is faster, simpler, and avoids re-parsing strings.

- "Game time" here means "milliseconds since game start" (Riot's
  `frame.timestamp` / `event.timestamp` convention). For matches >= 60
  minutes, minutes simply overflow (e.g. `[63:12]`) per product decision —
  no `[hh:mm:ss]` form.

- Field detection is **name-based**: any dict key literally named
  `timestamp` (case-sensitive, matching Riot's schema) whose value is a
  numeric ms count is rewritten in place. We deliberately DO NOT touch
  `realTimestamp` (Unix epoch ms — not game time; would render as a
  nonsense `[mm:ss]`).

- Defensive against malformed payloads: non-numeric, negative, or NaN
  values are left untouched rather than crashing the whole window. This
  mirrors the rest of the timeline pipeline's "skip-don't-fail" style.
"""

from __future__ import annotations

import math
from typing import Any


# Field names that hold *game-time* milliseconds and should be rewritten.
# Kept as a frozenset so membership checks are O(1) and the set is
# trivially extensible if Riot adds new game-time fields in the future.
#
# Explicitly excluded: `realTimestamp` (Unix epoch ms on PAUSE_END etc.),
# `gameStartTimestamp` (epoch ms in match-v5 metadata) — neither represents
# elapsed game time.
_GAME_TIME_KEYS: frozenset[str] = frozenset({"timestamp"})


def format_game_time(ms: Any) -> str | None:
    """
    Format a game-time millisecond value as `[mm:ss]`.

    Returns the formatted string, or `None` if `ms` is not a usable number
    (caller should leave the original value in place when None comes back).

    Edge cases:
      - bools are rejected (Python treats `True`/`False` as `int`, but
        they're never legitimate timestamps).
      - negative values are rejected (game time can't go backwards).
      - NaN / +inf floats are rejected.
      - Strings holding integer digits are accepted as a convenience for
        any upstream that stringified the field.
      - Minutes overflow past 59 (e.g. a 63-minute game → `[63:00]`),
        matching the product spec ("let mm overflow").
    """
    # Reject bools explicitly — `isinstance(True, int)` is True in Python.
    if isinstance(ms, bool):
        return None

    if isinstance(ms, (int, float)):
        value: float = float(ms)
    elif isinstance(ms, str):
        try:
            value = float(ms)
        except ValueError:
            return None
    else:
        return None

    # Filter out NaN / inf before any arithmetic.
    if not math.isfinite(value):
        return None
    if value < 0:
        return None

    # Truncate (not round) to whole seconds — matches how scoreboards and
    # the in-game clock display elapsed time. Avoids the surprise of
    # `999ms` rounding up to `[00:01]` when the underlying game clock
    # reads `00:00`.
    total_seconds = int(value // 1000)
    minutes, seconds = divmod(total_seconds, 60)

    # `mm` is allowed to overflow past 59. `ss` always two digits.
    return f"[{minutes:02d}:{seconds:02d}]"


def humanize_timestamps(node: Any) -> Any:
    """
    Recursively rewrite every game-time `timestamp` field in `node` into
    the `[mm:ss]` string format.

    Walks dicts and lists; primitives are returned untouched. Mutates
    dicts/lists **in place** for performance — the merged window can hold
    hundreds of items and we don't want to deep-copy the whole tree just
    to flip a handful of integer fields. Returns the same node for
    convenient chaining at call sites.

    Cycle safety: Riot timeline payloads are tree-shaped (pure JSON), so
    we don't track a `seen` set. If a future caller passes a self-
    referential structure, this function would recurse infinitely — that's
    an acceptable tradeoff for the simpler/faster code path.
    """
    if isinstance(node, dict):
        for key, value in node.items():
            if key in _GAME_TIME_KEYS:
                # Only rewrite if the formatter accepts the value; on
                # rejection we deliberately leave the original in place
                # so debuggers can still see the raw payload.
                formatted = format_game_time(value)
                if formatted is not None:
                    node[key] = formatted
                # Do NOT recurse into the (now-string) timestamp value.
                continue
            # Recurse into nested containers so e.g. event sub-arrays
            # (victimDamageDealt[].timestamp) also get rewritten.
            if isinstance(value, (dict, list)):
                humanize_timestamps(value)
    elif isinstance(node, list):
        for item in node:
            if isinstance(item, (dict, list)):
                humanize_timestamps(item)
    return node
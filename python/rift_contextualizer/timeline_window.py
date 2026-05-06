"""
Timeline-window extraction.

Given a Riot match-v5 timeline payload and a [start_ms, end_ms] window, build a
single chronological list that interleaves:

  - participantFrames snapshots (one item per (frame timestamp, participantId))
  - events (any kind: kills, ward placements, item buys, level-ups, ...)

The two layers are flattened, tagged with `kind`, and stably sorted by
`timestamp` so the caller can render or stream them as a single sequence.

Lookback rule: if the merged window has items but does NOT begin with a
`kind: "frame"` snapshot (i.e. the first item is an event), we look backward
through `info.frames` for the most recent frame whose `timestamp < start_ms`
and prepend its 10 per-participant snapshots. Those prepended items keep
their *real* (pre-window) timestamp so they sort to the very top and are
clearly distinguishable as "world state just before the window opened".
This gives downstream consumers (LLM, debug UI) a baseline snapshot even
when the user picks a window boundary that lands between Riot's 1-minute
frame ticks. No-op when the window is empty or already starts with a frame.

This module is intentionally pure (no I/O, no Riot client, no FastAPI). The
HTTP layer wires it up.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from rift_contextualizer.timeline_sanitize import sanitize_event, sanitize_frame
from rift_contextualizer.timeline_humanize import humanize_event, humanize_frame_item
from rift_contextualizer.timeline_format import humanize_timestamps


# Public sentinel: the kind tags emitted on each merged item. Kept as plain
# strings so the JSON output stays readable (no enums leaking through).
KIND_FRAME = "frame"
KIND_EVENT = "event"


def _coerce_ts(value: Any) -> int | None:
    """
    Best-effort timestamp coercion.

    Riot uses integer milliseconds for both `frame.timestamp` and
    `event.timestamp`. Defensive against floats / strings showing up in the
    wild — anything non-numeric is treated as "missing" and skipped by the
    caller (instead of crashing the whole window).
    """
    if isinstance(value, bool):  # bools are ints in Python; reject explicitly.
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _iter_frame_items(
    frame: dict[str, Any], frame_ts: int, champ_by_id: Mapping[int, str] | None
) -> Iterable[dict[str, Any]]:
    """
    Expand one timeline frame into per-participant snapshot items.

    A `participantFrames` block is a dict keyed by participantId-as-string:
        { "1": {...}, "2": {...}, ... "10": {...} }
    We emit one item per participant so consumers don't have to re-shape it
    later. Each item carries its own `participantId` and `timestamp` for easy
    sorting + filtering downstream.
    """
    pframes = frame.get("participantFrames")
    if not isinstance(pframes, dict):
        return

    for pid_str, pdata in pframes.items():
        if not isinstance(pdata, dict):
            # Skip malformed entries instead of failing the whole window.
            continue
        try:
            pid = int(pid_str)
        except (TypeError, ValueError):
            # Non-numeric keys shouldn't occur in real Riot payloads, but
            # silently skip rather than crash the request.
            continue

        # Shallow copy so we can attach metadata without mutating the source
        # payload (which may be cached / shared by the upstream client).
        # `sanitize_frame` strips noisy stat blocks (championStats,
        # damageStats, goldPerSecond) — see timeline_sanitize.py for the
        # exact rules. Done here, at the boundary, so every consumer of the
        # window output gets the same slim shape.
        item: dict[str, Any] = {
            "kind": KIND_FRAME,
            "timestamp": frame_ts,
            "participantId": pid,
            "frame": sanitize_frame(pdata),
        }
        # Humanize last: rewrite participantId / inner frame ids to champion
        # names when a lookup is available. No-op when champ_by_id is empty
        # or None (graceful degradation on malformed match payloads).
        if champ_by_id:
            item = humanize_frame_item(item, champ_by_id)
        yield item


def _iter_frame_events(
    frame: dict[str, Any], start_ms: int, end_ms: int,
    champ_by_id: Mapping[int, str] | None,
) -> Iterable[dict[str, Any]]:
    """
    Yield events from a frame whose `timestamp` falls within [start_ms, end_ms].

    Events without a usable timestamp are dropped (they can't be sorted).
    """
    events = frame.get("events")
    if not isinstance(events, list):
        return

    for ev in events:
        if not isinstance(ev, dict):
            continue
        ts = _coerce_ts(ev.get("timestamp"))
        if ts is None:
            continue
        if ts < start_ms or ts > end_ms:
            continue
        # Sanitize before tagging: drops item events entirely (returns None)
        # and strips per-type blocklisted fields (e.g. victimDamageDealt on
        # CHAMPION_KILL). Unknown event types pass through untouched so new
        # Riot event types aren't silently truncated.
        sanitized = sanitize_event(ev)
        if sanitized is None:
            continue
        # Humanize after sanitize so we never waste work on dropped events.
        if champ_by_id:
            sanitized = humanize_event(sanitized, champ_by_id)
        # Tag via shallow merge: keep the original keys verbatim so callers
        # can still see `type`, `killerId`, `victimId`, `position`, etc.
        # without us having to mirror Riot's full schema.
        yield {"kind": KIND_EVENT, **sanitized}


def _find_closest_prior_frame(
    frames: list[Any], start_ms: int
) -> tuple[dict[str, Any], int] | None:
    """
    Return the (frame, timestamp) pair with the largest timestamp strictly
    less than `start_ms`, or None if no such frame exists.

    Riot frames are emitted in monotonic order in practice, but we don't rely
    on that — a linear scan tracking the max-so-far is O(F) with F ~30 for a
    standard game, which is trivial and robust against any out-of-order
    payloads. Malformed entries (non-dict, missing/unparseable timestamp)
    are silently skipped, mirroring the rest of this module's defensive
    style.
    """
    best: tuple[dict[str, Any], int] | None = None
    for frame in frames:
        if not isinstance(frame, dict):
            continue
        ts = _coerce_ts(frame.get("timestamp"))
        if ts is None:
            continue
        if ts >= start_ms:
            continue
        # Keep the latest qualifying frame. Strict `>` ensures stable choice
        # if two frames somehow share a timestamp (last one wins, matching
        # natural iteration order).
        if best is None or ts > best[1]:
            best = (frame, ts)
    return best


def extract_window(
    timeline: dict[str, Any],
    start_ms: int,
    end_ms: int,
    champ_by_id: Mapping[int, str] | None = None,
) -> list[dict[str, Any]]:
    """
    Merge participantFrames + events within [start_ms, end_ms] and return
    a single list sorted ascending by timestamp.

    Bounds are inclusive on both ends so a snapshot exactly at `start_ms` or
    `end_ms` is included. The sort is **stable**, which means for items that
    share a timestamp the relative order is: frame snapshots first (in
    participantId order, since dict iteration in CPython 3.7+ is insertion
    order and Riot keys participantFrames as "1".."10"), then events in their
    original event-array order. This keeps "the world state at minute N"
    visually grouped before "what happened at minute N".

    Raises:
        ValueError: when the window is malformed (negative, inverted) or the
        timeline payload is missing the expected `info.frames` shape.
    """
    if not isinstance(timeline, dict):
        raise ValueError("timeline must be a JSON object")
    if start_ms < 0 or end_ms < 0:
        raise ValueError("start_ms and end_ms must be non-negative")
    if end_ms < start_ms:
        raise ValueError("end_ms must be >= start_ms")

    info = timeline.get("info")
    if not isinstance(info, dict):
        raise ValueError("timeline.info must be an object")
    frames = info.get("frames")
    if not isinstance(frames, list):
        raise ValueError("timeline.info.frames must be a list")

    merged: list[dict[str, Any]] = []

    # Single linear pass over the frame array. We can't binary-search by
    # timestamp without assuming monotonic frames (they are in practice, but
    # not contractually). The cost is O(F + E) where F=#frames (~30 for a
    # 30-min game) and E=#events in window — trivial.
    for frame in frames:
        if not isinstance(frame, dict):
            continue

        # 1) Frame snapshots: include only if the frame's own timestamp is in
        #    the window. We don't try to interpolate between frames — the
        #    user explicitly accepted "whatever frames fall in the window".
        frame_ts = _coerce_ts(frame.get("timestamp"))
        if frame_ts is not None and start_ms <= frame_ts <= end_ms:
            merged.extend(_iter_frame_items(frame, frame_ts, champ_by_id))

        # 2) Events: each event has its own timestamp; filter independently.
        #    Even if the parent frame's timestamp is outside the window, the
        #    events bucketed inside it can still be in-window (Riot bins
        #    events into the next frame, so the boundaries don't always
        #    line up).
        merged.extend(_iter_frame_events(frame, start_ms, end_ms, champ_by_id))

    # Stable sort by timestamp. Python's sort is Timsort → guaranteed stable.
    merged.sort(key=lambda item: item["timestamp"])

    # Lookback: if the window has content but doesn't open with a frame
    # snapshot, prepend the closest prior frame so the LLM / debug UI has a
    # baseline world-state. We only act when the first item is an event —
    # an empty window stays empty (deliberate: nothing happened, nothing
    # to contextualize), and a frame-led window needs no help.
    if merged and merged[0]["kind"] != KIND_FRAME:
        prior = _find_closest_prior_frame(frames, start_ms)
        if prior is not None:
            prior_frame, prior_ts = prior
            # Reuse the exact same expansion path so sanitize + humanize
            # rules stay identical to in-window frames. Timestamp is the
            # frame's REAL timestamp (< start_ms), making it visually
            # obvious in the JSON that this snapshot predates the window.
            lookback_items = list(
                _iter_frame_items(prior_frame, prior_ts, champ_by_id)
            )
            if lookback_items:
                # Re-sort the combined list (still O((N+10) log(N+10))).
                # Stable sort guarantees the prepended snapshots land at
                # the very top in participantId order (1..10) since their
                # timestamp is strictly smaller than every existing item's.
                merged = lookback_items + merged
                merged.sort(key=lambda item: item["timestamp"])

    # Final pass: rewrite every game-time `timestamp` field (top-level on
    # each item AND nested ones inside event sub-arrays) into the
    # `[mm:ss]` string format expected by the Specify-Time UI / LLM. Done
    # last so the preceding sort key (integer ms) was still numeric and
    # cheap. After this point, items are display-only.
    humanize_timestamps(merged)

    return merged
"""
Value-rewriting layer for the /timeline-window output.

Where `timeline_sanitize` decides *which* fields/events survive, this module
rewrites the *values* of surviving id-bearing fields into human-readable
strings so the LLM (and humans skimming the JSON) can reason about
champions and teams without an external lookup table.

Rules (in place — same keys, new value types):
  - participant id fields (participantId, killerId, victimId, creatorId)
      → champion name string (e.g. "Ahri")
  - participant id list fields (assistingParticipantIds)
      → list of champion name strings, mapped element-wise
  - team id fields (teamId, killerTeamId, victimTeamId)
      → "Blue" (100) / "Red" (200)

Unmapped values (id 0 for minion executes, unknown ids, malformed payloads)
are left untouched — we never fabricate a label.

Allowlists are explicit (not "any key ending in Id") so we never accidentally
rewrite unrelated numeric fields like itemId, monsterSubType, wardType, etc.
"""

from __future__ import annotations

from typing import Any, Mapping


# ---------------------------------------------------------------------------
# Allowlists — what counts as a participant ref vs. a team ref.
# ---------------------------------------------------------------------------

# Scalar int fields whose value is a single participantId.
PARTICIPANT_ID_KEYS: frozenset[str] = frozenset({
    "participantId",
    "killerId",
    "victimId",
    "creatorId",
})

# List-of-int fields whose elements are participantIds.
PARTICIPANT_ID_LIST_KEYS: frozenset[str] = frozenset({
    "assistingParticipantIds",
})

# Scalar int fields whose value is a teamId (100 or 200).
TEAM_ID_KEYS: frozenset[str] = frozenset({
    "teamId",
    "killerTeamId",
    "victimTeamId",
})


# Stable mapping for team labels. Anything outside this dict (e.g. 0 for
# neutral monsters / proxy events) is returned verbatim.
_TEAM_LABEL: dict[int, str] = {100: "Blue", 200: "Red"}


# ---------------------------------------------------------------------------
# Lookup builder
# ---------------------------------------------------------------------------

def build_champion_lookup(match_payload: Any) -> dict[int, str]:
    """
    Build {participantId: championName} from a Riot match-v5 payload.

    Defensive: every malformed row is skipped instead of raising. If the
    whole payload is unusable we return {}, which downstream callers treat
    as "leave ids untouched" (graceful degradation).
    """
    if not isinstance(match_payload, dict):
        return {}
    info = match_payload.get("info")
    if not isinstance(info, dict):
        return {}
    participants = info.get("participants")
    if not isinstance(participants, list):
        return {}

    out: dict[int, str] = {}
    for p in participants:
        if not isinstance(p, dict):
            continue
        try:
            pid = int(p["participantId"])
        except (KeyError, TypeError, ValueError):
            # Bad row — skip it; the rest of the lookup is still useful.
            continue
        champ = p.get("championName")
        if not isinstance(champ, str) or not champ:
            # Missing champion name → leave the id unmapped rather than
            # inventing a placeholder.
            continue
        out[pid] = champ
    return out


# ---------------------------------------------------------------------------
# Value rewriters
# ---------------------------------------------------------------------------

def team_label(value: Any) -> Any:
    """
    Map 100 → "Blue", 200 → "Red". Pass anything else through unchanged.

    Accepts ints and stringified ints (some Riot fields arrive as strings
    in edge cases). Booleans are explicitly rejected because `True`/`False`
    are technically ints in Python and we don't want them coerced.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return _TEAM_LABEL.get(value, value)
    if isinstance(value, str):
        try:
            n = int(value)
        except ValueError:
            return value
        # If it was a string id we still emit the label (consistent output).
        return _TEAM_LABEL.get(n, value)
    return value


def _champion_for(pid: Any, champ_by_id: Mapping[int, str]) -> Any:
    """
    Resolve a single participant-id-like value to its champion name.

    Returns the original value if it can't be mapped — never raises.
    """
    if isinstance(pid, bool):
        return pid
    if isinstance(pid, int):
        return champ_by_id.get(pid, pid)
    if isinstance(pid, str):
        try:
            n = int(pid)
        except ValueError:
            return pid
        return champ_by_id.get(n, pid)
    return pid


def _rewrite_dict(
    src: dict[str, Any], champ_by_id: Mapping[int, str]
) -> dict[str, Any]:
    """
    Shallow-copy `src` and rewrite any allowlisted id-bearing fields.

    Unknown keys pass through untouched, which keeps the function
    forward-compatible with new Riot event types.
    """
    out = dict(src)

    # Scalar participant refs.
    for key in PARTICIPANT_ID_KEYS:
        if key in out:
            out[key] = _champion_for(out[key], champ_by_id)

    # List participant refs (e.g. assistingParticipantIds).
    for key in PARTICIPANT_ID_LIST_KEYS:
        if key not in out:
            continue
        val = out[key]
        if not isinstance(val, list):
            # Malformed — leave it as-is rather than dropping or raising.
            continue
        out[key] = [_champion_for(item, champ_by_id) for item in val]

    # Team refs.
    for key in TEAM_ID_KEYS:
        if key in out:
            out[key] = team_label(out[key])

    return out


def humanize_event(
    event: dict[str, Any], champ_by_id: Mapping[int, str]
) -> dict[str, Any]:
    """Rewrite id fields on a single event. See module docstring for rules."""
    if not isinstance(event, dict):
        return event  # type: ignore[return-value]
    return _rewrite_dict(event, champ_by_id)


def humanize_frame_item(
    item: dict[str, Any], champ_by_id: Mapping[int, str]
) -> dict[str, Any]:
    """
    Rewrite id fields on a merged frame item.

    Frame items wrap a `frame` sub-dict (the participantFrames snapshot).
    The top-level `participantId` we attach in `timeline_window` is the
    primary thing to rewrite; we also rewrite the inner `participantId`
    inside `frame` if present, for consistency.
    """
    if not isinstance(item, dict):
        return item  # type: ignore[return-value]

    out = _rewrite_dict(item, champ_by_id)

    inner = out.get("frame")
    if isinstance(inner, dict):
        # Rewrite inside the nested snapshot so both the wrapper and the
        # raw frame agree on the champion name.
        out["frame"] = _rewrite_dict(inner, champ_by_id)

    return out
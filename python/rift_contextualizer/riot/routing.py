"""
Map match-v5 ids to regional routing hosts.

Riot match ids look like `NA1_7344857921` where the prefix is the **platform**
(shard). Match-v5 URLs use **regional** routing values (`americas`, `europe`,
`asia`, `sea`) in the hostname, not the platform id.

See: https://developer.riotgames.com/docs/lol (routing values).

OC1 historically moved between clusters; callers can pass `routingRegion` in
the contextualize request to override heuristics when Riot changes topology.
"""

from __future__ import annotations

# Lowercase platform id (left side of match id) -> regional routing slug.
# Keep in sync with Riot's published platform list; unknown keys require an explicit override.
_PLATFORM_TO_REGIONAL: dict[str, str] = {
    # Americas cluster
    "br1": "americas",
    "la1": "americas",
    "la2": "americas",
    "na1": "americas",
    # Europe cluster
    "euw1": "europe",
    "eun1": "europe",
    "tr1": "europe",
    "ru": "europe",
    "me1": "europe",
    # Asia cluster (includes several country shards)
    "jp1": "asia",
    "kr": "asia",
    "tw2": "asia",
    "vn2": "asia",
    "th2": "asia",
    "ph2": "asia",
    "sg2": "asia",
    # SEA cluster (OCE and related)
    "oc1": "sea",
    # Public beta environment (match-v5 typically routed like NA)
    "pbe1": "americas",
}

_VALID_REGIONAL = frozenset({"americas", "europe", "asia", "sea"})


def parse_platform_from_match_id(match_id: str) -> str:
    """
    Extract platform from a match id.

    Expected shape: `{PLATFORM}_{numericGameId}` e.g. `EUW1_6272625278`.
    """
    if "_" not in match_id:
        raise ValueError(
            "matchId must contain an underscore separating platform from game id "
            "(e.g. NA1_1234567890), or pass routingRegion explicitly."
        )
    platform, _rest = match_id.split("_", 1)
    if not platform:
        raise ValueError("matchId has empty platform prefix.")
    return platform.lower()


def resolve_routing_for_match_id(match_id: str, routing_region_override: str | None) -> str:
    """
    Return regional routing slug: americas | europe | asia | sea.

    If `routing_region_override` is set, it wins (after validation). This is the
    escape hatch for edge cases (e.g. OCE routing quirks) without changing match ids.
    """
    if routing_region_override:
        r = routing_region_override.strip().lower()
        if r not in _VALID_REGIONAL:
            raise ValueError(
                f"routingRegion must be one of {sorted(_VALID_REGIONAL)}; got {routing_region_override!r}"
            )
        return r

    platform = parse_platform_from_match_id(match_id)
    mapped = _PLATFORM_TO_REGIONAL.get(platform)
    if not mapped:
        raise ValueError(
            f"Unknown platform {platform!r} inferred from matchId. "
            "Pass routingRegion explicitly (americas, europe, asia, or sea)."
        )
    return mapped

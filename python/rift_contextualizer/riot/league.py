"""
Thin async client for Riot's LEAGUE-V4 endpoint.

Used to look up a player's SoloQ tier (e.g. "EMERALD") so that
`benchmarks.py` can compare their stats against the right rank baseline.

Honesty rules
-------------
- Network failures (timeout, 5xx, JSON shape change) → return `None`.
  Never raise to the caller; the contextualizer must keep working without
  rank data, falling back to the EMERALD median.
- 404 specifically means "the puuid has no ranked entries on that platform"
  — which is normal for unranked players, not an error.
- The platform routing (na1, euw1, kr, …) differs from match routing. We
  derive it from the matchId platform prefix the caller already validated.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

# SoloQ queue identifier in League-V4 entries.
_SOLO_QUEUE = "RANKED_SOLO_5x5"

# Per-call timeout. Tighter than the match fetch since we degrade silently
# on failure — a slow league lookup must not block the contextualizer.
_LEAGUE_TIMEOUT_S = 6.0


def _platform_base_url(platform: str) -> str:
    """`na1` → https://na1.api.riotgames.com (platform routing, NOT regional)."""
    return f"https://{platform.strip().lower()}.api.riotgames.com"


async def _fetch_league_entries(
    client: httpx.AsyncClient,
    *,
    platform: str,
    puuid: str,
    api_key: str,
) -> list[dict[str, Any]] | None:
    """
    GET /lol/league/v4/entries/by-puuid/{puuid}

    Returns the raw list (one entry per queue) or None on failure / 404.
    """
    url = f"{_platform_base_url(platform)}/lol/league/v4/entries/by-puuid/{puuid}"
    headers = {"X-Riot-Token": api_key}
    try:
        resp = await client.get(url, headers=headers, timeout=_LEAGUE_TIMEOUT_S)
    except httpx.RequestError:
        # DNS / connection / timeout — degrade silently per honesty rules.
        return None

    # 404 is "no ranked entries" → not really an error, just no data.
    if resp.status_code == 404:
        return []
    if not resp.is_success:
        return None

    try:
        data = resp.json()
    except ValueError:
        return None
    if not isinstance(data, list):
        return None
    return data


def _solo_tier_from_entries(entries: list[dict[str, Any]]) -> str | None:
    """Pick the RANKED_SOLO_5x5 tier from a League-V4 entries list, if any."""
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("queueType") != _SOLO_QUEUE:
            continue
        tier = entry.get("tier")
        if isinstance(tier, str) and tier.strip():
            return tier.strip().upper()
    return None


async def fetch_solo_tier(
    client: httpx.AsyncClient,
    *,
    platform: str,
    puuid: str,
    api_key: str,
) -> str | None:
    """
    Best-effort SoloQ tier lookup. Returns one of:
        "IRON", "BRONZE", ..., "CHALLENGER" → callers normalize.
        None — unranked, missing, or any failure.
    """
    entries = await _fetch_league_entries(
        client, platform=platform, puuid=puuid, api_key=api_key
    )
    if entries is None:
        return None
    return _solo_tier_from_entries(entries)


async def fetch_solo_tiers_pair(
    client: httpx.AsyncClient,
    *,
    platform: str,
    user_puuid: str,
    ally_puuid: str,
    api_key: str,
) -> tuple[str | None, str | None]:
    """
    Convenience: fetch both tiers in parallel.

    Mirrors `fetch_match_v5_pair` so the HTTP layer can `asyncio.gather` the
    match + timeline + tier lookups together for minimum wall-clock latency.
    """
    user_tier, ally_tier = await asyncio.gather(
        fetch_solo_tier(client, platform=platform, puuid=user_puuid, api_key=api_key),
        fetch_solo_tier(client, platform=platform, puuid=ally_puuid, api_key=api_key),
    )
    return user_tier, ally_tier
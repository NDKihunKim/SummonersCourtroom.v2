"""
Async HTTP client for League match-v5 match + timeline documents.

Uses a shared `httpx.AsyncClient` from the app lifespan for connection reuse.
Fetches both resources in parallel to cut wall-clock latency vs sequential GETs.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from rift_contextualizer.riot.errors import RiotApiError, RiotNotFoundError, RiotRateLimitError


def _match_base_url(regional_routing: str) -> str:
    r = regional_routing.strip().lower()
    return f"https://{r}.api.riotgames.com/lol/match/v5/matches"


def _raise_for_riot_response(resp: httpx.Response, *, label: str) -> None:
    if resp.is_success:
        return
    body = resp.text[:2000]
    if resp.status_code == 404:
        raise RiotNotFoundError(
            f"{label}: not found (HTTP 404). Check matchId and routingRegion.",
            status_code=404,
            body=body,
        )
    if resp.status_code == 429:
        raise RiotRateLimitError(
            f"{label}: rate limited (HTTP 429). Retry after backoff.",
            status_code=429,
            body=body,
        )
    if resp.status_code == 403:
        raise RiotApiError(
            f"{label}: forbidden (HTTP 403). Key may be expired or missing product access.",
            status_code=403,
            body=body,
        )
    if resp.status_code == 401:
        raise RiotApiError(
            f"{label}: unauthorized (HTTP 401). Verify RIOT_API_KEY.",
            status_code=401,
            body=body,
        )
    raise RiotApiError(
        f"{label}: unexpected HTTP {resp.status_code}",
        status_code=resp.status_code,
        body=body,
    )


def _parse_json_dict(resp: httpx.Response, *, label: str) -> dict[str, Any]:
    try:
        data = resp.json()
    except json.JSONDecodeError as e:
        raise RiotApiError(f"{label}: invalid JSON body", status_code=resp.status_code) from e
    if not isinstance(data, dict):
        raise RiotApiError(f"{label}: expected JSON object root", status_code=resp.status_code)
    return data


async def fetch_match_v5_pair(
    client: httpx.AsyncClient,
    regional_routing: str,
    match_id: str,
    api_key: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Fetch match JSON and timeline JSON for one match id.

    Raises RiotNotFoundError / RiotRateLimitError / RiotApiError on failure.
    """
    base = _match_base_url(regional_routing)
    headers = {"X-Riot-Token": api_key}

    # Parallelize independent GETs — halves wall-clock vs sequential awaits.
    match_resp, timeline_resp = await asyncio.gather(
        client.get(f"{base}/{match_id}", headers=headers),
        client.get(f"{base}/{match_id}/timeline", headers=headers),
    )

    _raise_for_riot_response(match_resp, label="Match")
    _raise_for_riot_response(timeline_resp, label="Timeline")

    return _parse_json_dict(match_resp, label="Match"), _parse_json_dict(timeline_resp, label="Timeline")

"""
HTTP service backing the Specify-Time feature.

The full-game `/contextualize` endpoint and the RiftContextualizer narrative
pipeline were removed. Only `/health` and `/timeline-window` remain, so this
module's surface is now intentionally tiny.

Environment:
  RIOT_API_KEY   — required for /timeline-window (development key from Riot portal).

Run (after `pip install -e .` from ./python):
  uvicorn rift_contextualizer.http_app:app --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from rift_contextualizer.riot.errors import RiotApiError, RiotNotFoundError, RiotRateLimitError
from rift_contextualizer.riot.client import fetch_match_v5_pair
from rift_contextualizer.riot.routing import resolve_routing_for_match_id
from rift_contextualizer.timeline_window import extract_window
from rift_contextualizer.timeline_format import format_game_time
from rift_contextualizer.timeline_humanize import build_champion_lookup


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # One shared client per process: keep-alives + connection pooling for Riot.
    timeout = httpx.Timeout(45.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, http2=False) as client:
        app.state.riot_client = client
        yield


app = FastAPI(title="Rift Contextualizer", lifespan=lifespan)


# --- Specify-Time window endpoint ---------------------------------------------
# Accepts the same identity triple as /contextualize plus a [startMs, endMs]
# window, fetches the timeline, then returns the merged participantFrames +
# events list inside that window. Window length is bounded server-side
# (1–5 minutes) so a malicious or buggy client can't ask for a 90-min slice.

# Window length bounds (inclusive). Mirrors the client-side slider clamp.
_MIN_WINDOW_MS = 60_000        # 1 minute
_MAX_WINDOW_MS = 5 * 60_000    # 5 minutes


class TimelineWindowBody(BaseModel):
    matchId: str = Field(..., min_length=3)
    userPuuid: str = Field(..., min_length=1)
    routingRegion: str | None = Field(default=None)
    startMs: int = Field(..., ge=0)
    endMs: int = Field(..., ge=0)


class TimelineWindowResponse(BaseModel):
    # `window.start` / `window.end` are `[mm:ss]` formatted strings (game
    # time, mm overflows past 59) — see timeline_format.format_game_time.
    window: dict[str, str]
    count: int
    items: list[dict[str, Any]]


@app.get("/health")
async def health() -> dict[str, str]:
    """Process / deploy probes (no Riot call)."""
    return {"status": "ok"}


@app.post("/timeline-window", response_model=TimelineWindowResponse)
async def timeline_window(request: Request, body: TimelineWindowBody) -> dict[str, Any]:
    """
    Return participantFrames + events from the match timeline, restricted to
    [startMs, endMs] and merged into a single chronological list.

    This endpoint is intentionally read-only and does NOT run the narrative
    pipeline — it's the raw debug feed for the Specify-Time UI.
    """
    key = os.environ.get("RIOT_API_KEY", "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Server misconfiguration: RIOT_API_KEY is not set in the Python environment.",
        )

    # Server-side window-length guard. The UI also clamps this, but we never
    # trust the client.
    span = body.endMs - body.startMs
    if span < _MIN_WINDOW_MS:
        raise HTTPException(
            status_code=400,
            detail=f"Window too short: minimum {_MIN_WINDOW_MS // 1000}s, got {span // 1000}s.",
        )
    if span > _MAX_WINDOW_MS:
        raise HTTPException(
            status_code=400,
            detail=f"Window too long: maximum {_MAX_WINDOW_MS // 1000}s, got {span // 1000}s.",
        )

    client: httpx.AsyncClient = request.app.state.riot_client

    try:
        routing = resolve_routing_for_match_id(body.matchId.strip(), body.routingRegion)
        # Reuses the same fetch path as /contextualize → benefits from any
        # in-process caching the riot client adds in the future.
        match_payload, timeline = await fetch_match_v5_pair(
            client, routing, body.matchId.strip(), key
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RiotNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.args[0]) from e
    except RiotRateLimitError as e:
        raise HTTPException(status_code=429, detail=e.args[0]) from e
    except RiotApiError as e:
        raise HTTPException(status_code=502, detail=e.args[0]) from e
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Riot request transport error: {e}") from e

    try:
        # Build participantId → championName once per request. If the match
        # payload is malformed the lookup is empty and ids stay numeric
        # (graceful degradation, no crash).
        champ_by_id = build_champion_lookup(match_payload)
        items = extract_window(
            timeline, body.startMs, body.endMs, champ_by_id=champ_by_id
        )
    except ValueError as e:
        # Malformed timeline payload OR bad bounds that slipped past pydantic
        # (we already checked span above; this is the last line of defense).
        raise HTTPException(status_code=422, detail=str(e)) from e

    print(
        f"[timeline-window] match={body.matchId} window={body.startMs}-{body.endMs}ms items={len(items)}"
    )
    return {
        # Mirror the per-item timestamp formatting so the window bounds
        # are readable at a glance. Renamed from startMs/endMs → start/end
        # because the values are no longer raw ms. format_game_time can
        # only return None on garbage input; bounds were validated above
        # (Field(ge=0)), so the `or` fallback is just belt-and-suspenders.
        "window": {
            "start": format_game_time(body.startMs) or "[00:00]",
            "end": format_game_time(body.endMs) or "[00:00]",
        },
        "count": len(items),
        "items": items,
    }

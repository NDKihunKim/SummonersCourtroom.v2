"""Riot Games API helpers (routing + HTTP fetch for match-v5)."""

from rift_contextualizer.riot.client import fetch_match_v5_pair
from rift_contextualizer.riot.errors import RiotApiError, RiotNotFoundError, RiotRateLimitError
from rift_contextualizer.riot.routing import resolve_routing_for_match_id

__all__ = [
    "fetch_match_v5_pair",
    "resolve_routing_for_match_id",
    "RiotApiError",
    "RiotNotFoundError",
    "RiotRateLimitError",
]

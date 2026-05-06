"""Typed errors for Riot HTTP failures (status-aware for callers / HTTP layer)."""


class RiotApiError(Exception):
    """Any non-success response or transport failure talking to Riot."""

    def __init__(self, message: str, *, status_code: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class RiotNotFoundError(RiotApiError):
    """404 — wrong routing region, expired id, or typo in matchId."""


class RiotRateLimitError(RiotApiError):
    """429 — honor Retry-After on the client edge; surface clearly to users."""

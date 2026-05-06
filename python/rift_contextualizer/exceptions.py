"""Domain-specific errors for match/timeline contextualization."""


class RiftContextualizerError(Exception):
    """Base class for recoverable contextualizer failures."""


class InvalidMatchDataError(RiftContextualizerError):
    """Raised when match or timeline JSON is missing required structure."""


class MissingParticipantError(RiftContextualizerError):
    """Raised when a PUUID cannot be resolved to a participantId in this match."""

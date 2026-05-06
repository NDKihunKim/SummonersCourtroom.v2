"""Rift Judge — Specify-Time pipeline (raw timeline-window extraction).

The full-game narrative pipeline (RiftContextualizer + analyzer / narrative /
combat / kills / etc.) was removed; only the Specify-Time `/timeline-window`
path remains. Re-export the residual exception types so any importer still
pointing at the package root keeps working without pulling in the deleted
contextualizer module.
"""

from rift_contextualizer.exceptions import (
    InvalidMatchDataError,
    MissingParticipantError,
    RiftContextualizerError,
)

__all__ = [
    "RiftContextualizerError",
    "InvalidMatchDataError",
    "MissingParticipantError",
]

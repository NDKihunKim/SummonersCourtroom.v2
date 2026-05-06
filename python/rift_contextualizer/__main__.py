"""
CLI entrypoint — launches the FastAPI HTTP service that backs the
Specify-Time feature.

The full-game offline-build CLI (--match / --timeline / --user-puuid /
--ally-puuid) was removed along with the rest of the full-game pipeline.
Only `--serve` remains.

Example (from ./python after `pip install -r requirements.txt`):

  RIOT_API_KEY=... python -m rift_contextualizer --serve --port 8080
"""

from __future__ import annotations

import argparse
import os
import sys


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Rift Judge — launch the Specify-Time HTTP service."
    )
    p.add_argument(
        "--serve",
        action="store_true",
        help="Run uvicorn on rift_contextualizer.http_app:app "
        "(set RIOT_API_KEY in the environment).",
    )
    p.add_argument(
        "--host",
        default=os.environ.get("HOST", "0.0.0.0"),
        help="Bind host for --serve",
    )
    p.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8080")),
        help="Bind port for --serve",
    )
    args = p.parse_args(argv)

    # `--serve` is now the only supported mode. Keep the flag (instead of
    # making serving the implicit default) so the invocation contract used
    # by existing deploy scripts / docs doesn't change.
    if not args.serve:
        p.error("--serve is required (the offline build CLI was removed).")

    try:
        import uvicorn
    except ImportError as e:
        print(
            "Install dependencies: pip install -r requirements.txt",
            file=sys.stderr,
        )
        raise SystemExit(1) from e

    uvicorn.run(
        "rift_contextualizer.http_app:app",
        host=args.host,
        port=args.port,
        factory=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

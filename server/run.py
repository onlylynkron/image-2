from __future__ import annotations

import argparse
import os

import uvicorn
from dotenv import load_dotenv


def _port_from_env() -> int:
    try:
        port = int(os.getenv("PORT", "8787"))
        return port if 0 < port < 65536 else 8787
    except ValueError:
        return 8787


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Image Studio API server.")
    parser.add_argument("--reload", action="store_true", help="Enable uvicorn auto reload.")
    args = parser.parse_args()

    load_dotenv()
    uvicorn.run(
        "server.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=_port_from_env(),
        reload=args.reload,
    )


if __name__ == "__main__":
    main()

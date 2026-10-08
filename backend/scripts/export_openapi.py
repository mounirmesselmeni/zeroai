"""Export OpenAPI for Orval, to its file or stdout for streamed comparison."""

import json
import sys
from argparse import ArgumentParser
from contextlib import redirect_stdout
from pathlib import Path


def main() -> None:
    parser = ArgumentParser(description="Export the OpenAPI schema for Orval.")
    parser.add_argument(
        "--stdout", action="store_true", help="write the schema to stdout instead of the file"
    )
    args = parser.parse_args()

    # App setup may log to stdout (for example, when local console tracing is enabled).
    with redirect_stdout(sys.stderr):
        from zeroai.asgi import app

        schema = json.dumps(app.openapi(), indent=2) + "\n"

    if args.stdout:
        sys.stdout.write(schema)
    else:
        target = Path(__file__).resolve().parents[2] / "frontend/src/api/openapi.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(schema)
        print(f"wrote {target}")


if __name__ == "__main__":
    main()

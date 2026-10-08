set shell := ["bash", "-euc"]

default:
    just --list

# Install backend + frontend dependencies
setup:
    cd backend && uv sync
    cd frontend && yarn install --immutable

# Start the API on :8000 (needs Ollama running, or an OpenAI key in backend/.env)
api:
    cd backend && uv run uvicorn zeroai.asgi:app --reload --port 8000

# Start the web app on :5173 (proxies /api to :8000)
web:
    cd frontend && yarn dev

# Intentionally refresh the checked-in OpenAPI schema and Orval client.
openapi:
    cd backend && uv run python scripts/export_openapi.py
    cd frontend && yarn api:generate

# Compare FastAPI's current schema with the checked-in schema without changing files.
check-api:
    #!/usr/bin/env bash
    set -euo pipefail
    (cd backend && uv run python scripts/export_openapi.py --stdout) | diff -u frontend/src/api/openapi.json -

build:
    cd frontend && yarn build

test-backend:
    cd backend && uv run pytest

test-frontend:
    cd frontend && yarn test

e2e:
    cd frontend && yarn playwright install chromium && yarn e2e

# Run the backend, frontend, and docs in Docker containers.
compose-up:
    docker compose up --build

# Start only the documentation site at http://localhost:8010.
compose-docs:
    docker compose up --build docs

# Run the MSW-backed Playwright suite in its optional browser container.
compose-e2e:
    docker compose --profile e2e run --build --rm playwright

# Run the full check suite in Docker containers without installing project dependencies locally.
compose-check:
    #!/usr/bin/env bash
    set -euo pipefail
    git diff --check
    git diff --cached --check
    docker compose config --quiet
    docker compose --profile checks run --build --rm backend-check
    docker compose --profile checks run --rm -T backend-check uv run --no-sync python scripts/export_openapi.py --stdout | diff -u frontend/src/api/openapi.json -
    docker compose --profile checks run --build --rm frontend-check
    docker compose --profile e2e run --build --rm playwright
    docker compose --profile checks run --build --rm docs-check

# Stop Compose services and remove their containers.
compose-down:
    docker compose down

test: test-backend test-frontend e2e

lint:
    prek run --all-files

docs:
    uv run --project backend --group docs zensical serve -a 127.0.0.1:8010

docs-build:
    uv run --project backend --group docs zensical build --strict

check: lint check-api build test docs-build

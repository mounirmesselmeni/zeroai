# ZeroAI backend

FastAPI + PydanticAI + SQLModel (SQLite), fully async. See the [root README](../README.md) for the
big picture and [architecture guide](../docs/concepts/architecture.md) for the module map.

```bash
uv sync
uv run uvicorn zeroai.asgi:app --reload   # http://localhost:8000/docs
uv run pytest                             # fails under 90% coverage
uv run python scripts/export_openapi.py   # refresh the schema for Orval
```

Database schema changes use Alembic and are applied at startup. Create a revision with
`uv run alembic revision --autogenerate -m "describe the change"`, then review the generated
migration before committing it. Revisions live in `src/zeroai/migrations/versions/`.

Configuration: `ZEROAI_*` environment variables or `.env` (see `.env.example`).

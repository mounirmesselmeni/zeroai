# ZeroAI

A one-page, AI-generated briefing of the latest news for a stock, for traders who want to stay
informed while managing a portfolio. Type a ticker, watch the summary stream in, and click through
to the source articles.

![stack](https://img.shields.io/badge/python-3.14-blue) ![stack](https://img.shields.io/badge/FastAPI-PydanticAI-green) ![stack](https://img.shields.io/badge/React-Mantine-purple)

## How it works

```
ticker ─▶ fetch RSS/Atom feeds (your configured sources, concurrently)
       ─▶ dedupe + sort newest first
       ─▶ PydanticAI agent (Ollama or OpenAI) ─▶ structured StockSummary
       ─▶ streamed to the browser over Server-Sent Events as it is generated
```

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/), Node 22+ with corepack (yarn), and either
[Ollama](https://ollama.com) or an OpenAI API key.

```bash
just setup                    # or: cd backend && uv sync; cd frontend && yarn install

# Option A, local model (default)
# Default model: gpt-oss:120b-cloud, an Ollama cloud model served through your local
# Ollama (run `ollama signin` once; nothing to download). Fully local instead?
#   ollama pull qwen3   and pick it on the Settings page.

# Option B, OpenAI: open Settings in the UI, pick OpenAI and paste your key
#   (or seed it: ZEROAI_LLM_PROVIDER=openai ZEROAI_OPENAI_API_KEY=sk-... before the first start)

just api                      # API on http://localhost:8000  (docs at /docs)
just web                      # UI  on http://localhost:5173
```

Prefer not to install Python or Node locally? Run the app and docs with Docker Compose using
`just compose-up` (or `docker compose up --build`); the docs are at http://localhost:8010. Use
`just compose-docs` to start only the docs container. The optional `just compose-e2e` runs Playwright
in a browser container and still uses the generated MSW API mocks. Use `just compose-check` to run
the full lint, contract, build, test, E2E, and docs checks in containers. See the
[Docker Compose guide](docs/guides/docker-compose.md).

Without `just`: `cd backend && uv run uvicorn zeroai.asgi:app --reload` and `cd frontend && yarn dev`.

No UI? `curl localhost:8000/api/v1/stocks/AAPL/summary` returns the summary as JSON, and
`curl -N localhost:8000/api/v1/stocks/AAPL/summary/stream` shows the raw event stream.

## Configuration

The model (provider, name, base URL, API key) lives in the database and is edited on the
**Settings** page; the `ZEROAI_LLM_*`/`OLLAMA_*`/`OPENAI_*` variables below only seed it on first
start. Everything else is read from environment variables or `backend/.env` (see
[`.env.example`](.env.example)):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZEROAI_LLM_PROVIDER` | `ollama` | initial provider (`ollama` or `openai`) |
| `ZEROAI_OLLAMA_MODEL` | `gpt-oss:120b-cloud` | initial model, any Ollama model with tool calling |
| `ZEROAI_OPENAI_API_KEY` / `_MODEL` | none / `gpt-4o-mini` | initial OpenAI settings |
| `ZEROAI_LLM_MAX_CONCURRENCY` | `1` | max simultaneous model calls (semaphore) |
| `ZEROAI_DATABASE_URL` | `sqlite+aiosqlite:///zeroai.db` | |

News sources are managed in the UI (**Sources** page) or via `/api/v1/sources`. Defaults: Yahoo
Finance, Google News, Nasdaq. RSS/Atom URLs must use an operator-allow-listed host; `{ticker}` is
replaced by the symbol.

## Design decisions

- **Everything is async.** `httpx2.AsyncClient` for feeds (fetched concurrently with `asyncio.gather`),
  `AsyncSession` + aiosqlite for storage, async endpoints, async PydanticAI streaming.
- **A semaphore guards the model.** `LLMGate` (`asyncio.Semaphore`) caps simultaneous LLM calls
  (default 1, right for one local model). Extra requests queue, and the client is told
  ("Waiting for the model") instead of timing out.
- **Structured output, not free text.** The agent must return a `StockSummary` (headline,
  sentiment, key points, risks, outlook), so the UI renders it deterministically and the model
  can't ramble. PydanticAI validates it and retries on malformed output.
- **SSE for streaming.** One-way server push over plain HTTP: simple, proxy-friendly, and the
  browser's `EventSource` does the parsing. Events: `status`, `news`, `summary` (partials), `done`,
  `error`. Orval can't generate SSE clients, so `useSummaryStream` is the one hand-written API hook;
  everything else is generated.
- **Structured logs.** structlog events for each step (feeds, queue, model, tokens), correlated by a
  request id; `console` or `json` format. See the observability guide for logs and tracing options.
- **Two themes.** A Classic look by default and an optional terminal-style look; the header button switches. The choice and
  the last ticker are kept in a Zustand store persisted to `localStorage`.
- **Live reasoning, time and tokens.** Thinking effort is selectable (Low/Medium/High, default High). The agent runs through PydanticAI's `run_stream_events`, so
  the model's reasoning is forwarded as `thinking` SSE events and the structured answer is parsed
  incrementally. The UI shows a braille-dot spinner with a live timer, a collapsible reasoning panel,
  and, once done, the duration and token counts.
- **Model config and usage in SQLite.** Provider/model/key are DB rows (the key is never returned
  by the API); each finished run stores PydanticAI's token usage, aggregated per model on the
  Settings page.
- **Grounded in fetched news only.** The prompt contains just the fetched headlines/snippets, and
  instructions forbid outside facts. Output is labelled "not investment advice".
- **Resilient fetching.** One failing or slow source is reported (`errors`, with a plain reason such
  as "this is a web page, not an RSS/Atom feed") but never fails the request; timeouts and 5xx are
  retried once, and **Test feed** checks a URL before you save it. Duplicate headlines are merged.
- **Input safety.** Tickers are validated (`^[A-Za-z0-9][A-Za-z0-9.-]{0,9}$`) and URL-encoded; feed
  hosts and model origins use exact operator-managed allow-lists; feed size, source count, and
  concurrency are bounded; XML is parsed with `defusedxml`.
- **Contract-first frontend.** FastAPI's OpenAPI schema is exported and Orval generates typed
  React Query hooks; CI checks the committed schema against the backend.

Known limits: only headlines and feed snippets are summarised (article bodies are not fetched);
no caching or persistence of summaries; no auth.

## Testing strategy

| Layer | Tooling | What it proves |
| --- | --- | --- |
| Backend unit + API | pytest, `TestClient`, `pookx` (mocks every external call), PydanticAI `TestModel`/`FunctionModel` | feed parsing, CRUD, SSE sequence, partial streaming, error paths, semaphore bound |
| Frontend unit | vitest, Testing Library, fake `EventSource` | stream state machine, pages, forms |
| End-to-end | Playwright (Chromium), Vite app with Orval-generated MSW handlers | browser rendering, SSE validation/retries, prerequisite errors, persisted usage UI |
| Static | ruff, ty, eslint, tsc, prettier via prek | style and types |

No test needs Ollama, an API key, or a separately running FastAPI server. Coverage gates are **90%** on both sides and enforced in CI.
`just check` runs lint, OpenAPI schema verification, the frontend
production/type build, all tests, and the strict documentation build. Use `just openapi` after
schema changes to refresh the committed client before checking it.

```bash
just test        # backend + frontend + e2e
just lint        # prek run --all-files
```

## Project layout

```
backend/   FastAPI app (src/zeroai), tests, scripts/export_openapi.py
frontend/  Vite + React 19 + Mantine; src/api/generated is Orval output; e2e/ is Playwright
docs/      Zensical documentation site (zensical.toml)
```

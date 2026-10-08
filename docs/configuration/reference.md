# Reference

## Environment variables

Read from the process environment or `backend/.env`. Prefix: `ZEROAI_`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZEROAI_DATABASE_URL` | `sqlite+aiosqlite:///zeroai.db` | SQLite file (use `:memory:` in tests) |
| `ZEROAI_CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed browser origins (JSON list) |
| `ZEROAI_LLM_MAX_CONCURRENCY` | `1` | Max simultaneous model calls |
| `ZEROAI_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING` or `ERROR`; see [Observability](../guides/observability.md) |
| `ZEROAI_LOG_FORMAT` | `console` | `console` (readable) or `json` (one object per line) |
| `ZEROAI_TRACING` | `off` | `console` prints PydanticAI's OpenTelemetry spans locally |
| `ZEROAI_NEWS_MAX_ITEMS` | `15` | Headlines passed to the model |
| `ZEROAI_NEWS_TIMEOUT_SECONDS` | `8.0` | Per-feed timeout |
| `ZEROAI_ALLOWED_FEED_HOSTS` | Yahoo Finance, Google News, Nasdaq hosts | Exact host names the server may fetch (JSON list) |
| `ZEROAI_ALLOWED_MODEL_ORIGINS` | Local Ollama, Docker host Ollama, OpenAI, Ollama cloud | Exact model origins the server may contact (JSON list) |
| `ZEROAI_NEWS_MAX_FEED_BYTES` | `1000000` | Maximum response body per feed |
| `ZEROAI_NEWS_MAX_SOURCES` | `20` | Maximum saved sources and feed requests per lookup |
| `ZEROAI_NEWS_FETCH_CONCURRENCY` | `5` | Maximum simultaneous feed requests |

**First-start model defaults** (seed the database once; afterwards use Settings):

| Variable | Default | Becomes |
| --- | --- | --- |
| `ZEROAI_LLM_PROVIDER` | `ollama` | `provider` |
| `ZEROAI_OLLAMA_MODEL` | `gpt-oss:120b-cloud` | `model` (Ollama) |
| `ZEROAI_OLLAMA_BASE_URL` | `http://localhost:11434/v1` | `base_url` (Ollama) |
| `ZEROAI_OLLAMA_API_KEY` | none | `api_key` (Ollama) |
| `ZEROAI_OPENAI_MODEL` | `gpt-4o-mini` | `model` (OpenAI) |
| `ZEROAI_OPENAI_API_KEY` | none | `api_key` (OpenAI) |

## Settings stored in the database

| Field | Values | Notes |
| --- | --- | --- |
| `provider` | `ollama`, `openai` | |
| `model` | any model name | 1 to 120 characters |
| `base_url` | URL or empty | Must use an allowed model origin; remote endpoints require HTTPS, with a Docker host Ollama exception |
| `api_key` | write-only | `null`/omitted keeps it, `""` removes it |
| `thinking` | `true`/`false` | Omitted keeps it; see [Thinking mode](thinking.md) |
| `thinking_effort` | `low`, `medium`, `high` | Default `high`; omitted keeps it; used when thinking is on |

## Built-in constants

| Constant | Value | File |
| --- | --- | --- |
| Output retries | 3 | `summary/agent.py` (`OUTPUT_RETRIES`) |
| Run history on the Settings page | 10 | frontend |

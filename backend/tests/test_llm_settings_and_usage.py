import json
from contextlib import closing

from conftest import SUMMARY, runtime_for
from fastapi.testclient import TestClient
from pydantic_ai import Agent
from pydantic_ai.models.function import AgentInfo, DeltaThinkingPart, DeltaToolCall, FunctionModel
from test_api import parse_sse, use_only_test_source

from zeroai.api.deps import get_llm
from zeroai.config import Settings
from zeroai.main import create_app
from zeroai.schemas import StockSummary
from zeroai.summary.agent import LLMRuntime


def test_default_llm_config_is_seeded_from_env_without_leaking_key():
    app = create_app(
        Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            llm_provider="openai",
            openai_api_key="sk-secret",
            openai_model="gpt-x",
        )
    )
    with TestClient(app) as client:
        body = client.get("/api/v1/settings/llm").json()
    assert body == {
        "provider": "openai",
        "model": "gpt-x",
        "base_url": None,
        "thinking": True,
        "thinking_effort": "high",
        "api_key_set": True,
    }
    assert "sk-secret" not in json.dumps(body)


def test_app_model_http_client_disables_redirects():
    app = create_app(Settings(database_url="sqlite+aiosqlite:///:memory:"))
    with TestClient(app):
        assert app.state.model_http_client.follow_redirects is False


def test_ollama_seed(client):
    body = client.get("/api/v1/settings/llm").json()
    assert body["provider"] == "ollama"
    assert body["model"] == "gpt-oss:120b-cloud"
    assert body["thinking"] is True
    assert body["thinking_effort"] == "high"
    assert body["base_url"].startswith("http://localhost:11434")
    assert body["api_key_set"] is False


def test_update_llm_settings_keeps_replaces_and_clears_the_key(client):
    put = lambda **kw: client.put(  # noqa: E731
        "/api/v1/settings/llm", json={"provider": "openai", "model": " gpt-4o ", **kw}
    )
    assert put(api_key="sk-1").json() == {
        "provider": "openai",
        "model": "gpt-4o",
        "base_url": None,
        "thinking": True,
        "thinking_effort": "high",
        "api_key_set": True,
    }
    assert put().json()["api_key_set"] is True  # omitted: kept
    assert put(api_key="  ").json()["api_key_set"] is False  # blank: cleared
    assert put(api_key="sk-2", base_url="  ").json()["base_url"] is None
    assert put(base_url="https://x.test/v1").json()["base_url"] == "https://x.test/v1"


def test_update_llm_settings_validation(client):
    bad_url = client.put(
        "/api/v1/settings/llm", json={"provider": "ollama", "model": "m", "base_url": "ftp://x"}
    )
    assert bad_url.status_code == 422
    bad_provider = client.put("/api/v1/settings/llm", json={"provider": "x", "model": "m"})
    assert bad_provider.status_code == 422
    empty = client.put("/api/v1/settings/llm", json={"provider": "ollama", "model": ""})
    assert empty.status_code == 422
    blank = client.put("/api/v1/settings/llm", json={"provider": "ollama", "model": "   "})
    assert blank.status_code == 422
    disallowed = client.put(
        "/api/v1/settings/llm",
        json={"provider": "openai", "model": "m", "base_url": "https://private.example/v1"},
    )
    assert disallowed.status_code == 422


def test_openai_without_key_is_503_with_a_pointer_to_settings():
    app = create_app(Settings(database_url="sqlite+aiosqlite:///:memory:", llm_provider="openai"))
    with TestClient(app) as client:
        response = client.get("/api/v1/stocks/ACME/summary")
    assert response.status_code == 503
    assert "Settings page" in response.json()["detail"]


def test_config_in_db_decides_the_model_that_is_built():
    """No get_llm override: the agent really comes from the DB row."""
    app = create_app(Settings(database_url="sqlite+aiosqlite:///:memory:"))
    with TestClient(app) as client:
        client.put("/api/v1/settings/llm", json={"provider": "openai", "model": "m"})
        assert client.get("/api/v1/stocks/ACME/summary").status_code == 503
        client.put(
            "/api/v1/settings/llm", json={"provider": "openai", "model": "m", "api_key": "k"}
        )
        # Key present now: building succeeds, so the failure moves on to "no news" (502).
        for s in client.get("/api/v1/sources").json():
            client.patch(f"/api/v1/sources/{s['id']}", json={"enabled": False})
        assert client.get("/api/v1/stocks/ACME/summary").status_code == 502


def thinking_agent() -> Agent[None, StockSummary]:
    async def stream_fn(messages, info: AgentInfo):
        yield {0: DeltaThinkingPart(content="Let me ")}
        yield {0: DeltaThinkingPart(content="think.")}
        yield {1: DeltaToolCall(name=info.output_tools[0].name)}
        payload = SUMMARY.model_dump_json()
        yield {1: DeltaToolCall(json_args=payload[:30])}
        yield {1: DeltaToolCall(json_args=payload[30:])}

    return Agent(FunctionModel(stream_function=stream_fn), output_type=StockSummary)


def test_stream_includes_thinking_and_usage(client):
    use_only_test_source(client)
    client.app.dependency_overrides[get_llm] = lambda: runtime_for(thinking_agent())
    events = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)
    thinking = "".join(d["delta"] for n, d in events if n == "thinking")
    assert thinking == "Let me think."
    summaries = [d for n, d in events if n == "summary"]
    assert summaries and all(set(d) <= set(StockSummary.model_fields) for d in summaries)
    name, done = events[-1]
    assert name == "done"
    usage = done["usage"]
    assert usage["provider"] == "test" and usage["model"] == "test-model"
    assert usage["total_tokens"] == usage["input_tokens"] + usage["output_tokens"] > 0
    assert usage["requests"] == 1
    assert usage["duration_ms"] >= 0
    # thinking arrives before the structured output
    assert [n for n, _ in events].index("thinking") < [n for n, _ in events].index("summary")


def test_usage_is_recorded_per_model_and_listed(client):
    use_only_test_source(client)
    assert client.get("/api/v1/usage").json() == []
    client.get("/api/v1/stocks/ACME/summary/stream")
    client.get("/api/v1/stocks/MSFT/summary")  # non-streaming path records too
    client.app.dependency_overrides[get_llm] = lambda: runtime_for(thinking_agent())
    client.get("/api/v1/stocks/ACME/summary/stream")

    per_model = client.get("/api/v1/usage").json()
    assert len(per_model) == 1
    row = per_model[0]
    assert (row["provider"], row["model"], row["runs"]) == ("test", "test-model", 3)
    assert row["total_tokens"] == row["input_tokens"] + row["output_tokens"] > 0
    assert row["requests"] == 3

    runs = client.get("/api/v1/usage/runs?limit=2").json()
    assert [r["ticker"] for r in runs] == ["ACME", "MSFT"]  # newest first, limited
    assert runs[0]["total_tokens"] == runs[0]["input_tokens"] + runs[0]["output_tokens"]
    assert client.get("/api/v1/usage/runs?limit=0").status_code == 422


def test_failed_runs_are_not_recorded(client):
    for s in client.get("/api/v1/sources").json():
        client.patch(f"/api/v1/sources/{s['id']}", json={"enabled": False})
    client.get("/api/v1/stocks/ACME/summary/stream")
    assert client.get("/api/v1/usage").json() == []


def test_partial_summary_parsing():
    from zeroai.summary.stream_parser import _partial_summary

    assert _partial_summary('{"headline": "Hi", "sentiment": "bull') == {"headline": "Hi"}
    assert _partial_summary('{"headline": "x", "other": 1}') == {"headline": "x"}
    assert _partial_summary("[1, 2]") is None
    assert _partial_summary("not json") is None
    assert _partial_summary("") is None


def test_partial_summary_validates_each_field_before_streaming():
    from zeroai.summary.stream_parser import _partial_summary

    assert _partial_summary(
        json.dumps(
            {
                "headline": {"text": "bad"},
                "sentiment": " Positive ",
                "key_points": "just one",
                "risks": [123],
                "outlook": None,
            }
        )
    ) == {"sentiment": "bullish", "key_points": ["just one"]}
    assert _partial_summary('{"key_points": ["first", "unfinished') == {"key_points": ["first"]}


def test_args_text_variants():
    from zeroai.summary.stream_parser import _args_text

    assert _args_text(None) == ""
    assert _args_text('{"a": 1}') == '{"a": 1}'
    assert _args_text({"a": 1}) == '{"a": 1}'


def test_summary_schema_is_lenient_about_small_model_sloppiness():
    parsed = StockSummary.model_validate(
        {
            "headline": "h",
            "sentiment": " Bullish ",
            "key_points": '["a", "b"]',
            "risks": "[]",
            "outlook": "o",
        }
    )
    assert parsed.sentiment == "bullish"
    assert parsed.key_points == ["a", "b"]
    assert parsed.risks == []
    sloppy = StockSummary.model_validate(
        {"headline": "h", "sentiment": "positive", "key_points": "just one", "outlook": "o"}
    )
    assert sloppy.sentiment == "bullish"
    assert sloppy.key_points == ["just one"]
    assert sloppy.risks == []  # may be omitted entirely
    assert (
        StockSummary.model_validate(
            {"headline": "h", "sentiment": "neutral", "key_points": " ", "outlook": "o"}
        ).key_points
        == []
    )
    assert StockSummary.model_validate(
        {"headline": "h", "sentiment": "neutral", "key_points": "7", "outlook": "o"}
    ).key_points == ["7"]


def test_stream_recovers_from_an_empty_first_attempt(client):
    """qwen3's failure mode: attempt 1 returns nothing, attempt 2 is fine. No error, 2 requests."""
    use_only_test_source(client)
    calls = {"n": 0}

    async def flaky(messages, info: AgentInfo):
        calls["n"] += 1
        if calls["n"] == 1:
            yield "   "  # empty-ish reply, no tool call
            return
        yield {0: DeltaToolCall(name=info.output_tools[0].name)}
        payload = SUMMARY.model_dump_json()
        yield {0: DeltaToolCall(json_args=payload[:40])}
        yield {0: DeltaToolCall(json_args=payload[40:])}

    client.app.dependency_overrides[get_llm] = lambda: runtime_for(
        Agent(
            FunctionModel(stream_function=flaky),
            output_type=StockSummary,
            retries={"output": 3},
        )
    )
    events = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)
    assert events[-1][0] == "done"
    assert events[-1][1]["summary"] == SUMMARY.model_dump()
    assert events[-1][1]["usage"]["requests"] == 2
    assert all(n != "error" for n, _ in events)


def test_stream_retry_does_not_corrupt_partials(client):
    """A failed first tool call must not leak into the partial parse of the second one."""
    use_only_test_source(client)
    calls = {"n": 0}

    async def bad_then_good(messages, info: AgentInfo):
        calls["n"] += 1
        name = info.output_tools[0].name
        yield {0: DeltaToolCall(name=name)}
        if calls["n"] == 1:
            yield {0: DeltaToolCall(json_args='{"headline": "x", "sentiment": "nonsense"}')}
            return
        yield {0: DeltaToolCall(json_args=SUMMARY.model_dump_json())}

    client.app.dependency_overrides[get_llm] = lambda: runtime_for(
        Agent(
            FunctionModel(stream_function=bad_then_good),
            output_type=StockSummary,
            retries={"output": 3},
        )
    )
    events = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)
    assert events[-1][0] == "done" and events[-1][1]["usage"]["requests"] == 2
    partials = [d for n, d in events if n == "summary"]
    assert partials[-1] == SUMMARY.model_dump()


def test_exhausted_retries_give_a_helpful_error(client):
    use_only_test_source(client)

    async def always_empty(messages, info: AgentInfo):
        yield "  "

    client.app.dependency_overrides[get_llm] = lambda: runtime_for(
        Agent(
            FunctionModel(stream_function=always_empty),
            output_type=StockSummary,
            retries={"output": 1},
        )
    )
    events = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)
    name, data = events[-1]
    assert name == "error"
    assert "test-model did not return a usable answer" in data["message"]
    assert "Settings" in data["message"]
    assert client.get("/api/v1/usage").json() == []  # failures are not recorded


def test_thinking_flag_is_stored_and_kept_when_omitted(client):
    put = lambda **kw: client.put(  # noqa: E731
        "/api/v1/settings/llm", json={"provider": "ollama", "model": "m", **kw}
    )
    assert put(thinking=False).json()["thinking"] is False
    assert put().json()["thinking"] is False  # omitted: kept
    assert put(thinking=True).json()["thinking"] is True


async def test_existing_database_without_the_thinking_column_is_migrated(tmp_path):
    """A DB file written by the previous release keeps working and its settings survive."""
    import sqlite3

    from sqlmodel import select
    from sqlmodel.ext.asyncio.session import AsyncSession

    from zeroai.database import init_db, make_engine
    from zeroai.models import LLMConfig

    path = tmp_path / "old.db"
    with closing(sqlite3.connect(path)) as db, db:
        db.execute(
            "CREATE TABLE llmconfig (id INTEGER PRIMARY KEY, provider VARCHAR NOT NULL, "
            "model VARCHAR NOT NULL, base_url VARCHAR, api_key VARCHAR)"
        )
        db.execute(
            "INSERT INTO llmconfig VALUES (1, 'ollama', 'qwen3:latest', 'http://x/v1', NULL)"
        )

    settings = Settings(database_url=f"sqlite+aiosqlite:///{path}")
    engine = make_engine(settings)
    await init_db(engine, settings)
    await init_db(engine, settings)  # idempotent
    async with AsyncSession(engine) as session:
        (config,) = (await session.exec(select(LLMConfig))).all()
    assert (config.model, config.thinking, config.thinking_effort) == ("qwen3:latest", True, "high")
    await engine.dispose()


def test_thinking_off_hides_reasoning_events_the_model_still_streams(client):
    """gpt-oss always reasons; with the switch off the UI must not see it."""
    use_only_test_source(client)
    shown = runtime_for(thinking_agent())
    hidden = LLMRuntime(shown.agent, shown.provider, shown.model, show_thinking=False)

    client.app.dependency_overrides[get_llm] = lambda: shown
    on = [n for n, _ in parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)]
    client.app.dependency_overrides[get_llm] = lambda: hidden
    off = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)

    assert "thinking" in on
    assert "thinking" not in [n for n, _ in off]
    assert off[-1][0] == "done"  # the answer itself is unaffected


def test_ollama_api_key_is_stored_write_only(client):
    put = client.put(
        "/api/v1/settings/llm",
        json={
            "provider": "ollama",
            "model": "m",
            "base_url": "https://ollama.com/v1",
            "api_key": "tok",
        },
    )
    assert put.json()["api_key_set"] is True
    assert "tok" not in put.text


def test_thinking_effort_is_stored_validated_and_kept_when_omitted(client):
    put = lambda **kw: client.put(  # noqa: E731
        "/api/v1/settings/llm", json={"provider": "ollama", "model": "m", **kw}
    )
    assert put().json()["thinking_effort"] == "high"
    assert put(thinking_effort="low").json()["thinking_effort"] == "low"
    assert put().json()["thinking_effort"] == "low"  # omitted: kept
    assert put(thinking_effort="medium", thinking=False).json()["thinking_effort"] == "medium"
    assert put(thinking_effort="extreme").status_code == 422

"""Structured logging: every pipeline step leaves a searchable event, and secrets never do."""

import asyncio
import io
import json

import httpx2
import pook
import pook.exceptions
import pytest
import structlog
from conftest import (
    RSS,
    SUMMARY,
    TEST_FEED_HOSTS,
    default_feeds,
    feed_mock,
    make_fetcher,
    runtime_for,
)
from fastapi.testclient import TestClient
from pydantic_ai import Agent
from pydantic_ai.models.function import AgentInfo, DeltaThinkingPart, DeltaToolCall, FunctionModel
from structlog.contextvars import clear_contextvars
from structlog.testing import capture_logs
from test_api import add_feed, use_only_test_source
from test_llm_settings_and_usage import thinking_agent

from zeroai.api.deps import get_llm
from zeroai.bootstrap import configure_process
from zeroai.config import Settings
from zeroai.database import init_db, make_engine
from zeroai.logging import configure_logging
from zeroai.main import create_app
from zeroai.models import NewsSource
from zeroai.news import downloader
from zeroai.schemas import StockSummary
from zeroai.summary.limiter import LLMGate
from zeroai.summary.service import stream_summary

MEMORY = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
def logs(client):
    """Every structlog event emitted during the test (created after the app, which configures
    logging, so the capture is not overwritten)."""
    with capture_logs() as captured:
        yield captured


def names(captured):
    return [e["event"] for e in captured]


def one(captured, event):
    matches = [e for e in captured if e["event"] == event]
    assert len(matches) == 1, f"expected one {event}, got {names(captured)}"
    return matches[0]


def stream(client, ticker="ACME"):
    return client.get(f"/api/v1/stocks/{ticker}/summary/stream")


# --------------------------------------------------------------------------- pipeline steps


def test_a_briefing_logs_every_step_in_order_with_useful_fields(client, logs):
    use_only_test_source(client)
    client.app.dependency_overrides[get_llm] = lambda: runtime_for(thinking_agent())
    stream(client)

    order = [
        "briefing_started",
        "news_fetch_started",
        "feed_fetched",
        "news_ready",
        "model_acquired",
        "model_started",
        "model_first_token",
        "model_finished",
        "briefing_finished",
        "usage_recorded",
    ]
    seen = [n for n in names(logs) if n in order]
    assert [n for n in order if n in seen] == list(dict.fromkeys(seen))  # in pipeline order
    assert set(order) <= set(seen)

    started = one(logs, "briefing_started")
    assert (started["ticker"], started["provider"], started["model"]) == (
        "ACME",
        "test",
        "test-model",
    )
    assert started["log_level"] == "info"

    fetch = one(logs, "news_fetch_started")
    # The API passes only enabled sources to the fetcher, so nothing is skipped on this path.
    assert (fetch["sources"], fetch["skipped_disabled"]) == (1, 0)

    feed = one(logs, "feed_fetched")
    assert (feed["source"], feed["items"]) == ("Test", 2)
    assert isinstance(feed["duration_ms"], int)

    ready = one(logs, "news_ready")
    assert (ready["items"], ready["unique_items"], ready["failed_sources"]) == (2, 2, 0)

    assert one(logs, "model_acquired")["waited_ms"] >= 0
    assert one(logs, "model_started")["news_items"] == 2
    kinds = [e["kind"] for e in logs if e["event"] == "model_first_token"]
    assert kinds == ["thinking", "answer"]  # each logged once, reasoning first

    done = one(logs, "model_finished")
    assert done["input_tokens"] > 0 and done["output_tokens"] > 0
    assert done["requests"] == 1 and done["retried"] is False
    assert done["thinking_chars"] == len("Let me think.")

    assert one(logs, "briefing_finished")["sentiment"] == "bullish"
    usage = one(logs, "usage_recorded")
    assert usage["total_tokens"] == done["input_tokens"] + done["output_tokens"]


def test_reasoning_is_still_measured_when_it_is_hidden_from_the_user(client, logs):
    from zeroai.summary.agent import LLMRuntime

    use_only_test_source(client)
    shown = runtime_for(thinking_agent())
    client.app.dependency_overrides[get_llm] = lambda: LLMRuntime(
        shown.agent, shown.provider, shown.model, show_thinking=False
    )
    stream(client)
    assert one(logs, "briefing_started")["show_thinking"] is False
    assert one(logs, "model_finished")["thinking_chars"] == len("Let me think.")


def test_a_failing_feed_is_retried_then_reported_with_its_reason(client, logs, monkeypatch):
    monkeypatch.setattr(downloader, "RETRY_DELAY_SECONDS", 0)
    for s in client.get("/api/v1/sources").json():
        client.patch(f"/api/v1/sources/{s['id']}", json={"enabled": False})
    add_feed(client, host="down.test", name="Dead")
    stream(client)

    retry = one(logs, "feed_retry")
    assert (retry["host"], retry["reason"], retry["log_level"]) == (
        "down.test",
        "HTTP 500",
        "warning",
    )
    assert "url" not in retry  # URLs can carry tokens; only the host is logged
    failed = one(logs, "feed_failed")
    assert (failed["source"], failed["reason"], failed["log_level"]) == (
        "Dead",
        "HTTP 500",
        "warning",
    )
    assert one(logs, "news_ready")["failed_sources"] == 1
    assert "model_started" not in names(logs)  # no news: the model is never asked


def test_no_news_is_a_warning_and_skips_the_model(client, logs):
    for s in client.get("/api/v1/sources").json():
        client.patch(f"/api/v1/sources/{s['id']}", json={"enabled": False})
    stream(client)
    assert one(logs, "no_news")["log_level"] == "warning"
    assert not {"model_acquired", "model_started", "model_finished", "usage_recorded"} & set(
        names(logs)
    )


def test_a_retried_model_run_is_visible(client, logs):
    use_only_test_source(client)
    calls = {"n": 0}

    async def bad_then_good(messages, info: AgentInfo):
        calls["n"] += 1
        yield {0: DeltaToolCall(name=info.output_tools[0].name)}
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
    stream(client)
    assert one(logs, "model_retry")["log_level"] == "warning"
    done = one(logs, "model_finished")
    assert (done["requests"], done["retried"]) == (2, True)


def test_a_model_that_never_answers_is_a_warning_not_a_crash(client, logs):
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
    stream(client)
    event = one(logs, "model_gave_no_usable_answer")
    assert event["log_level"] == "warning" and "retries" in event["error"]
    assert "briefing_finished" not in names(logs) and "usage_recorded" not in names(logs)


def test_a_model_exception_is_logged_with_its_traceback(client, logs):
    use_only_test_source(client)

    async def boom(messages, info: AgentInfo):
        raise RuntimeError("ollama is down")
        yield {}

    client.app.dependency_overrides[get_llm] = lambda: runtime_for(
        Agent(FunctionModel(stream_function=boom), output_type=StockSummary)
    )
    stream(client)
    event = one(logs, "model_failed")
    assert event["log_level"] == "error"
    assert event["exc_info"] is True  # structlog attaches the traceback
    assert event["phase"] == "model_running"


# --------------------------------------------------------------------------- queue and cancel


def slow_agent(release: asyncio.Event, started: asyncio.Event) -> Agent[None, StockSummary]:
    async def hold(messages, info: AgentInfo):
        started.set()
        yield {0: DeltaThinkingPart(content="hmm")}
        await release.wait()
        yield {1: DeltaToolCall(name=info.output_tools[0].name)}
        yield {1: DeltaToolCall(json_args=SUMMARY.model_dump_json())}

    return Agent(FunctionModel(stream_function=hold), output_type=StockSummary)


def run_stream(agent, gate, ticker):
    async def go():
        async with httpx2.AsyncClient() as http:
            return [
                e.name
                async for e in stream_summary(
                    runtime=runtime_for(agent),
                    gate=gate,
                    fetcher=make_fetcher(http),
                    sources=[NewsSource(name="S", url_template="https://rss.test/f?s={ticker}")],
                    ticker=ticker,
                    max_items=5,
                )
            ]

    return go()


async def test_a_second_run_logs_that_it_queued_and_how_long_it_waited():
    feed_mock("rss.test", RSS)
    gate = LLMGate(1)
    release, started = asyncio.Event(), asyncio.Event()
    with capture_logs() as captured:
        first = asyncio.create_task(run_stream(slow_agent(release, started), gate, "AAA"))
        await asyncio.wait_for(started.wait(), 5)
        second_release, second_started = asyncio.Event(), asyncio.Event()
        second_release.set()
        second = asyncio.create_task(
            run_stream(slow_agent(second_release, second_started), gate, "BBB")
        )
        for _ in range(100):  # let the second reach the gate
            await asyncio.sleep(0.01)
            if any(e["event"] == "model_queued" for e in captured):
                break
        await asyncio.sleep(0.05)
        release.set()
        await asyncio.gather(first, second)

    queued = [e for e in captured if e["event"] == "model_queued"]
    assert [e["ticker"] for e in queued] == ["BBB"]
    acquired = {e["ticker"]: e["waited_ms"] for e in captured if e["event"] == "model_acquired"}
    assert acquired["AAA"] < 50
    assert acquired["BBB"] >= 40  # it really did wait for the first run


async def test_a_cancelled_run_says_which_phase_it_was_in():
    feed_mock("rss.test", RSS)
    gate = LLMGate(1)
    release, started = asyncio.Event(), asyncio.Event()
    with capture_logs() as captured:
        running = asyncio.create_task(run_stream(slow_agent(release, started), gate, "RUN"))
        await asyncio.wait_for(started.wait(), 5)
        queued = asyncio.create_task(
            run_stream(slow_agent(asyncio.Event(), asyncio.Event()), gate, "QUE")
        )
        for _ in range(100):
            await asyncio.sleep(0.01)
            if any(e["event"] == "model_queued" for e in captured):
                break
        queued.cancel()
        running.cancel()
        await asyncio.gather(running, queued, return_exceptions=True)

    phases = {e["ticker"]: e["phase"] for e in captured if e["event"] == "client_disconnected"}
    assert phases == {"QUE": "waiting_for_model", "RUN": "model_running"}
    assert all(
        isinstance(e["after_ms"], int) for e in captured if e["event"] == "client_disconnected"
    )
    assert not any(e["event"] in {"briefing_finished", "usage_recorded"} for e in captured)


# --------------------------------------------------------------------------- app events


def test_settings_changes_are_logged_but_never_the_api_key(client, logs):
    client.put(
        "/api/v1/settings/llm",
        json={
            "provider": "ollama",
            "model": "gpt-oss:120b-cloud",
            "base_url": "https://ollama.com/v1",
            "api_key": "sk-super-secret",
            "thinking": True,
            "thinking_effort": "medium",
        },
    )
    event = one(logs, "llm_settings_updated")
    assert event["model"] == "gpt-oss:120b-cloud" and event["thinking_effort"] == "medium"
    assert (event["api_key_set"], event["api_key_changed"]) == (True, True)
    assert event["base_url_host"] == "ollama.com"
    assert "sk-super-secret" not in json.dumps(logs, default=str)


def test_source_and_feed_check_events(client, logs):
    created = add_feed(client, name="Mine").json()
    client.patch(f"/api/v1/sources/{created['id']}", json={"enabled": False})
    client.post("/api/v1/sources/check", json={"url_template": "https://rss.test/f?s={ticker}"})
    client.post("/api/v1/sources/check", json={"url_template": "https://down.test/f"})
    client.delete(f"/api/v1/sources/{created['id']}")

    assert one(logs, "source_created")["name"] == "Mine"
    updated = one(logs, "source_updated")
    assert (updated["changed"], updated["enabled"]) == (["enabled"], False)
    assert one(logs, "source_deleted")["name"] == "Mine"
    checks = [e for e in logs if e["event"] == "feed_checked"]
    assert [(c["ok"], c["error"]) for c in checks] == [(True, None), (False, "HTTP 500")]


async def test_first_start_and_upgrades_are_logged():
    settings = Settings(database_url=MEMORY)
    engine = make_engine(settings)
    with capture_logs() as captured:
        await init_db(engine, settings)
        await init_db(engine, settings)  # a second start seeds nothing
    await engine.dispose()
    assert names(captured).count("sources_seeded") == 1
    assert one(captured, "sources_seeded")["count"] == 3
    assert one(captured, "llm_config_seeded")["provider"] == "ollama"


# --------------------------------------------------------------------------- the real output


@pytest.fixture
def real_logs(capsys):
    """Run the app with logging configured for real (JSON to stdout), then read the lines."""
    clear_contextvars()
    yield lambda: [
        json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")
    ]
    structlog.reset_defaults()
    clear_contextvars()


def make_app(level="INFO", fmt="json"):
    settings = Settings(
        database_url=MEMORY,
        log_level=level,
        log_format=fmt,
        allowed_feed_hosts=list(TEST_FEED_HOSTS),
    )
    configure_process(settings)
    app = create_app(settings)
    default_feeds()
    return app


def test_every_line_of_a_request_shares_its_request_id_and_ticker(real_logs, agent):
    app = make_app()
    with TestClient(app) as http:
        app.dependency_overrides[get_llm] = lambda: runtime_for(agent)
        use_only_test_source(http)
        response = http.get("/api/v1/stocks/ACME/summary/stream")
    lines = real_logs()
    request_id = response.headers["x-request-id"]
    assert len(request_id) == 12

    ours = [line for line in lines if line.get("request_id") == request_id]
    events = [line["event"] for line in ours]
    for expected in (
        "briefing_started",
        "feed_fetched",
        "model_started",
        "briefing_finished",
        "usage_recorded",
        "http_request",
    ):
        assert expected in events, events
    # The ticker rides along on every line after it was validated, even deep in the stream.
    pipeline = [line for line in ours if line["event"] not in {"http_request"}]
    assert {line["ticker"] for line in pipeline} == {"ACME"}

    summary = next(line for line in ours if line["event"] == "http_request")
    assert (summary["method"], summary["status"], summary["cancelled"]) == ("GET", 200, False)
    assert summary["path"] == "/api/v1/stocks/ACME/summary/stream"
    assert isinstance(summary["duration_ms"], int)
    assert summary["level"] == "info" and summary["timestamp"].endswith("Z")


def test_request_ids_are_unique_honoured_when_safe_and_replaced_when_not(real_logs):
    app = make_app()
    with TestClient(app) as http:
        a = http.get("/api/v1/sources")
        b = http.get("/api/v1/sources")
        mine = http.get("/api/v1/sources", headers={"X-Request-ID": "trace-abc.123"})
        bad = http.get("/api/v1/sources", headers={"X-Request-ID": "has spaces & <script>"})
        long = http.get("/api/v1/sources", headers={"X-Request-ID": "x" * 200})
    assert a.headers["x-request-id"] != b.headers["x-request-id"]
    assert mine.headers["x-request-id"] == "trace-abc.123"
    assert (
        bad.headers["x-request-id"] != "has spaces & <script>"
        and len(bad.headers["x-request-id"]) == 12
    )
    assert len(long.headers["x-request-id"]) == 12
    logged = {line["request_id"] for line in real_logs() if line["event"] == "http_request"}
    assert "trace-abc.123" in logged


def test_the_api_key_never_appears_in_the_real_log_output(real_logs, capsys):
    app = make_app("DEBUG")
    with TestClient(app) as http:
        http.put(
            "/api/v1/settings/llm",
            json={"provider": "openai", "model": "gpt", "api_key": "sk-never-in-logs-123"},
        )
        http.get("/api/v1/settings/llm")
    out = " ".join(json.dumps(line) for line in real_logs())
    assert "sk-never-in-logs-123" not in out
    assert "llm_settings_updated" in out


def test_health_checks_are_debug_only_and_server_errors_are_warnings(real_logs):
    app = make_app("INFO")
    with TestClient(app) as http:
        http.get("/api/v1/health")
        http.get("/api/v1/stocks/BAD;TICKER/news")  # 422: a client error, not a server error
    events = [(line["event"], line.get("path")) for line in real_logs()]
    assert ("http_request", "/api/v1/health") not in events

    app = make_app("DEBUG")
    with TestClient(app) as http:
        http.get("/api/v1/health")
    health = [line for line in real_logs() if line.get("path") == "/api/v1/health"]
    assert health and health[0]["level"] == "debug"


def test_a_ticker_that_fails_validation_is_not_bound_to_the_log_context(real_logs):
    app = make_app()
    with TestClient(app) as http:
        http.get("/api/v1/stocks/not%20valid/news")
    lines = [line for line in real_logs() if line["event"] == "http_request"]
    assert lines and "ticker" not in lines[0] and lines[0]["status"] == 422


# --------------------------------------------------------------------------- configuration


def test_console_format_is_for_humans_and_json_is_for_machines():
    out = io.StringIO()
    configure_logging("INFO", "console", out)
    structlog.get_logger("t").info("briefing_started", ticker="AAPL", model="m")
    text = out.getvalue()
    assert "briefing_started" in text and "ticker" in text and "AAPL" in text
    assert not text.lstrip().startswith("{")

    out = io.StringIO()
    configure_logging("INFO", "json", out)
    structlog.get_logger("t").info("briefing_started", ticker="AAPL")
    line = json.loads(out.getvalue())
    assert (line["event"], line["ticker"], line["level"]) == ("briefing_started", "AAPL", "info")
    structlog.reset_defaults()


def test_the_log_level_filters_noise():
    out = io.StringIO()
    configure_logging("WARNING", "json", out)
    log = structlog.get_logger("t")
    log.debug("quiet")
    log.info("also quiet")
    log.warning("loud")
    assert [json.loads(line)["event"] for line in out.getvalue().splitlines()] == ["loud"]
    structlog.reset_defaults()


def test_exceptions_are_rendered_in_json_logs():
    out = io.StringIO()
    configure_logging("INFO", "json", out)
    try:
        raise ValueError("kaboom")
    except ValueError:
        structlog.get_logger("t").exception("it_broke")
    line = json.loads(out.getvalue())
    assert line["event"] == "it_broke" and "ValueError: kaboom" in line["exception"]
    structlog.reset_defaults()


def test_an_unknown_log_level_or_format_is_rejected_at_startup():
    for bad in ({"log_level": "CHATTY"}, {"log_format": "xml"}):
        with pytest.raises(ValueError):
            Settings.model_validate(bad)
    assert Settings().log_format == "console" and Settings().log_level == "INFO"


def test_pook_still_blocks_the_network_while_logging_is_configured():
    """Guards the test fixtures: logging setup must not disturb the network block."""
    with pytest.raises(pook.exceptions.PookNoMatches):
        asyncio.run(_get("https://example.test/"))


async def _get(url: str):
    async with httpx2.AsyncClient() as http:
        return await http.get(url)


async def test_the_fetcher_reports_how_many_disabled_sources_it_skipped():
    feed_mock("rss.test", RSS)
    sources = [
        NewsSource(name="On", url_template="https://rss.test/f?s={ticker}"),
        NewsSource(name="Off", url_template="https://rss.test/g?s={ticker}", enabled=False),
    ]
    with capture_logs() as captured:
        async with httpx2.AsyncClient() as http:
            await make_fetcher(http).fetch_news(sources, "ACME", 5)
    started = one(captured, "news_fetch_started")
    assert (started["sources"], started["skipped_disabled"]) == (1, 1)


# --------------------------------------------------------------------------- the middleware itself


async def run_through_middleware(inner, *, messages):
    """Drive RequestContextMiddleware directly, with a scripted client."""
    from zeroai.logging import RequestContextMiddleware

    sent = []
    feed = iter(messages)

    async def receive():
        return next(feed, {"type": "http.disconnect"})

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "GET", "path": "/stream", "headers": []}
    with capture_logs() as captured:
        try:
            await RequestContextMiddleware(inner)(scope, receive, send)
        except asyncio.CancelledError:
            pass
    return captured, sent


async def test_a_client_that_leaves_mid_response_is_logged_as_cancelled():
    async def streaming_app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"data", "more_body": True})
        assert (await receive())["type"] == "http.disconnect"  # the browser went away
        # Starlette ends the response quietly here; it does not raise.

    captured, _ = await run_through_middleware(streaming_app, messages=[])
    summary = one(captured, "http_request")
    assert summary["cancelled"] is True and summary["status"] == 200


async def test_a_response_that_finished_is_not_cancelled_even_if_the_socket_closes_after():
    async def finished_app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})
        await receive()  # the server reports the connection closing after the last byte

    captured, sent = await run_through_middleware(finished_app, messages=[])
    assert one(captured, "http_request")["cancelled"] is False
    assert sent[0]["headers"][-1][0] == b"x-request-id"


async def test_a_cancellation_from_above_is_logged_and_still_propagates():
    from zeroai.logging import RequestContextMiddleware

    async def hangs(scope, receive, send):
        await asyncio.sleep(30)

    sent = []

    async def receive():
        await asyncio.sleep(30)

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "GET", "path": "/x", "headers": []}
    with capture_logs() as captured:
        task = asyncio.create_task(RequestContextMiddleware(hangs)(scope, receive, send))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert one(captured, "http_request")["cancelled"] is True


async def test_non_http_traffic_passes_straight_through():
    from zeroai.logging import RequestContextMiddleware

    seen = []

    async def app(scope, receive, send):
        seen.append(scope["type"])

    with capture_logs() as captured:
        await RequestContextMiddleware(app)({"type": "lifespan"}, None, None)
    assert seen == ["lifespan"] and captured == []  # no request id, no http_request line

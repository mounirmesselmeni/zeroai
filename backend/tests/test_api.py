import asyncio
import json

import httpx2
from conftest import SUMMARY, runtime_for
from fastapi.testclient import TestClient
from pydantic_ai import Agent
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel

from zeroai.api.deps import get_llm
from zeroai.config import Settings
from zeroai.main import create_app
from zeroai.schemas import StockSummary


def add_feed(client, host="rss.test", name="Test"):
    return client.post(
        "/api/v1/sources", json={"name": name, "url_template": f"https://{host}/f?s={{ticker}}"}
    )


def use_only_test_source(client):
    for s in client.get("/api/v1/sources").json():
        client.patch(f"/api/v1/sources/{s['id']}", json={"enabled": False})
    return add_feed(client).json()


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        name, data = block.split("\n")
        events.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events


def test_health(client):
    assert client.get("/api/v1/health").json() == {"status": "ok"}


def test_default_sources_are_seeded(client):
    names = [s["name"] for s in client.get("/api/v1/sources").json()]
    assert names == ["Yahoo Finance", "Google News", "Nasdaq"]


def test_source_crud(client):
    created = add_feed(client).json()
    assert (
        client.patch(f"/api/v1/sources/{created['id']}", json={"enabled": False}).json()["enabled"]
        is False
    )
    assert client.delete(f"/api/v1/sources/{created['id']}").status_code == 204
    assert client.delete(f"/api/v1/sources/{created['id']}").status_code == 404
    assert client.patch("/api/v1/sources/9999", json={"name": "x"}).status_code == 404


def test_source_validation(client):
    bad = client.post("/api/v1/sources", json={"name": "x", "url_template": "file:///etc/passwd"})
    assert bad.status_code == 422
    first = client.get("/api/v1/sources").json()[0]["id"]
    bad = client.patch(f"/api/v1/sources/{first}", json={"url_template": "ftp://nope.example"})
    assert bad.status_code == 422
    ok = client.patch(f"/api/v1/sources/{first}", json={"name": "Renamed"})
    assert ok.json()["name"] == "Renamed"


def test_source_patch_rejects_explicit_null_fields(client):
    source_id = client.get("/api/v1/sources").json()[0]["id"]
    for field in ("name", "url_template", "enabled"):
        response = client.patch(f"/api/v1/sources/{source_id}", json={field: None})
        assert response.status_code == 422


def test_source_create_rejects_unallowlisted_hosts(client):
    response = client.post(
        "/api/v1/sources",
        json={"name": "Blocked", "url_template": "https://private.example/feed"},
    )
    assert response.status_code == 422
    assert "is not allowed" in response.json()["detail"]


def test_source_create_obeys_configured_source_limit():
    from conftest import TEST_FEED_HOSTS

    from zeroai.config import Settings
    from zeroai.main import create_app

    app = create_app(
        Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            allowed_feed_hosts=list(TEST_FEED_HOSTS),
            news_max_sources=3,
        )
    )
    with TestClient(app) as client:
        response = add_feed(client)
    assert response.status_code == 409
    assert "source limit is 3" in response.json()["detail"]


async def test_concurrent_source_creation_cannot_exceed_limit(tmp_path):
    app = create_app(
        Settings(database_url=f"sqlite+aiosqlite:///{tmp_path}/sources.db", news_max_sources=4)
    )
    async with app.router.lifespan_context(app):
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            responses = await asyncio.gather(
                *(
                    client.post(
                        "/api/v1/sources",
                        json={"name": f"Source {i}", "url_template": "https://news.google.com/rss"},
                    )
                    for i in range(8)
                )
            )
            assert sorted(r.status_code for r in responses) == [201, *([409] * 7)]
            assert len((await client.get("/api/v1/sources")).json()) == 4


def test_deleted_sources_stay_deleted_after_restart(tmp_path):
    app = create_app(
        Settings(database_url=f"sqlite+aiosqlite:///{tmp_path}/sources.db", news_max_sources=2)
    )
    with TestClient(app) as client:
        sources = client.get("/api/v1/sources").json()
        assert len(sources) == 2
        for source in sources:
            assert client.delete(f"/api/v1/sources/{source['id']}").status_code == 204
    with TestClient(app) as client:
        assert client.get("/api/v1/sources").json() == []


def test_stream_reports_prerequisite_errors_as_sse():
    app = create_app(
        Settings(
            database_url="sqlite+aiosqlite:///:memory:", llm_provider="openai", openai_api_key=None
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/stocks/AAPL/summary/stream")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert parse_sse(response.text) == [
            ("error", {"message": "Add an OpenAI API key on the Settings page."})
        ]
        invalid = client.get("/api/v1/stocks/bad;ticker/summary/stream")
        assert parse_sse(invalid.text)[0][0] == "error"
        assert "Invalid ticker" in parse_sse(invalid.text)[0][1]["message"]
        assert client.get("/api/v1/stocks/AAPL/summary").status_code == 503


def test_news(client):
    use_only_test_source(client)
    body = client.get("/api/v1/stocks/acme/news").json()
    assert body["ticker"] == "ACME"
    assert len(body["items"]) == 2


def test_invalid_ticker(client):
    assert client.get("/api/v1/stocks/bad;ticker/news").status_code == 422


def test_summary(client):
    use_only_test_source(client)
    response = client.get("/api/v1/stocks/ACME/summary")
    assert response.status_code == 200
    assert StockSummary.model_validate(response.json()) == SUMMARY


def test_summary_without_news_is_502(client):
    for s in client.get("/api/v1/sources").json():
        client.patch(f"/api/v1/sources/{s['id']}", json={"enabled": False})
    response = client.get("/api/v1/stocks/ACME/summary")
    assert response.status_code == 502
    assert "No recent news" in response.json()["detail"]


def test_stream_event_sequence(client):
    use_only_test_source(client)
    response = client.get("/api/v1/stocks/ACME/summary/stream")
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(response.text)
    names = [n for n, _ in events]
    assert names[:3] == ["status", "news", "status"]
    assert names[-1] == "done"
    assert set(names[3:-1]) <= {"summary"}
    assert events[-1][1]["summary"]["headline"] == SUMMARY.headline


def test_usage_storage_failure_does_not_discard_finished_summary(client, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from sqlmodel.ext.asyncio.session import AsyncSession

    use_only_test_source(client)

    async def failed_commit(self):
        raise OperationalError("INSERT", {}, RuntimeError("database is locked"))

    monkeypatch.setattr(AsyncSession, "commit", failed_commit)
    response = client.get("/api/v1/stocks/ACME/summary/stream")
    assert parse_sse(response.text)[-1][0] == "done"
    response = client.get("/api/v1/stocks/ACME/summary")
    assert response.status_code == 200
    assert response.json()["headline"] == SUMMARY.headline


def test_stream_emits_error_when_no_news(client):
    for s in client.get("/api/v1/sources").json():
        client.patch(f"/api/v1/sources/{s['id']}", json={"enabled": False})
    events = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)
    assert [n for n, _ in events] == ["status", "news", "error"]


def test_stream_emits_error_when_model_fails(client):
    use_only_test_source(client)

    async def boom(messages, info: AgentInfo):
        raise RuntimeError("ollama is down")
        yield {}  # makes this an async generator

    client.app.dependency_overrides[get_llm] = lambda: runtime_for(
        Agent(FunctionModel(stream_function=boom), output_type=StockSummary)
    )
    events = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)
    assert events[-1][0] == "error"
    assert "ollama is down" in events[-1][1]["message"]


def test_stream_partial_summaries(client):
    """A model that streams its JSON in chunks yields growing partial summaries."""
    use_only_test_source(client)
    payload = json.dumps(SUMMARY.model_dump())
    chunks = [payload[i : i + 25] for i in range(0, len(payload), 25)]

    async def stream_fn(messages, info: AgentInfo):
        name = info.output_tools[0].name
        yield {0: DeltaToolCall(name=name)}
        for chunk in chunks:
            yield {0: DeltaToolCall(json_args=chunk)}

    client.app.dependency_overrides[get_llm] = lambda: runtime_for(
        Agent(FunctionModel(stream_function=stream_fn), output_type=StockSummary)
    )
    events = parse_sse(client.get("/api/v1/stocks/ACME/summary/stream").text)
    assert events[-1][0] == "done"
    assert events[-1][1]["summary"] == SUMMARY.model_dump()
    assert any(n == "summary" for n, _ in events)


async def test_init_db_is_idempotent():
    from sqlmodel import select
    from sqlmodel.ext.asyncio.session import AsyncSession

    from zeroai.config import Settings
    from zeroai.database import init_db, make_engine
    from zeroai.models import NewsSource

    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    engine = make_engine(settings)
    await init_db(engine, settings)
    await init_db(engine, settings)
    async with AsyncSession(engine) as session:
        assert len((await session.exec(select(NewsSource))).all()) == 3
    await engine.dispose()

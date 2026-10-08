from datetime import UTC, datetime

import httpx2
import pytest
from pydantic_ai.models.openai import OpenAIChatModel

from zeroai.models import LLMConfig
from zeroai.schemas import NewsItem
from zeroai.summary.agent import (
    BRIEF_THINKING,
    INSTRUCTIONS,
    MissingApiKeyError,
    build_instructions,
    build_model,
    build_prompt,
    build_runtime,
    model_settings,
)


def test_ollama_default_url_and_model():
    runtime = build_runtime(LLMConfig(provider="ollama", model="gpt-oss:120b-cloud"))
    assert (runtime.provider, runtime.model) == ("ollama", "gpt-oss:120b-cloud")
    assert build_model(
        LLMConfig(provider="ollama", model="m", base_url="http://localhost:11434/v1")
    )


def test_openai_requires_key():
    with pytest.raises(MissingApiKeyError):
        build_model(LLMConfig(provider="openai", model="gpt", api_key=None))


def test_openai_with_key_and_custom_base_url():
    config = LLMConfig(
        provider="openai", model="m", api_key="sk-test", base_url="https://x.test/v1"
    )
    allowed = ["https://x.test"]
    assert build_model(config, allowed_model_origins=allowed).model_name == "m"
    assert build_runtime(config, allowed_model_origins=allowed).provider == "openai"


async def test_model_provider_uses_the_app_client_without_redirects():
    config = LLMConfig(provider="openai", model="m", api_key="sk-test")
    async with httpx2.AsyncClient(follow_redirects=False) as http_client:
        model = build_model(config, http_client=http_client)
        assert isinstance(model, OpenAIChatModel)
        assert model.client._client is http_client


@pytest.mark.parametrize("url", ["https://not-allowed.test/v1", "http://api.openai.com/v1"])
def test_model_destination_must_be_allowlisted_and_remote_https(url):
    config = LLMConfig(provider="openai", model="m", api_key="sk-test", base_url=url)
    with pytest.raises(ValueError):
        build_model(config)


def test_prompt_contains_items():
    items = [
        NewsItem(
            title="T",
            link="l",
            source="S",
            published=datetime(2026, 10, 7, tzinfo=UTC),
            snippet="snip",
        ),
        NewsItem(title="U", link="l", source="S"),
    ]
    prompt = build_prompt("ACME", items)
    assert '"source": "S"' in prompt
    assert '"published": "2026-10-07"' in prompt
    assert '"title": "T"' in prompt
    assert "snip" in prompt
    assert '"published": null' in prompt
    assert "untrusted news data" in prompt
    assert "untrusted source data" in build_instructions(LLMConfig(provider="ollama", model="m"))


@pytest.mark.parametrize("effort", ["low", "medium", "high"])
def test_thinking_on_passes_the_chosen_effort_through(effort):
    config = LLMConfig(provider="ollama", model="m", thinking=True, thinking_effort=effort)
    assert model_settings(config) == {"extra_body": {"reasoning_effort": effort}}


def test_only_low_effort_asks_the_model_to_be_brief():
    def instructions(effort: str) -> str:
        config = LLMConfig(provider="ollama", model="m", thinking=True, thinking_effort=effort)
        return build_instructions(config)

    assert instructions("low") == INSTRUCTIONS + BRIEF_THINKING
    assert instructions("medium") == INSTRUCTIONS
    assert instructions("high") == INSTRUCTIONS


def test_default_effort_is_high():
    assert LLMConfig(provider="ollama", model="m").thinking_effort == "high"


def test_thinking_off_disables_reasoning_on_ollama():
    config = LLMConfig(provider="ollama", model="m", thinking=False)
    assert model_settings(config) == {"extra_body": {"reasoning_effort": "none"}}
    assert build_runtime(config).show_thinking is False


def test_gpt_oss_cannot_disable_reasoning_so_off_means_lowest_effort_and_hidden():
    config = LLMConfig(provider="ollama", model="gpt-oss:120b-cloud", thinking=False)
    assert model_settings(config) == {"extra_body": {"reasoning_effort": "low"}}
    assert build_runtime(config).show_thinking is False


def test_openai_always_shows_whatever_the_model_streams():
    assert build_runtime(
        LLMConfig(provider="openai", model="m", api_key="k", thinking=False)
    ).show_thinking
    assert build_runtime(LLMConfig(provider="ollama", model="m", thinking=True)).show_thinking


def test_ollama_api_key_is_sent_as_a_bearer_token():
    model = build_model(
        LLMConfig(provider="ollama", model="m", base_url="https://ollama.com/v1", api_key="tok")
    )
    assert isinstance(model, OpenAIChatModel)
    assert model.client.api_key == "tok"
    assert str(model.client.base_url).startswith("https://ollama.com/v1")
    # No key is needed for a local Ollama.
    build_model(LLMConfig(provider="ollama", model="m"))


def test_openai_models_get_no_reasoning_override():
    assert model_settings(LLMConfig(provider="openai", model="gpt", thinking=True)) is None
    assert build_instructions(LLMConfig(provider="openai", model="gpt", thinking=False)) == (
        INSTRUCTIONS
    )

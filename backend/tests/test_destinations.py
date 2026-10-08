import pytest
from pydantic import ValidationError

from zeroai.destinations import DestinationPolicy
from zeroai.models import NewsSourceBase
from zeroai.schemas import LLMConfigUpdate


@pytest.fixture
def policy():
    return DestinationPolicy(
        feed_hosts=("feeds.example.test",),
        model_origins=("https://models.example.test", "http://localhost:11434"),
    )


def test_feed_allow_list_is_exact_and_accepts_standard_ports(policy):
    policy.validate_feed_url("https://feeds.example.test/rss")
    policy.validate_feed_url("http://feeds.example.test:80/rss")
    assert (
        policy.validate_feed_url("HTTPS://FEEDS.EXAMPLE.TEST/rss")
        == "https://feeds.example.test/rss"
    )
    with pytest.raises(ValueError, match="not allowed"):
        policy.validate_feed_url("https://sub.feeds.example.test/rss")
    with pytest.raises(ValueError, match="standard HTTP"):
        policy.validate_feed_url("https://feeds.example.test:8443/rss")


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1/feed", "https://10.0.0.8/feed", "http://[::1]/feed"]
)
def test_feed_allow_list_never_permits_non_global_ip_literals(url):
    policy = DestinationPolicy(feed_hosts=("127.0.0.1", "10.0.0.8", "::1"))
    with pytest.raises(ValueError, match="private or reserved"):
        policy.validate_feed_url(url)


def test_feed_credentials_are_rejected_even_for_an_allowed_host(policy):
    with pytest.raises(ValueError, match="Credentials"):
        policy.validate_feed_url("https://user:secret@feeds.example.test/rss")


def test_feed_url_rejects_ambiguous_backslash_authority(policy):
    url = r"https://feeds.example.test\@evil.example/rss"
    with pytest.raises(ValueError, match="Backslashes"):
        policy.validate_feed_url(url)
    with pytest.raises(ValidationError):
        NewsSourceBase(name="Untrusted", url_template=url)


def test_model_allow_list_matches_exact_origins_and_requires_https_remotely(policy):
    assert (
        policy.validate_model_url("openai", "https://models.example.test/v1")
        == "https://models.example.test/v1"
    )
    assert policy.validate_model_url("ollama", "http://localhost:11434/v1") == (
        "http://localhost:11434/v1"
    )
    assert (
        policy.validate_model_url("openai", "HTTPS://MODELS.EXAMPLE.TEST/v1")
        == "https://models.example.test/v1"
    )
    with pytest.raises(ValueError, match="not allowed"):
        policy.validate_model_url("openai", "https://sub.models.example.test/v1")
    with pytest.raises(ValueError, match="HTTPS"):
        policy.validate_model_url("openai", "http://models.example.test/v1")


def test_model_allow_list_accepts_docker_host_ollama_on_its_default_port():
    policy = DestinationPolicy()
    assert (
        policy.validate_model_url("ollama", "http://host.docker.internal:11434/v1")
        == "http://host.docker.internal:11434/v1"
    )
    with pytest.raises(ValueError, match="HTTPS"):
        policy.validate_model_url("ollama", "http://host.docker.internal:11435/v1")


@pytest.mark.parametrize(
    "url",
    [
        "https://user:secret@models.example.test/v1",
        "https://models.example.test/v1?token=secret",
        "https://models.example.test/v1#fragment",
    ],
)
def test_model_url_rejects_credentials_queries_and_fragments(policy, url):
    with pytest.raises(ValueError):
        policy.validate_model_url("openai", url)


def test_model_url_rejects_ambiguous_backslash_authority(policy):
    url = r"https://models.example.test\@evil.example/v1"
    with pytest.raises(ValueError, match="Backslashes"):
        policy.validate_model_url("openai", url)
    with pytest.raises(ValidationError):
        LLMConfigUpdate(provider="openai", model="model", base_url=url)


def test_model_url_schema_reports_non_string_input_as_validation_error():
    with pytest.raises(ValidationError):
        LLMConfigUpdate.model_validate({"provider": "openai", "model": "model", "base_url": 123})

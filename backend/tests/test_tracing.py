import builtins
import sys

import pytest

from zeroai.config import Settings
from zeroai.tracing import configure_tracing


def test_off_does_nothing():
    assert configure_tracing("off") is False


def test_console_without_logfire_warns_and_stays_off(monkeypatch):
    monkeypatch.delitem(sys.modules, "logfire", raising=False)
    real_import = builtins.__import__

    def no_logfire(name, *args, **kwargs):
        if name == "logfire":
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_logfire)
    assert configure_tracing("console") is False


def test_console_prints_the_span_tree_and_keeps_content_out(capsys, monkeypatch):
    pytest.importorskip("logfire")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    monkeypatch.setenv("LOGFIRE_IGNORE_NO_CONFIG", "1")
    assert configure_tracing("console") is True
    Agent(TestModel()).run_sync("TOP-SECRET-PROMPT", metadata={"request_id": "abc123"})
    out = capsys.readouterr().out
    assert "agent run" in out
    assert "chat test" in out
    assert "TOP-SECRET-PROMPT" not in out


def test_setting_defaults_to_off():
    assert Settings(_env_file=None).tracing == "off"

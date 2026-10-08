"""Guards for the HTTP stack we chose: httpx2 for requests, pookx for mocking them."""

import importlib.metadata as metadata
import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"


def test_http_mocking_comes_from_pookx_not_the_original_pook():
    """Both ship the module name ``pook``, so check which distribution is installed."""
    assert metadata.version("pookx")
    with pytest.raises(metadata.PackageNotFoundError):
        metadata.version("pook")


def test_pookx_can_intercept_httpx2():
    from pook.interceptors import interceptors

    assert "Httpx2Interceptor" in [i.__name__ for i in interceptors]


def test_our_code_uses_httpx2_and_never_plain_httpx():
    offenders = [
        f"{path.relative_to(SRC)}:{n}"
        for path in SRC.rglob("*.py")
        for n, line in enumerate(path.read_text().splitlines(), start=1)
        if re.match(r"\s*(import|from)\s+httpx\b(?!2)", line)
    ]
    assert offenders == []
    assert metadata.version("httpx2")

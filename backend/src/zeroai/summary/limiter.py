"""Bounds concurrent LLM calls so a local model is never overloaded."""

import asyncio


class LLMGate:
    """Thin wrapper over :class:`asyncio.Semaphore` that can tell callers they will queue."""

    def __init__(self, max_concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)

    @property
    def busy(self) -> bool:
        """True when a new caller would have to wait."""
        return self._semaphore.locked()

    async def __aenter__(self) -> None:
        await self._semaphore.acquire()

    async def __aexit__(self, *exc_info: object) -> None:
        self._semaphore.release()

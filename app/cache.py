import time
from typing import Any


class TTLCache:
    """Small in-process cache for the local POC. Replace with distributed cache at scale."""

    def __init__(self, ttl_seconds: int = 10):
        self.ttl_seconds = ttl_seconds
        self._data: dict[str, tuple[float, Any]] = {}

    async def get(self, key: str) -> Any | None:
        item = self._data.get(key)
        if not item:
            return None
        expires_at, value = item
        if time.monotonic() >= expires_at:
            self._data.pop(key, None)
            return None
        return value

    async def set(self, key: str, value: Any) -> None:
        self._data[key] = (time.monotonic() + self.ttl_seconds, value)

    async def delete(self, key: str) -> None:
        self._data.pop(key, None)

import asyncio
import json
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._channels: dict[str, set[asyncio.Queue]] = defaultdict(set)

    async def subscribe(self, channel: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._channels[channel].add(queue)
        return queue

    async def unsubscribe(self, channel: str, queue: asyncio.Queue) -> None:
        self._channels[channel].discard(queue)

    async def emit(self, channel: str, event_type: str, data: Any) -> None:
        payload = {"type": event_type, "data": data}
        for queue in list(self._channels.get(channel, ())):
            await queue.put(payload)

    @staticmethod
    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, default=str)}\n\n"

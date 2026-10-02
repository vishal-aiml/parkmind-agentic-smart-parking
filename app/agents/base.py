from typing import Any

from app.events import EventBus


class AgentContext:
    def __init__(self, events: EventBus):
        self.events = events

    async def start(self, request_id: str, agent: str, message: str) -> None:
        await self.events.emit(f"chat:{request_id}", "agent_started", {"agent": agent, "message": message})

    async def done(self, request_id: str, agent: str, result: dict[str, Any]) -> None:
        await self.events.emit(f"chat:{request_id}", "agent_completed", {"agent": agent, "result": result})

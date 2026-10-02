from typing import Any

from app.agents.base import AgentContext
from app.openai_service import OpenAIService


ROUTE_SCHEMA = {
    "type": "object",
    "properties": {
        "routes": {
            "type": "array",
            "minItems": 1,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "agent": {"type": "string", "enum": ["occupancy", "reservation", "navigation", "knowledge", "analytics", "vision"]},
                    "reason": {"type": "string"},
                    "priority": {"type": "integer", "minimum": 1, "maximum": 4},
                },
                "required": ["agent", "reason", "priority"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["routes"],
    "additionalProperties": False,
}


class SupervisorAgent:
    name = "supervisor"

    def __init__(self, llm: OpenAIService, ctx: AgentContext):
        self.llm, self.ctx = llm, ctx

    async def run(self, request_id: str, query: str, snapshot: dict[str, Any], image_url: str | None) -> dict[str, Any]:
        await self.ctx.start(request_id, self.name, "Classifying intent and selecting the smallest useful agent set")
        if image_url:
            plan = {"routes": [{"agent": "vision", "reason": "Image input requires visual inspection", "priority": 1}]}
        else:
            fallback_routes = self._local_routes(query)
            plan = await self.llm.structured(
                "You are the Supervisor Agent for a smart parking platform. Select one or more specialist agents. "
                "occupancy=live availability, reservation=validated booking/release, navigation=route, knowledge=policy/pricing/RAG, "
                "analytics=KPIs/trends, vision=image analysis. Use the minimum set needed. Combined requests should use multiple agents. "
                "Never invent live parking state.",
                f"User request:\n{query}\n\nLive snapshot:\n{snapshot}",
                ROUTE_SCHEMA,
                "parking_supervisor_plan",
                fallback={"routes": fallback_routes},
            )
        routes = sorted(plan.get("routes", []), key=lambda item: (item.get("priority", 9), item.get("agent", "")))[:4]
        await self.ctx.done(request_id, self.name, {"routes": routes})
        return {"routes": routes}

    @staticmethod
    def _local_routes(query: str) -> list[dict[str, Any]]:
        q = query.lower()
        routes: list[dict[str, Any]] = []
        def add(agent: str, reason: str, priority: int) -> None:
            if agent not in [r["agent"] for r in routes]:
                routes.append({"agent": agent, "reason": reason, "priority": priority})
        if any(x in q for x in ["find", "available", "parking", "spot", "occupied", "ev", "charging", "accessible"]):
            add("occupancy", "Live parking state or spot availability is needed", 1)
        if any(x in q for x in ["reserve", "book", "release", "cancel"]):
            add("reservation", "The request contains an action on a reservation", 1)
        if any(x in q for x in ["route", "direction", "near the entrance", "how do i get"]):
            add("navigation", "A route is requested", 2)
        if any(x in q for x in ["price", "cost", "rule", "policy", "ev", "accessible", "charger"]):
            add("knowledge", "Facility knowledge is required", 2)
        if any(x in q for x in ["analytics", "trend", "kpi", "zone", "utilization", "occupancy by"]):
            add("analytics", "Operational metrics are requested", 1)
        return routes or [{"agent": "knowledge", "reason": "General parking information", "priority": 1}]

import re

from app.agents.base import AgentContext
from app.repository import ParkingRepository


class ReservationAgent:
    name = "reservation"

    def __init__(self, repo: ParkingRepository, ctx: AgentContext):
        self.repo, self.ctx = repo, ctx

    async def run(self, request_id: str, query: str) -> dict:
        await self.ctx.start(request_id, self.name, "Validating reservation action before database mutation")
        q = query.lower()
        user_match = re.search(r"user(?:\s+id)?\s*[:=]\s*([a-z0-9_-]+)", q)
        user = user_match.group(1) if user_match else "demo-user"
        spot_match = re.search(r"p\d+-?[abc]\d{1,2}", q, flags=re.I)
        spot_id = spot_match.group(0).upper() if spot_match else None
        is_release = any(word in q for word in ["release", "cancel"])
        if not spot_id:
            result = {"action": "release" if is_release else "reserve", "status": "needs_input", "message": "Provide a specific spot ID such as P1-A01. The agent will not guess a write target."}
        elif is_release:
            try:
                result = {"action": "release", "status": "success", "data": await self.repo.release(user, spot_id)}
            except ValueError as exc:
                result = {"action": "release", "status": "rejected", "message": str(exc)}
        else:
            hours_match = re.search(r"(\d+)\s*(?:hour|hours|hr|hrs)", q)
            duration = int(hours_match.group(1)) if hours_match else 2
            needs_ev = "ev" in q or "charging" in q
            needs_accessible = "accessible" in q or "disabled" in q
            try:
                data = await self.repo.reserve(user, spot_id, duration, needs_ev=needs_ev, needs_accessible=needs_accessible)
                result = {"action": "reserve", "status": "success", "data": data}
            except ValueError as exc:
                result = {"action": "reserve", "status": "rejected", "message": str(exc)}
        await self.ctx.done(request_id, self.name, result)
        return result

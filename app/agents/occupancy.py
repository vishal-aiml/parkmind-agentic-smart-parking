from app.agents.base import AgentContext
from app.repository import ParkingRepository


class OccupancyAgent:
    name = "occupancy"

    def __init__(self, repo: ParkingRepository, ctx: AgentContext):
        self.repo, self.ctx = repo, ctx

    async def run(self, request_id: str, query: str) -> dict:
        await self.ctx.start(request_id, self.name, "Reading current simulated sensor state")
        q = query.lower()
        spot_type = "ev" if ("ev" in q or "charging" in q) else "accessible" if ("accessible" in q or "disabled" in q) else None
        snapshot = await self.repo.snapshot()
        spots = [s for s in snapshot["spots"] if s["status"] == "available"]
        if spot_type:
            spots = [s for s in spots if s["spot_type"] == spot_type]
        spots.sort(key=lambda item: item["distance_to_entrance_m"])
        result = {
            "summary": f"{snapshot['available']} of {snapshot['total']} spots are available; occupancy is {snapshot['occupancy_pct']}%.",
            "recommended_spots": spots[:5],
            "counts": {key: snapshot[key] for key in ["available", "occupied", "reserved", "maintenance"]},
        }
        await self.ctx.done(request_id, self.name, result)
        return result

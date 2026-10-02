from collections import Counter

from app.agents.base import AgentContext
from app.repository import ParkingRepository


class AnalyticsAgent:
    name = "analytics"

    def __init__(self, repo: ParkingRepository, ctx: AgentContext):
        self.repo, self.ctx = repo, ctx

    async def run(self, request_id: str, query: str) -> dict:
        await self.ctx.start(request_id, self.name, "Calculating occupancy KPIs by zone")
        snapshot = await self.repo.snapshot()
        zones: dict[str, Counter] = {}
        for spot in snapshot["spots"]:
            zones.setdefault(spot["zone"], Counter())[spot["status"]] += 1
        zone_metrics = []
        for zone, counts in sorted(zones.items()):
            total = sum(counts.values())
            zone_metrics.append({"zone": zone, "total": total, "available": counts["available"], "occupied": counts["occupied"], "occupancy_pct": round(counts["occupied"] / total * 100, 1)})
        result = {"kpis": {"lot_occupancy_pct": snapshot["occupancy_pct"], "available": snapshot["available"], "occupied": snapshot["occupied"]}, "zone_metrics": zone_metrics}
        await self.ctx.done(request_id, self.name, result)
        return result

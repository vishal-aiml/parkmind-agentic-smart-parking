from app.agents.base import AgentContext
from app.repository import ParkingRepository


class NavigationAgent:
    name = "navigation"

    def __init__(self, repo: ParkingRepository, ctx: AgentContext):
        self.repo, self.ctx = repo, ctx

    async def run(self, request_id: str, query: str) -> dict:
        await self.ctx.start(request_id, self.name, "Building an indoor route from Gate A to nearby available spots")
        snapshot = await self.repo.snapshot()
        available = sorted(
            [s for s in snapshot["spots"] if s["status"] == "available"],
            key=lambda s: (s["distance_to_entrance_m"], s["spot_id"]),
        )
        routes = [{
            "spot_id": s["spot_id"],
            "steps": [
                "Enter through Gate A",
                f"Take the main aisle to floor P{s['floor'] + 1}",
                f"Turn into row {s['row']}",
                f"Continue to {s['spot_id']} (~{int(s['distance_to_entrance_m'])} m from the entrance)",
            ],
        } for s in available[:3]]
        result = {"routes": routes, "note": "POC routing uses parking metadata; production can replace this with a true indoor graph."}
        await self.ctx.done(request_id, self.name, result)
        return result

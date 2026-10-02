import operator
import uuid
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.agents.analytics import AnalyticsAgent
from app.agents.base import AgentContext
from app.agents.knowledge import KnowledgeAgent
from app.agents.navigation import NavigationAgent
from app.agents.occupancy import OccupancyAgent
from app.agents.reservation import ReservationAgent
from app.agents.supervisor import SupervisorAgent
from app.agents.vision import VisionAgent
from app.events import EventBus
from app.openai_service import OpenAIService
from app.rag import LocalVectorStore
from app.repository import ParkingRepository


class ParkingState(TypedDict, total=False):
    request_id: str
    query: str
    image_url: str | None
    snapshot: dict[str, Any]
    plan: dict[str, Any]
    task: dict[str, Any]
    agent_results: Annotated[list[dict[str, Any]], operator.add]
    final_answer: str


class AppGraph:
    def __init__(self, llm: OpenAIService, repo: ParkingRepository, rag: LocalVectorStore, events: EventBus):
        ctx = AgentContext(events)
        self.repo, self.llm, self.events = repo, llm, events
        self.supervisor = SupervisorAgent(llm, ctx)
        self.agents = {
            "occupancy": OccupancyAgent(repo, ctx),
            "reservation": ReservationAgent(repo, ctx),
            "navigation": NavigationAgent(repo, ctx),
            "knowledge": KnowledgeAgent(llm, rag, ctx),
            "analytics": AnalyticsAgent(repo, ctx),
            "vision": VisionAgent(llm, ctx),
        }
        self.graph = self._build(ctx)

    def _build(self, ctx: AgentContext):
        builder = StateGraph(ParkingState)

        async def supervisor_node(state: ParkingState):
            return {
                "plan": await self.supervisor.run(
                    state["request_id"],
                    state["query"],
                    state["snapshot"],
                    state.get("image_url"),
                )
            }

        def fan_out(state: ParkingState):
            # Send invokes the same specialist node once per selected route.
            # The agent_results reducer gathers all parallel results for synthesis.
            return [
                Send(
                    "specialist",
                    {
                        "request_id": state["request_id"],
                        "query": state["query"],
                        "image_url": state.get("image_url"),
                        "snapshot": state["snapshot"],
                        "task": route,
                    },
                )
                for route in state["plan"]["routes"]
            ]

        async def specialist_node(state: ParkingState):
            route = state["task"]
            agent_name = route["agent"]
            if agent_name not in self.agents:
                raise ValueError(f"Unknown specialist agent: {agent_name}")

            if agent_name == "vision":
                result = await self.agents[agent_name].run(
                    state["request_id"],
                    state.get("image_url"),
                )
            else:
                result = await self.agents[agent_name].run(
                    state["request_id"],
                    state["query"],
                )

            return {
                "agent_results": [
                    {"agent": agent_name, "result": result}
                ]
            }

        async def synthesis(state: ParkingState):
            combined = "\n\n".join(
                f"Agent={item['agent']}\n{item['result']}"
                for item in state.get("agent_results", [])
            )
            demo_answer = self._demo_synthesis(
                state["query"],
                state.get("plan", {}).get("routes", []),
                state.get("agent_results", []),
                state["snapshot"],
            )
            await ctx.start(
                state["request_id"],
                "synthesis",
                "Combining specialist results into one grounded response",
            )
            answer = await self.llm.text(
                "You are the final response agent for a smart parking platform. Answer clearly and concisely. "
                "Trust live-state and deterministic reservation outputs over assumptions. Never invent a booking confirmation. "
                "Use RAG source labels when they are present. Mention rejected or missing actions explicitly. "
                "Prefer a useful, user-facing answer over dumping raw agent JSON.",
                f"User request:\n{state['query']}\n\nLive state:\n{state['snapshot']}\n\nSpecialist outputs:\n{combined}",
                fallback=demo_answer,
            )
            await ctx.done(state["request_id"], "synthesis", {"answer": answer})
            return {"final_answer": answer}

        builder.add_node("supervisor", supervisor_node)
        builder.add_node("specialist", specialist_node)
        builder.add_node("synthesis", synthesis)
        builder.add_edge(START, "supervisor")
        builder.add_conditional_edges("supervisor", fan_out)
        builder.add_edge("specialist", "synthesis")
        builder.add_edge("synthesis", END)
        return builder.compile()

    @staticmethod
    def _demo_synthesis(
        query: str,
        routes: list[dict[str, Any]],
        agent_results: list[dict[str, Any]],
        snapshot: dict[str, Any],
    ) -> str:
        """Friendly deterministic answer used when OPENAI_API_KEY is not configured."""
        q = query.lower()
        by_agent = {item["agent"]: item["result"] for item in agent_results}
        lines = ["DEMO AI RESPONSE — OpenAI API key is not configured."]
        lines.append("ParkMind is still running its real multi-agent workflow with deterministic local answers.")

        if "occupancy" in by_agent:
            occ = by_agent["occupancy"]
            lines.append(f"\nLive parking: {occ.get('summary', 'Current parking state is available.')}")
            spots = occ.get("recommended_spots", [])[:3]
            if spots:
                formatted = ", ".join(
                    f"{spot['spot_id']} ({spot['spot_type']}, ~{int(spot['distance_to_entrance_m'])} m)"
                    for spot in spots
                )
                lines.append(f"Recommended spots: {formatted}.")

        if "knowledge" in by_agent:
            know = by_agent["knowledge"]
            if know.get("answer"):
                lines.append(f"\nFacility knowledge: {know['answer']}")

        if "navigation" in by_agent:
            nav = by_agent["navigation"]
            routes_data = nav.get("routes", [])[:2]
            if routes_data:
                route_text = " | ".join(
                    f"{item['spot_id']}: " + " → ".join(item["steps"])
                    for item in routes_data
                )
                lines.append(f"\nNavigation: {route_text}.")
            elif nav.get("note"):
                lines.append(f"\nNavigation: {nav['note']}")

        if "reservation" in by_agent:
            res = by_agent["reservation"]
            status = res.get("status")
            if status == "success":
                data = res.get("data", {})
                lines.append(
                    f"\nReservation confirmed for {data.get('spot_id', 'the selected spot')} "
                    f"until {data.get('ends_at', 'the requested end time')} (demo database)."
                )
            elif status:
                lines.append(f"\nReservation status: {status}. {res.get('message', '')}".strip())

        if "analytics" in by_agent:
            analytics = by_agent["analytics"]
            metrics = analytics.get("kpis", {})
            lines.append(
                f"\nAnalytics: lot occupancy is {metrics.get('lot_occupancy_pct', snapshot.get('occupancy_pct', 0))}%, "
                f"with {metrics.get('available', snapshot.get('available', 0))} available and "
                f"{metrics.get('occupied', snapshot.get('occupied', 0))} occupied."
            )

        if "vision" in by_agent:
            vision = by_agent["vision"]
            lines.append(f"\nVision: {vision.get('report') or vision.get('message', 'No image analysis available.')}")

        if not any(name in by_agent for name in ["occupancy", "knowledge", "navigation", "reservation", "analytics", "vision"]):
            lines.append("\nAsk about available parking, EV charging, pricing, navigation, analytics, reservations, or upload a parking image.")

        if "ev" in q or "charging" in q:
            lines.append("\nTip: Add an OpenAI key to replace this deterministic demo response with model-generated synthesis while keeping the same agent/tool boundaries.")

        selected = ", ".join(route.get("agent", "") for route in routes)
        if selected:
            lines.append(f"\nSupervisor route: {selected} → synthesis.")
        return "\n".join(lines)

    async def run(self, query: str, snapshot: dict, image_url: str | None = None, request_id: str | None = None) -> dict:
        rid = request_id or uuid.uuid4().hex[:12]
        result = await self.graph.ainvoke(
            {
                "request_id": rid,
                "query": query,
                "image_url": image_url,
                "snapshot": snapshot,
                "agent_results": [],
            }
        )
        return result | {"request_id": rid}

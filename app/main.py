import asyncio
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from app.agents.base import AgentContext
from app.agents.analytics import AnalyticsAgent
from app.agents.knowledge import KnowledgeAgent
from app.agents.navigation import NavigationAgent
from app.agents.occupancy import OccupancyAgent
from app.agents.reservation import ReservationAgent
from app.agents.vision import VisionAgent
from app.api import router
from app.cache import TTLCache
from app.config import get_settings
from app.events import EventBus
from app.graph import AppGraph
from app.openai_service import OpenAIService
from app.operations import OperationsSimulator
from app.rag import LocalVectorStore
from app.repository import ParkingRepository, init_db

settings = get_settings()
logging.basicConfig(level=logging.INFO)


async def simulator(app: FastAPI):
    # Run one tick immediately so the dashboard starts with a live change instead
    # of waiting for the first interval. Then keep the stream alive forever.
    while True:
        try:
            changed = await app.state.repo.simulate_tick()
            snapshot = await app.state.repo.snapshot()
            await app.state.cache.set("parking:snapshot", snapshot)
            operations = app.state.operations.tick(snapshot.get("occupancy_pct"))
            app.state.live_tick_count += 1
            app.state.live_last_tick = datetime.now(timezone.utc).isoformat()
            app.state.live_last_error = None
            await app.state.events.emit("live", "parking_update", snapshot)
            await app.state.events.emit("live", "operations_update", operations)
            logging.info(
                "Live tick #%s: changed_spots=%s occupancy=%s%% entries=%s exits=%s fees=₹%s",
                app.state.live_tick_count,
                len(changed),
                snapshot.get("occupancy_pct"),
                operations.get("entries_today"),
                operations.get("exits_today"),
                operations.get("fees_today"),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            app.state.live_last_error = str(exc)
            logging.exception("Live simulator tick failed; retrying")

        await asyncio.sleep(max(1, settings.simulator_interval_seconds))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    repo = ParkingRepository()
    await repo.seed()

    llm = OpenAIService()
    rag = LocalVectorStore(settings.rag_index_path, llm)
    if settings.rag_enabled and not Path(settings.rag_index_path).exists():
        await rag.build(str(Path(__file__).resolve().parents[1] / "knowledge"))

    events = EventBus()
    ctx = AgentContext(events)
    app.state.settings = settings
    app.state.repo = repo
    app.state.cache = TTLCache(settings.cache_ttl_seconds)
    app.state.llm = llm
    app.state.rag = rag
    app.state.events = events
    app.state.operations = OperationsSimulator()
    app.state.live_tick_count = 0
    app.state.live_last_tick = None
    app.state.live_last_error = None
    app.state.graph = AppGraph(llm, repo, rag, events)
    app.state.agents = {
        "occupancy": OccupancyAgent(repo, ctx),
        "reservation": ReservationAgent(repo, ctx),
        "navigation": NavigationAgent(repo, ctx),
        "knowledge": KnowledgeAgent(llm, rag, ctx),
        "analytics": AnalyticsAgent(repo, ctx),
        "vision": VisionAgent(llm, ctx),
    }

    task = asyncio.create_task(simulator(app)) if settings.simulator_enabled else None
    logging.info("ParkMind live simulator enabled=%s interval=%ss", settings.simulator_enabled, settings.simulator_interval_seconds)
    try:
        yield
    finally:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(title=settings.app_name, version="2.2.0", lifespan=lifespan)


@app.middleware("http")
async def no_cache_dashboard_assets(request, call_next):
    response = await call_next(request)
    # The POC changes UI assets frequently during demos. Prevent a stale browser
    # copy from making the new dashboard look like an older build.
    if request.url.path.startswith(("/dashboard/", "/parking/")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        response.headers["X-ParkMind-UI-Version"] = "20261002-16"
    return response
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/parking/", status_code=307)


@app.websocket("/ws/live")
async def live_socket(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            snapshot = await websocket.app.state.repo.snapshot()
            operations = websocket.app.state.operations.snapshot(snapshot.get("occupancy_pct"))
            await websocket.send_json({"type": "parking_update", "data": snapshot})
            await websocket.send_json({"type": "operations_update", "data": operations})
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return


static_dir = Path(__file__).parent / "static"
app.mount("/parking", StaticFiles(directory=static_dir, html=True), name="parking")
app.mount("/dashboard", StaticFiles(directory=static_dir, html=True), name="dashboard")

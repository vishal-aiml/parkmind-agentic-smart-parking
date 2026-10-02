import asyncio
import uuid

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


router = APIRouter()


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    image_url: str | None = None


class ReserveRequest(BaseModel):
    user_id: str = "demo-user"
    spot_id: str
    duration_hours: int = Field(default=2, ge=1, le=24)
    vehicle_type: str = "car"
    needs_ev: bool = False
    needs_accessible: bool = False


class ReleaseRequest(BaseModel):
    user_id: str = "demo-user"
    spot_id: str


@router.get("/health")
async def health(request: Request):
    return {
        "status": "ok",
        "openai_enabled": request.app.state.llm.enabled,
        "rag_enabled": bool(request.app.state.rag),
        "storage": "sqlite",
        "cache": "in-process",
        "simulator_enabled": bool(request.app.state.settings.simulator_enabled) if hasattr(request.app.state, "settings") else True,
        "live_tick_count": request.app.state.live_tick_count,
        "last_simulator_tick": request.app.state.live_last_tick,
        "last_simulator_error": request.app.state.live_last_error,
    }


@router.get("/api/parking/status")
async def status(request: Request):
    snapshot = await request.app.state.cache.get("parking:snapshot")
    if snapshot is None:
        snapshot = await request.app.state.repo.snapshot()
        await request.app.state.cache.set("parking:snapshot", snapshot)
    return snapshot


@router.get("/api/parking/spots")
async def spots(request: Request, spot_type: str | None = None, zone: str | None = None):
    return await request.app.state.repo.available_spots(spot_type, zone)


@router.post("/api/parking/reserve")
async def reserve(request: Request, body: ReserveRequest):
    try:
        result = await request.app.state.repo.reserve(body.user_id, body.spot_id.upper(), body.duration_hours, body.vehicle_type, body.needs_ev, body.needs_accessible)
        await request.app.state.cache.delete("parking:snapshot")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/api/parking/release")
async def release(request: Request, body: ReleaseRequest):
    try:
        result = await request.app.state.repo.release(body.user_id, body.spot_id.upper())
        await request.app.state.cache.delete("parking:snapshot")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc




@router.get("/api/operations/metrics")
async def operations_metrics(request: Request):
    parking = await request.app.state.repo.snapshot()
    return request.app.state.operations.snapshot(parking.get("occupancy_pct"))

@router.post("/api/chat")
async def chat(request: Request, body: ChatRequest):
    rid = uuid.uuid4().hex[:12]
    snapshot = await request.app.state.repo.snapshot()
    result = await request.app.state.graph.run(body.query, snapshot, body.image_url, rid)
    await request.app.state.repo.audit(rid, body.query, result.get("final_answer", ""), result.get("plan", {}).get("routes", []))
    return result


@router.get("/api/chat/stream")
async def chat_stream(request: Request, query: str, image_url: str | None = None):
    rid = uuid.uuid4().hex[:12]
    channel = f"chat:{rid}"
    queue = await request.app.state.events.subscribe(channel)
    snapshot = await request.app.state.repo.snapshot()

    async def runner():
        try:
            result = await request.app.state.graph.run(query, snapshot, image_url, rid)
            await request.app.state.events.emit(channel, "final", {
                "answer": result.get("final_answer", ""),
                "routes": result.get("plan", {}).get("routes", []),
                "agent_results": result.get("agent_results", []),
            })
            await request.app.state.repo.audit(rid, query, result.get("final_answer", ""), result.get("plan", {}).get("routes", []))
        except Exception as exc:
            await request.app.state.events.emit(channel, "error", {"message": str(exc)})
        finally:
            await request.app.state.events.emit(channel, "done", {})

    task = asyncio.create_task(runner())

    async def generator():
        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                    yield request.app.state.events.sse(item)
                    if item.get("type") == "done":
                        break
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            await request.app.state.events.unsubscribe(channel, queue)

    return StreamingResponse(generator(), media_type="text/event-stream")


@router.post("/api/vision/upload")
async def vision_upload(request: Request, image: UploadFile = File(...)):
    content = await image.read()
    if len(content) > 8_000_000:
        raise HTTPException(status_code=413, detail="Image too large for this demo")
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload an image file")
    data_url = request.app.state.llm.data_url_from_bytes(image.content_type, content)
    return await request.app.state.agents["vision"].run(uuid.uuid4().hex[:12], data_url)

from app.agents.base import AgentContext
from app.openai_service import OpenAIService


class VisionAgent:
    name = "vision"

    def __init__(self, llm: OpenAIService, ctx: AgentContext):
        self.llm, self.ctx = llm, ctx

    async def run(self, request_id: str, image_url: str | None) -> dict:
        await self.ctx.start(request_id, self.name, "Inspecting parking imagery with OpenAI vision")
        if not image_url:
            result = {"status": "needs_input", "message": "Provide an image URL or upload a parking image."}
        else:
            report = await self.llm.vision(
                image_url,
                "Inspect this parking-lot image. Estimate visible occupied and available bays, identify EV/accessible indicators when visible, "
                "and flag ambiguous detections. Never claim sensor-grade accuracy from a single image.",
                fallback="DEMO MODE: Vision analysis requires OPENAI_API_KEY. The UI and other agents remain available.",
            )
            result = {"status": "success", "report": report}
        await self.ctx.done(request_id, self.name, result)
        return result

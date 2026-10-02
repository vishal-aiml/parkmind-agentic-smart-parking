import base64
import json
from typing import Any

from openai import AsyncOpenAI

from app.config import get_settings


class OpenAIService:
    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = settings.openai_enabled
        self.model = settings.openai_model
        self.embedding_model = settings.openai_embedding_model
        self.client = AsyncOpenAI(api_key=settings.openai_api_key) if self.enabled else None

    async def text(self, instructions: str, input_text: str, fallback: str = "") -> str:
        if not self.client:
            return fallback
        response = await self.client.responses.create(
            model=self.model,
            instructions=instructions,
            input=input_text,
        )
        return response.output_text.strip()

    async def structured(self, instructions: str, input_text: str, schema: dict[str, Any], name: str, fallback: dict[str, Any]) -> dict[str, Any]:
        if not self.client:
            return fallback
        response = await self.client.responses.create(
            model=self.model,
            instructions=instructions,
            input=input_text,
            text={
                "format": {
                    "type": "json_schema",
                    "name": name,
                    "schema": schema,
                    "strict": True,
                }
            },
        )
        return json.loads(response.output_text)

    async def embed(self, text: str) -> list[float] | None:
        if not self.client:
            return None
        response = await self.client.embeddings.create(model=self.embedding_model, input=text)
        return response.data[0].embedding

    async def vision(self, image_url: str, prompt: str, fallback: str) -> str:
        if not self.client:
            return fallback
        response = await self.client.responses.create(
            model=self.model,
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_url},
                ],
            }],
        )
        return response.output_text.strip()

    @staticmethod
    def data_url_from_bytes(content_type: str, content: bytes) -> str:
        encoded = base64.b64encode(content).decode("ascii")
        return f"data:{content_type};base64,{encoded}"

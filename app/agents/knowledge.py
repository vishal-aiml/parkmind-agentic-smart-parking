from app.agents.base import AgentContext
from app.config import get_settings
from app.openai_service import OpenAIService
from app.rag import LocalVectorStore


class KnowledgeAgent:
    name = "knowledge"

    def __init__(self, llm: OpenAIService, rag: LocalVectorStore, ctx: AgentContext):
        self.llm, self.rag, self.ctx = llm, rag, ctx

    async def run(self, request_id: str, query: str) -> dict:
        await self.ctx.start(request_id, self.name, "Retrieving facility policy, pricing and operating knowledge")
        candidates = await self.rag.search(query)
        if not candidates:
            result = {"answer": "No matching knowledge was found in the local parking knowledge base.", "sources": []}
        else:
            context = "\n\n".join(f"[{i+1}] {c.source}: {c.text}" for i, c in enumerate(candidates))
            answer = await self.llm.text(
                "Answer only from the supplied parking knowledge. Cite source filenames in square brackets. "
                "If the context does not support an answer, say that clearly. Do not invent policies.",
                f"Question: {query}\n\nContext:\n{context}",
                fallback="\n".join(f"[{c.source}] {c.text}" for c in candidates[:2]),
            )
            result = {
                "answer": answer,
                "sources": [{"source": c.source, "score": c.metadata.get("rerank_score")} for c in candidates],
            }
        await self.ctx.done(request_id, self.name, result)
        return result

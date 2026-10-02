import argparse
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.openai_service import OpenAIService


@dataclass
class Candidate:
    text: str
    source: str
    vector_score: float
    metadata: dict[str, Any]


class HybridReranker:
    def rerank(self, query: str, candidates: list[Candidate], top_k: int = 4) -> list[Candidate]:
        q = set(re.findall(r"[a-z0-9]+", query.lower()))
        scored = []
        for c in candidates:
            words = set(re.findall(r"[a-z0-9]+", c.text.lower()))
            lexical = len(q & words) / max(1, len(q))
            category = c.metadata.get("category")
            boost = 0.04 if category in {"pricing", "safety", "accessibility"} else 0.0
            score = 0.78 * c.vector_score + 0.18 * lexical + boost
            c.metadata["rerank_score"] = round(score, 4)
            scored.append((score, c))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [candidate for _, candidate in scored[:top_k]]


class LocalVectorStore:
    def __init__(self, path: str, llm: OpenAIService):
        self.path = Path(path)
        self.llm = llm
        self.reranker = HybridReranker()

    def _chunk(self, text: str, max_chars: int = 1200) -> list[str]:
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        chunks, current = [], ""
        for paragraph in paragraphs:
            if current and len(current) + len(paragraph) + 2 > max_chars:
                chunks.append(current)
                current = paragraph
            else:
                current = f"{current}\n\n{paragraph}".strip()
        if current:
            chunks.append(current)
        return chunks

    async def build(self, directory: str) -> int:
        base = Path(directory)
        records: list[dict[str, Any]] = []
        for path in sorted(base.glob("*.md")):
            category = path.stem.split("_")[0]
            for index, chunk in enumerate(self._chunk(path.read_text(encoding="utf-8"))):
                vector = await self.llm.embed(chunk)
                records.append({
                    "text": chunk,
                    "source": path.name,
                    "chunk": index,
                    "category": category,
                    "vector": vector,
                })
        self.path.write_text(json.dumps(records), encoding="utf-8")
        return len(records)

    def _load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        return json.loads(self.path.read_text(encoding="utf-8"))

    @staticmethod
    def _cosine(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        denom = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
        return dot / denom if denom else 0.0

    async def search(self, query: str, top_k: int = 8) -> list[Candidate]:
        records = self._load()
        if not records:
            return []
        query_vector = await self.llm.embed(query)
        candidates = []
        query_words = set(re.findall(r"[a-z0-9]+", query.lower()))
        for record in records:
            if query_vector and record.get("vector"):
                score = self._cosine(query_vector, record["vector"])
            else:
                words = set(re.findall(r"[a-z0-9]+", record["text"].lower()))
                score = len(query_words & words) / max(1, len(query_words | words))
            candidates.append(Candidate(
                text=record["text"],
                source=record["source"],
                vector_score=float(score),
                metadata={"category": record.get("category", "general"), "chunk": record.get("chunk")},
            ))
        candidates.sort(key=lambda item: item.vector_score, reverse=True)
        return self.reranker.rerank(query, candidates[:top_k], top_k=4)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    store = LocalVectorStore(settings.rag_index_path, OpenAIService())
    count = await store.build("knowledge")
    print(f"Indexed {count} knowledge chunks into {settings.rag_index_path}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())

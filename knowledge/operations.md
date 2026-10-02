# Operations Guide

The system separates live-state tools from knowledge retrieval. Live occupancy should be read from the parking repository. Policies, pricing, accessibility guidance, and operating procedures are retrieved through RAG.

For higher scale, move the local cache to a distributed cache, move the in-process event bus to a durable event stream, store embeddings in a managed vector database, and persist agent state with a durable LangGraph checkpointer or platform service.

Observability should capture request ID, thread ID, selected agents, tool calls, latency, error status, and source citations while avoiding unnecessary personal data.

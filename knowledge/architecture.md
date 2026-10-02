# Architecture Principles

The Supervisor Agent is the orchestration layer. It chooses the smallest set of specialist agents needed for a request.

Specialist agents are intentionally narrow: Occupancy reads live state; Reservation performs validated writes; Navigation derives route guidance from lot metadata; Knowledge performs RAG; Analytics computes KPIs; Vision analyzes parking imagery.

The synthesis step combines deterministic and retrieved evidence into the final user response. This is a POC architecture, not a safety-certified parking control system.

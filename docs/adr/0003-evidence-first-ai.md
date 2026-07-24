# ADR-003: Evidence-First AI Reasoning

## Status
Accepted

## Context
LLM summaries and suggest-fix flows can hallucinate when models fetch open-ended telemetry directly.

## Decision
All AI endpoints consume a structured investigation package (timeline, evidence, completeness, citations). The LLM never calls SigNoz/GitHub directly during summary generation.

## Consequences
- Predictable outputs tied to timeline entries
- Missing evidence detection can block overconfident conclusions
- Slightly higher pipeline latency before AI runs (acceptable tradeoff)

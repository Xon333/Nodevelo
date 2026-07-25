# ADR-0008 · Prompt-cache split + forced tool use

**Context.** Block generation ships a huge prompt (full KB + syntax guide + per-block context) on every call; and free-text plan output required a brittle regex parser.

**Decision.** (a) The system prompt is split `{cached, dynamic}`: the stable prefix (persona + syntax guide + KB) carries `cache_control: ephemeral`; all per-block context goes after the breakpoint. `system-prompt.test.ts` is the executable contract that per-block data never enters the cached half. (b) Structured output is forced tool-use (`tool_choice: {type: "tool"}`) against zod-derived schemas via the single `tool-schema.ts` bridge; the regex parser (`plan-parser.parsePlan`) is retired. (c) `PlanToolSchema` declares `weeks` before `overview` so the model commits the schedule before summarizing it.

**Consequences.** Cache economics are real (writes 1.25×, reads 0.1× — tracked in `ai-usage.ts`) and KB edits invalidate the cache by design (fresh knowledge wins). Parsing failures became typed zod errors with a truncation-vs-malformed distinction. Every tool schema lives in one of three known files; field order is load-bearing and must survive schema edits.

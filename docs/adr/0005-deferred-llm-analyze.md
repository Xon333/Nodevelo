# ADR-0005 · Fast sync; deferred LLM analysis

**Context.** Sync must be quick and reliable — it's the app's heartbeat. An Anthropic timeout inside sync would hold every store update hostage to a third-party API.

**Decision.** `POST /api/sync` computes everything deterministic (scores, zones, PRs, interval match) and writes `today-analysis.json` without a coach note, returning `analysisPending: true`. The client then calls `POST /api/analyze`, which makes the one LLM call and writes the note back (idempotent; `force` regenerates; optional auto-post to Intervals.icu).

**Consequences.** Sync latency is independent of Claude. An LLM failure degrades to "no note yet," not a failed sync. The client owns the follow-up trigger (re-entrancy-guarded in `SyncProvider`). Grep-for-LLM-callers naïvely flags `sync/route.ts` (it only imports the config check). Dev iteration on today's ride = `npm run reset:today` + re-sync.

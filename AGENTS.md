<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Orient first

Read [docs/COMPASS.md](docs/COMPASS.md) before exploring the codebase — it is the single navigation
hub (mental model, task router, file index pointers, traps) and replaces most exploratory file
reads. Hard contracts: [docs/INVARIANTS.md](docs/INVARIANTS.md).

# Recurring bug classes — check before shipping

Three defect shapes have shipped more than once. Check for them explicitly on relevant changes:

- **Migration flags.** Guard a new `fooMigratedAt` field with a truthy check (`if (profile.fooMigratedAt)`), never `=== null`. A JSON file written before the field existed parses back as `undefined`, not `null` — an equality check misses it and the migration silently never runs.
- **"Today" must be local, not UTC.** Use `localToday()` / `resolveToday()` from `lib/date.ts` for anything user-facing (what day is it for the athlete right now). Don't inline `new Date().toISOString().slice(0, 10)` — that's UTC and drifts a day off from the athlete's local date near midnight. (Pure day-math like `addDays`/lookback windows can stay UTC-anchored; the risk is specifically in code answering "what day is it *now* for the user.")
- **LLM-backed paths need one live smoke run.** Unit tests + a green build only prove the deterministic scaffolding around a prompt — they don't exercise the real Anthropic call. Before calling a new or changed AI-generation path "done," run it once against the live API and read the actual output.

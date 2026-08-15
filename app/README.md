# app/ — pages & API routes

Next.js **16** App Router (conventions differ from older Next — check `node_modules/next/dist/docs/` first; note `proxy.ts` at repo root is the renamed middleware, applying the CSRF guard to all of `/api/*`).

- **7 pages** (`today` · `plan` · `trends` · `profile` · `model` · `settings` · `knowledge`): thin server shells delegating to client components — except Profile and Settings, which read stores server-side (`force-dynamic`). Root `page.tsx` redirects to `/today`. Page ↔ component ↔ API map: [docs/systems/08-frontend.md](../docs/systems/08-frontend.md).
- **22 API routes**: full table in [docs/FILE_INDEX.md](../docs/FILE_INDEX.md#appapi--routes). Routes are IO shells — logic belongs in `lib/` ([recipe](../docs/RECIPES.md#add-an-api-route)).
- **The big three**: `api/sync` (the orchestrator — [flow](../docs/systems/01-sync-and-data.md)), `api/generate` (proposal only — [pipeline](../docs/systems/06-generation.md)), `api/write` (the commit).
- **Rules**: block mutations take the CAS guard (`lib/block-version.ts`); errors return `{ error }` + one `lib/log.ts` line; `api/dev/` is development-only (403 otherwise).
- Request-body validation is hand-rolled per route (narrow `unknown` with type guards, 400 with `{ error }`) — there is no shared request validator; zod is used only for LLM output.
- New user-facing surface = a page; new data operation = a route group. Pages never contain business logic — that's `lib/`'s job.

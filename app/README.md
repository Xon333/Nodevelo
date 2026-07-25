# app/ — pages & API routes

Next.js **16** App Router (conventions differ from older Next — check `node_modules/next/dist/docs/` first; note `proxy.ts` at repo root is the renamed middleware, applying the CSRF guard to all of `/api/*`).

- **7 pages** (`today` · `plan` · `trends` · `profile` · `model` · `settings` · `knowledge`): thin server shells delegating to client components — except Profile and Settings, which read stores server-side (`force-dynamic`). Root `page.tsx` redirects to `/today`. Page ↔ component ↔ API map: [docs/systems/frontend.md](../docs/systems/frontend.md).
- **21 API route groups**: full table in [docs/reference/FILE_INDEX.md](../docs/reference/FILE_INDEX.md#appapi--routes). Routes are IO shells — logic belongs in `lib/` ([workflow](../docs/workflows.md#add-an-api-route)).
- **The big three**: `api/sync` (the orchestrator — [flow](../docs/systems/data-and-sync.md)), `api/generate` (proposal only — [pipeline](../docs/systems/generation-pipeline.md)), `api/write` (the commit).
- **Rules**: block mutations take the CAS guard (`lib/block-version.ts`); errors return `{ error }` + one `lib/log.ts` line; `api/dev/` is development-only (403 otherwise).

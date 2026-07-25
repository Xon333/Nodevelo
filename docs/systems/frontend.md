# Frontend

Next.js 16 App Router + React 19 + Tailwind v4. Visual rules live in [DESIGN.md](../../DESIGN.md) (tokens, component vocabulary) under [UX-CONSTITUTION.md](../../UX-CONSTITUTION.md) (decision rules); this doc covers structure and data flow.

## Shape

Pages are thin server shells; almost everything renders client-side from shared state. Only **Profile** and **Settings** read data server-side (`force-dynamic`, since their JSON stores change at runtime). `app/page.tsx` redirects to `/today`. `app/layout.tsx` owns fonts (Chakra Petch UI / JetBrains Mono numerics / Warriot wordmark), the pre-hydration dark-mode script, and the provider stack `QueryProvider > SyncProvider > Nav + SyncNotice + main`.

Navigation (`components/Nav.tsx`): three tiers — primary (Today/Plan/Trends), "You & the coach" (Profile/Model), "System" (Settings/Knowledge); desktop left rail, mobile top bar + bottom tabs (Model reachable only via the top-bar brain icon — mobile restructure deferred). Keyboard: digits 1–7 jump pages, `s` syncs, `?` shows the legend.

## Client state (the important part)

- **`SyncProvider`** is the one long-lived cross-page store: React Query key `['sync']` for `GET /api/sync` (staleTime 30s, refetch on focus/reconnect). `doSync()` POSTs, merges the response into the cache, then **`invalidateQueries(['sync'])`** — the POST response omits `currentBlock`, so a full refetch is required. If `analysisPending`, it auto-triggers `POST /api/analyze` (re-entrancy-guarded against double-billing Claude).
- **Page-local data** uses a deliberate house idiom: `useMountLoad` + `loadFailed` + `LoadFailed` UI (from `ui.tsx`) — *not* `useQuery` — for best-effort feature components (MorningCheckIn, SessionDisposition, RescheduleBanner, LoadingPrompt, SeasonSection). Follow the idiom; the header comments cross-reference each other as precedent.
- **`useQuery` where cache-sharing matters**: `['season', today, seasonVersion]` (PlanView), `['trends', syncedAt]` (deliberately identical in Trends and StandingGuidance so React Query dedupes — UXA-19).
- **Invalidation over optimism**: mutating actions call `invalidateQueries` rather than optimistic merges — an explicit past-bug fix (HR-44/46/59). No polling anywhere.
- Query keys are defined ad hoc at call sites — there is no central key registry; grep before inventing one.

## Naming convention (bimodal, deliberate)

**PascalCase file = single default-export component** (`AthleteStateCard.tsx`). **lowercase file = named-export helper module** (`dashboard/today.tsx`, `trends/sections.tsx`, `athlete-state-ui.tsx`). The lowercase dashboard modules are *not* legacy leftovers — they're the split targets of the old monolith, consumed by `TodayView.tsx` / `PlanView.tsx`.

## Feature ownership

| Feature | Page | Components | API |
|---|---|---|---|
| Morning check-in | Today | `MorningCheckIn` | `/api/morning-check` |
| Ride debrief (reps, trace, PRs, note) | Today | `dashboard/today.tsx` → `TodayRideCard`, `RideTrace` | `/api/sync`, `/api/analyze`, `/api/note` |
| Session disposition | Today | `SessionDisposition` | `/api/disposition` |
| Ask coach (streaming) | Today | `AskCoach` | `/api/ask` |
| Carb-loading prompt | Today | `LoadingPrompt` | `/api/loading` |
| Athlete state | Today + Model | `AthleteStateCard` / `StateDriversCard` (+ shared `athlete-state-ui.tsx`) | `/api/sync` |
| Block generate/preview/accept | Plan | `dashboard/BlockGenerator`, `PlanPreview`, `dashboard/plan.tsx` | `/api/generate`, `/api/write` |
| Block calendar + day moves | Plan | `dashboard/plan.tsx` → `CurrentBlockSection`, `DayAction` | `/api/reschedule` |
| Reschedule banner | Plan | `RescheduleBanner` | `/api/reschedule` |
| Season objective/events/roadmap | Plan | `SeasonSection`, `SeasonRoadmap` (props-only) | `/api/season` |
| Retrospective + history | Plan | `dashboard/plan.tsx` → `RetroSection`, `BlockHistory` | `/api/retrospective`, `/api/history` |
| Trends verdict + charts | Trends | `Trends`, `trends/sections.tsx`, `trends/verdict.tsx`, `Sparkline`, `MultiSparkline` | `/api/trends` |
| Standing guidance / calibration | Model | `StandingGuidance`, `CalibrationPanel` | `/api/trends`, `/api/calibration` |
| Profile dossier + power curve | Profile | `AthleteProfileForm` (712 lines), `PowerCurveChart`, `IfBandOffsets` | `/api/profile`, `/api/knowledge` |
| Generation settings / AI usage / backup | Settings | `BlockSettingsForm`, `PlatformBehaviorForm`, `AiUsageCard` (server-rendered), `BackupRestore` | `/api/settings`, `/api/export`, `/api/import` |
| KB editor | Knowledge | `KnowledgeBaseEditor` (self-contained lifecycle) | `/api/knowledge` |

## Test coverage reality

Component tests exist only around the Plan/generation flow (8 files: PlanPreview, PowerCurveChart, RescheduleBanner, SeasonRoadmap, SyncProvider, BlockGenerator, PlanView, dashboard/plan). Today/Model/Profile/Settings/Knowledge components have none — but their underlying `lib/` logic is thoroughly unit-tested. Component tests use per-file `/** @vitest-environment jsdom */` docblocks (infra added 2026-07-23).

## Big files (split candidates, in order)

`dashboard/today.tsx` (740 — `TodayRideCard` alone ~385), `AthleteProfileForm.tsx` (712, five distinct sections), `dashboard/plan.tsx` (604). Precedent for extraction: `SeasonSection` was already split out of the profile form.

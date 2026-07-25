# components/ — the UI layer

Structure, ownership, and data flow: [docs/systems/08-frontend.md](../docs/systems/08-frontend.md). Visual rules: [DESIGN.md](../DESIGN.md) under [UX-CONSTITUTION.md](../UX-CONSTITUTION.md).

## Orientation

- **Naming is bimodal and deliberate**: PascalCase file = single default-export component; lowercase file = named-export helper module (`dashboard/today.tsx`, `trends/sections.tsx`, `athlete-state-ui.tsx` — not legacy leftovers).
- **App shell**: `Nav`, `QueryProvider`, `SyncProvider` (the one cross-page store), `SyncNotice`.
- **Primitives**: `ui.tsx` — Card, PrimaryButton, StatTile, Skeleton, MetricTip/InfoDot, `useMountLoad`, `LoadFailed`. DESIGN.md §6 sanctions these as the component vocabulary; build with them, not fresh chrome.
- **Page modules**: `dashboard/` (Today + Plan), `trends/`; the rest are single-feature components mapped in [docs/systems/08-frontend.md](../docs/systems/08-frontend.md).

## House rules

- Best-effort feature components use the `useMountLoad` + `loadFailed` idiom (see MorningCheckIn et al.); shared/cache-sensitive data uses `useQuery` with a shared key. Mutations invalidate `['sync']` — no optimistic merges.
- Every surface satisfies dark/light pairing and the UX-Constitution §11 pre-ship checklist.
- Shared styling logic gets one home (`athlete-state-ui.tsx` exists so two cards can't drift).
- Widening a shared primitive (e.g. `ui.tsx`'s `Card` gaining attribute-spreading for one caller) is fine additive/backward-compatible, but it's drift risk for every other consumer — worth a second look if a primitive picks up a second caller-specific reason to widen.
- Component tests: colocated `.test.tsx` with `/** @vitest-environment jsdom */`.

# FR-13 early-end retrospective window acceptance

**Date:** 2026-09-01

**Status:** PASS

**Scope:** the [FR3-01 failure](2026-09-01-fr3-core-journey-audit.md#fr3-01--early-end-narrative-grades-the-unlived-future),
[accepted design](../superpowers/specs/2026-09-01-fr13-early-end-retrospective-window-design.md),
and [implementation plan](../superpowers/plans/2026-09-01-fr13-early-end-retrospective-window.md).

## Isolated live route smoke

The attended smoke started the preview server with scratch copies selected through
`NODEVELO_DATA_DIR` and `NODEVELO_KB_DIR`, with Anthropic configured. An explicitly early-ended
`POST /api/retrospective` returned HTTP 200. The response closeout was exactly **1 planned / 0
scored / 1 missed**; saved history recorded **1 planned hour / 0 actual hours**, archived only the
lived 2026-09-01 day, and carried `promptVersion: 10` with non-degraded AI provenance.

The returned narrative evaluated the effective one-hour window directly:

> FR-13 isolated smoke closed out after a single day with zero hours logged against the one hour
> planned…there's nothing to penalize beyond that opening day.

The response and saved markdown were inspected and scanned explicitly. Neither named or graded
`2026-09-03` or `SIT`, called the result a two-week pause, nor compared actual hours against the
full scheduled block. The real athlete data and knowledge base remained unchanged, and the preview
server was stopped after inspection.

## Automated verification

- Acceptance-run `npm run check`: PASS — 118 test files / 2,510 tests, workflow guards, sync tests,
  and link checks.
- Docs-follow-up `npm run check-links`: PASS — 147 Markdown files, no broken links.
- FR-13 scope and whitespace checks against the accepted FR-3 baseline: PASS.

## Verdict

`PASS` — the live language path, deterministic closeout, and persisted history all used the same
effective early-end window without evaluating the unlived future session.

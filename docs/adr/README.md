# Architecture decision records

Standing decisions extracted from code, commit history, and ARCHIVE closeouts (recorded retrospectively 2026-07-25). Format: context → decision → consequences. New ADRs: next number, same shape, one decision per file. These record *why*; the *how* lives in [../systems/](../START_HERE.md#the-systems-shelf).

| # | Decision |
|---|---|
| [0001](0001-local-first-json-files.md) | Local-first JSON files, no database |
| [0002](0002-deterministic-numbers-llm-phrases.md) | Deterministic numbers; the LLM only arranges and phrases |
| [0003](0003-two-phase-generate-write.md) | Generation proposes; write commits |
| [0004](0004-validators-warn-only.md) | Validators warn — they don't rewrite |
| [0005](0005-deferred-llm-analyze.md) | Fast sync; deferred LLM analysis |
| [0006](0006-effective-dated-physiology.md) | Effective-dated physiology store |
| [0007](0007-append-only-ledger.md) | Append-only execution ledger with provenance stamps |
| [0008](0008-prompt-caching-and-forced-tools.md) | Prompt-cache split + forced tool use |
| [0009](0009-flat-lib-colocated-tests.md) | Flat `lib/` with colocated tests |
| [0010](0010-calibration-precedence.md) | Calibration precedence: override > derived > default |

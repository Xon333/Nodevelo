# ADR-0010 · Calibration precedence: override > derived > default

**Context.** Sports-science constants (ACWR bands, TSB edges, decoupling cutoffs, carb optima) are population averages. Personalizing them from the athlete's own data is the app's keystone — but a naive fit calibrates to habit ("you always fail threshold at TSB −20, so −20 must be fine") or to noise.

**Decision.** One precedence rule, implemented once (`calibration.trustedCalibration`): **manual override** (athlete says so) beats **derived** (only when the ledger honestly *discriminates* — the derived edge must separate failures from successes by a margin, via `correlation.ts`'s guarded derivers) beats **population default**. Non-discriminating signals fall back to the default rather than pretending. Import direction is one-way: calibration consumes correlation, never the reverse.

**Consequences.** Every calibrated parameter carries confidence/provenance and is contestable in the UI (`CalibrationPanel`). New "magic numbers" should enter as calibratable parameters through this path, not as fresh literals. The derivations re-run on each sync from the frozen ledger ([ADR-0007](0007-append-only-ledger.md)), so they're reproducible.

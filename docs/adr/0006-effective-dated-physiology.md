# ADR-0006 · Effective-dated physiology store

**Context.** FTP and zones change over a season. Scoring a June ride against September's FTP silently rewrites history; so does re-deriving old scores after a zone update.

**Decision.** `lib/physiology.ts` keeps an effective-dated history (`data/physiology.json`), reconciled from Intervals.icu sport settings on each sync. Consumers resolve values *as of a date* (`physiologyAsOf`); the ledger additionally freezes `ftpUsed` onto each entry at scoring time.

**Consequences.** Past rides stay judged by the rules that were live then — the ledger's immutability ([ADR-0007](0007-append-only-ledger.md)) is meaningful because its inputs are pinned too. `physiology.json` is the FTP/zones source of truth; `athlete.json`'s performance numbers are an overlay at read time, and the KB markdown is prose, not the source.

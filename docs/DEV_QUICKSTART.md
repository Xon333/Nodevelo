# Dev quickstart — how to actually use these docs while coding

One rule: **before you touch code, answer "what am I doing?" below, open the ONE doc it points to, then start.** Don't browse. Don't read linearly. Don't open five tabs "just in case."

## The lookup table

| What you're about to do | Open exactly this | Then |
|---|---|---|
| Fix a bug in a system you sort of know | `docs/systems/<that-system>.md` (list: [START_HERE](START_HERE.md#the-systems-shelf)) | Ctrl+F the function name in [FILE_INDEX](reference/FILE_INDEX.md) to find the file |
| "Where does X live? Who calls it?" | [reference/FILE_INDEX.md](reference/FILE_INDEX.md), Ctrl+F | Nothing else — it names the file and its importers |
| Add a page / route / validator / test / etc. | [workflows.md](workflows.md), find the matching recipe | Follow it top to bottom, don't improvise the order |
| You're about to touch persistence, dates, the ledger, calibration, or a prompt | [reference/INVARIANTS.md](reference/INVARIANTS.md), scan the numbered list | If your change fights one of the 30, stop and re-read the ADR it links to before proceeding |
| Lost context after an interruption / new session | [ATLAS.md](ATLAS.md) — just the "one-paragraph mental model" + "three loops" (30 seconds) | Back to what you were doing |
| A term in code/comments you don't recognize | [GLOSSARY.md](GLOSSARY.md), Ctrl+F | — |
| Debugging a bad AI-generated block or note | [systems/ai-layer.md § Debugging](systems/ai-layer.md#debugging-a-bad-generation) | — |
| Finished a change, don't know what to update | [START_HERE.md § Ownership rules](START_HERE.md#ownership-rules-who-documents-what) | One doc, not three |

That's it. Eight rows. If your situation isn't one of them, it's [START_HERE.md](START_HERE.md) — it's a router, not a read.

## Session-open ritual (30 seconds, every session)

1. `git log --oneline -5` — what happened since you last looked.
2. `git status --short` — is there uncommitted WIP (yours or the other concurrent session's)?
3. Only if you don't already know where you're going: [ATLAS.md](ATLAS.md)'s mental model + three loops.

Do not open README.md top-to-bottom "to refresh." It's a reference manual, not a warm-up read.

## Red flags — stop and check INVARIANTS before editing

- Anything in `lib/types.ts` (999 lines, 54 importers — the whole app moves when this moves)
- Anything under `data/` shape or a new persisted field
- `score-log.ts` / the ledger — past entries are frozen, never retro-score
- Anything in `anthropic-prompts.ts` or the three protocol-band copies (KB / prompt / validator)
- A new migration flag — truthy check, not `=== null`
- Anything computing "today" for the athlete — must be `lib/date.ts`, never inline UTC

If none of these apply, you don't need to stop for anything — just code.

## Mid-session, stuck >10 minutes

That's the signal to open a doc, not grep harder. In order of cheapness:
1. [GLOSSARY.md](GLOSSARY.md) — is this a naming trap? (`trace.ts`, `loading.ts`, model-vs-state, durability-vs-score are the repeat offenders)
2. [FILE_INDEX.md](reference/FILE_INDEX.md) — who else touches this file?
3. The relevant `docs/systems/*.md` — the diagram usually shows the step you're missing.
4. [adr/](adr/README.md) — is this "weird" thing actually a deliberate, documented decision?

## End-of-session: one doc, decided by what changed

| You changed... | Update... |
|---|---|
| A capability the athlete can see | [FEATURES.md](../FEATURES.md) |
| Nothing shipped yet, still open | [ROADMAP.md](../ROADMAP.md) (append, never renumber) |
| Something shipped | Move its line to [ARCHIVE.md](../ARCHIVE.md) |
| A quick bug/feedback item | [todo.md](../todo.md) |
| How a subsystem works, mechanically | its `docs/systems/*.md` |
| A new file/route/prompt call site | [FILE_INDEX.md](reference/FILE_INDEX.md) / [PROMPT_INDEX.md](reference/PROMPT_INDEX.md) |

Never CONTINUE.md (that's `/handoff`'s job) and never `docs/superpowers/plans/*` (immutable).

## Pin these three tabs, nothing else

[ATLAS.md](ATLAS.md) · [reference/FILE_INDEX.md](reference/FILE_INDEX.md) · [reference/INVARIANTS.md](reference/INVARIANTS.md)

Everything else in `docs/` is a lookup, not a read.

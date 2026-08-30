# knowledge-base-defaults

The committed **skeleton** of the athlete's editable reference notes — **not** generation authority
or real coaching content.

- Your actual knowledge base lives in `/knowledge-base/` (gitignored, local, personal). The loader
  (`lib/kb-loader.ts`) reads each file from there if present and **falls back to the matching default
  here** otherwise — so a fresh clone / CI and the Knowledge editor run without hard-failing.
- These stubs are intentionally thin. Drop
  your own `cycling_database.md` / `training_knowledge.md` / `nutrition_knowledge.md` /
  `athlete_profile.md` into `/knowledge-base/` and they override these per-file.
- Editing a file in the in-app Knowledge editor writes a local override into `/knowledge-base/`; this
  directory is never written to at runtime.

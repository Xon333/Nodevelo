# Domain documentation

NodeVelo already has one domain model and one decision log:

- Use [`docs/GLOSSARY.md`](../GLOSSARY.md) for canonical terms.
- Use [`docs/DECISIONS.md`](../DECISIONS.md) for architecture and product decisions.

Generic skills may call these files `CONTEXT.md` and `docs/adr/`. In this repository those names map
to the files above. Update the glossary when terminology changes and append a dated ADR section to
the decision log when a hard-to-reverse trade-off is accepted. Do not create parallel domain files.

Surface conflicts with an existing term or decision before changing code or documentation.

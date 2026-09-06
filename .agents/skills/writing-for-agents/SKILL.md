---
name: writing-for-agents
description: Write repository instructions and agent-facing documentation with clear scope and contextual references.
---

# Writing for Agents

Keep instructions that change decisions: project contracts, non-obvious risks, authorization boundaries, and contextual pointers. Remove generic coaching, incident narratives that repeat a rule, and procedures already owned by a script or another document.

State when a linked document is relevant. Read requirements in the affected area; avoid routing every small edit through a full repository tour. Put shared rules in one owner and mode-specific examples behind references. Preserve links when moving content.

Describe the intended outcome and what completion means. Allow routine choices within the user's scope. Require input for material unresolved decisions or actions beyond authorization, not for each implementation step. Scale plans, reviews, and verification to the actual change.

In NodeVelo, AGENTS.md owns operating rules and CLAUDE.md imports it. Compass owns navigation; subsystem docs own behavior; GLOSSARY and DECISIONS own terminology and decisions. Edit canonical skills in `.agents/skills/`, not compatibility symlinks.

For skill packaging and validation, use skill-creator when available; [SKILL-MECHANICS.md](SKILL-MECHANICS.md) records compatibility details. Preserve invocation policy unless the user requests a change.

Verify modified instructions against realistic requests: a routine edit should proceed, a meaningful ambiguity should surface, and a protected action should retain its boundary. Check changed references and report the actual validation performed.

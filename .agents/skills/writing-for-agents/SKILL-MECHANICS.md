# Skill mechanics

Use skill-creator, when available, for the target environment's current frontmatter, metadata, and validation rules. Keep descriptions concise and specific. SKILL.md holds essential routing and constraints; supporting files hold conditional detail.

Preserve existing invocation policy unless the user requests a change. Claude's `disable-model-invocation` frontmatter and Codex's `agents/openai.yaml` invocation policy are environment-specific; do not assume one controls the other. Verify the target environment's documentation before changing either.

A router is useful when it helps select among distinct workflows. Link only the references needed for the selected workflow rather than loading every guide.

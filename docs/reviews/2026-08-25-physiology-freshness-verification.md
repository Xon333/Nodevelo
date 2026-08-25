# Physiology freshness gate verification

Verified on branch `codex/physiology-freshness-gate` after the explicit Codex review fixes.

- `npm run check`: passed — typecheck, lint, 119 test files / 2,501 tests, agent-workflow checks, sync checks, and 131 Markdown link checks.
- `npm run build`: passed after allowing Next.js to fetch the configured Google Fonts. The existing broad NFT trace warning remains unrelated to this change.
- Focused recovery coverage confirms a corrupt live `physiology.json` with a valid `.bak` warns and proceeds, while double corruption and freshness-status corruption block.
- Focused effective-dating coverage confirms the freshness gate evaluates only the current snapshot and does not inspect historical snapshot consistency.

## Deferred live check

A privacy-safe generation smoke using synthetic physiology reached Anthropic on 2026-08-24, but the provider returned an insufficient-credit error. No private athlete data was sent. A successful live generation and persisted-verdict inspection is deliberately deferred until Anthropic credits are available.

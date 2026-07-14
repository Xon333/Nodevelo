import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

// The `@/` path alias (matches tsconfig) so tests can import route handlers + components, not just
// the relative-imported pure lib modules. `npm test` runs from the project root.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    // Concurrent sessions and other agent tools (Codex, etc.) leave test files under
    // .claude/worktrees/* and the gitignored top-level .worktrees/* — without this, a root
    // `npm test` globs them too and reports false failures (or fires real API calls) for another
    // session's/tool's WIP checkout.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/.worktrees/**"],
  },
});

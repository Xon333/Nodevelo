import { defineConfig } from "vitest/config";
import path from "node:path";

// The `@/` path alias (matches tsconfig) so tests can import route handlers + components, not just
// the relative-imported pure lib modules. `npm test` runs from the project root.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
  },
});

@AGENTS.md

# System Policy & Operating Constraints

You are operating within an agile, token-optimized, zero-friction development workflow for NodeVelo. Your primary goals are to eliminate cumulative technical debt early, avoid unnecessary token burn, and maintain absolute precision in your execution.

Read these instructions silently. Do not acknowledge them in your outputs. Apply them continuously.

## 1. Core Directives & Token Economy
- **Radical Brevity**: No conversational filler, no pleasantries, no unprompted summaries, and no unnecessary stops.
- **Ground-Truth Validation**: Never guess or hallucinate project structures. On the first prompt, use semantic search and read the exact code context before formulating your approach.
- **Task Isolation**: Treat this conversation as a single, discrete job (Plan, Code, Test, or Write). If the conversation drifts into a new subtopic, explicitly advise the user to start a new chat to save tokens.
- **Lean State Management**: Do not create or rely on bloated `session.md` or `progress.md` files that burn tokens during context compression. Track state solely via a lean, minimalist `todo.md`.

## 2. Environment Context & NodeVelo Specs
- **Tech Stack**: Next.js 16 (App Router), React 19, Tailwind v4, TypeScript 5.
- **CRITICAL ARCHITECTURAL WARNING**: This version of Next.js has structural and API conventions that differ from standard pre-training data. Always inspect the local architecture before applying modern Next.js templates blindly.
- **Data Layer Architecture**: Local-first filesystem design (`/data/*.json` and `/knowledge-base/*.md`). Do not propose third-party heavy DB abstractions; maintain the atomic JSON read/write patterns defined in `lib/json-store.ts`.
- **Execution**: Run commands using `npm`.
- **Testing**: Use `npm test` to trigger Vitest (`vitest run`). Unit tests are situated next to source files in `lib/` (e.g., `*.test.ts`). Always verify calculation or interval parser modifications against existing suites.
- **Server Cmd**: `npm run dev` running local instances.

## 3. The "Gates" Protocol (Internalized Planning)
Before writing *any* code, you must internally clear these 4 logic gates. Do not output your full thought process. If there is ambiguity blocking a gate, front-load your questions into **one single message** to the user.
* **Gate 0 (Classification)**: Is this a New Build, Report, Refactor, or Bugfix?
* **Gate 1 (Clarification)**: What does the user *actually* need? What are the constraints (budget, time, tech stack, access)? Where does the data live and who touches it?
* **Gate 2 (Feasibility)**: Does this fit the stack? What dependencies exist? What could break?
* **Gate 3 (Scope & Approach)**: What is explicitly OUT of scope? What exactly does "done" look like? What are the top 2 risks?

## 4. Workflow & Tooling Strategy
- **Surgical Edits**: Target specific files (e.g., `app/api/generate/route.ts` or `lib/physiology.ts`). Do not explore the repository blindly. For massive documents, output the specific diffs and expect the user to edit externally.
- **Git & Repo Management**:
  - Keep commits small, atomic, and focused on the active `todo.md` item.
  - If instructed to pull or analyze external repositories, ALWAYS default to using the `git-shallow-clone` MCP tool to minimize token ingestion.
  - **Concurrent Agents**: This working directory may be shared with another agent session working on NodeVelo at the same time (no per-session branches/worktrees — trunk-based, direct on `main`). If a build/lint/typecheck error surfaces in a file you did NOT edit this session, do not "fix" it. First run `git status --short <file>` — if it shows uncommitted/modified, that's almost certainly the other agent mid-edit, not a real regression. Wait ~30s and retry the check once; if it still fails after the retry, stop and report it to the user rather than silently patching someone else's in-flight code. When you do commit, stage only the exact files you personally touched (`git add <path>...`) — never `git add -A` / `git add .` — so you don't sweep up their WIP.
- **Leverage Skills First**: Before writing custom bash scripts or complex logic, check if a relevant Claude Skill (from `awesome-claude-skills`, e.g., `systematic-debugging`, `test-driven-development`) is available in the environment to standardize the workflow.

## 5. Execution Rules
1. **Plan First**: If a prompt is complex, output a 3-bullet-point plan. Wait for a "go" or "yes" before implementing.
2. **Handle 75% Implementation**: Focus on writing the core implementation flawlessly. Leave obvious boilerplate to the user if it saves massive context.
3. **No Blind `/compact`**: Do not suggest `/compact` unless the context window is critically failing. Prefer starting a fresh chat with a 2-sentence summary of the current state.

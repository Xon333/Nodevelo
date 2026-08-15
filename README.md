# NodeVelo

**A personal cycling coach that learns from how you actually train.** NodeVelo sits on top of
[Intervals.icu](https://intervals.icu): it pulls your physiology and ride history, scores every
session against what was prescribed, learns your strengths and weak points, and generates the next
structured training block with Claude — then writes it back to your Intervals.icu calendar.

Intervals.icu stays the **system of record** for day-to-day training. NodeVelo is the **thinking
layer on top**: it decides *what to do next* and explains *how you executed* — the judgement a
coach adds that a data platform doesn't.

> **Lost? Open [docs/COMPASS.md](docs/COMPASS.md).** It's the single navigation hub — a task
> router ("I need to…" → the one place to go), the mental model, and every doc one click away.
> This README is the landing page; the Compass is the map.

## The core idea

Five design decisions define the whole app — everything else follows from them:

1. **A layer, not a replacement.** NodeVelo never re-skins Intervals.icu's charts. It adds the
   coaching judgement on top — analysis, learning, generation — and defers to Intervals.icu as the
   source of truth for physiology.
2. **Deterministic core, generative shell.** All the math — scoring, zones, load, nutrition,
   readiness — is plain, unit-tested TypeScript. The LLM only does language: it phrases plans and
   analysis from numbers the code already computed. **The AI never owns arithmetic or physiological
   limits**, so it cannot hallucinate your FTP or invent a calorie target.
3. **Two kinds of memory, treated oppositely.** *Owned intent* (goals, weak points, notes — what
   only you know) is hand-written and never recomputed. *Synced physiology* (FTP, zones, weight,
   fitness — what Intervals.icu measures) is a one-way pull and never hand-edited. Conflating the
   two is the classic coaching-app bug; here the split is enforced structurally.
4. **An immutable execution ledger.** Every ride is scored once, against the FTP that was live that
   day, then frozen. The coach learns from this append-only history (recency-weighted), so trends
   reflect *real adaptation* — not a moving FTP denominator quietly rewriting the past.
5. **Local-first, single-user.** Persistence is plain JSON (`data/`) and markdown
   (`knowledge-base/`) on your machine — the filesystem *is* the database. No accounts, no cloud DB,
   no multi-tenant surface. A deliberate constraint, not a missing feature.

The full rationale behind these (and five more standing decisions) lives in
[docs/DECISIONS.md](docs/DECISIONS.md).

## How it works — one loop

**Rides sync in → every ride is scored into an immutable ledger → the ledger teaches a per-athlete model → the season engine picks the next focus → Claude writes the training block (the plan) inside hard numeric constraints → validators check it → you accept → calendar events land on Intervals.icu → repeat.** The canonical diagram of this loop lives at the top of [docs/COMPASS.md](docs/COMPASS.md#the-mental-model-60-seconds).

Each stage is one numbered doc in [docs/systems/](docs/systems/) — read them in order
(`01-sync-and-data` → `06-generation`, plus cross-cutting `07-ai-layer` and `08-frontend`) and you
have the whole architecture. Every doc opens with *why the system exists* before *how it works*.

## The repository in seven lines

| | |
|---|---|
| `lib/` | The brain: 83 flat engine modules, every number computed here, tests colocated |
| `app/` | 7 thin pages + 22 API routes (IO shells over `lib/`) |
| `components/` | The UI (design system: [DESIGN.md](DESIGN.md), governed by [UX-CONSTITUTION.md](UX-CONSTITUTION.md)) |
| `data/` | The database — JSON files, gitignored, atomic writes + backups |
| `knowledge-base/` | Your coaching corpus (gitignored; committed skeleton in `knowledge-base-defaults/`) |
| `docs/` | The knowledge system — start at [COMPASS.md](docs/COMPASS.md) |
| `proxy.ts` | Next 16 middleware: CSRF guard on every `/api/*` route |

Each of the four code/data folders has its own `README.md` stating what it is and the rules that apply inside it.

## Setup

```bash
cp .env.local.example .env.local   # fill in the three keys below
npm install
npm run dev                        # http://localhost:3000  (redirects to /today)
```

| Variable | Source |
|---|---|
| `INTERVALS_API_KEY` | Intervals.icu → Settings → Developer |
| `INTERVALS_ATHLETE_ID` | Your athlete id, format `i12345` (visible in Intervals.icu URLs) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |

> **Local-first by design.** The filesystem is the database — this will **not** run on an
> ephemeral serverless filesystem (e.g. Vercel). Run it locally.

> **Bound to localhost — there is no auth.** Routes spend Anthropic credits (`/api/generate`) and
> can overwrite your data (`/api/import`) or your Intervals.icu calendar (`/api/write`); on an open
> network any device could drive them with `curl`. `npm run dev:lan` opts into LAN access — only on
> a network you trust.

> **Stack note.** Next.js 16 (App Router) / React 19 / TypeScript / Tailwind v4 — conventions
> differ from older Next.js. See [AGENTS.md](AGENTS.md) and the bundled guides in
> `node_modules/next/dist/docs/` before changing routing or server/client boundaries.

## Development

```bash
npm run check     # tsc + lint + vitest — the verification loop
```

Full command table (dev servers, reset, skills): [WORKFLOW.md](WORKFLOW.md).

Making a change? [docs/RECIPES.md](docs/RECIPES.md) has the exact steps per change type.
Touching persistence, prompts, dates, or the ledger? Scan
[docs/INVARIANTS.md](docs/INVARIANTS.md) first.

## Where to next

| You are… | Go to |
|---|---|
| New here, want the full picture | [docs/COMPASS.md](docs/COMPASS.md) → the numbered [docs/systems/](docs/systems/) in order (~30 min) |
| Here to change something | [docs/COMPASS.md](docs/COMPASS.md) "I need to…" table |
| Running it day-to-day | [WORKFLOW.md](WORKFLOW.md) — commands, skills, runbooks |
| An AI coding agent | [AGENTS.md](AGENTS.md), then [docs/COMPASS.md](docs/COMPASS.md) |

Capabilities live in [FEATURES.md](FEATURES.md), the forward backlog in [ROADMAP.md](ROADMAP.md), shipped history in [ARCHIVE.md](ARCHIVE.md), live bugs in [todo.md](todo.md).

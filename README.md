# Cycling Training Brain

Personal, single-user training app: an AI brain on top of [Intervals.icu](https://intervals.icu).
It reads your athlete data, generates structured training blocks with `claude-sonnet-4-6`
using a local markdown knowledge base, and writes the finished plan back to your
Intervals.icu calendar. All day-to-day training management stays in Intervals.icu —
this app only generates and writes plans.

## Setup

```bash
cp .env.local.example .env.local   # fill in your three keys
npm install
npm run dev                        # http://localhost:3000
```

| Variable | Where to get it |
|---|---|
| `INTERVALS_API_KEY` | Intervals.icu → Settings → Developer |
| `INTERVALS_ATHLETE_ID` | Your athlete id, format `i12345` (visible in Intervals.icu URLs) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |

> **Local-first by design.** Athlete profile, sync cache and the knowledge base are
> plain files under `/data` and `/knowledge-base`. This does not work on Vercel's
> ephemeral serverless filesystem — run it locally (`npm run dev` or `npm run build && npm start`).

## Workflow

1. **Sync** (dashboard) — pulls 8 weeks of activities, wellness, fitness (CTL/ATL/TSB)
   and your power curve into `data/last-sync.json`. Auto-syncs on open if older than 24 h.
2. **Set up the block** — length (2/4 weeks), start date, goal, weakpoints
   (pre-filled from your profile).
3. **Generate** — assembles the knowledge base + your current data + a deterministic
   nutrition reference table into a prompt and asks `claude-sonnet-4-6` for the block.
4. **Preview & confirm** — every day is shown as a card (workout steps + nutrition).
   Nothing is written until you click **Write to Intervals.icu**.
5. **Write** — each day is POSTed as a planned event (structured workout syntax in the
   description, rest days as calendar notes). The block becomes the active block.

## Pages

- `/dashboard` — sync bar, active block calendar, block generation, plan preview, recent stats
- `/profile` — performance numbers, goals, weakpoints, nutrition formula settings.
  Saving updates `data/athlete.json` **and** regenerates `knowledge-base/athlete_profile.md`.
- `/knowledge` — edit the knowledge base `.md` files in place (no create/delete).
  Edits apply to the very next generation.

## Nutrition is code, not AI

`lib/nutrition.ts` deterministically computes daily kcal targets
(base + session kJ + buffer; flat target on rest days), pre/in/post-ride carbs and
protein. The buffer self-adjusts ±150 kcal against your 7-day weight trend (capped
0–600). The AI receives these numbers as a reference table and only phrases them in
natural language — it never calculates nutrition.

## Development

```bash
npm test       # vitest — nutrition formula + plan parser (30 tests)
npm run lint
npm run build
```

Key modules: `lib/intervals-api.ts` (API client), `lib/anthropic-api.ts` (prompt
assembly, always `claude-sonnet-4-6`), `lib/plan-parser.ts` (AI output → structured
days → Intervals.icu events), `lib/kb-loader.ts` (knowledge base), `lib/nutrition.ts`
(deterministic formula).

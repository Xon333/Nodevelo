# Reliable Long Blocks and Season Clarity — Design

**Date:** 2026-07-13
**Status:** Approved for planning

## Goal

Make six- and eight-week block generation reliable, keep the generator form readable at every desktop width, and explain why a season roadmap is shown and when it changes.

## Decisions

### Long block generation

The Anthropic output allowance will scale with `BlockParams.lengthWeeks` rather than using one 8,000-token ceiling for every request. Four weeks retains the current allowance; six and eight weeks receive progressively larger allowances that cover their 42 and 56 structured daily entries. The route will surface a specific retryable message when the model reaches its output limit before returning a valid structured plan.

The generation client will return the provider stop reason alongside the structured payload. The route will use it only to distinguish truncation from other malformed-output failures. This is deliberately narrow: it does not change the prompt, model, schedule validation, or generation cache key.

### Responsive generator form

The form stays two columns from the small breakpoint through ordinary laptop widths and becomes four columns only at the extra-large breakpoint. This accounts for the fixed desktop navigation rail reducing the effective content width. No control dimensions or field order change.

### Season clarity

The existing season algorithm remains unchanged. The roadmap will identify an auto-drafted arc and explain its inputs: saved objective/events, current fitness/load, and the detected limiter. It will say that a successful block generation refreshes the derived roadmap. An athlete-created objective/event remains editable in the existing Season card.

## Data flow

```text
lengthWeeks → output-token allowance → Anthropic response stop reason
                                      ↓
                              precise API/UI error

profile + sync + season inputs → existing replanSeasonArc → season-plan.json
                                                        ↓
                                              SeasonRoadmap explanation
```

## Testing

- Unit-test token allowance selection for 2, 4, 6, and 8 weeks.
- Unit-test the route's distinct truncated-response error.
- Add a component-level regression check for the generator breakpoint class.
- Run the focused route, season, and component tests, then typecheck, lint, and the full suite.
- Run one live six-week generation and inspect the returned 42-day plan before declaring the LLM-backed path complete.

## Scope exclusions

- No season-periodization algorithm changes.
- No automatic write of a generated block to the calendar.
- No change to supported block lengths.

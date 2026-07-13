# Align App Agent Handoff

## Goal Health Model (rewritten 2026-07)

Goal health was fully rewritten from the old multi-dimension blend (structure /
consistency / throughput / recency + weakest-link pull + multiplicative overdue
penalty + new-goal grace) because it swung wildly on sparse goals — completing
one task jumped a goal 74→99, deleting an overdue task jumped 43→60.

The new model (`computeHealth` in `src/App.tsx`) is **"how active am I with this
goal"**: an event-based, time-decaying point tally, clamped 0–100, returned 0–1.
Every event contributes points that decay from their own date; the half-life is
set by horizon (short 14d / ongoing 30d / long 60d), so neglect bleeds the score
down and any single edit only nudges it.

- **Build-out** (adding items): sub-goal +10, habit +7, task +5 — decays from
  each item's `created_at`. No cap.
- **Completion**: sub-goal +40, habit-day +7, task +13 (late task +5) — decays
  from completion date. Worth more than build-out.
- **Missed/skipped habit day**: −7 each, decaying.
- **Open overdue task**: −10 scaled by lateness, present drag (no decay).
- Gentle ±15%·focusStrength priority nudge at the end.

Weights live at the top of `computeHealth` and are meant to be tuned.

`computeHabitConsistency` and `applyNewGoalGrace` were removed (orphaned).
NOTE: a server-side `goal_health` Supabase view still uses the OLD formula, but
`geminiAdvisor.ts` overrides those numbers with the client-computed ones before
the coach sees them, so the view is stale-but-unused. Consider updating/dropping
it as cleanup.

### DB change (applied to prod)

Added `public.habits.created_at bigint` (migration `add_habits_created_at`),
backfilled all existing rows to the migration timestamp (a clean "reset the
build-out clock today"), with a `now()`-ms default for future inserts. Both add
flows and the row mappers in `src/App.tsx` now set/read `createdAt`.

Primary files:

- `src/App.tsx`, `src/data.ts`, `src/App.health.test.ts`, `supabase/schema.sql`

## Verification

Use a Node version compatible with the project lockfile. The bundled Codex runtime worked:

```bash
env PATH=/Users/patrickbarfoot/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- --run
env PATH=/Users/patrickbarfoot/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
```

Verified results before this handoff:

- `npm test -- --run`: 4 tests passed.
- `npm run build`: passed.

## Supabase Notes

Supabase project discovered during debugging:

- Project name: `Align`
- Project ref: `hossofghephkcncecesp`
- Relevant tables: `public.goals`, `public.habits`

Observed live data had at least one task row with `completions: {}` while most rows had `completions: []`. The code fix normalizes this locally; no live data migration has been applied.

## Cleanup Notes

`node_modules/`, `dist/`, `*.tsbuildinfo`, and `.npm-cache/` are generated and should not be committed.

## Remaining Choices

- Decide whether to commit and push these local changes to `pbarfoo/Align_App`.
- Decide whether to add a Supabase data cleanup migration/query to convert non-array `habits.completions` values to `[]`.
- If UX still feels off, tune `computeOngoingHealth` weights rather than changing completion persistence again.

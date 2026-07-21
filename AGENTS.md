# Align App Agent Handoff

## Sprint Focus (single chosen goal, 2026-07)

The user can nominate **one** goal as the current "sprint focus". It is a pure
selection + surfacing feature — it deliberately does NOT touch the health or
coach math (that stays driven by the per-domain priority taper `focusStrength`,
which is a separate concept).

- **Data**: `Goal.sprintFocusAt?: number` (`src/data.ts`) — unix ms when chosen;
  `undefined` = not the focus. Persisted as `goals.sprint_focus_at bigint`
  (nullable, migration `add_goals_sprint_focus_at`, applied to prod). Round-trips
  through `goalToRow`/`goalFromRow`.
- **Single-select**: `applySprintFocus(goals, id, now?)` in `src/App.tsx` returns
  the goals with `id` stamped and every other goal cleared; re-selecting the
  current focus toggles it off. Enforced client-side (not the DB) so the upsert
  sync carries the whole cleared set back. Wired via `setSprintFocus` in the
  Align tab's `GoalManager`. Tests: `src/App.sprintFocus.test.ts`.
- **UI**: a target (◎) button in every goal card's controls (`node-focus`) —
  both top-level goals and sub-goals (sub-goals thread the props through
  `ShortWithActions`). The chosen goal gets an accent frame (`.sprint-focus`) +
  inline "Sprint focus" pill. The Today tab shows a `sprint-focus-banner` above
  the coach card with the goal title, its domain, and its health chip, and below
  that lists the goal's whole to-do: every habit plus still-open task in the focus
  goal's **subtree** (walk `sprintFocusGoalIds` = itself + descendant sub-goals,
  so a top-level focus pulls in its sub-goals' items). Rows reuse Today's
  `renderRow`. Styles in `src/styles.css` under the `.node-sun.on` block.
- **AI ideas**: the banner has an on-demand "✦ Get ideas for this sprint" panel.
  `getSprintFocusIdeas` (`src/geminiAdvisor.ts`) prompts Gemini (via the same
  `gemini-proxy` edge function the coach uses) with the focus goal, its
  sub-goals, its tasks/habits, and the value/vision it serves, and returns a
  `SprintAdvice` = `{ perspective, ideas[] }`. Fetched on click, cached per goal
  per day in localStorage (`gemini-sprint-v1-<goalId>-<date>`), with a Refresh
  (bust) button. State in Today is tagged with the goal id so switching focus
  drops stale advice. No auto-fetch (unlike the coach card) — one deliberate tap.

## Value Alignment Model (decoupled from goal health, 2026-07)

`valueAlignmentScore` (`src/App.tsx`) was rewritten to be **separate** from goal
health. It used to be a flat 50/50 blend of reflection + goal health, so tuning
goal health silently moved alignment. It's now **reflection-first**: a weighted
average of up to four 0–1 elements, only the ones with data participating
(weights **renormalise** over what's present, so relative dominance holds):

- **Reflection 0.55** — decayed weekly self-rating (`decayedAvg/3`). The anchor.
- **Lived actions 0.25** — its OWN saturating, ~4-week-decay tally of completions
  on tagged goals (sub-goal 3 > task 1 ≈ habit-day 1; skips subtract). NOT
  `computeHealth`.
- **Goal health 0.12** — avg `computeHealth` across tagged goals (graced=false).
  Deliberately a small voice, so goal-health tuning barely moves alignment.
- **Consistency 0.08** — habit-days kept vs skipped on tagged habits, 28d window.

Key rules:
- **Behaviour confidence ramp**: the three behavioural elements' weights are
  scaled by `confidence` ρ = evidence / (evidence + `VA_CONFIDENCE_K`), where
  evidence counts judgeable signals (completed sub-goals/tasks, overdue tasks,
  matured/skipped habits — via the shared maturity gates `taskCountsInPace`
  /`habitCountsYet`). So they ramp in smoothly instead of snapping on: a
  brand-new empty goal has ρ≈0 (adding structure never drags alignment down),
  one overdue task is small evidence (gentle dip), an established value
  saturates ρ→1 (full behavioural weight). This replaced an earlier hard
  `anyBehaviour` gate that caused an N/A→0 cliff (~2.6-pt drop on one overdue
  task; now ~0.8).
- **No-reflection cap 0.7**: with zero reflections, behaviour alone can't read as
  fully aligned.
- Weights/constants (`VA_WEIGHTS`, `VA_NO_REFLECTION_CAP`, `VA_ACTION_K`,
  `VA_CONFIDENCE_K`, `VA_ACT`, `VA_HALF_LIFE_DAYS`, `VA_WINDOW_DAYS`) live above
  the function, meant to be tuned. Tests: `src/App.alignment.test.ts`.

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

- **Build-out** (adding items): sub-goal +10, habit +4, task +2 — decays from
  each item's `created_at`. No cap. Tasks/habits are deliberately light so
  health is driven mostly by sub-goals (real milestones).
- **Completion**: sub-goal +40, habit-day +4, task +6 (late task +3) — decays
  from completion date. Worth more than build-out.
- **Missed/skipped habit day**: −1 each, decaying (softened from −7, 2026-07:
  missing already forfeits the day's +4, so the felt cost is ~5).
- **Open overdue task**: −10 scaled by lateness, present drag (no decay).
- Gentle ±15%·focusStrength priority nudge at the end.
- Only EXPLICIT skips (`skippedDates`) are penalised, not auto-detected pending
  grace days — clicking the red skip pill is what applies the ding.

Weights live at the top of `computeHealth` and are meant to be tuned.

`computeHabitConsistency` and `applyNewGoalGrace` were removed. New goals start
at 50 via a **birth credit**: `computeHealth`'s optional `goalCreatedAt` adds
`50 * decay(goalCreatedAt)` to the tally, so a goal is 50 the moment it's
created and — left alone — fades from there through the SAME decay as everything
else (no special glide). Build-out/completions add on top. The wrappers pass
`goalCreatedAt` only when `graced` (default true); value-alignment passes
`graced=false` so a brand-new empty goal scores its true 0 there.
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

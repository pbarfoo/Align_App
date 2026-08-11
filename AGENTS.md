# Align App Agent Handoff

## Deleting never lowers health (2026-08)

Health is a tally over the items a goal currently holds, so deleting one erased
its credit retroactively: removing a finished task or a completed sub-goal made
it look like the work had never happened and the score fell. That punishes
tidying up — the opposite of what the model is for.

Fix: at delete time, measure what the goal's **earned** ledger just lost and
bank it as a dated credit on the surviving goal (`Goal.retainedCredits`).
Because the credit decays from the deletion date at the same half-life the
deleted items were on, health isn't merely pinned at the click — it follows the
**exact curve it would have followed had the items stayed**. Deleted work fades
out naturally, as all activity does; it's never revoked.

- `earnedLedger(subGoals, treeHabits, now, halfLife)` — the build-out /
  completion / miss / overdue tally, split out of `computeHealth` so the delete
  path can measure the same number. `computeHealth` now = `earnedLedger` +
  retained credits (earned, so `earnedScale` applies) + the fixed credits
  (birth, sprint) that survive a delete anyway.
- `retainHealthOnDelete(prevGoals, prevHabits, nextGoals, nextHabits, ref, now)`
  diffs `goalEarnedNet` per surviving goal and banks the shortfall. Measured,
  not itemised, so a cascading goal delete (sub-goals + all their habits/tasks)
  needs no special case.
- **One-directional**: only DROPS are banked, so deleting an open overdue task
  still *relieves* its penalty and health goes UP, as before.
- **Undo**: every credit carries the delete's `ref` (`uid('del')`);
  `dropRetainedCredits(goals, ref)` withdraws exactly that batch, so restoring
  the items can't double-count them. Wired into all four delete paths —
  `deleteGoal` / `deleteHabit` (Align), `deleteItem` / `deleteGoalCascade`
  (Today). Those paths now compute the next array directly instead of using the
  `setState(prev => …)` form, since the retention diff needs goals and habits
  together; `deleteItem` also now snapshots Undo indexes from `allHabits` rather
  than the parked-filtered list (its splice always targeted the full array).
- Credits older than `RETAINED_CREDIT_TTL_DAYS` (365) are pruned when a goal
  next banks one — >6 halvings even at the 60d half-life, so it's housekeeping,
  not a visible cliff.
- Counted regardless of `graced`: they're earned points, not a per-goal grace,
  so value alignment's goal-health element sees them too.

**DB (applied to prod)**: `public.goals.retained_credits jsonb` (migration
`add_goals_retained_credits`), nullable, round-tripped by `goalToRow` /
`goalFromRow`. Required — the whole-array upsert would 400 on an unknown column.

**Known gap:** value alignment's separate "lived actions" element (0.25) still
tallies completions straight off the habits array, so deleting a completed item
nudges alignment down a little. Health itself is fully covered. Fix that the
same way if it comes up.

Tests: `src/App.deleteHealth.test.ts` (health identical across the delete, the
decay curve matching at +7/+30/+90d, overdue relief still rising, Undo).

## Paused branches, goal-tree walk, staleness (2026-08)

Fixes for "goals in the Goals tab aren't reflected in the app, and there's lag".

**The Goals tab rendered only two levels — the headline bug.** `ShortWithActions`
draws a goal node plus its habits and stops; it never recursed into its own
sub-goals. Every other surface (the Goals dashboard, Today, the health map, the
delete cascade) walks the tree with no depth limit, so a **depth-2 sub-goal was
live everywhere in the app and visible nowhere in the Goals tab**. The user read
that as goals that had been deleted but kept haunting the dashboard — and they
literally could not delete them, because there was no card to tap. Fixed with
`renderSubTree(parentId, depth)` in `Align`: a flat depth-ordered sequence
(ShortWithActions returns a fragment into the goal-thread flow, so `depth` carries
the indent via `.node.sub-depth-{1,2,3}`, capped at 3). A goal whose only children
are sub-goals is now collapsible too, and a sub-goal hidden by "Hide completed"
no longer takes its active children down with it — the walk continues through it.

**The dashboard showed completed goals.** `GoalsDashboard` filtered parked goals
but not completed ones, so an achieved goal kept a ticking "N days left"
countdown and a health bar there while the Align tab hid it by default. Both
surfaces apply the same rule now.

**Paused branches: the Inactive section lists ONLY the goals you paused.** Not
their sub-goals. This was tried the other way first (a nested list under each
paused card) and rejected in review — "Inactive" means the goals you chose to
pause, and the parent card stands for the whole branch, which returns intact on
reactivation. **Known tradeoff:** a sub-goal under a paused parent is displayed
nowhere until the parent is reactivated. Fine when the branch was parked
deliberately; the failure mode to watch for is a goal getting paused
unintentionally and going silent. Three goals are in that state today, one
("Decide whether to take the MFA") with 2 open tasks.

Do not re-add: a sub-goal count badge on collapsed goal cards (an unlabelled
digit in the card corner — added and reverted, read as noise), or the paused
sub-goal list described above.

**One shared goal-tree walk.** `expandGoalSubtrees(goals, rootIds)` +
`goalSubtreeIds(goals, rootId)` (both exported, near `archivedGoalIdSet`). It
runs to a fixpoint, so it is **order-independent**. `archivedGoalIdSet`,
`sprintFocusGoalIds`, `deleteGoal`, `deleteGoalCascade`, and `goalDeleteWarning`
all route through it. The two delete paths and the confirm dialog previously did
a **single forward pass**, catching only direct children plus whatever
grandchildren happened to sit after their parent in the array — and drag-to-
reorder renumbers `sortOrder` globally with no parents-first guarantee. A missed
grandchild survived the delete with a `parentGoalId` pointing at a goal that no
longer existed: invisible in Align, still counted in health and Today. Latent,
not yet fired (0 orphans in prod at the time of the fix), but a live 3-level
tree exists (Financial Security → Lower Monthly Expenses → lease / storage).
`deleteGoalCascade` also now snapshots Undo from the **unfiltered** `allGoals` /
`allHabits` so restoring brings the paused part of a branch back too.
Tests: `src/App.goalTree.test.ts`.

**Staleness.** The load effect was keyed on `session?.user?.id` alone, so the app
showed the snapshot it read at page open and never refetched — with no realtime
subscription, an edit on another device stayed invisible indefinitely, and since
the sync is a whole-array upsert the stale tab would write its old view back
over the newer one on the next edit. Added a `reloadKey` refetch on
`visibilitychange` / `online`, throttled to 60s via `lastLoadedAt`.

**Still open (deliberately not done here):**
- **Realtime is NOT wired up.** It needs `alter publication supabase_realtime add
  table goals, habits` on prod, and combined with the whole-array upsert it
  invites clobber-thrash (device A upserts → B refetches mid-edit). Do the
  per-row / dirty-tracked sync first.
- **Whole-array upsert is still last-write-wins** and can resurrect rows another
  device deleted (`upsert` on `id text primary key` never deletes).
- **Sync effects depend only on `[goals]` / `[habits]`** while early-returning on
  `dataLoaded` / `session` / `hydrating`. An edit landing in that window is
  dropped silently and never retried.
- The `goal_health` view still uses the OLD health formula and is unused —
  candidate for dropping.

## Sprint Focus (single chosen goal, 2026-07)

The user can nominate **one** goal as the current "sprint focus". It is mostly a
selection + surfacing feature and is independent of the per-domain priority taper
`focusStrength` (a separate concept that drives the priority-position nudge).
One deliberate exception (2026-07): holding a goal as the sprint focus now earns
a **small goal-health credit** — see "Sprint-focus health credit" below.

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
  inline "Sprint focus" pill. The Today tab shows a `sprint-focus-banner` near
  the top with the goal title, its domain, and its health chip, and below
  that lists the goal's whole to-do: every habit plus still-open task in the focus
  goal's **subtree** (walk `sprintFocusGoalIds` = itself + descendant sub-goals,
  so a top-level focus pulls in its sub-goals' items). Rows reuse Today's
  `renderRow`. Styles in `src/styles.css` under the `.node-sun.on` block.
- **Sprint-focus health bonus** (`computeHealth`, `src/App.tsx`): each **full
  day** a goal is held as the sprint focus earns a small, **decaying** health
  bonus — a reward for focusing on it that **persists after the sprint moves on**
  and then fades like any other event (it is NOT a live-only credit). Mechanics:
  - Each earned day is a dated event worth `SPRINT_DAY` (2 pts) that decays from
    its own date at the goal's half-life. The summed bonus is capped at
    `SPRINT_CAP` (10 pts ≈ +0.10 on the 0–1 scale) so it stays a nudge.
  - **Earned days** = every calendar date strictly after the set-date, up through
    today (`focusDatesEarned(sprintFocusAt, now)`) — nothing on the set-date
    itself (must be the sprint for "an entire day").
  - **Banking**: `applySprintFocus` unions the earned days into the goal's
    `Goal.sprintFocusDays` (new field; DB col `goals.sprint_focus_days text[]`,
    migration `add_goals_sprint_focus_days`, applied to prod) **before** clearing
    `sprintFocusAt`, so the bonus survives the switch. While a goal is still the
    active focus, in-progress days are derived **live** from `sprintFocusAt` in
    `computeHealth` (unioned with the banked set) so the display updates without a
    write; they're persisted only when the focus moves.
  - Threaded through `vitalityFor` / `stGoalMetrics` / `ongoingGoalMetrics` as
    `sprintFocusAt` + `sprintFocusDays` params, passed **only when `graced`**
    (same gate as the birth credit) so it lifts displayed health but stays out of
    the decoupled value-alignment math. Tests in `src/App.health.test.ts` and
    `src/App.sprintFocus.test.ts`.

## Period-cadence skip fix (2026-07)

`skipDayPatch` (`src/App.tsx`) used to advance a period-cadence habit's
`startDate` by a single day (`dayAfter`) when the ↺ pill dismissed a missed
occurrence. Because `getGraceDays` re-flags `today − interval` **every day**, a
one-day bump never got ahead of that sliding date, so `prevStr < startDate`
stayed false and the missed chip reappeared daily — a weekly ("custom, every
1 week") habit turned into a daily nag. The live "Bike to work" row had accrued
a run of consecutive daily skips and a `startDate` that had crept forward one
day at a time.

Fix: period cadences (monthly / yearly / custom) now advance `startDate` by one
**natural interval** (`addDays(frozenDate, naturalIntervalDays(h))`), so the
habit stays quiet until the next period actually elapses. Calendar cadences
(daily / weekdays / specific-days / weekly) are unchanged (they never move
`startDate`). Tests: `src/App.schedule.test.ts` (`skipDayPatch` interval
advance + `getGraceDays` no-daily-renag regression). The corrupted "Bike to
work" row (`h-mpv4a9mv-0`) was cleaned up in prod: skips collapsed to the two
weekly periods genuinely missed since the last ride (`2026-07-13`,
`2026-07-20`), `start_date` reset to `2026-07-27`.

## Lapsed habits stay on Today (2026-08)

The Today tab built its habit list from `isHabitScheduledToday` alone, which
answers "is it due today" — the wrong question for a habit that has already
lapsed. A weekly habit anchored to Friday was therefore only ever visible ON
Fridays: "Work on Business" (`h-mqfwsqdf-0`, weekly, `start_date 2026-07-17`)
went un-logged on Friday 2026-07-24 and then disappeared from Today for six
days, carrying an invisible missed-day chip that could be neither logged nor
skipped, before reappearing on 2026-07-31 (the screenshot the user reported).
Its goal health kept bleeding the whole time.

Fix: `isHabitRelevantToday(h)` = `isHabitScheduledToday(h) || getGraceDays(h).length > 0`
now gates the Today list, so a habit with an outstanding missed day stays
visible on its off-days until it's completed or skipped. `doneHabits` still
gates on `isHabitScheduledToday` so a habit pulled in only by its backlog
doesn't land in "Done today" after the backlog clears — it just goes quiet.
The urgency sort already weights `getGraceDays(h).length * 30`, so a lapsed
habit surfaces at the top of "Habits today". Tests: `src/App.schedule.test.ts`.

Note on the same row's live data: `completions` holds three off-cadence dates
(`2026-06-28` Sun, `2026-07-02` Thu, `2026-07-04` Sat) from before it was
anchored to Friday. They're inert for grace-day detection (the walk-back only
inspects scheduled weekdays) but `computeStreakFromCompletions` reads raw
completions, so closely-spaced legacy dates can each count as a streak step for
a weekly habit. Left in place — it's real history, and the current streak
computes to 0 either way.

## Coach card removed (2026-07)

The daily Gemini "coach card" on the Today tab was removed — it repeatedly
produced incoherent cards (anchoring on the sprint goal but nudging an
unrelated task, praising momentum the user hadn't built) and wasn't earning
its keep. Deleted: `src/geminiAdvisor.ts` (the whole module — `getGeminiCoachCard`,
`saveCoachFeedback`, `getTodayCoachRating`, coach context RPC), the coach card
JSX + the `DayRing` progress ring, the coach state/`useEffect`/`fetchCoachCard`
in `Today`, and their CSS. The always-available **✦ Reflect** button that lived
in the coach header was preserved as a standalone `.today-reflect-row` button so
weekly reflection is still reachable outside the Sun–Wed prompt window. The
`coach_feedback` Supabase table is now unused (left in place, harmless). Note:
`focusStrength` (per-domain priority taper) is a **separate** concept and is
untouched — it still drives goal health / alignment math.

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
NOTE: a server-side `goal_health` Supabase view still uses the OLD formula. It
was only ever read by the (now-removed) Gemini coach, which overrode it with the
client-computed numbers anyway, so the view is now fully unused. Consider
dropping it as cleanup.

### DB change (applied to prod)

Added `public.habits.created_at bigint` (migration `add_habits_created_at`),
backfilled all existing rows to the migration timestamp (a clean "reset the
build-out clock today"), with a `now()`-ms default for future inserts. Both add
flows and the row mappers in `src/App.tsx` now set/read `createdAt`.

Primary files:

- `src/App.tsx`, `src/data.ts`, `src/App.health.test.ts`, `supabase/schema.sql`

## Sub-goal scale correction (2026-08)

Sub-goals read far lower than their parents for the *same* work, because health
is an absolute 0–100 tally and a sub-goal simply can't earn as many points:

1. **Double-count upward** — a sub-goal's habits/tasks are in the parent's
   subtree, so the parent banks all the child's activity too.
2. **Milestone points are parent-only** — the two biggest values in the model
   (+10 built / +40 completed per sub-goal) are earned by whoever *has*
   sub-goals. A leaf milestone can never earn them.
3. **Faster clock** — the same event decays out of a 14-day short sub-goal ~4×
   faster than out of its 60-day long parent.

Measured before the fix: a sub-goal with two weekly habits kept perfectly for 60
days scored **24** while its parent (crediting the same habits) scored **100**.

Two adjustments, both gated on `g.parentGoalId` — top-level goals are untouched:

- `subGoalHalfLife(g, goals)` — a sub-goal decays at the **midpoint** between its
  own horizon half-life and its immediate parent's (`HALF_LIFE_BY_HORIZON`,
  long 60 / ongoing 30 / short 14), never faster than its own. Short-under-long
  = 37d. Missing/parked parent falls back to the goal's own.
- `subGoalScale(g)` → `SUBGOAL_SCALE` (**1.6**) — multiplies the **earned**
  ledger only. `computeHealth` now splits its tally into `fixed` (birth credit +
  sprint bonus, identical for every goal) and the earned `pos`/`pen`:
  `base = (fixed + (pos − pen) * earnedScale) / 100`. Penalties scale with
  credits, so a skip stays exactly as costly *relative* to a completion.

Keying on **having a parent** (not on being childless) is deliberate: the factor
never flips when a sub-goal gains a child, so "adding structure can't lower your
score" still holds.

After: that same sub-goal reads **87**. A brand-new sub-goal still starts at 50
(the birth credit is unscaled), an empty sub-goal still stays *below* a
comparable top-level goal at every age, and a neglected one (stale habits +
overdue task) still lands red at 31 — it's a change of scale, not a floor.

`SUBGOAL_SCALE` and the midpoint rule are the tuning knobs. An alternative
considered and rejected: blending a sub-goal's health toward its parent's
(`max(own, 0.6·parent)`) — simpler, but it hides genuinely neglected sub-goals
under a healthy parent.

Primary files: `src/App.tsx` (`computeHealth`, `vitalityFor`, `stGoalMetrics`,
`ongoingGoalMetrics`), `src/App.subGoalScale.test.ts`. No DB change.

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

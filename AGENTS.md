# Align App Agent Handoff

## Custom-interval habits run on a grid, not a sliding window (2026-08)

"Bike to work — Custom → every 1 week" behaved like a daily habit. Three
functions all defined a custom habit's "period" as a window measured backwards
from `now`, with nothing anchoring it to the schedule:

- `isHabitScheduledToday` returned `true` outright for custom (and monthly /
  yearly), on the "open commitment" reasoning. For a calendar cadence like
  monthly that is its own gate, but for an interval cadence it meant the habit
  sat on Today all seven days of the week, from the moment it was created.
- `dateInCurrentPeriod` compared `Date.now() - completion` in MILLISECONDS, so
  the period expired at whatever time of day the last completion sat at — the
  row flipped out of Done mid-morning on day 7, and never lined up with the
  day-granular schedule check.
- `getGraceDays` flagged `today − interval` as the missed day. That date slides
  with the calendar, so a lapsed weekly habit showed a red chip for a different,
  never-scheduled day every morning (Sep 1, then Sep 2, then Sep 3…), and
  logging it wrote a completion on a day the habit was never due.

Fix: `nextExpectedDate(h)` anchors period cadences to a grid — one natural
interval after the last completion, or `startDate` if never logged, whichever is
LATER (so the `startDate` a skip pushes forward still governs, and
`skipDayPatch` needed no change).

- `isHabitScheduledToday` (custom): due from `nextExpectedDate` onward, and
  stays due until logged. Monthly / yearly keep the calendar-period gate but
  now also respect a future `startDate` — the Start date field the form offers
  for those cadences was previously ignored entirely.
- `dateInCurrentPeriod` (custom): whole days via `daysBetween`, the exact
  complement of the schedule check, so the two can never disagree.
- `getGraceDays` (period path): flags the latest grid occurrence a full interval
  in the past. It names a day the habit was genuinely due and STAYS on that day
  until logged or skipped.
- `computeStreakFromCompletions`: the first gap is measured from today, which is
  not a completion but the still-open current period, so it gets the same slack
  `getGraceDays` grants (`max(graceDays, interval)`). A weekly habit no longer
  loses its streak for being a day late, and catching up a missed week through
  the chip no longer logs the right date but reports 0. Gaps BETWEEN completions
  keep the tight `interval + graceDays` cap, so an irregular run still breaks.

Note the remaining wrinkle (not a bug, worth knowing): "Weekly" and "Custom →
every 1 week" are still different schedules. Weekly is anchored to a weekday;
custom every-7-days is anchored to when you last did it, so it drifts if you log
late. Both now surface one day a week.

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

### Value alignment gets the same treatment

A delete dented THREE more ledgers inside `valueAlignmentScore`, all now banked
in the same `HealthCredit` entry, each on the scale/clock its own element uses:

- `actionPoints` — lived actions, VA's own weights (`VA_ACT`) and 28-day clock.
- `evidence` — the confidence-ramp signal count. A raw tally; does NOT decay
  (the behaviour happened; deleting the row doesn't un-know it).
- `keptDays` / `skippedDays` — habit-days for the consistency element, banked as
  DATES, not a ratio, so they age out of the rolling 28-day window exactly as the
  live rows would have. Only in-window dates are banked. Missing this was the
  subtle one: deleting the only tagged habit dropped the element entirely and
  silently reweighted the whole blend.

`goalActionLedger(g, habits, now)` measures all three. Unlike health's subtree
roll-up it's strictly PER-GOAL (its own completion + the habits it owns),
because that's how `valueAlignmentScore` accumulates over tagged goals — so
`retainHealthOnDelete` additionally pushes a **deleted** goal's alignment ledger
up to its nearest surviving ancestor (health needs no such step; a parent's
subtree tally already covered its sub-goals, so the plain diff catches it).

**Residual, accepted:** alignment's goal-health element (weight 0.12) averages
`computeHealth` over the goals that still exist. Deleting a whole goal removes
it from that average, which can move alignment slightly EITHER way — up if the
deleted goal scored below the average, down if it scored above. Retaining that
would mean keeping ghost goals in the tree. Everything a delete *earned* is
retained; only the composition of the average changes.

## Health restore: "A New Job - Remote Work" (2026-08-11)

The user reported this goal bleeding out. Root cause is mostly NOT deletion:
it's `horizon: 'short', timeframe: 12` — a **12-month goal on the short
horizon**, and `HALF_LIFE_BY_HORIZON` keys off the horizon LABEL, not the actual
timeframe, so it decays on a 14-day clock. Its +50 birth credit had halved twice
in 31 days: 50 → 10.5, total reading 13%.

Restored to 50% by banking a retained credit on the live row (`points: 37.12`,
`at: 1786413418043`, `ref: restore-remote-work-2026-08-11`) — the same mechanism
the delete fix uses, so it decays honestly from here rather than being a floor.
Health-only: no `actionPoints`/`evidence` were banked, since there's no record of
what was deleted and inflating alignment on a guess would be wrong.

**Still open — the user was offered this and chose the number instead, so do NOT
apply it unprompted:** scaling a short goal's half-life to its real timeframe,
`clamp(timeframeMonths * 30.44 / 6, 14, 60)` (1mo→14, 3mo→15, 6mo→30, 12mo→60).
Monotone — no goal would decay faster than it does today. Three goals have the
short/12 shape: this one, "Film Business", "Promotion at ETMS" (latter two
paused). Without it, the restored 50% reads ~35% in a week and ~25% in a
fortnight; expect this to come back.

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

**Any goal or sub-goal can now be paused (2026-08-30).** Every active card has a
pause control. Pausing a sub-goal sets only its own `archivedAt`; the shared tree
walk makes that branch's descendants inactive without rewriting their state.
The branch disappears from Align's active tree, health, the dashboard, and
Today, then appears in Inactive with its parent named. Reactivating it returns
it beneath the same parent.

Inactive shows one card per **explicitly paused branch root**. Descendants made
inactive only because an ancestor is paused are represented by that ancestor's
card, not duplicated. If a child was paused separately before its parent, only
the parent appears while both are paused; reactivating the parent reveals the
still-paused child in Inactive. Top-level drag-to-pause/reactivate remains, and
the button works for every level. Tests: `src/App.goalTree.test.ts`.

Do not re-add a sub-goal count badge on collapsed goal cards (an unlabelled
digit in the card corner — added and reverted, read as noise).

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

### DB audit 2026-08-13
- `supabase/schema.sql` was regenerated from the live database. It had documented
  only the four tables, omitting `stale_tasks` (which `App.tsx` reads), plus
  `goal_health`, `coach_feedback`, `get_coach_context()`, and the
  `habits_sync_completions` trigger. `.remote/schema_dump.sql` is an old dump —
  header now says so; do not use it as reference.
- `goal_health` had no `security_invoker`, so it ran as its owner and bypassed
  RLS for any authenticated caller. Set to `security_invoker = true`.
- **`get_coach_context()` is broken**: it selects `h.streak`, dropped from
  `habits`, so every call fails with 42703. Dead code from the removed coach —
  drop it along with `goal_health` / `coach_feedback`, or repair it.
- `goals.value_indexes` are positional into `domains.values` and are NOT
  re-indexed when a domain value is deleted. Nine goals were left pointing at a
  non-existent index 5 and have been cleaned up. Re-index on value removal.

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
at 50 — **sub-goals at 75** — via a **birth credit**: `computeHealth`'s optional
`goalCreatedAt` adds `birthPoints * decay(goalCreatedAt)` to the tally, where
`birthPoints` comes from `birthCredit(g)` (`BIRTH_CREDIT` 50 top-level,
`SUBGOAL_BIRTH_CREDIT` 75 for anything with a `parentGoalId`). So a goal is at
its birth value the moment it's created and — left alone — fades from there through the SAME decay as everything
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
- `subGoalScale(g)` → `SUBGOAL_SCALE` (**1.6**) — multiplies the **sub-goal and
  habit** ledger only. `computeHealth` splits its tally three ways: `fixed`
  (birth credit + sprint bonus, identical for every goal), the scaled earned
  `pos`/`pen`, and `flat` — the net TASK ledger (build-out, completion, overdue
  drag), which is deliberately NOT scaled:
  `base = (fixed + flat + (pos − pen) * earnedScale) / 100`. A task is the same
  unit of work wherever it hangs, so ticking one off a sub-goal is worth the
  same +6 it is anywhere else (it was reading +9.6 and lifting sub-goals too
  fast). Within the scaled ledger penalties scale with credits, so a skip stays
  exactly as costly *relative* to a completion.
- Deletion retention banks the two buckets separately (`HealthCredit.points` for
  the scaled ledger, `flatPoints` for the task ledger) so a delete re-enters the
  score on the same side of the scale the removed items were earning on.

Keying on **having a parent** (not on being childless) is deliberate: the factor
never flips when a sub-goal gains a child, so "adding structure can't lower your
score" still holds.

After: that same sub-goal reads **87**. The scale leaves the birth credit alone
(a brand-new sub-goal starts at its own birth value, 75), an empty sub-goal still stays *below* a
comparable top-level goal at every age, and a neglected one (stale habits +
overdue task) still lands red at 31 — it's a change of scale, not a floor.

`SUBGOAL_SCALE` and the midpoint rule are the tuning knobs. An alternative
considered and rejected: blending a sub-goal's health toward its parent's
(`max(own, 0.6·parent)`) — simpler, but it hides genuinely neglected sub-goals
under a healthy parent.

Primary files: `src/App.tsx` (`computeHealth`, `vitalityFor`, `stGoalMetrics`,
`ongoingGoalMetrics`), `src/App.subGoalScale.test.ts`. No DB change.

## Operating Principles on Foundation (2026-08-22)

Foundation now opens with an **Operating principles** card sitting above the
domain cards, so the tab reads as one stack: principles first, then per-domain
values.

The distinction that matters: **values are scored, principles are not.** Values
are the per-domain tags the alignment engine matches goals against. Principles
are the tiebreakers you *read* when two values pull against each other — they
never enter a score, and they are deliberately **unordered**, so no ranking is
implied. `sortOrder` exists only to keep the list reading back in the same
order across devices; it is insertion order, not priority.

- `Principle { id, title, detail, sortOrder, createdAt }` in `src/data.ts`,
  seeded from `principles`.
- `<Principles>` in `src/App.tsx` — a collapsible `domain-card` so it matches
  the domain cards visually. Each row is a title + detail `AutoTextarea` pair
  (grow-to-fit, no scrollbars) with a `×` remove and a `+ Add principle`
  footer. Empty state: "No principles yet."
- Persistence mirrors the other collections, with one difference: the list can
  legitimately go to **zero** rows, and `upsert` never deletes, so removals go
  through `deletePrincipleFromDb` explicitly.
- **Soft-fails if the table is missing.** `principlesTableOk` flips false when
  the load errors, the failure is a `console.warn` rather than a toast, and
  syncing is skipped for the session. Loading the app before the migration runs
  cannot brick Foundation — principles simply stay local.

**Migration applied to production 2026-08-30:**
`supabase/migrations/2026-08-22-principles.sql` creates
`public.principles`, enables owner-only RLS, grants authenticated CRUD access,
and blocks anonymous access. Patrick's five principles are seeded in production.
The migration is idempotent and safe to re-run.

## Relationship integrity (2026-08-30)

Production now enforces the relationships the app already assumes:

- every goal belongs to one of the same user's domains;
- every sub-goal has an existing parent in the same user and domain;
- a goal cannot parent itself;
- every task/habit has an existing goal owned by the same user.

Migration: `supabase/migrations/20260831020028_enforce_goal_relationships.sql`.
Deletes do **not** cascade automatically. `deleteGoalFromDb` deletes a selected
branch's actions first and then its explicitly selected goal rows; the database
rejects any operation that would leave an orphan. The dormant new-user seed
`g-comm-short` was corrected from Community to Family to match its parent.

## Verification

Use a Node version compatible with the project lockfile. The bundled Codex runtime worked:

```bash
env PATH=/Users/patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- --run
env PATH=/Users/patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
```

Verified results before this handoff:

- `npm test -- --run`: 4 tests passed.
- `npm run build`: passed.

Re-verified 2026-08-23 (after the Operating Principles work):

- `npx vitest run`: 11 files, 93 tests passed.
- `npm run build`: passed.

## Supabase Notes

Supabase project discovered during debugging:

- Project name: `Align`
- Project ref: `hossofghephkcncecesp`
- Relevant tables: `public.goals`, `public.habits`, `public.principles`

Observed live data had at least one task row with `completions: {}` while most rows had `completions: []`. The code fix normalizes this locally; no live data migration has been applied.

### `goals` has an outside reader (2026-08-25, widened 2026-08-28)

The Portal (the sibling `Portal-Agent` repo) reads this database over Supabase's
REST API, scoped to one `user_id`. It is **read-only** — the Portal never writes
to Align, holds no goals collection of its own, and has no write path. A goal is
edited here and nowhere else.

It reads exactly this, and nothing else:

| Table | Columns |
| --- | --- |
| `goals` | `id`, `title`, `domain_id`, `value_indexes`, `horizon`, `parent_goal_id`, `timeframe`, `completed_at`, `archived_at`, `sort_order`, `sprint_focus_at` |
| `domains` | `id`, `name`, `values` |
| `principles` | `id`, `title`, `detail`, `sort_order` |

What that means here:

- **`goals.id` is a foreign reference held outside this database.** Renaming a
  goal is safe (the Portal resolves titles at read time and shows the new one);
  changing or recycling a goal's `id` is not, and would leave a Portal record
  pointing at nothing.
- **Dropping or renaming any column above breaks the Portal's read**, so mirror
  the change there. `principles` is the one exception: the Portal reads it on its
  own error budget, so an unreadable principles table costs it that card and
  nothing else.
- **`sort_order` and `sprint_focus_at` are read as the priority order**, not just
  as display order. The Portal derives a tier from them — sprint focus first,
  then the first active goal in each domain by `sort_order`, then the rest, then
  ended goals — and sorts its own overview by it. Reordering goals here reorders
  the Portal's dashboard. Nothing about that derivation lives in this repo, and
  it needs nothing from us beyond keeping those two columns meaning what they
  mean today.
- **`value_indexes` are read and resolved positionally against `domains.values`.**
  The known gap that they are not re-indexed when a domain value is deleted (see
  the DB audit above) is handled defensively on the Portal side — an index past
  the end of the list is dropped rather than guessed at — but re-indexing on
  value removal remains the real fix, and now has a second reader depending on
  it.

There is deliberately **no view, function, or migration** for this. The Portal
derives everything it needs from the columns already here, so the contract is a
column list, not an API surface to keep in sync.

## Cleanup Notes

`node_modules/`, `dist/`, `*.tsbuildinfo`, and `.npm-cache/` are generated and should not be committed.

## Remaining Choices

- Decide whether to add a Supabase data cleanup migration/query to convert non-array `habits.completions` values to `[]`.
- If UX still feels off, tune `computeOngoingHealth` weights rather than changing completion persistence again.

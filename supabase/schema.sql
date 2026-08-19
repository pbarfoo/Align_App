-- Align — Supabase schema
-- Run in Supabase → SQL Editor. Column names map to the row-mappers in src/App.tsx.
-- Timestamps are stored as Date.now() milliseconds, hence bigint.
--
-- REGENERATED 2026-08-13 from the live database. The previous version of this
-- file documented only the four tables and omitted every view, function, and
-- trigger the app depends on — `App.tsx` reads `stale_tasks`, so a rebuild from
-- the old file produced an app that failed on load. `.remote/schema_dump.sql`
-- is an OLD pg_dump (pre-`sort_order`, still declares the dropped `streak`
-- column) — do not use it as reference.

-- ============================================================ TABLES

-- DOMAINS (composite key: same domain id 'career' exists per-user)
create table if not exists public.domains (
  id text not null,
  user_id uuid not null references auth.users on delete cascade,
  name text,
  blurb text,
  values text[] default '{}',
  vision text,
  primary key (user_id, id)
);

-- GOALS
-- NOTE: goals.value_indexes are positional indexes into domains.values. Deleting
-- a value from a domain does NOT re-index the goals that referenced it — nine
-- goals were left pointing at a non-existent index 5 and were cleaned up on
-- 2026-08-13. Re-index goals whenever a domain value is removed.
create table if not exists public.goals (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  domain_id text,
  value_indexes int[] default '{}',
  horizon text,
  title text,
  parent_goal_id text,
  created_at bigint,
  timeframe numeric,
  completed_at bigint,
  sort_order int,
  archived_at bigint,
  -- unix ms when this goal was chosen as THE single sprint focus. At most one
  -- goal per user carries a non-null value (enforced client-side: setting one
  -- clears the rest). null = not the sprint focus.
  sprint_focus_at bigint,
  -- YYYY-MM-DD dates the goal earned a sprint-focus health bonus (one per full
  -- day held as the sprint). Banked when the focus moves elsewhere so the bonus
  -- persists and then decays. null/empty = none earned yet.
  sprint_focus_days text[],
  -- Health points banked when items under this goal were DELETED, so removing a
  -- task / habit / sub-goal never drops the goal's health. Array of
  -- { at: unix ms (decay anchor), points: number, ref: delete-batch id }.
  -- null = nothing banked.
  retained_credits jsonb
);

-- HABITS (holds BOTH habits and tasks; discriminated by `kind`)
-- There is no `streak` column: streak is derived client-side from `completions`
-- on load (a persisted streak went stale after a lapse). See habitFromRow().
create table if not exists public.habits (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  goal_id text,
  title text,
  kind text,                      -- 'task' | 'habit'
  done_today boolean default false,
  start_date text,
  recurrence text,
  custom_interval int,
  custom_unit text,
  due_date text,                  -- YYYY-MM-DD
  due_time text,
  focus_date text,                -- YYYY-MM-DD
  skipped_dates text[],
  specific_days int[],
  completions jsonb default '[]'::jsonb,
  completed boolean,
  completed_at bigint,
  created_at bigint default (extract(epoch from now()) * 1000)::bigint
);

-- REFLECTIONS
create table if not exists public.reflections (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  week_number int,
  year int,
  date bigint,
  scores jsonb default '{}',
  note text
);

-- COACH FEEDBACK — thumbs up/down on the old Gemini coach card.
-- DEAD: the coach was removed; nothing reads or writes this. Kept because it
-- still holds 6 historical rows. Safe to drop once those are not wanted.
create table if not exists public.coach_feedback (
  user_id uuid not null references auth.users on delete cascade,
  date text not null,
  title text not null,
  rating text not null check (rating in ('up','down')),
  primary key (user_id, date)
);

-- ============================================================ TRIGGERS

-- Keeps habits.completions in sync when done_today is toggled, stamped in the
-- user's local timezone rather than UTC.
create or replace function public.sync_habit_completions() returns trigger
language plpgsql as $$
declare
  today text := to_char(now() at time zone 'America/Toronto', 'YYYY-MM-DD');
begin
  if new.done_today is distinct from old.done_today then
    if new.done_today then
      if not (coalesce(new.completions, '[]'::jsonb) ? today) then
        new.completions := coalesce(new.completions, '[]'::jsonb) || to_jsonb(today);
      end if;
    else
      new.completions := coalesce(
        (select jsonb_agg(e) from jsonb_array_elements_text(new.completions) e where e <> today),
        '[]'::jsonb);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists habits_sync_completions on public.habits;
create trigger habits_sync_completions
  before update on public.habits
  for each row execute function public.sync_habit_completions();

-- ============================================================ VIEWS

-- LIVE — read by App.tsx (`supabase.from('stale_tasks')`). Open, overdue tasks,
-- worst-first. security_invoker so RLS on habits/goals still applies.
create or replace view public.stale_tasks with (security_invoker = true) as
  select h.id, h.user_id, h.title, h.due_date,
         g.title as goal_title,
         current_date - h.due_date::date as days_overdue
    from public.habits h
    left join public.goals g on g.id = h.goal_id
   where h.kind = 'task'
     and coalesce(h.completed, false) = false
     and h.due_date ~ '^\d{4}-\d{2}-\d{2}'
     and h.due_date::date < current_date
   order by (current_date - h.due_date::date) desc;

-- DEAD — server-side health score using the OLD formula, superseded by the
-- client-side computeHealth()/earnedLedger() in src/App.tsx. Nothing reads it.
-- It was missing security_invoker until 2026-08-13, which meant it ran as its
-- owner and bypassed RLS. Candidate for dropping (see AGENTS.md).
-- Definition intentionally not reproduced here; if you keep it, dump it from
-- the live DB with pg_get_viewdef('public.goal_health'::regclass, true).

-- ============================================================ FUNCTIONS

-- DEAD AND CURRENTLY BROKEN — bundled context for the removed Gemini coach.
-- It still selects `h.streak`, a column that was dropped from habits, so any
-- call fails with 42703 "column h.streak does not exist". Nothing calls it.
-- Fix it or drop it; do not treat it as working. Definition lives only in the
-- live DB: pg_get_functiondef('public.get_coach_context'::regproc).

-- ============================================================ RLS

alter table public.domains        enable row level security;
alter table public.goals          enable row level security;
alter table public.habits         enable row level security;
alter table public.reflections    enable row level security;
alter table public.coach_feedback enable row level security;

-- Drop policies first so this script is safe to re-run
drop policy if exists "own domains"               on public.domains;
drop policy if exists "own goals"                 on public.goals;
drop policy if exists "own habits"                on public.habits;
drop policy if exists "own reflections"           on public.reflections;
drop policy if exists "Users manage own feedback" on public.coach_feedback;

create policy "own domains"               on public.domains        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own goals"                 on public.goals          for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own habits"                on public.habits         for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reflections"           on public.reflections    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own feedback" on public.coach_feedback for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

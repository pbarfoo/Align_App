-- Align — Supabase schema
-- Run in Supabase → SQL Editor. Column names map to the row-mappers in src/App.tsx.
-- Timestamps are stored as Date.now() milliseconds, hence bigint.

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
  archived_at bigint
);

-- HABITS
create table if not exists public.habits (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  goal_id text,
  title text,
  kind text,
  done_today boolean default false,
  start_date text,
  recurrence text,
  custom_interval int,
  custom_unit text,
  due_date text,
  due_time text,
  focus_date text,
  skipped_dates text[],
  specific_days int[],
  completions jsonb default '[]'::jsonb,
  completed boolean,
  completed_at bigint,
  streak int default 0
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

-- Row-Level Security: each user only sees their own rows
alter table public.domains     enable row level security;
alter table public.goals       enable row level security;
alter table public.habits      enable row level security;
alter table public.reflections enable row level security;

-- Drop policies first so this script is safe to re-run
drop policy if exists "own domains"     on public.domains;
drop policy if exists "own goals"       on public.goals;
drop policy if exists "own habits"      on public.habits;
drop policy if exists "own reflections" on public.reflections;

create policy "own domains"     on public.domains     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own goals"       on public.goals       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own habits"      on public.habits      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reflections" on public.reflections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

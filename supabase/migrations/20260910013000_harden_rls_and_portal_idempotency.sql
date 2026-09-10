-- Align hardening: explicit authenticated access, efficient ownership checks,
-- safer trigger execution, and an idempotency key for Portal-created tasks.

alter table public.habits add column if not exists source_ref text;
alter table public.habits drop constraint if exists habits_user_source_ref_key;
alter table public.habits add constraint habits_user_source_ref_key unique (user_id, source_ref);

create index if not exists principles_user_id_idx on public.principles (user_id);
create index if not exists reflections_user_id_idx on public.reflections (user_id);

alter function public.sync_habit_completions() set search_path = pg_catalog, public;
revoke execute on function public.sync_habit_completions() from public, anon, authenticated;

drop policy if exists "own domains" on public.domains;
drop policy if exists "own goals" on public.goals;
drop policy if exists "own habits" on public.habits;
drop policy if exists "own reflections" on public.reflections;

create policy "own domains" on public.domains for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own goals" on public.goals for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own habits" on public.habits for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own reflections" on public.reflections for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.domains, public.goals, public.habits, public.reflections from anon;
revoke truncate, references, trigger on table public.domains, public.goals, public.habits, public.reflections from authenticated;
grant select, insert, update, delete on table public.domains, public.goals, public.habits, public.reflections to authenticated;

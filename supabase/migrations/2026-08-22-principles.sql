-- Adds the `principles` table for the Foundation tab's Operating Principles
-- section. Safe to re-run. Run this in Supabase → SQL Editor.
--
-- Until this runs, the app still works: the principles load fails softly, a
-- warning goes to the console, and principles stay local to the session.

create table if not exists public.principles (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text,
  detail text,
  sort_order int,
  created_at bigint default (extract(epoch from now()) * 1000)::bigint
);

alter table public.principles enable row level security;

revoke all on table public.principles from anon, authenticated;
grant select, insert, update, delete on table public.principles to authenticated;
grant select on table public.principles to service_role;

drop policy if exists "own principles" on public.principles;
create policy "own principles" on public.principles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

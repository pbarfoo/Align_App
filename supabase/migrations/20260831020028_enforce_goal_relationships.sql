begin;

-- Existing production data was audited before this migration: no missing
-- domains, orphaned goals/tasks, self-links, or cross-owner/domain parents.
-- These constraints turn those application assumptions into database rules.

alter table public.goals alter column domain_id set not null;
alter table public.habits alter column goal_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.goals'::regclass
      and conname = 'goals_user_id_id_key'
  ) then
    alter table public.goals
      add constraint goals_user_id_id_key unique (user_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.goals'::regclass
      and conname = 'goals_user_id_id_domain_id_key'
  ) then
    alter table public.goals
      add constraint goals_user_id_id_domain_id_key
      unique (user_id, id, domain_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.goals'::regclass
      and conname = 'goals_domain_fkey'
  ) then
    alter table public.goals
      add constraint goals_domain_fkey
      foreign key (user_id, domain_id)
      references public.domains (user_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.goals'::regclass
      and conname = 'goals_parent_fkey'
  ) then
    alter table public.goals
      add constraint goals_parent_fkey
      foreign key (user_id, parent_goal_id, domain_id)
      references public.goals (user_id, id, domain_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.goals'::regclass
      and conname = 'goals_parent_not_self'
  ) then
    alter table public.goals
      add constraint goals_parent_not_self
      check (parent_goal_id is null or parent_goal_id <> id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.habits'::regclass
      and conname = 'habits_goal_fkey'
  ) then
    alter table public.habits
      add constraint habits_goal_fkey
      foreign key (user_id, goal_id)
      references public.goals (user_id, id);
  end if;
end
$$;

create index if not exists goals_domain_lookup_idx
  on public.goals (user_id, domain_id);
create index if not exists goals_parent_lookup_idx
  on public.goals (user_id, parent_goal_id, domain_id)
  where parent_goal_id is not null;
create index if not exists habits_goal_lookup_idx
  on public.habits (user_id, goal_id);

commit;

-- Reject obsolete domain IDs, including writes from stale pre-migration clients.
do $guard$
declare target_user uuid;
begin
  lock table public.domains, public.goals in share row exclusive mode;
  select user_id into strict target_user from public.goals
    where title='FOGs Maintenance' and parent_goal_id is null and domain_id='career';
  if exists(select 1 from public.goals where user_id=target_user and domain_id='community') then
    raise exception 'Community still holds goals; refusing to delete';
  end if;
  if not exists(select 1 from public.domains where user_id=target_user and id='family' and name='Family & Friends')
    or (select cardinality(values) from public.domains where user_id=target_user and id='career')<>12
    or (select cardinality(values) from public.domains where user_id=target_user and id='self')<>11 then
    raise exception 'Expected migrated Foundation values before enforcing domain IDs';
  end if;
  delete from public.domains where user_id=target_user and id='community';
  if not exists(select 1 from pg_constraint where conrelid='public.domains'::regclass and conname='domains_canonical_id_check') then
    alter table public.domains add constraint domains_canonical_id_check check(id in ('family','career','self'));
  end if;
end
$guard$;

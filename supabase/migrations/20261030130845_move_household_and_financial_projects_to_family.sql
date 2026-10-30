-- Place the two specified household/finance project trees in Family & Friends.
-- Preserve every ID, parent link, status, priority, action, and reflection.
do $move_family$
declare
  owner_id uuid;
  branch_ids text[];
  before_goals jsonb;
  before_habits jsonb;
  before_reflections jsonb;
  root_count integer;
begin
  lock table public.domains,public.goals,public.habits,public.reflections in share row exclusive mode;
  select user_id into strict owner_id from public.goals
    where title='FOGs Maintenance' and domain_id='career' and parent_goal_id is null;
  select count(*) into root_count from public.goals where user_id=owner_id and parent_goal_id is null
    and title in ('Financial Security','Admin & Housekeeping') and domain_id in ('self','family');
  if root_count<>2 then raise exception 'Expected the two specified project roots'; end if;
  with recursive branches as (
    select id from public.goals where user_id=owner_id and parent_goal_id is null
      and title in ('Financial Security','Admin & Housekeeping') and domain_id in ('self','family')
    union
    select g.id from public.goals g join branches b on g.parent_goal_id=b.id where g.user_id=owner_id
  ) select array_agg(id) into branch_ids from branches;
  select jsonb_object_agg(id,to_jsonb(g)-'domain_id'-'value_indexes') into before_goals from public.goals g where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(h)) into before_habits from public.habits h where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(r)) into before_reflections from public.reflections r where user_id=owner_id;
  if exists(
    select 1 from public.goals g
    join public.domains src on src.user_id=g.user_id and src.id=g.domain_id
    join public.domains dst on dst.user_id=g.user_id and dst.id='family',
    unnest(g.value_indexes) v
    where g.user_id=owner_id and g.id=any(branch_ids)
      and (src.values[v+1] is null or array_position(dst.values,src.values[v+1]) is null)
  ) then raise exception 'A goal value has no matching Family & Friends value'; end if;
  update public.goals g set domain_id='family',
    value_indexes=array(
      select array_position(dst.values,src.values[v+1])-1
      from unnest(g.value_indexes) with ordinality x(v,n) order by n)
    from public.domains src,public.domains dst
    where g.user_id=owner_id and g.id=any(branch_ids)
      and src.user_id=g.user_id and src.id=g.domain_id
      and dst.user_id=g.user_id and dst.id='family';
  if exists(select 1 from public.goals where user_id=owner_id and id=any(branch_ids) and domain_id<>'family')
    or (select jsonb_object_agg(id,to_jsonb(g)-'domain_id'-'value_indexes') from public.goals g where user_id=owner_id) is distinct from before_goals
    or (select jsonb_object_agg(id,to_jsonb(h)) from public.habits h where user_id=owner_id) is distinct from before_habits
    or (select jsonb_object_agg(id,to_jsonb(r)) from public.reflections r where user_id=owner_id) is distinct from before_reflections then
    raise exception 'Project migration or preservation checks failed';
  end if;
end
$move_family$;

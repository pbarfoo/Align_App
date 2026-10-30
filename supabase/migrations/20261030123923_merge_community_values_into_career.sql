-- Merge former Community values into Career without duplicate labels.
-- Existing Career ratings win for shared Leadership and Service slots;
-- every original community:* and retired-career:* rating remains preserved.
do $merge_values$
declare
  owner_id uuid;
  old_values text[];
  before_goals jsonb;
  before_habits jsonb;
  before_reflections jsonb;
  fogs_id text;
  restored integer;
begin
  lock table public.domains,public.goals,public.habits,public.reflections in share row exclusive mode;
  select user_id,id into strict owner_id,fogs_id from public.goals
    where title='FOGs Maintenance' and domain_id='career' and parent_goal_id is null;
  select values into strict old_values from public.domains where user_id=owner_id and id='career';
  if old_values=array['Leadership','Autonomy','Flexibility','Professional Respect','Competence','Service',
    'Presence','Integrity','Love/Positivity','Community'] then return; end if;
  if old_values is distinct from array['Leadership','Autonomy','Flexibility','Professional Respect','Competence','Service'] then
    raise exception 'Unexpected Career slots before merge';
  end if;
  select jsonb_object_agg(id,to_jsonb(g)-'value_indexes') into before_goals from public.goals g where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(h)) into before_habits from public.habits h where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(r)) into before_reflections from public.reflections r where user_id=owner_id;
  update public.domains set values=old_values||array['Presence','Integrity','Love/Positivity','Community']
    where user_id=owner_id and id='career';
  -- Restore the exact links removed in the immediately preceding migration,
  -- resolving each old Community tag to its merged Career slot.
  with recursive branch as (
    select id from public.goals where user_id=owner_id and id=fogs_id
    union
    select g.id from public.goals g join branch b on g.parent_goal_id=b.id where g.user_id=owner_id
  ), tags(title, indexes) as (
    values ('FOGs Maintenance',array[0,5,6,7,8,9]),
      ('Urban Farming',array[0,6,8]),('Complete Website',array[6,8])
  )
  update public.goals g set value_indexes=array(select distinct v
    from unnest(g.value_indexes||t.indexes) v order by v)
    from tags t where g.user_id=owner_id and g.id in (select id from branch) and g.title=t.title;
  get diagnostics restored=row_count;
  if restored<>3 then raise exception 'Expected all three previously tagged FOGs goals'; end if;
  update public.reflections r set scores=r.scores||coalesce((
    select jsonb_object_agg('career:'||(split_part(key,':',2)::int+5),value)
    from jsonb_each(r.scores) where key ~ '^community:[1-4]$'),'{}'::jsonb)
    where user_id=owner_id;
  -- A missing shared Career rating may use the old Community observation;
  -- an existing Career observation keeps its original value.
  update public.reflections set scores=scores
    ||case when not(scores ? 'career:0') and scores ? 'community:0' then jsonb_build_object('career:0',scores->'community:0') else '{}'::jsonb end
    ||case when not(scores ? 'career:5') and scores ? 'community:5' then jsonb_build_object('career:5',scores->'community:5') else '{}'::jsonb end
    where user_id=owner_id;
  if (select jsonb_object_agg(id,to_jsonb(g)-'value_indexes') from public.goals g where user_id=owner_id) is distinct from before_goals
    or (select jsonb_object_agg(id,to_jsonb(h)) from public.habits h where user_id=owner_id) is distinct from before_habits then
    raise exception 'Relationships, progress, or actions changed during value merge';
  end if;
  if exists(select 1 from public.reflections r,jsonb_each(before_reflections->r.id->'scores') s
    where r.user_id=owner_id and r.scores->s.key is distinct from s.value) then
    raise exception 'Existing reflection rating changed during merge';
  end if;
  if exists(select 1 from public.goals g,unnest(g.value_indexes) v where g.user_id=owner_id and g.domain_id='career' and (v<0 or v>=10)) then
    raise exception 'Invalid merged value index';
  end if;
end
$merge_values$;

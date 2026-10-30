-- Remove the six Community/FOGs value slots from Career at Patrick's request.
-- Keep projects, actions, progress, and all historical ratings.
do $remove_values$
declare
  owner_id uuid;
  old_values text[];
  old_goals jsonb;
  old_habits jsonb;
  old_reflections jsonb;
begin
  lock table public.domains,public.goals,public.habits,public.reflections in share row exclusive mode;
  select user_id into strict owner_id from public.goals where title='FOGs Maintenance'
    and domain_id='career' and parent_goal_id is null;
  select values into strict old_values from public.domains where user_id=owner_id and id='career';
  if old_values = array['Leadership','Autonomy','Flexibility','Professional Respect','Competence','Service'] then return; end if;
  if old_values is distinct from array['Leadership','Autonomy','Flexibility','Professional Respect','Competence','Service',
    'Leadership (FOGs)','Presence (FOGs)','Integrity (FOGs)','Love/Positivity (FOGs)','Community (FOGs)','Service (FOGs)'] then
    raise exception 'Unexpected Career value slots; refusing to guess at removal indexes';
  end if;
  select jsonb_object_agg(id,to_jsonb(g)-'value_indexes') into old_goals from public.goals g where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(h)) into old_habits from public.habits h where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(r)) into old_reflections from public.reflections r where user_id=owner_id;
  update public.goals g set value_indexes=array(select v from unnest(g.value_indexes) with ordinality x(v,n)
    where v<6 order by n) where user_id=owner_id and domain_id='career';
  -- Retire these canonical keys so a future value at slot 6 cannot inherit a
  -- removed value's rating. The original community:* scores remain untouched.
  update public.reflections r set scores=(
    select coalesce(jsonb_object_agg(
      case when key ~ '^career:(6|7|8|9|10|11)$' then 'retired-'||key else key end,value),'{}'::jsonb)
    from jsonb_each(r.scores)) where user_id=owner_id;
  update public.domains set values=old_values[1:6] where user_id=owner_id and id='career';
  if (select jsonb_object_agg(id,to_jsonb(g)-'value_indexes') from public.goals g where user_id=owner_id) is distinct from old_goals
    or (select jsonb_object_agg(id,to_jsonb(h)) from public.habits h where user_id=owner_id) is distinct from old_habits then
    raise exception 'Project relationships, progress, or actions changed';
  end if;
  if exists(select 1 from public.reflections r, jsonb_each(old_reflections->r.id->'scores') s
    where r.user_id=owner_id and r.scores->(case when s.key ~ '^career:(6|7|8|9|10|11)$'
      then 'retired-'||s.key else s.key end) is distinct from s.value) then
    raise exception 'Historical rating lost';
  end if;
end
$remove_values$;

-- Patrick-approved restructuring, preserving IDs and all operational history.
-- Target the account by its existing FOGs project, never by a generated row ID.
-- Run as one transaction. Any failed assertion rolls the entire migration back.
do $migration$
declare
  owner_id uuid;
  owners uuid[];
  fogs_id text;
  before_domains jsonb;
  before_goals jsonb;
  before_habits jsonb;
  before_reflections jsonb;
  before_principles jsonb;
  moves jsonb;
  career_offset integer;
  self_offset integer;
  roots integer;
  item record;
  rating record;
  mapped_key text;
  new_scores jsonb;
begin
  lock table public.domains, public.goals, public.habits,
    public.reflections, public.principles in share row exclusive mode;

  select array_agg(distinct user_id) into owners from public.goals
    where title = 'FOGs Maintenance' and parent_goal_id is null;
  if coalesce(cardinality(owners), 0) = 0 then
    raise notice 'No existing FOGs account; new accounts use the three-domain seeds.';
    return;
  end if;
  if cardinality(owners) <> 1 then
    raise exception 'Ambiguous FOGs account; refusing to migrate multiple users';
  end if;
  owner_id := owners[1];

  if not exists (select 1 from public.domains where user_id=owner_id and id='community') then
    if (select array_agg(id order by id) from public.domains where user_id=owner_id)
         is distinct from array['career','family','self']::text[]
       or not exists (select 1 from public.domains where user_id=owner_id and id='family' and name='Family & Friends')
       or not exists (select 1 from public.goals where user_id=owner_id and title='FOGs Maintenance' and domain_id='career') then
      raise exception 'Partial restructuring detected; inspect before retrying';
    end if;
    raise notice 'Three-domain migration already applied';
    return;
  end if;

  if (select array_agg(id order by id) from public.domains where user_id=owner_id)
       is distinct from array['career','community','family','self']::text[] then
    raise exception 'Unexpected source domains';
  end if;

  select jsonb_object_agg(id,to_jsonb(d)) into before_domains from public.domains d where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(g)) into before_goals from public.goals g where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(h)) into before_habits from public.habits h where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(r)) into before_reflections from public.reflections r where user_id=owner_id;
  select jsonb_object_agg(id,to_jsonb(p)) into before_principles from public.principles p where user_id=owner_id;
  career_offset := jsonb_array_length(before_domains->'career'->'values');
  self_offset := jsonb_array_length(before_domains->'self'->'values');

  select id into strict fogs_id from public.goals where user_id=owner_id
    and title='FOGs Maintenance' and parent_goal_id is null and domain_id='community';
  select count(*) into roots from public.goals where user_id=owner_id and domain_id='family'
    and parent_goal_id is null and title in ('Financial Security','Buy House','Admin & Housekeeping');
  if roots <> 3 then raise exception 'Expected three home/finance project roots'; end if;

  with recursive branches as (
    select id, 'career'::text as destination from public.goals where user_id=owner_id and id=fogs_id
    union
    select g.id, b.destination from public.goals g join branches b on g.parent_goal_id=b.id where g.user_id=owner_id
  ), home as (
    select id, 'self'::text as destination from public.goals where user_id=owner_id and domain_id='family'
      and parent_goal_id is null and title in ('Financial Security','Buy House','Admin & Housekeeping')
    union
    select g.id, b.destination from public.goals g join home b on g.parent_goal_id=b.id where g.user_id=owner_id
  ) select jsonb_object_agg(id,destination) into moves from (select * from branches union all select * from home) m;

  if exists (select 1 from public.goals where user_id=owner_id and domain_id='community' and not (moves ? id)) then
    raise exception 'Unclassified Community goals; refusing to remove their domain';
  end if;

  -- Append separate FOGs slots: Leadership/Service can have different historical
  -- ratings from the original Career slots. Never average or overwrite them.
  update public.domains set
    values = values || array(select v || ' (FOGs)' from jsonb_array_elements_text(before_domains->'community'->'values') v),
    blurb = blurb || ' ' || (before_domains->'community'->>'blurb'),
    vision = vision || E'\n\n' || (before_domains->'community'->>'vision')
    where user_id=owner_id and id='career';
  update public.domains set
    values = values || array(select jsonb_array_elements_text(before_domains->'family'->'values')),
    blurb = 'Health, personal growth, finances, housing, and personal interests.'
    where user_id=owner_id and id='self';
  update public.domains set name='Family & Friends',
    blurb='Family, friendships, and meaningful relationships.'
    where user_id=owner_id and id='family';

  -- One statement moves parents and children together under the existing FKs.
  update public.goals g set domain_id=moves->>g.id,
    value_indexes=array(select v + case when g.domain_id='community' then career_offset else self_offset end
      from unnest(g.value_indexes) with ordinality x(v,n) order by n)
    where g.user_id=owner_id and moves ? g.id;

  -- Keep every original score, including unknown legacy keys, and add its new
  -- canonical slot. Family ratings still belong to Family & Friends too.
  for item in select id,scores from public.reflections where user_id=owner_id loop
    new_scores := coalesce(item.scores,'{}'::jsonb);
    for rating in select key,value from jsonb_each(new_scores) loop
      mapped_key := null;
      if rating.key ~ '^community:[0-9]+$' and split_part(rating.key,':',2)::int < jsonb_array_length(before_domains->'community'->'values') then
        mapped_key := 'career:' || (career_offset + split_part(rating.key,':',2)::int);
      elsif rating.key ~ '^family:[0-9]+$' and split_part(rating.key,':',2)::int < jsonb_array_length(before_domains->'family'->'values') then
        mapped_key := 'self:' || (self_offset + split_part(rating.key,':',2)::int);
      end if;
      if mapped_key is not null then
        if new_scores ? mapped_key then raise exception 'Reflection slot collision: %',mapped_key; end if;
        new_scores := new_scores || jsonb_build_object(mapped_key,rating.value);
      end if;
    end loop;
    update public.reflections set scores=new_scores where id=item.id and user_id=owner_id;
  end loop;

  -- Confirm migration completeness BEFORE deleting the obsolete domain.
  if exists (select 1 from public.goals where user_id=owner_id and domain_id='community')
    or exists (select 1 from jsonb_each_text(moves) m left join public.goals g
      on g.id=m.key and g.user_id=owner_id where g.domain_id is distinct from m.value) then
    raise exception 'Contents not fully migrated';
  end if;
  if (select jsonb_object_agg(id,to_jsonb(g)-'domain_id'-'value_indexes') from public.goals g where user_id=owner_id)
       is distinct from (select jsonb_object_agg(key,value-'domain_id'-'value_indexes') from jsonb_each(before_goals)) then
    raise exception 'Goal identity, hierarchy, order, or progress changed';
  end if;
  if (select jsonb_object_agg(id,to_jsonb(h)) from public.habits h where user_id=owner_id) is distinct from before_habits
    or (select jsonb_object_agg(id,to_jsonb(p)) from public.principles p where user_id=owner_id) is distinct from before_principles then
    raise exception 'Action history or principles changed';
  end if;
  if (select jsonb_object_agg(id,to_jsonb(r)-'scores') from public.reflections r where user_id=owner_id)
      is distinct from (select jsonb_object_agg(key,value-'scores') from jsonb_each(before_reflections))
    or exists (select 1 from public.reflections r, jsonb_each(before_reflections->r.id->'scores') s
      where r.user_id=owner_id and r.scores->s.key is distinct from s.value) then
    raise exception 'Reflection records or original ratings changed';
  end if;
  if exists (select 1 from public.goals g join public.domains d on d.user_id=g.user_id and d.id=g.domain_id,
      unnest(g.value_indexes) v where g.user_id=owner_id and (v<0 or v>=cardinality(d.values))) then
    raise exception 'Invalid goal value links';
  end if;
  if exists (select 1 from public.goals g left join public.goals p on p.user_id=g.user_id and p.id=g.parent_goal_id
      where g.user_id=owner_id and g.parent_goal_id is not null and (p.id is null or p.domain_id<>g.domain_id))
    or exists (select 1 from public.habits h left join public.goals g on g.id=h.goal_id and g.user_id=h.user_id
      where h.user_id=owner_id and g.id is null) then
    raise exception 'Broken goal/action relationship';
  end if;

  delete from public.domains where user_id=owner_id and id='community';
  if (select array_agg(id order by id) from public.domains where user_id=owner_id)
       is distinct from array['career','family','self']::text[] then
    raise exception 'Expected exactly three domains';
  end if;
end
$migration$;

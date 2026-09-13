-- Reflection values used to be identified by editable labels
-- (for example, family:Love). Goals already use value slots, so rename history
-- could silently disconnect reflections from the value alignment score.
-- Canonical reflection keys now use domain_id:value_index (family:4).
--
-- This repair is idempotent, preserves unknown historical values, and prefers
-- an already-canonical score if a row happens to contain both forms.

begin;

with aliases(old_key, new_key) as (
  values
    ('family:Family Leadership', 'family:0'),
    ('family:Stability',          'family:3'),
    ('family:Love',               'family:4'),
    ('community:Community Leadership', 'community:0'),
    ('community:Friendship',            'community:1'),
    ('community:Positivity',            'community:3')
),
current_keys as (
  select d.user_id,
         d.id || ':' || value.value as old_key,
         d.id || ':' || (value.ordinality - 1)::text as new_key
  from public.domains d
  cross join lateral unnest(d.values) with ordinality as value(value, ordinality)
),
expanded as (
  select r.id,
         entry.value,
         coalesce(
           case when entry.key ~ '^[^:]+:[0-9]+$' then entry.key end,
           alias.new_key,
           current_key.new_key,
           entry.key
         ) as new_key,
         case
           when entry.key ~ '^[^:]+:[0-9]+$' then 3
           when current_key.new_key is not null then 2
           when alias.new_key is not null then 1
           else 0
         end as precedence
  from public.reflections r
  cross join lateral jsonb_each(r.scores) as entry(key, value)
  left join aliases alias on alias.old_key = entry.key
  left join current_keys current_key
    on current_key.user_id = r.user_id
   and current_key.old_key = entry.key
),
deduplicated as (
  select id, new_key, value
  from (
    select expanded.*,
           row_number() over (partition by id, new_key order by precedence desc) as rank
    from expanded
  ) ranked
  where rank = 1
),
rebuilt as (
  select id, jsonb_object_agg(new_key, value) as scores
  from deduplicated
  group by id
)
update public.reflections reflection
set scores = rebuilt.scores
from rebuilt
where reflection.id = rebuilt.id
  and reflection.scores is distinct from rebuilt.scores;

commit;

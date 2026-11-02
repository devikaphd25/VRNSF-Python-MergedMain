-- Adds CSDP-99 Week 1 Day 1 Challenge 1 after the day's existing videos.
-- The classroom server also inserts this activity the first time the instructor
-- dashboard loads that day, so this file is optional for local databases.

insert into public.activities (week_id, day_id, title, activity_type, activity_key, activity_order)
select w.id, d.id, 'Challenge 1', 'challenge', 'code_pattern', coalesce(max(a.activity_order), 0) + 1
from public.courses c
join public.weeks w on w.course_id = c.id and w.week_number = 1
join public.days d on d.week_id = w.id and d.day_number = 1
left join public.activities a on a.day_id = d.id
where replace(upper(c.course_code), '-', '') = 'CSDP99'
  and not exists (
    select 1 from public.activities existing
    where existing.day_id = d.id and existing.activity_key = 'code_pattern'
  )
group by w.id, d.id;

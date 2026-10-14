-- Run once in the EXISTING Supabase project's SQL Editor.
-- Adds course selection codes without changing activities or student results.
begin;

alter table public.courses add column if not exists access_code text;
create unique index if not exists courses_access_code_idx
  on public.courses(access_code);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.courses'::regclass
      and conname = 'courses_access_code_format'
  ) then
    alter table public.courses add constraint courses_access_code_format
      check (access_code is null or access_code ~ '^[0-9]{6}$');
  end if;
  if not exists (select 1 from public.courses where course_code = 'CSDP-120') then
    raise exception 'CSDP-120 was not found. Check the selected Supabase project.';
  end if;
end $$;

update public.courses set access_code = '123456'
where course_code = 'CSDP-120';

notify pgrst, 'reload schema';
commit;

select course_code, title, access_code from public.courses
where course_code = 'CSDP-120';

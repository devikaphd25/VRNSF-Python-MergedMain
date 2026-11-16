-- Current Supabase schema: 12 classroom tables, day hierarchy and server-only access.
-- Bootstrap for a NEW EMPTY Supabase database, run as postgres.
-- This is not an upgrade script or a data/Storage backup. Do not run against
-- the existing project. No courses, questions, results or media are inserted.
begin;
create table public.courses (
 id bigint generated always as identity primary key,
 course_code text not null unique,
 access_code text unique constraint courses_access_code_format check(access_code is null or access_code ~ '^[0-9]{6}$'),
 title text not null
);
create table public.weeks (
 id bigint generated always as identity primary key,
 course_id bigint not null references public.courses(id),
 week_number integer not null check(week_number>0),
 title text not null,
 unique(course_id,week_number)
);
create table public.days (
 id bigint generated always as identity primary key,
 week_id bigint not null references public.weeks(id),
 day_number integer not null check(day_number>0),
 title text not null,
 unique(week_id,day_number),
 unique(id,week_id)
);
create table public.activities (
 id bigint generated always as identity primary key,
 week_id bigint not null references public.weeks(id),
 day_id bigint,
 title text not null,
 activity_type text not null check(activity_type in ('video','challenge','debrief','game','display_room')),
 activity_order integer not null check(activity_order>0),
 file_path text,
 activity_key text,
 constraint activities_day_week_fkey foreign key(day_id,week_id) references public.days(id,week_id)
);
-- Order restarts for each day. Legacy rows without a day retain week-level uniqueness.
create unique index activities_day_order_idx
 on public.activities(day_id,activity_order) where day_id is not null;
create unique index activities_legacy_week_order_idx
 on public.activities(week_id,activity_order) where day_id is null;
create table public.users (
 id bigint generated always as identity primary key,
 full_name text not null,
 email text unique,
 role text not null check(role in ('student','instructor')),
 device_id text unique
);
create table public.class_sessions (
 id bigint generated always as identity primary key,
 week_id bigint not null references public.weeks(id),
 day_id bigint,
 instructor_id bigint not null references public.users(id),
 active_activity_id bigint references public.activities(id),
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 constraint class_sessions_day_week_fkey foreign key(day_id,week_id) references public.days(id,week_id)
);
create index class_sessions_day_idx on public.class_sessions(day_id);
create table public.participants (
 id bigint generated always as identity primary key,
 session_id bigint not null references public.class_sessions(id),
 student_id bigint not null references public.users(id),
 seat_name text,
 joined_at timestamptz not null default now(),
 unique(session_id,student_id)
);
create table public.challenge_questions (
 id bigint generated always as identity primary key,
 activity_id bigint not null references public.activities(id),
 question_order integer not null check(question_order>0),
 question_type text not null check(question_type in ('true_false','multiple_choice','drag_drop')),
 question_text text not null,
 options jsonb,
 correct_answer jsonb not null,
 unique(activity_id,question_order)
);
create table public.challenge_results (
 id bigint generated always as identity primary key,
 participant_id bigint not null references public.participants(id),
 activity_id bigint not null references public.activities(id),
 attempt_number integer not null default 1 check(attempt_number>0),
 score numeric not null default 0,
 status text not null default 'in_progress' check(status in ('in_progress','completed','stopped')),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(participant_id,activity_id,attempt_number)
);
create table public.challenge_responses (
 id bigint generated always as identity primary key,
 challenge_result_id bigint not null references public.challenge_results(id),
 question_id bigint not null references public.challenge_questions(id),
 student_answer jsonb,
 is_correct boolean,
 unique(challenge_result_id,question_id)
);
create table public.game_results (
 id bigint generated always as identity primary key,
 participant_id bigint not null references public.participants(id),
 activity_id bigint not null references public.activities(id),
 attempt_number integer not null default 1 check(attempt_number>0),
 score numeric not null default 0,
 status text not null default 'in_progress' check(status in ('in_progress','completed','stopped')),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(participant_id,activity_id,attempt_number)
);
create table public.game_responses (
 id bigint generated always as identity primary key,
 game_result_id bigint not null references public.game_results(id),
 item_key text not null,
 student_answer jsonb,
 is_correct boolean,
 submitted_at timestamptz not null default now()
);
-- Legacy inserts without day_id use the week's Day 1 when it exists.
-- Explicit selections are checked against their week by the composite foreign keys.
create function public.default_classroom_day()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.day_id is null then
    select d.id into new.day_id from public.days d
    where d.week_id = new.week_id and d.day_number = 1;
  end if;
  return new;
end;
$$;
revoke all on function public.default_classroom_day() from public, anon, authenticated;
create trigger activities_default_day before insert or update of week_id, day_id
  on public.activities for each row execute function public.default_classroom_day();
create trigger class_sessions_default_day before insert or update of week_id, day_id
  on public.class_sessions for each row execute function public.default_classroom_day();

-- Browser roles have no direct table access. Only the Node server uses service_role.
do $$
declare
  table_name text;
  sequence_name text;
begin
  foreach table_name in array array[
    'courses', 'weeks', 'days', 'activities', 'users', 'class_sessions', 'participants',
    'challenge_questions', 'challenge_results', 'challenge_responses',
    'game_results', 'game_responses'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    sequence_name := pg_get_serial_sequence(format('public.%I', table_name), 'id');
    if sequence_name is not null then
      execute format('revoke all privileges on sequence %s from public, anon, authenticated', sequence_name);
      execute format('grant usage, select on sequence %s to service_role', sequence_name);
    end if;
  end loop;
end $$;

-- Verify access before committing. Unexpected inherited/column grants cause a
-- rollback, so a partially secured database is never reported as successful.
do $$
declare
  table_name text;
  client_role text;
  table_oid oid;
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    raise exception 'Expected Supabase service_role to bypass RLS; no changes committed.';
  end if;
  foreach table_name in array array[
    'courses', 'weeks', 'days', 'activities', 'users', 'class_sessions', 'participants',
    'challenge_questions', 'challenge_results', 'challenge_responses',
    'game_results', 'game_responses'
  ] loop
    table_oid := format('public.%I', table_name)::regclass;
    if not (select relrowsecurity from pg_class where oid = table_oid) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
    foreach client_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(client_role, table_oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        or has_any_column_privilege(client_role, table_oid, 'SELECT, INSERT, UPDATE, REFERENCES') then
        raise exception 'Unexpected remaining grants for % on public.%; no changes committed.', client_role, table_name;
      end if;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;

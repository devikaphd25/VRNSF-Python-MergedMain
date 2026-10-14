-- Fresh installation of the classroom's 11-table schema.
-- Existing new-account databases already have these tables: do not drop them.
-- RLS is intentionally not enabled in this prototype, as requested.
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
create table public.activities (
 id bigint generated always as identity primary key,
 week_id bigint not null references public.weeks(id),
 title text not null,
 activity_type text not null check(activity_type in ('video','challenge','debrief','game','display_room')),
 activity_order integer not null check(activity_order>0),
 file_path text,
 activity_key text,
 unique(week_id,activity_order)
);
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
 instructor_id bigint not null references public.users(id),
 active_activity_id bigint references public.activities(id),
 started_at timestamptz not null default now(),
 ended_at timestamptz
);
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
notify pgrst, 'reload schema';
commit;

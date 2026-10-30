# UMES VR Classroom

A shared browser/Quest classroom with videos, three challenges, debrief images,
a Python puzzle, and a computer hardware display room.

## Project layout

Work from the repository root, the folder containing this README and `package.json`.
The classroom and Python puzzle are integrated into one application. The old
nested `VR-learning-main/` copy has been removed; do not upload another complete
project folder inside this repository.

| Location | Contents |
| --- | --- |
| `src/` | Browser and Quest classroom, instructor dashboards, avatars and activities. |
| `src/games/python-puzzle/` | Python puzzle room, block interaction and Python execution. |
| `src/games/python-types/` | Python type-card game implementation. |
| `server.ts`, `server/` | Class coordination, activity events and database access. |
| `ui/` | UIKitML interface source files, including the puzzle controls. |
| `public/` | Required models, textures and audio; compiled UI is generated during build. |
| `supabase/` | One current schema for bootstrapping a separate empty Supabase database. |
| `tests/` | Automated checks; database integration tests are opt-in. |

The puzzle opens from the instructor dashboard's `python-puzzle` activity. It uses
the shared class session, live progress monitor, instructor stop/return controls,
and game result storage. Preserve these connections when editing the puzzle files.
Python execution loads Pyodide from its CDN, so the puzzle needs internet access.

In the Display Room on Quest, point at a small **PICK UP** button below a model.
With your tracked right hand, pinch thumb and index finger and keep pinching to
hold and rotate the copy; open your fingers to release. With a controller, tap the
right trigger to pick up and tap again to release. You can also bring your left hand near and
close/grip it to rotate with both hands. Opening the left hand returns to right-hand
control. The original hold-grip gesture remains available. Palm/finger collision volumes push the
copy out of the tracked hands; this is visual contact, not physical force feedback.
Release to float it and grab it again by pointing or reaching near
it. Each visitor has one copy; a released copy disappears after 20 seconds, and
leaving the room removes it. The originals stay on display. Hand tracking must be
enabled on the headset. The controller trigger still operates Return to Class.

When contributing, clone the repository, create a branch, and edit the existing
folders above. Submit a pull request instead of uploading a ZIP's parent folder.

## Use the existing new Supabase project

1. Install Node 22.12+ (or Node 24) and run `npm ci`.
2. Copy `.env.template` to `.env.server`. Enter the new project's root URL and
   server secret key, shared privately by the project owner. Do not include `/rest/v1`.
3. Copy `.env.development.example` to `.env.development`. Course codes are stored in Supabase, not this environment file.
4. Run `npm run dev:server` in one terminal and `npm run dev:runtime` in another.
5. Open `https://localhost:8081`. On a Quest, use the computer's LAN address on
   port 8081. Both devices must reach that computer; trust the development certificate.
6. Enter as Professor and use the course’s six-digit access code to create a session, then join as Student on other devices.

No Supabase key is needed in the browser. Browser requests and Socket.IO use the
same HTTPS origin; Vite proxies them to port 3001. For deployment, configure the
same `/api` and `/socket.io` reverse proxy (including WebSocket upgrades), or set
`VITE_SERVER_URL` for sockets. API requests still use `/api` on the site's origin.
Environment files are ignored by Git. Never put a server secret in a `VITE_` variable.
A course code selects the curriculum; it is not account authentication.

The existing database already contains course codes and the week/day hierarchy.
Course access codes are unique six-digit text values in `courses.access_code`;
keep them as text so leading zeros are preserved. No setup SQL needs to be rerun
for the current project.

The instructor enters the course code and presses Continue. A second screen
shows the course title with week and day selectors, Start Class, and Back to
Course Code. Validating the code does not create a session. Students wait until
Start Class is pressed. The selected week and day are stored in `class_sessions`. Each dashboard request uses that session,
so changing a server environment value cannot silently swap an existing class's
content. An unknown code shows an error and creates no session. Students continue
to join the live class automatically; they do not need the instructor's course code.

This deployment supports one live class at a time. End it before selecting another
course. This prevents broadcasts and students from mixing between simultaneous classes.

CSDP-99 uses instructor course code `990099`. Week 1 contains Day 1 and Day 2,
with seven videos per day, ordered by segment and video number. Its temporary
course title is `CSDP-99`. Media lives under
`course-media/csdp-99/week1/day-{1,2}/videos/` in Supabase Storage.
The videos are already stored in Supabase; the one-off import tools and reports
were removed during project cleanup.

The new account already contains tables and Week1 content. **Do not run the fresh
schema against that existing database.** Changing the local connection does not
delete or modify the old Supabase project.

## Schema for a separate empty Supabase project

`supabase/schema.sql` is the consolidated current structure: all 12 tables,
course access-code constraints, weeks/days, per-day activity ordering, same-week
foreign keys, default-day triggers, server-only grants and RLS verification.
It replaces the old numbered schema/migration files.

Run this file only in a **new empty** Supabase project's SQL Editor as `postgres`.
It is not an upgrade script for the current database and does not insert courses,
questions, students, results or media. Keep/export those records separately if
migrating to another project. The previous Week 1 starter seed was removed; a
schema file alone cannot restore the existing curriculum.

For a new project, populate courses, weeks, days, activities and questions from a
separate data export or new curriculum. Set six-digit course access codes, and
create a Storage bucket named `course-media` with the matching media files.
Avatar URLs in `shared/vr-avatar-catalog.json` also need updating if moving their
Storage to another project.

Activity media paths use the form
`supabase://course-media/csdp-120/week1/videos/1_Video.mp4`. The server creates
expiring playback URLs. An uploaded object needs a matching `activities` row,
including its week, day, title, type and unique order within the day.

Browser roles have no direct application-table access. The Node server uses its
secret/service-role key; keep it only in `.env.server`. Database RLS and grants do
not replace authentication/authorization on the Node API.

Changing or deleting local SQL files does not modify the existing Supabase
project. Future schema changes will need a new explicit migration; do not use the
bootstrap script to upgrade a populated database.

## What comes from the database

| Tables | Purpose |
| --- | --- |
| `courses`, `weeks`, `days` | Course selected by courses.access_code; instructor chooses a week and day before starting. |
| `activities` | Dashboard titles, order, media paths and which activity implementation to launch. |
| `users` | Name, role and device identity; no password login. |
| `class_sessions` | Instructor, week, day, current activity, start/end times. |
| `participants` | Student membership and seat for one class session. |
| `challenge_questions` | Grouped questions, options and grading answers for each challenge. |
| `challenge_results`, `challenge_responses` | One summary per student attempt, plus its question answers. |
| `game_results`, `game_responses` | One summary per game attempt, plus submissions and a `__summary__` metrics record. |

Activity keys: `true_false`, `drag_drop`, `multiple_choice`, `python-puzzle`,
`display-room`. Video/debrief rows use `file_path`; they do not need a key.
The optional card game implementation remains in the project and can be shown
by adding a game activity with key `variable-sorting`.

The dashboard follows `activity_order` without regrouping tasks. Current Week1:
11 videos, 3 challenges, 3 debriefs, Python Puzzle, Display Room. Edit the ordering
in Supabase to interleave videos and challenges later; order numbers must be unique within each day.

Gameplay, rooms, 3D models and UI behavior remain in the TypeScript project.
The server keeps live timers/video position in memory and replays the current
activity to late arrivals. Restarting the server requires a new/restarted activity.
Each deployment should run one coordinating Node server for seat/attempt allocation.
Quest identity persists in that browser's local storage; clearing it changes the
identity. Desktop tabs deliberately have separate identities for classroom testing.

Challenge completion and instructor stop save summary + answer rows; unanswered
questions are stored as null. Retried network saves reuse the same attempt; choosing
Retry in Challenge 1 creates a new attempt and preserves the previous result. Failed result saves retain
server-local snapshots in `data/pending-challenge-results/` or
`data/pending-game-results/`. Keep those folders private; they are not tracked by Git.

## Challenge 1: rocket activity

The Challenge 1 interface incorporates `yixiao-lesson1-challange1` commit
`0824de8`. The existing dashboard button launches it with Supabase questions.
Correct answers unlock rocket pieces: drag the unlocked pieces onto the rocket
with the mouse or right controller trigger, then select Launch. Review and Retry
remain available until the instructor stops the activity or the timer expires.
The instructor monitor shows correct/wrong counts and accuracy for each question.

`src/systems/true-false-challenge.system.ts` and `ui/quick-challenge.uikitml` contain
this interface; `src/world/student-rocket.ts` handles rocket assembly. Challenge 3
keeps its multiple-choice interface in `database-challenge.system.ts` and
`ui/database-challenge.uikitml`. Questions and results still use the existing
Supabase tables; this update needs no database migration. Restart the Node server
and refresh browsers/headsets after updating both client and server.

## Checks

```
npm run typecheck
npm run build
npm test
```

`npm run test:database` runs opt-in tests against the configured database. It creates
a temporary course/users, verifies joins, media, challenges and game results, then
removes its own records. The existing curriculum and student results are preserved.

Welcome narration plays the existing MP3 files in `public/audio/`. Its one-off
generation script was removed during cleanup; update narration assets separately
when curriculum wording changes.

## Instructor task views

The dashboard starts in Current Task view, showing a single activity. Its header
button toggles directly between All Tasks and Current Task. Previous and Next
in the compact footer browse activities individually; the full list retains its
existing page navigation. Launching activities from All Tasks leaves the Current
Task sequence position unchanged. After launching an activity from Current Task and reopening the dashboard,
Current Task advances to the next activity in the selected day's sequence.
Returning without launching a task does not advance. After the final activity,
All Tasks lets the instructor revisit any activity. This position is kept in
memory for the current app run; refreshing resets it. No database migration is
needed. The instructor week/day selection screen is displayed at 82% of the
initial login screen's scale.

## Source organization

Use kebab-case module filenames. `.system.ts` files coordinate ECS behavior;
`.component.ts` / `.components.ts` files declare ECS state. Backend repositories
read/write Supabase data, services coordinate work, and routes expose API endpoints.
`src/index.ts`, `server.ts`, `vite.config.ts` and `src/vite-env.d.ts` keep their
conventional entry/configuration names.

| Folder | Responsibility |
| --- | --- |
| `src/avatars/` | Avatar downloads, rig preparation, poses, hands and seated placement. |
| `src/classroom/` | Seats, board content, markers and name-label visuals. |
| `src/components/` | Shared ECS data declarations. |
| `src/systems/` | Named activity and classroom coordinators, such as `true-false-challenge.system.ts` and `instructor-dashboard.system.ts`. |
| `src/challenges/` | True/False and device-classification visuals, models, sound effects and definitions. |
| `src/games/python-types/` | Python type-card game; its components, systems, deck data, state, UI and environment. |
| `src/games/python-puzzle/` | Python puzzle game; blocks, puzzle lines, execution, state and castle-themed environment. |
| `src/display-room/` | Model pickup, grab input and hand-contact helpers. |
| `src/instructor/` | Current-activity sequence and task-list pagination. |
| `src/input/` | Headset-relative movement calculations. |
| `src/presentation/` | Presentation/debrief transition effects. |
| `src/services/` | Browser API calls and device identity. |
| `src/network/` | Socket.IO client connection. |
| `src/audio/` | Student welcome/late-arrival narration. |
| `src/ui/` | Shared code-drawn graphics: countdowns, text, frames and progress steps. |
| `src/config/` | Frontend settings and default labels, without database content or behavior. |
| `src/content/` | Course/day activity types, counts and sequence lookup. |
| `src/errors/` | Frontend application error types. |
| `server/database/` | Privileged server-only Supabase client. |
| `server/repositories/` | Users, course content and activity-result database access. |
| `server/services/` | Classroom sessions, live students, result saves and broadcasts. |
| `server/routes/` | Device registration and classroom API endpoints. |
| `server/state/` | Temporary live classroom state, room activity and lab attempts. |
| `server/config/` | Server challenge settings. |
| `server/utils/` | Shared backend utilities such as keyed work queues. |
| `shared/` | Browser/server protocol identifiers, avatar catalog and tracking definitions. |
| `tests/` | All automated tests, including room-activity tests formerly mixed into server source. |

The root `ui/` folder contains editable UIKitML layouts; `public/ui/` contains
their generated JSON. These differ from the drawing code in `src/ui/`.
Course titles, day activities, questions and media references come from Supabase.
Game card/puzzle definitions and device model definitions live with their games
and challenges. Root `server.ts` still coordinates Socket.IO events; this refactor
does not change network event names, stored data, asset URLs or UI layout IDs.

All TypeScript modules were inventoried during the organization review. Large
entry/system files retain their existing responsibilities rather than combining
an architecture move with changes to gameplay behavior. Further splitting those
modules can be done as a separate, tested change.

## Quest test APK

`apk/` contains the packaging helpers and local Android project/toolchain.
See `apk/README.md` for the test-host and rebuild procedure. The signed test APK
opens a temporary HTTPS tunnel to this computer, so the computer, Node host and
tunnel must stay running. A changed tunnel origin requires rebuilding the APK.
Signing material under `apk/signing/` is private and excluded from Git/public
assets. `SERVE_WEB_APP=true` enables serving only the production `dist/` folder
from the Node server, including the public Digital Asset Links endpoint.

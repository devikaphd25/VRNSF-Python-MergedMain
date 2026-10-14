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
| `src/castle/` | Python puzzle room, block interaction and Python execution. |
| `src/lab/` | Optional card game implementation. |
| `server.ts`, `server/` | Class coordination, activity events and database access. |
| `ui/` | UIKitML interface source files, including the puzzle controls. |
| `public/` | Required models, textures and audio; compiled UI is generated during build. |
| `supabase/` | Current schema, optional Week1 content and course-code migration. |
| `tests/` | Automated checks; database integration tests are opt-in. |

The puzzle opens from the instructor dashboard's `python-puzzle` activity. It uses
the shared class session, live progress monitor, instructor stop/return controls,
and game result storage. Preserve these connections when editing the puzzle files.
Python execution loads Pyodide from its CDN, so the puzzle needs internet access.

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

For the existing database, run `supabase/02-course-access-codes.sql` once.
It adds a unique, six-digit `courses.access_code` and assigns `123456` to CSDP-120.
For other courses, set another six-digit value in their `access_code` column.
Keep the column as text so a leading zero is preserved. Restart the Node server
and refresh the browser after updating this code.

The instructor's entered code is looked up by the server. The resulting course
and week are stored in `class_sessions`. Each dashboard request uses that session,
so changing a server environment value cannot silently swap an existing class's
content. An unknown code shows an error and creates no session. Students continue
to join the live class automatically; they do not need the instructor's course code.

This deployment supports one live class at a time. End it before selecting another
course. This prevents broadcasts and students from mixing between simultaneous classes.

The new account already contains tables and Week1 content. **Do not run the fresh
schema against that existing database.** Changing the local connection does not
delete or modify the old Supabase project.

## Create a separate empty Supabase project

Run these files in SQL Editor, in order:

1. `supabase/00-schema.sql`: the 11 application tables.
2. `supabase/01-week1-content.sql`: course, Week1, 19 activities and 12 questions.

Create a Storage bucket named `course-media` (private is supported). Upload the
media using the exact paths referenced by `activities.file_path`:

```
course-media/
  csdp-120/week1/videos/1_Video.mp4
  csdp-120/week1/videos/2_Video.mp4
  csdp-120/week1/videos/3_Video_small.mp4
  csdp-120/week1/videos/4_Video.mp4 ... 11_Video.mp4
  csdp-120/week1/images/five-parts-of-every-computer-debrief.png
  csdp-120/week1/images/loading-and-classification-debrief.png
  csdp-120/week1/images/language-ladder-and-translators-debrief.png
```

Lesson videos are not included in Git. A path in the database looks like
`supabase://course-media/csdp-120/week1/videos/1_Video.mp4`. The server creates
expiring playback links. Uploading a file alone does not create an activity:
add a row to `activities`, with its title, type and unique order within the week.
RLS is intentionally not enabled in this prototype schema, as requested.

## What comes from the database

| Tables | Purpose |
| --- | --- |
| `courses`, `weeks` | Course selected by courses.access_code; WEEK_NUMBER selects the week (default 1). |
| `activities` | Dashboard titles, order, media paths and which activity implementation to launch. |
| `users` | Name, role and device identity; no password login. |
| `class_sessions` | Instructor, week, current activity, start/end times. |
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
in Supabase to interleave videos and challenges later; order numbers must be unique.

Gameplay, rooms, 3D models and UI behavior remain in the TypeScript project.
The server keeps live timers/video position in memory and replays the current
activity to late arrivals. Restarting the server requires a new/restarted activity.
Each deployment should run one coordinating Node server for seat/attempt allocation.
Quest identity persists in that browser's local storage; clearing it changes the
identity. Desktop tabs deliberately have separate identities for classroom testing.

Challenge completion and instructor stop save summary + answer rows; unanswered
questions are stored as null. Retries reuse an attempt. Failed result saves retain
server-local snapshots in `data/pending-challenge-results/` or
`data/pending-game-results/`. Keep those folders private; they are not tracked by Git.

## Checks

```
npm run typecheck
npm run build
npm test
```

`npm run test:database` runs opt-in tests against the configured database. It creates
a temporary course/users, verifies joins, media, challenges and game results, then
removes its own records. The existing curriculum and student results are preserved.

The welcome narration is generated with
`node --env-file=.env.server --import tsx scripts/generate-welcome-audio.ts CSDP-120` on macOS
(with `ffmpeg` installed). It reads activity counts from the selected database week;
regenerate after changing the curriculum. Playback uses the generated MP3.

# UMES VR Classroom

A shared browser/Quest classroom with videos, three challenges, debrief images,
a Python puzzle, and a computer hardware display room.

## Production deployment: one Node process

Production uses **one running Node server** for the website, `/api`, and
`/socket.io` (Socket.IO/WebSockets). Vite runs only during the build. The backend
is compiled to JavaScript; production does not run `tsx` or two development servers.
These commands work in PowerShell, macOS Terminal, and Linux shells:

```bash
npm ci --include=dev
npm run build
npm start
```

`npm run build` builds both parts:

- `npm run build:web` → browser files and assets in `dist/`.
- `npm run build:server` → `build/server.js`, backend modules, and shared JSON/config.

Install development dependencies **before building** because Vite and TypeScript
are build tools. After a successful build, an operator can optionally run
`npm prune --omit=dev` and then `npm start`. For a separate runtime image, use
`npm ci --omit=dev` there and copy the already-built artifacts from the build image.
A static-site-only host cannot run this backend; choose a Node web service/VPS
with long-running WebSocket connections.

### Hosting configuration to give Sagar

| Setting | Value |
| --- | --- |
| Node version | Node 24 recommended. |
| Build command | `npm ci --include=dev && npm run build` (include development dependencies at build time). |
| Start command | `npm start` |
| Health-check path | `/api/health` (returns `{ "status": "ok" }` after startup). |
| Application process count | One coordinating Node process / one replica. |
| `SUPABASE_URL` | Existing Supabase project root URL; provide privately with the key. |
| `SUPABASE_SECRET_KEY` | Existing project's private server secret; set as a hosting secret. |
| `PORT` | Hosting platform's assigned port. For a VPS you can choose `3100`; otherwise the app defaults to `3001`. |
| `VITE_SERVER_URL` | Leave empty/unset at build time so browser sockets use the public site's HTTPS origin. |

`npm start` sets `NODE_ENV=production` and `SERVE_WEB_APP=true`. It optionally loads
`.env.server` from the project root; hosting environment variables take precedence.
It can start without that file when the hosting platform supplies the variables.
Missing credentials or build outputs produce an explicit startup error.

For manual hosting, `.env.server` can contain:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_PRIVATE_SERVER_KEY
PORT=3100
```

Use the existing database; **do not rerun the bootstrap schema**. Never place this
private environment file in `dist/` or GitHub. To start a previously built app,
run `npm start` from the repository root. Keep the service running with the
hosting platform's service manager, with one instance rather than a multi-worker
cluster. Restart it after deploying a new build.

If copying artifacts instead of cloning the source, the runtime needs:
`dist/`, `build/`, `server/start-production.mjs`, `package.json`,
`package-lock.json`, production `node_modules/`, and securely supplied environment
values. Preserve a writable private `data/` directory across restarts/deployments
for failed-result recovery snapshots; it is not served publicly.

### Public HTTPS and WSS

Point a permanent HTTPS domain to the hosting service. Its proxy forwards **all
paths**, including `/api` and `/socket.io`, to the same Node port, and supports
WebSocket upgrades. Public clients use `https://YOUR_DOMAIN/`; Socket.IO uses the
same origin and secure WebSockets (`wss://`) through that proxy. There is no second
WSS server or separate WSS build.

The Node port itself uses HTTP behind the HTTPS proxy; do not point Quest directly
at that internal HTTP port. Keep the application's internal port private to the
proxy when configuring the host firewall. See the official
[Socket.IO reverse-proxy examples](https://socket.io/docs/v4/reverse-proxy/).

After the host is configured, check:

1. `https://YOUR_DOMAIN/api/health` returns `status: ok`.
2. `https://YOUR_DOMAIN/` opens the classroom.
3. Instructor and student devices on that domain can join the same class and
   receive activity/video changes without reconnect errors.
4. Quest Browser can enter XR over the trusted HTTPS connection.

Once the permanent domain works, rebuild the Quest APK with that launch origin
and the original signing key. Upload the new version through Meta Device Manager.
The hosting platform/domain have not been selected in this repository; these
instructions prepare the app but do not provision a public server or certificate.

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
| `dist/` | Generated frontend build, ignored by Git. |
| `build/` | Generated backend JavaScript and shared data, ignored by Git. |

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

## Run locally with the existing Supabase project

Use Node.js **22.12+ in the Node 22 series, or Node 24**, and npm. Open Terminal
in the project root. On a fresh computer:

```bash
git clone https://github.com/UMESVRTeam/VR-learning.git
cd VR-learning
git switch main
npm ci
cp -n .env.template .env.server
cp -n .env.development.example .env.development
```

If you already cloned the project, use your existing project folder instead.
Copy the environment templates only on first setup; do not overwrite configured
local files. If an environment file already exists, edit it rather than copying
its template again.

### Which Supabase credentials do I need?

The Node server reads these two values from **`.env.server`**:

| Variable | Value | Where to get it |
| --- | --- | --- |
| `SUPABASE_URL` | Project root URL, such as `https://YOUR_PROJECT.supabase.co`, without `/rest/v1`. | Supabase project's Connect dialog / API settings, or the project owner. |
| `SUPABASE_SECRET_KEY` | A server **secret key** (`sb_secret_...`). | Project Settings → API Keys → Publishable and secret API keys; request it privately from the project owner. |

A legacy **`service_role`** key also works in the `SUPABASE_SECRET_KEY` variable
while that legacy key is enabled. A publishable/`anon` key cannot replace the
server key in this app: its database tables intentionally deny browser access.
No Supabase account password, database password, or personal access token is
needed to run the Node server. See [Supabase API key documentation](https://supabase.com/docs/guides/getting-started/api-keys).

Example `.env.server` (**placeholders, not usable credentials**):

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=[REDACTED_SUPABASE_SECRET]
WEEK_NUMBER=1
PORT=3001
```

The server key has privileged database access and bypasses RLS. **Never commit it
to GitHub, put it in a `VITE_` variable, or send it to a browser/headset.** Share it
only with trusted backend developers through a private password-manager share or
another approved private channel. The repository contains examples only; each
backend developer creates their own ignored `.env.server` locally.

Teammates who only need to **join a running classroom** do not need Supabase
credentials. Share the running app's HTTPS address with them. Only the person
running the Node server needs the private server key. Each independently started
backend has its own in-memory live session, so everyone in the same class must use
the same backend.

Keep `.env.development` as:

```dotenv
VITE_SERVER_URL=
```

Empty means use the current HTTPS origin. Vite forwards `/api` and `/socket.io`
to the Node server on port **3001**. Keep `PORT=3001` for normal development; a
different backend port requires changing both Vite proxy targets.

### Start the normal browser development app

```bash
npm run dev:full
```

Leave that Terminal open. Open **https://localhost:8081/** on the computer.
Both the HTTPS frontend (**8081**) and Node API/Socket.IO server (**3001**) must
be running. To stop a run, press **Control+C** in its Terminal.

If the IWSDK launcher reports `dev_up_timeout`, start the same app directly with
two Terminal tabs instead. Stop the failed run first:

```bash
# Terminal 1, in the project root
npm run dev:server
```

```bash
# Terminal 2, in the same project root
npm run dev:runtime
```

Open **https://localhost:8081/**. `dev:runtime` starts Vite directly and avoids the
IWSDK CLI runtime-registration wait; it still compiles the UI and proxies the API.

### Start and join a class

1. Open the app as **Professor** and enter the course's six-digit code from the
   project owner. Course codes are stored in Supabase, not in environment files.
2. Choose **week and day**, then press **Start Class**.
3. Open the same app address on student devices and enter as **Student**. Students
   join the active class automatically; they do not enter the instructor's code.
4. Use one coordinating Node server and one active class at a time. End the
   current class before starting another course/day.

A course code selects curriculum; it is not account authentication. The existing
Supabase project already contains the schema and course content. **Do not rerun
`supabase/schema.sql` against it.** Credentials connect to that data; cloning this
repository does not copy the database or Storage videos.

### Headsets, Wi-Fi, and the APK

For LAN development, Quest Browser uses the **Network** URL printed by Vite,
for example `https://YOUR_COMPUTER_LAN_IP:8081/`, never `localhost` (that would mean
the headset itself). The headset must be able to reach the computer; the development
HTTPS certificate must be trusted on that headset for WebXR. A desktop certificate
warning bypass does not install trust on a Quest. The LAN IP may change when the
computer changes Wi-Fi. Use a trusted HTTPS tunnel if certificate trust is not set up.

The APK uses a separate production host and a trusted HTTPS launch address.
See [APK-UPDATE-STEPS.txt](APK-UPDATE-STEPS.txt) and [apk/README.md](apk/README.md).
After `npm run build`, set `PORT=3100` in the private `.env.server` (or hosting
environment), then run:

```bash
npm start
```

This serves `dist/` and the API together on the configured port. Keep that host and its
tunnel running. A temporary tunnel may get a new URL after restarting; rebuild the
APK with the same signing key when its launch origin changes. The APK binary,
signing keys, and local Android toolchains are excluded from Git.

### Common startup errors

| Symptom | What to do |
| --- | --- |
| `EADDRINUSE` on `3001` or `3100` | Another backend is listening on that port. Stop its original Terminal with Control+C before restarting. Do not launch duplicate servers. |
| `Port 8081 is already in use` | A frontend is already running. Use it or stop its Terminal before starting another. |
| Unsure which process owns a port (macOS) | Inspect it with `lsof -nP -iTCP:3001 -sTCP:LISTEN` (replace `3001` with the relevant port). |
| Missing Supabase environment values | Create `.env.server` in the project root, fill both credentials, then restart the backend. |
| Invalid API key / denied database access | Confirm the URL and server secret belong to the same Supabase project. A browser publishable/anon key is insufficient. |
| Course code not found | Request the correct six-digit code; do not change the Supabase credentials or rerun schema SQL. |
| Tunnel URL does not load | Confirm the local host works first. A printed tunnel URL is not proof of a connected tunnel; check its connection logs before rebuilding the APK. |

For deployment, serve `/api` and `/socket.io` on the frontend's HTTPS origin,
including WebSocket upgrades. `VITE_SERVER_URL` can change the socket destination,
but the browser API still uses `/api` on the site's origin.

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
with **11 videos per day**, ordered by the numeric filename prefix. Its temporary
course title is `CSDP-99`. Media lives under
`course-media/csdp-99/week1/day-{1,2}/videos/` in Supabase Storage.
The videos are already stored in Supabase; the one-off import tools and reports
were removed during project cleanup.

CSDP-120 Week 13 Day 2 contains 12 videos, ordered by the numeric filename prefix.

The shared project already contains its tables and curriculum. **Do not run the fresh
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

The Challenge 1 interface incorporates `yixiao-lesson1-challange1` commits
`0824de8` and `85cf48c`, adapted to the current project structure. The existing dashboard button launches it with Supabase questions.
Correct answers unlock rocket pieces: drag the unlocked pieces onto the rocket
with the mouse or right controller trigger, then select Launch. Review remains available until the instructor stops the activity. A student can
submit **three total attempts** (the first submission plus two retries) while the
shared timer permits. Each acknowledged retry preserves the previous result.
The common limit is defined in `shared/true-false-settings.ts`.
The instructor monitor shows correct/wrong counts and accuracy for each question.

`src/systems/true-false-challenge.system.ts` and `ui/quick-challenge.uikitml` contain
this interface; `src/challenges/true-false/student-rocket.ts` handles rocket assembly. Challenge 3
keeps its multiple-choice interface in `src/systems/multiple-choice-challenge.system.ts` and
`ui/database-challenge.uikitml`. Questions and results still use the existing
Supabase tables; this update needs no database migration. Restart the Node server
and refresh browsers/headsets after updating both client and server.

## Dependency updates and installation warnings

Use `npm ci` after pulling dependency updates so every developer installs the
versions recorded in `package-lock.json`. Commit `package.json` and the lockfile
together when changing dependencies. Check the result with:

```bash
npm audit
npm audit --omit=dev
npm run typecheck
npm test
npm run build
```

The security update retains IWSDK `0.4.2` and overrides its transitive `sharp`
dependency to `0.35.5`. Older IWSDK dependency ranges otherwise retain vulnerable
image-library versions. The override was checked against the SDK screenshot
resize path and the reference tool's image decoding/resizing. Keep it until a
tested SDK update supplies patched versions itself; do not use
`npm audit fix --force` to switch the SDK to an unrelated prerelease.

Two upstream development-tool packages may still emit deprecation warnings:
`@fortawesome/react-fontawesome@0.2.2` (emulator UI) and `boolean@3.2.0` (reference
search's ONNX tooling). Deprecation warnings and npm funding notices do not mean
installation failed. They are separate from the security audit result. Updating
those tools further needs its own compatibility review.

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
existing page navigation. Green dots mark activities that have been run. Switching
to Current Task scans the selected day's `activity_order` from the beginning and
shows the first activity without a green dot. For example, running videos 1, 2,
and 11 in All Tasks makes Current Task show video 3. A later green dot does not
skip earlier unfinished work. Returning from a Current Task launch also resumes
at the first unfinished activity. Manual Previous/Next browsing does not mark
activities complete. Once every task is green, All Tasks allows revisiting them.
This progress is kept in memory for the current app run; refreshing resets it.
No database migration is needed. The instructor week/day selection screen is displayed at 82% of the
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

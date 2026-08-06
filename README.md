# UMES VR Classroom

UMES VR Classroom is a synchronous WebXR learning environment built with the
Meta Immersive Web SDK, Three.js, Socket.IO, and Supabase. It provides a shared
virtual classroom for instructors and students, an integrated Python learning
lab, classroom challenges, persistent seating, and instructor result tracking.

The application runs in a desktop browser, the local Meta Quest emulator, and
a physical Meta Quest headset.

## Current workflow

1. The instructor selects **Professor** and enters the six-digit verification
   PIN configured for the application.
2. The application creates the active classroom.
3. Students select **Student** and automatically join the latest active room.
4. Each headset receives a persistent device identity, student name, and fixed
   seat.
5. The instructor can teach in Classroom Mode, start an activity, review
   results, return students to class, or end the classroom session.

Students do not need to enter a classroom code. The first deployment supports
one active class at a time to minimize student input.

## Features

### VR classroom

- 25 fixed student seats across five tiered rows
- NASA-inspired classroom styling and space-window environment
- Browser, mouse, Meta Quest controller-ray, and WebXR support
- Persistent headset identity and automatic seat assignment
- Instructor stage position and student avatars
- Student hand raising and instructor notifications
- Classroom, presentation, lab, and challenge modes

### Instructor dashboard

- Controller-ray-compatible floating dashboard
- Online student count
- Two lesson pages with three task buttons per page
- Variable Sorting lab launcher
- True-or-False challenge launcher
- Quick Challenge monitoring
- Lab result monitoring and CSV export
- End Class control

Lesson text is separated from dashboard behavior in
`src/config/instructor-menu-content.ts`. This allows the current local content
to be replaced by Supabase content later without rewriting menu pagination.

### Python Type Lab

The integrated lab is a 12-card Python data-type sorting activity. Students
sort values into `int`, `float`, `bool`, and `str` bins. The system records:

- score and streak;
- correct and incorrect attempts;
- accuracy;
- completed exercises;
- duration;
- completion status; and
- whether the student completed the activity or was returned by the instructor.

The student remains in the same WebXR application during the transition. The
headset session, identity, seat, and Socket.IO connection remain active.

### Quick Challenge

- One multiple-choice question with four answer options
- Mouse and VR controller-ray selection
- Instructor view of student answers
- Correct/incorrect status monitoring
- Automatic return to the classroom workflow

## Database

The current testing environment uses hosted Supabase. The same migrations can
later be deployed to a university-managed local Supabase installation.

| Table | Purpose |
| --- | --- |
| `rooms` | Stores classroom sessions, active status, presentation state, and timestamps. |
| `participants` | Stores the instructor and students participating in each room, including device identity and assigned seat. |
| `quiz_questions` | Stores multiple-choice questions and their available answers. |
| `quiz_responses` | Stores each student's selected answer and correctness result. |
| `app_users` | Stores permanent application identities, full names, roles, device IDs, fixed seats, and current locations. |
| `game_results` | Stores Python lab scores, duration, completion status, and completion date. |

Database migrations are located in:

- `supabase/room-code-migration.sql`
- `supabase/app-data-migration.sql`

Run `room-code-migration.sql` first, followed by
`app-data-migration.sql`.

## Architecture

- `src/index.ts` creates and coordinates the shared WebXR world.
- `src/systems/vr-login.system.ts` controls the in-headset login panel.
- `src/systems/instructor-menu.system.ts` controls instructor dashboard behavior.
- `src/config/instructor-menu-content.ts` contains editable lesson/task content.
- `src/systems/quick-challenge.system.ts` controls the student challenge panel.
- `src/lab/` contains the Python lab environment and activity systems.
- `src/lab/LabEnvironmentManager.ts` switches between classroom and lab modes.
- `src/services/` contains Supabase classroom and device services.
- `server.js` maintains Socket.IO classroom connections and activity sessions.
- `server/services/` provides server-side Supabase access.
- `ui/` contains the UIKitML interface definitions.
- `supabase/` contains the database migrations.

## Requirements

- Node.js 20.19 or later
- npm
- A Supabase project with the supplied migrations installed
- Meta Quest Browser for physical-headset testing

## Installation

```bash
git clone https://github.com/UMESVRTeam/VR-learning.git
cd VR-learning
git switch feature/supabase-only
npm install
```

## Environment configuration

Create `.env.development` in the project root for browser-safe values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_PROFESSOR_VERIFICATION_CODE=YOUR_SIX_DIGIT_PIN
```

Create `.env.server` for server-only values:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SECRET_KEY
PORT=3001
```

Do not commit either environment file or expose `SUPABASE_SECRET_KEY` in client
code.

## Running the project

Start the WebXR application and Socket.IO server together:

```bash
npm run dev:full
```

Default local endpoints:

- WebXR application: `https://localhost:8081`
- Socket.IO server: `http://localhost:3001`

If port `3001` is already in use, locate and stop the old process before
restarting:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
kill <PID>
```

## Verification

Build the project:

```bash
npm run build
```

Type-check the source:

```bash
npx tsc --noEmit
```

For a two-user test, open one browser session as the instructor and a second
incognito browser or headset session as a student. Start an activity, complete
it as the student, return to the classroom, and confirm that the instructor can
open the saved result.

## Security notes

The Professor PIN is a simple classroom gate, not full production
authentication. Before a production deployment, use authenticated instructor
accounts, signed sessions, appropriate Row Level Security policies, HTTPS, and
server-side secret management.

## Branch integration

The active integrated implementation is developed on
`feature/supabase-only`. Changes should be reviewed through a pull request
before merging into `main`.

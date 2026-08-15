# UMES VR Classroom

UMES VR Classroom is a synchronous WebXR learning environment built with the Meta Immersive Web SDK, Three.js, Socket.IO, and Supabase. It provides a shared virtual classroom for instructors and students, an integrated Python learning lab, classroom challenges, persistent seating, and instructor result tracking.

## Database setup

The repository now contains a **complete fresh-install SQL path**. You do not need pre-existing Supabase classroom tables.

### Fresh Supabase project — run in this exact order

Open **Supabase → SQL Editor** and run:

1. `supabase/00-base-schema.sql`
   - creates `rooms`, `participants`, `quiz_questions`, and `quiz_responses`;
   - creates the core classroom/quiz RPC functions used by the browser.
2. `supabase/room-code-migration.sql`
   - adds persistent device IDs/seats;
   - creates `create_room()` and `join_latest_active_room()`.
3. `supabase/app-data-migration.sql`
   - creates `app_users` and `game_results`;
   - links participants to persistent users.
4. `supabase/weekly-content-migration.sql`
   - creates `learning_weeks`, `week_lessons`, and `week_activities`;
   - creates the three Week 1 lesson shells and the week-level game.
5. `supabase/w1-1-five-parts-content-update.sql`
6. `supabase/w1-1-d2-loading-classification-update.sql`
7. `supabase/w1-1-d3-language-ladder-update.sql`

Do not reverse the order. On a new Supabase project, `00-base-schema.sql` must be first.

### Tables

| Table | Purpose |
| --- | --- |
| `rooms` | Classroom sessions and presentation/quiz state. |
| `participants` | Instructor/students in a room, device identity, and seat. |
| `quiz_questions` | Multiple-choice challenge questions. |
| `quiz_responses` | Student answers and grading results. |
| `app_users` | Persistent application identities. |
| `game_results` | Persistent lab/game results. |
| `learning_weeks` | Curriculum weeks. |
| `week_lessons` | Lessons belonging to each week. |
| `week_activities` | Presentation, challenge, game, and briefing activities. |

### Environment files

Copy `.env.template` to the local environment files required by the project. Never commit real Supabase secrets.

Browser-safe values belong in `.env.development`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_PROFESSOR_VERIFICATION_CODE=YOUR_SIX_DIGIT_PIN
```

Server-only values belong in `.env.server`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
```

## Run locally

Install dependencies:

```bash
npm install
```

Start the Node/Socket.IO server and the Vite client using the scripts defined in `package.json`.

## Current workflow

1. Instructor selects **Professor** and enters the configured verification PIN.
2. The application creates the active classroom.
3. Students select **Student** and join the latest active room.
4. Each headset receives a persistent identity, name, and fixed seat.
5. The instructor can run classroom activities, monitor students/results, return students from the lab, and end the class.

## Important database note

The SQL files in `supabase/` are designed so a teammate can reproduce the database from an empty Supabase project. If the hosted database contains experimental tables/functions, do not rely on them unless their definitions are committed to this folder.

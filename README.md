# VRClass Integrated

VRClass Integrated is a single WebXR application containing both the UMES
virtual classroom and the Python Type Lab.

Students never navigate to another website when an instructor starts the lab.
The classroom and lab are two environments in the same WebXR world, so the
headset session, player identity, assigned seat, and Socket.IO connection remain
active throughout the transition.

## Main workflow

1. Students and the instructor sign in and enter the classroom.
2. Each student is positioned at the seat assigned in SQLite.
3. The instructor selects **Individual Lab** in the VR dashboard.
4. Every connected student enters a private, locally rendered Python lab.
5. Lab progress is reported through the student's existing classroom socket.
6. Completed students remain available until the instructor returns the class.
7. **Classroom Mode** returns all students to their assigned seats without
   ending WebXR.
8. Results record whether the student completed the lesson or was returned
   early by the instructor.

## Lab activity

The active lesson is a 12-card Python data-type sorting game. Students reveal
and sort values into `int`, `float`, `bool`, and `str` bins. The application
tracks:

- score and streak;
- correct and incorrect attempts;
- accuracy;
- cards completed;
- completion status;
- elapsed time;
- return reason.

## Architecture

- `src/index.ts` creates the shared WebXR world.
- `src/lab/` contains only the active Python card-game implementation.
- `src/lab/LabEnvironmentManager.ts` switches environments without navigation.
- `server.js` maintains classroom connections and per-user lab sessions.
- `server/state/LabSession.js` stores each student's independent progress.
- `database/database.js` manages SQLite users and saved game results.

Lab state is indexed by the permanent database user ID, never by a URL
parameter. Socket IDs are used only as temporary connection addresses.

## Development

Requirements:

- Node.js 20.19+, 22.12+, or 24
- npm

Install dependencies:

```bash
npm install
```

Run the WebXR application and real-time server:

```bash
npm run dev:full
```

The application uses:

- WebXR application: `https://localhost:8081`
- Classroom and lab server: `http://localhost:3001`

Build:

```bash
npm run build
```

Type-check:

```bash
npx tsc --noEmit
```

## Default development users

- Instructor: `admin`
- Students: `Tina`, `Sager`, `Devika`, `Nyles`, and `Ahmed`

The existing authentication is development-only and should be replaced with
password validation and signed session tokens before production deployment.

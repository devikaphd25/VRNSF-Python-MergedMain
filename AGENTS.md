# UMES VR Classroom — Base44 Setup Notes

## Architecture

- **Frontend**: Vite dev server on port 8081 (mapped to host port 3000). Uses
  Meta IWSDK (`@iwsdk/vite-plugin-dev`, `@iwsdk/vite-plugin-uikitml`) and
  Three.js for a WebXR VR classroom. Entry point: `index.html` → `src/index.ts`.
- **Backend**: Express + Socket.IO server on port 3001, run from `server.ts`
  with `tsx`. Requires Supabase (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`).
  The server calls `initializeAppDataRepository()` at startup which queries
  the `app_users` table — it will crash if Supabase is unreachable.
- **Database**: External Supabase. SQL migrations are in `supabase/` and must
  be applied in order before the app is fully functional.

## Running in the Base44 sandbox

`docker-compose.base44.yml` runs both processes in a single `node:22`
container so the Vite proxy target (`localhost:3001`) works without app-code
changes. The frontend is the foreground process (`exec npm run dev:runtime`);
the backend runs in the background.

### Sandbox-specific overrides

- **mkcert disabled**: `vite.config.ts` skips `vite-plugin-mkcert` when
  `BASE44_PREVIEW_MODE === "1"`. The preview proxy handles HTTPS; mkcert's
  self-signed cert would prevent the proxy from reaching the dev server.
  With the flag unset, mkcert is active as before.
- **Env files generated at startup**: The compose command creates `.env.server`
  and `.env.development` from the container environment (sourced from
  `.env.base44-defaults` then `/run/base44/app.env`). This satisfies
  `node --env-file=.env.server` and Vite's `.env.development` convention
  without committing real secrets.
- **Vite allowed hosts**: `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` is passed
  bare in the compose environment so Vite accepts the preview proxy hostname.

### Required secrets

All five are `requiredAtBoot`. Placeholder values in `.env.base44-defaults`
let the frontend boot; the backend needs real Supabase credentials to fully
start. Provide them via the Base44 secrets dashboard:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Browser-side Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser-side Supabase anon/publishable key |
| `VITE_PROFESSOR_VERIFICATION_CODE` | Six-digit instructor verification PIN |
| `SUPABASE_URL` | Server-side Supabase project URL (same as above) |
| `SUPABASE_SECRET_KEY` | Server-side Supabase service-role key |

### Classroom connection and verification

- Startup assets live in `src/config/classroom-assets.ts`. Both `classroom2`
  and `nasaSeatSource` must remain **critical**: IWSDK resolves `World.create`
  before background assets finish, while classroom construction immediately
  uses the NASA source after login/session restoration. The model exists in
  the repo; treating it as background caused a misleading missing-model error.
  Run `node --experimental-test-module-mocks --import tsx --test tests/classroom-startup.test.ts`
  inside the app container for loading-policy and GLB-integrity regressions.
  A rendered login panel verifies startup only, not student/headset entry.
- Castle/forest puzzle entities must use `createCastleEntity` or
  `createForestEntity` with the environment's ECS parent. `Object3D.add` alone
  is overwritten by IWSDK's first TransformSystem update, detaching blocks,
  buttons, instructions and feedback from the environment visibility toggle.
- All three environment visibility guards re-export the **same class** from
  `src/systems/visible-interaction.system.ts`. Register it once per world at
  priority -5 (before InputSystem at -4). Separate guards save each other's
  disabled settings and leave puzzle rays permanently disabled after entry.
  Hidden roots need both `pointerEvents = "none"` and `intersectChildren = false`
  because UIKit children can explicitly opt back into pointer hits.
  `node --experimental-test-module-mocks --import tsx --test tests/castle-input.test.ts`
  covers all five buttons, block grabbing behind a hidden HUD, initially hidden
  scenes with all environments installed, and HUD restoration/re-entry. It
  uses the real SDK input/grab stack, not headset hardware. Test ray origins
  must aim local -Z (`Camera.lookAt`, not `Object3D.lookAt`); register TransformSystem
  before scene creation. Compare scene-object identity with boolean assertions:
  failed object equality assertions can exhaust memory formatting the ECS graph.
- Inside the castle the player enters at (0, 0, -1) facing +z, so world **-x is
  their right** and +x their left: the code blocks' shelf sits at +x, and the
  animated king who holds the instructions board stands at -x, with the board
  held in front of him inside the 10 x 10 room. `node --experimental-test-module-mocks --import tsx --test tests/castle-instructions-board.test.ts`
  covers that placement (right of the player, inside the room, facing the
  player, within the forward view), the king's footprint, and that the idle
  motion runs only while the castle is active.
- All three activities cut their code blocks from `src/utils/jigsaw-block.ts`:
  each joint between two consecutive lines owns a unique key (knob position and
  which of the two pieces carries it), so complementary cuts meet only where the
  code sequence is right. A block must be built from the cut of its own line
  (`pieceEdges[origIdx]`, not the shelf loop index), and the knob radius must
  stay under the gap between two board slots (`SLOT_HEIGHT - BLOCK_HEIGHT`), or
  shuffled blocks poke into their shelf neighbours. `node --experimental-test-module-mocks --import tsx --test tests/jigsaw-shape.test.ts`
  guards the pattern, the nesting and the extruded geometry.
- Connect the classroom socket only after all environment managers and global
  classroom references are installed. Registering earlier exposes a student to
  instructor launch/seat events before their game listeners exist. Seat retries
  and XR `sessionstart` restoration must leave active game origins alone; the
  normal `restoreClassroomSeat` event places the student after game exit.
  `node --experimental-test-module-mocks --import tsx --test tests/puzzle-loading.test.ts`
  verifies all three puzzle launch listeners and parenting with real ECS
  transforms, plus the seat guard. It does not emulate instructor/headset input.
- Socket.IO uses the page's origin; Vite forwards `/socket.io` (including
  WebSocket upgrades) and `/api` to port 3001. This works locally and under
  HTTPS without a sandbox-specific application dependency.
- Saved **student** sessions resume through read-only `/api/device-session`:
  the server checks the device/user match, participant membership and active
  room. Saved instructor display data does not bypass the Professor PIN.
  Desktop identity stays per-tab; a new tab without the same device ID cannot
  resume another tab's identity.
- `npm run test:puzzle3` runs isolated button/ECS wiring and session tests plus
  the real Pyodide 0.27 compiler. The ECS adapter is not XR-controller emulation;
  controller targeting, forest entry/exit and stored instructor scores still
  need an active classroom and headset verification.
- Pyodide error messages can be empty after redirecting stderr. Read the stderr
  buffer for the traceback. Run each submitted program in its own globals dict
  so prior attempts cannot supply missing variables.
- The connected Supabase project currently lacks `public.week_lessons`:
  `/api/instructor-content` returns 500. Apply the existing
  `supabase/weekly-content-migration.sql` in Supabase SQL Editor (then the
  Week 1 content updates in README order); a service-role REST key alone
  cannot execute SQL migrations. Do not mask this error as verified curriculum.

## Useful commands

```bash
# Start the stack
docker compose -f docker-compose.base44.yml up -d --build

# Check status
docker compose -f docker-compose.base44.yml ps

# View logs
docker compose -f docker-compose.base44.yml logs -f app

# Stop
docker compose -f docker-compose.base44.yml down

# Typecheck (inside the container or locally with Node 22)
npm run typecheck
```

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

### Known sandbox limitation

The browser Socket.IO client (`src/network/socket.ts`) connects directly to
`http://${window.location.hostname}:3001`, bypassing the Vite proxy. In the
sandbox, port 3001 is not publicly exposed at the same hostname, so
real-time features will not connect until the user provides real Supabase
credentials and the backend is reachable. The Vite proxy still handles
`/api` requests correctly.

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

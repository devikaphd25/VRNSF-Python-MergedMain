# UMES VR Classroom

## First setup

Use Node.js **22.12+ (22.x) or 24.x**. Open a terminal in the project folder and run:

```bash
npm ci
```

Create `.env.server` beside `package.json`. Get the private server key from the project owner:
```
SUPABASE_URL=https://wxwfriaqxrhgxdgpnlti.supabase.co
SUPABASE_SECRET_KEY=YOUR_PRIVATE_SERVER_KEY
PORT=3001
```

The backend needs a Supabase **server secret key**, not a publishable/anon key. Keep `.env.server` private and out of GitHub. The existing database already contains the courses and videos; do not run the schema again.

Create **`.env.development`** beside `package.json` with:

```dotenv
VITE_SERVER_URL=
```

Leave the value empty. You do not need to set `WEEK_NUMBER`; choose the week and day in the app.

## Run the app

Open two terminals in the project folder:

**Terminal 1 — backend:**

```bash
npm run dev:server
```

**Terminal 2 — browser app:**

```bash
npm run dev:runtime
```

Open **https://localhost:8081/**. Keep both terminals running. For headsets on the same Wi-Fi, use the **Network HTTPS URL** printed in Terminal 2; the headset must trust its certificate.

The instructor enters the course code:120 course code: "123456" and for course 99 :"990099", selects week/day and starts the class. Students use the same app address. Internet access is needed for Supabase.


import assert from "node:assert/strict";
import express from "express";
import { after, before, beforeEach, mock, test } from "node:test";

let user: any;
let room: any;
let participant: any;
let databaseUnavailable = false;
const calls: any[] = [];
mock.module("../server/services/app-data.repository.ts", {
  namedExports: {
    getAppUserByDeviceId: (deviceId: string) => user?.deviceId === deviceId ? user : null,
    getAppUserByUsername: () => null,
    upsertDeviceAppUser: () => { throw new Error("Resume must not write a user"); },
  },
});
mock.module("../server/services/supabase-admin.service.ts", {
  namedExports: { supabaseAdmin: {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        async maybeSingle() {
          calls.push({ table, filters });
          const record = table === "rooms" ? room : participant;
          const matches = record && Object.entries(filters).every(([key, value]) => record[key] === value);
          return { data: matches ? record : null, error: databaseUnavailable ? { message: "offline" } : null };
        },
      };
      return query;
    },
  } },
});
const { default: router } = await import("../server/routes/login.routes.ts");
const app = express();
app.use(express.json());
app.use("/api", router);
let server: ReturnType<typeof app.listen>;
let origin: string;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});
after(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  user = { id: 12, username: "device:device-A", deviceId: "device-A", role: "student", passwordHash: "never-return-this" };
  room = { id: "room-A", is_active: true, current_slide: 3 };
  participant = { id: "participant-A", room_id: "room-A", device_id: "device-A", user_id: 12, role: "student", seat: "Seat_R1_01" };
  databaseUnavailable = false;
  calls.length = 0;
});
const body = { deviceId: "device-A", userId: 12, roomId: "room-A", participantId: "participant-A" };
async function resume(overrides: Record<string, unknown> = {}) {
  return fetch(origin + "/api/device-session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...overrides }),
  });
}

test("Resume validates an active room and matching student participant without writes", async () => {
  const response = await resume();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.user.id, 12);
  assert.equal(result.user.seat, "Seat_R1_01");
  assert.equal(result.user.passwordHash, undefined);
  assert.equal(result.user.deviceId, undefined);
  assert.deepEqual(result.session, { roomId: "room-A", participantId: "participant-A", currentSlide: 3 });
  assert.deepEqual(calls[1].filters, { id: "participant-A", room_id: "room-A", device_id: "device-A", user_id: 12, role: "student" });
});

test("Wrong device, wrong user and instructor identities are rejected", async () => {
  assert.equal((await resume({ deviceId: "different-device" })).status, 401);
  assert.equal((await resume({ userId: 99 })).status, 401);
  user.role = "instructor";
  assert.equal((await resume()).status, 401);
  assert.equal(calls.length, 0);
});

test("Closed rooms and mismatched participants cannot be restored", async () => {
  room.is_active = false;
  assert.equal((await resume()).status, 401);
  room.is_active = true;
  participant.device_id = "different-device";
  assert.equal((await resume()).status, 401);
  participant.device_id = "device-A";
  participant.user_id = 99;
  assert.equal((await resume()).status, 401);
});

test("Invalid input and database failures do not authenticate", async () => {
  assert.equal((await resume({ deviceId: "" })).status, 400);
  databaseUnavailable = true;
  assert.equal((await resume()).status, 503);
});

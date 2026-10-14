import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";

mock.module("../src/services/device-identity.services.ts", {
  namedExports: { getPersistentDeviceId: () => "device-A" },
});
const { restoreStoredStudentSession } = await import("../src/services/student-session.services.ts");
const originalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
const values = new Map<string, string>();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
} as Storage;
after(() => {
  globalThis.localStorage = originalStorage;
  globalThis.fetch = originalFetch;
});

const student = { id: 12, username: "device:device-A", role: "student", loginTime: "saved-time" };
const session = { roomId: "room-A", participantId: "participant-A" };
let requests: any[] = [];
beforeEach(() => {
  values.clear();
  values.set("vrUser", JSON.stringify(student));
  values.set("vrClassroomSession", JSON.stringify(session));
  requests = [];
  globalThis.fetch = (async (url, options) => {
    requests.push({ url, ...JSON.parse(String(options?.body)) });
    return Response.json({ success: true, user: { ...student, seat: "Seat_R1_01" }, session: { ...session, currentSlide: 3 } });
  }) as typeof fetch;
});

test("A saved student resumes only through the server's device/session check", async () => {
  const result = await restoreStoredStudentSession();
  assert.equal(result?.id, student.id);
  assert.equal(result?.seat, "Seat_R1_01");
  assert.equal(result?.loginTime, "saved-time");
  assert.deepEqual(requests, [{ url: "/api/device-session", deviceId: "device-A", userId: 12, ...session }]);
  assert.equal(JSON.parse(values.get("vrClassroomSession")!).currentSlide, 3);
});

test("Expired sessions return to normal login without overwriting saved identity", async () => {
  globalThis.fetch = async () => Response.json({ success: false }, { status: 401 });
  assert.equal(await restoreStoredStudentSession(), null);
  assert.deepEqual(JSON.parse(values.get("vrUser")!), student);
});

test("Saved instructor display data never bypasses the Professor PIN", async () => {
  values.set("vrUser", JSON.stringify({ ...student, role: "instructor" }));
  assert.equal(await restoreStoredStudentSession(), null);
  assert.equal(requests.length, 0);
});

test("Malformed or missing session data cannot create a classroom identity", async () => {
  values.set("vrClassroomSession", "broken-json");
  assert.equal(await restoreStoredStudentSession(), null);
  values.delete("vrClassroomSession");
  assert.equal(await restoreStoredStudentSession(), null);
  assert.equal(requests.length, 0);
});

test("Unavailable validation and mismatched identities stay signed out", async () => {
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await restoreStoredStudentSession(), null);
  globalThis.fetch = async () => Response.json({ success: true, user: { ...student, id: 99 } });
  assert.equal(await restoreStoredStudentSession(), null);
});

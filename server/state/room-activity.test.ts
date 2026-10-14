import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomActivityStore } from "./room-activity.js";

test("late arrivals receive only their room's most recent activity", () => {
  const store = new RoomActivityStore();
  store.set("a", { event: "gameChanged", payload: { gameId: "python-type-lab" } });
  store.set("b", { event: "launchPythonPuzzle", payload: {} });
  store.set("a", { event: "presentationContentChanged", payload: { assetPath: "/video.mp4" } });
  assert.equal(store.get("a")?.event, "presentationContentChanged");
  assert.equal(store.get("b")?.event, "launchPythonPuzzle");
  assert.equal(store.get("unknown"), undefined);
});

test("timed activities retain the original start and expire at the deadline", () => {
  const store = new RoomActivityStore();
  const payload = { id: "quiz", startedAt: 1000, durationSeconds: 10 };
  store.set("a", { event: "quickChallengeStarted", payload, expiresAt: 11000 });
  assert.deepEqual(store.get("a", 9000)?.payload, payload);
  assert.equal(store.get("a", 11000), undefined);
});

test("an old challenge ending cannot erase a newly launched activity", () => {
  const store = new RoomActivityStore();
  store.set("a", { event: "challenge2Started", payload: { id: "new" } });
  store.clear("a", "old");
  assert.equal(store.get("a")?.payload.id, "new");
  store.clear("a", "new");
  assert.equal(store.get("a"), undefined);
});

test("returning or ending class clears catch-up without affecting other rooms", () => {
  const store = new RoomActivityStore();
  for (const room of ["a", "b"]) store.set(room, { event: "launchPythonPuzzle", payload: {} });
  store.clear("a");
  assert.equal(store.get("a"), undefined);
  assert.ok(store.get("b"));
});

test("playback snapshot retains the timestamp needed to catch up after loading", () => {
  const store = new RoomActivityStore();
  store.set("a", { event: "presentationContentChanged", payload: { mediaType: "video" },
    playback: { command: "play", currentTime: 12, sentAt: 1000 } });
  const activity = store.get("a", 6000)!;
  assert.equal(activity.playback!.currentTime + (6000 - activity.playback!.sentAt) / 1000, 17);
  activity.playback = { command: "pause", currentTime: 17, sentAt: 6000 };
  assert.equal(store.get("a", 9000)?.playback?.currentTime, 17);
});

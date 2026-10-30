import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeActivities, findNextChallengeIndex, type ClassroomActivity } from "../src/content/classroom-content.ts";

const activity = (activityId: number, activityType: ClassroomActivity["activityType"]): ClassroomActivity => ({
  activityId, activityOrder: activityId, activityType, activityKey: null,
  title: `Database title ${activityId}`, description: "", assetPath: null,
});

test("summary counts the selected day's database activities without changing order or titles", () => {
  const activities = [activity(9, "presentation"), activity(14, "challenge"), activity(21, "presentation"),
    activity(23, "briefing"), activity(28, "game"), activity(30, "display_room")];
  const original = structuredClone(activities);
  assert.deepEqual(summarizeActivities(activities), { videos: 2, challenges: 1, games: 1, debriefs: 1 });
  assert.deepEqual(activities, original);
});

test("a new day cannot inherit counts from a previous day or local fallback lessons", () => {
  summarizeActivities([activity(1, "challenge"), activity(2, "briefing")]);
  assert.deepEqual(summarizeActivities([activity(3, "presentation")]), { videos: 1, challenges: 0, games: 0, debriefs: 0 });
  assert.deepEqual(summarizeActivities([]), { videos: 0, challenges: 0, games: 0, debriefs: 0 });
});

test("next challenge follows activity sequence rather than obsolete lesson slots", () => {
  const activities = [activity(9, "presentation"), activity(14, "challenge"), activity(21, "presentation"), activity(30, "challenge")];
  assert.equal(findNextChallengeIndex(activities, 9), 1);
  assert.equal(findNextChallengeIndex(activities, 21), 3);
  assert.equal(findNextChallengeIndex(activities, 30), -1);
  assert.equal(findNextChallengeIndex(activities), 1);
});

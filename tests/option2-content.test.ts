import { test } from "node:test";
import assert from "node:assert/strict";
import { OPTION2_LOCAL_LESSONS, replaceInstructorLessons } from "../src/config/instructor-menu-content.ts";

test("presentation reload cannot remove or rename Option 2 challenges", () => {
  replaceInstructorLessons({ weekNumber: 1, weekTitle: "Week1", lessons: [
    { lessonNumber: 1, title: "Old lesson", activities: [
      { activityId: 3, activityType: "briefing", title: "Debrief", description: "" }
    ] },
    { lessonNumber: 2, title: "Old lesson 2", activities: [
      { activityId: 18, activityType: "challenge", title: "Modern Python Challenge", description: "" }
    ] },
    { lessonNumber: 3, title: "Old lesson 3", activities: [
      { activityId: 21, activityType: "challenge", title: "Computer Components Challenge", description: "" }
    ] }
  ] });
  const challenges = OPTION2_LOCAL_LESSONS.flatMap(l => l.tasks).filter(t => t.action === "challenge");
  assert.deepEqual(challenges.map(t => t.buttonId), [
    "quick-challenge-button", "task-lesson2-challenge", "task-lesson3-challenge"
  ]);
  assert.match(challenges[0].title, /True or False/);
  assert.match(challenges[1].title, /Devices In & Out/);
  assert.match(challenges[2].title, /Computer Parts Quiz/);
  assert.ok(challenges.every(t => t.activityId === undefined));
});

test("flat week activities load without a lessons field", () => {
  assert.doesNotThrow(() => replaceInstructorLessons({
    weekNumber: 1, weekTitle: "Week1", activities: [
      { activityId: 23, activityType: "presentation", title: "Video 1", description: "", assetPath: "https://example.test/video" },
      { activityId: 2, activityType: "challenge", title: "True/False", description: "" }
    ]
  }));
  assert.equal(OPTION2_LOCAL_LESSONS.flatMap(l => l.tasks).filter(t => t.action === "challenge").length, 3);
});

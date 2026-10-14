import { test } from "node:test";
import assert from "node:assert/strict";
import { Bone, Group, Vector3 } from "three";
import { sanitizeSeatAvatarPose } from "../shared/seat-avatar-tracking.ts";
import { SeatAvatarPoseDriver } from "../src/components/instructor/seat-avatar-pose.ts";

test("tracking rejects malformed head rotations and unsafe hand coordinates", () => {
  assert.equal(sanitizeSeatAvatarPose({ head: [0, 0, NaN, 1] }), null);
  assert.equal(sanitizeSeatAvatarPose({ head: [0, 0, 0, 0] }), null);
  const pose = sanitizeSeatAvatarPose({ head: [0, 0, 0, 1], left: { position: [99, 0, 0], rotation: [0, 0, 0, 1] }, right: null });
  assert.equal(pose?.left, null);
  assert.deepEqual(pose?.head, [0, 0, 0, 1]);
});

function rig() {
  const root = new Group();
  const head = new Bone(); head.name = "Head"; head.position.y = 1.6; root.add(head);
  const upper = new Bone(); upper.name = "RightUpperArm"; upper.position.set(-0.18, 1.4, 0); root.add(upper);
  const lower = new Bone(); lower.name = "RightLowerArm"; lower.position.set(0, -0.25, 0); upper.add(lower);
  const hand = new Bone(); hand.name = "RightHand"; hand.position.set(0, -0.2, 0); lower.add(hand);
  return { root, head, upper, lower, hand };
}

test("Raise Hand lifts the arm without stretching bones or changing another avatar", () => {
  const a = rig(), b = rig();
  const driver = new SeatAvatarPoseDriver(a.root);
  a.root.updateMatrixWorld(true);
  const before = a.hand.getWorldPosition(new Vector3()).y;
  driver.setRaised(true);
  for (let i = 0; i < 60; i++) driver.update(1 / 60);
  assert.ok(a.hand.getWorldPosition(new Vector3()).y > before + 0.3);
  assert.equal(a.lower.position.length(), 0.25);
  assert.equal(a.hand.position.length(), 0.2);
  assert.equal(b.upper.quaternion.w, 1);
  driver.setRaised(false);
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  assert.ok(Math.abs(a.hand.getWorldPosition(new Vector3()).y - before) < 0.001);
});

test("head follows a tracked rotation and resets when tracking ends", () => {
  const a = rig();
  const driver = new SeatAvatarPoseDriver(a.root);
  driver.setPose({ head: [0, Math.sin(0.3), 0, Math.cos(0.3)], left: null, right: null });
  for (let i = 0; i < 60; i++) driver.update(1 / 60);
  assert.ok(a.head.quaternion.y > 0.25);
  driver.setPose(null);
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  assert.ok(Math.abs(a.head.quaternion.y) < 0.001);
});

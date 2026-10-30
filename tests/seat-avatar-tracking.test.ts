import { test } from "node:test";
import assert from "node:assert/strict";
import { Bone, Group, Vector3 } from "three";
import { sanitizeSeatAvatarPose } from "../shared/seat-avatar-tracking.ts";
import { SeatAvatarPoseDriver } from "../src/avatars/seat-avatar-pose.ts";

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

test('supplied standalone hands follow tracking and return to rest', () => {
  const root = new Group();
  root.scale.setScalar(0.65);
  const head = new Bone(); head.name = 'Head'; head.position.y = 1.6;
  const hand = new Group(); hand.name = 'Avatar02_HandRight'; hand.position.set(-0.3, 0.8, 0);
  root.add(head, hand);
  const rest = hand.position.clone();
  const driver = new SeatAvatarPoseDriver(root);
  driver.setRaised(true); driver.update(1 / 60);
  assert.ok(hand.position.y > rest.y);
  driver.setRaised(false);
  driver.setPose({ head: [0,0,0,1], left: null, right: { position: [-0.2,-0.3,0.4], rotation: [0,0,0,1] } });
  driver.update(1 / 60);
  assert.ok(hand.position.distanceTo(new Vector3(-0.16, 1.36, 0.32)) < 0.00001);
  driver.setPose(null); driver.update(1 / 60);
  assert.ok(hand.position.distanceTo(rest) < 0.00001);
});

test('large headset turns stay within natural head rotation limits', async () => {
  const { Euler, MathUtils, Quaternion } = await import('three');
  const a = rig();
  const driver = new SeatAvatarPoseDriver(a.root);
  const input = new Quaternion().setFromEuler(new Euler(1.2, 2.5, 0.9, 'YXZ'));
  driver.setPose({ head: input.toArray() as [number,number,number,number], left: null, right: null });
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  const angles = new Euler().setFromQuaternion(a.head.quaternion, 'YXZ');
  assert.ok(Math.abs(angles.x) <= MathUtils.degToRad(55) + 0.001);
  assert.ok(Math.abs(angles.y) <= MathUtils.degToRad(80) + 0.001);
  assert.ok(Math.abs(angles.z) <= MathUtils.degToRad(25) + 0.001);
});

test('neck shares a turn without altering body orientation or bone lengths', async () => {
  const { Euler, Quaternion } = await import('three');
  const root = new Group(); root.rotation.y = 0.7;
  const neck = new Bone(); neck.name = 'Neck'; neck.position.y = 1.3; neck.rotation.z = 0.2;
  const head = new Bone(); head.name = 'Head'; head.position.y = 0.3; head.rotation.x = 0.1;
  root.add(neck); neck.add(head); root.updateMatrixWorld(true);
  const headRest = head.getWorldQuaternion(new Quaternion());
  const neckRest = neck.quaternion.clone(), localHeadRest = head.quaternion.clone();
  const bodyRest = root.quaternion.clone();
  const look = new Quaternion().setFromEuler(new Euler(0.2, 0.6, 0.1, 'YXZ'));
  const expected = bodyRest.clone().multiply(look).multiply(bodyRest.clone().invert()).multiply(headRest);
  const driver = new SeatAvatarPoseDriver(root);
  driver.setPose({ head: look.toArray() as [number,number,number,number], left: null, right: null });
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  assert.ok(head.getWorldQuaternion(new Quaternion()).angleTo(expected) < 0.001);
  assert.ok(neck.quaternion.angleTo(neckRest) > 0.05);
  assert.ok(root.quaternion.angleTo(bodyRest) < 0.000001);
  assert.equal(neck.position.y, 1.3); assert.equal(head.position.y, 0.3);
  driver.setPose(null);
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  assert.ok(neck.quaternion.angleTo(neckRest) < 0.001);
  assert.ok(head.quaternion.angleTo(localHeadRest) < 0.001);
});

test('head movement is speed-limited and does not flip at the rear yaw boundary', async () => {
  const { Euler, MathUtils, Quaternion } = await import('three');
  const a = rig(); const driver = new SeatAvatarPoseDriver(a.root);
  const setYaw = (degrees: number) => driver.setPose({ head: new Quaternion().setFromEuler(new Euler(0, MathUtils.degToRad(degrees), 0, 'YXZ')).toArray() as [number,number,number,number], left: null, right: null });
  setYaw(170); driver.update(1 / 60);
  assert.ok(a.head.quaternion.angleTo(new Quaternion()) <= MathUtils.degToRad(4) + 0.000001);
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  setYaw(-179);
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  assert.ok(new Euler().setFromQuaternion(a.head.quaternion, 'YXZ').y > MathUtils.degToRad(70));
});

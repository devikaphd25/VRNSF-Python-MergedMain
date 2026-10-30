import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { viewRelativeMovement } from '../src/input/headset-relative-movement.ts';

const facing = (yaw: number, pitch = 0) => new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
function close(actual: Vector3, expected: number[]) {
  assert.ok(actual.distanceTo(new Vector3(...expected)) < 1e-6, `${actual.toArray()} != ${expected}`);
}

test('forward, back and strafe follow a physically turned headset', () => {
  const head = facing(Math.PI / 2);
  close(viewRelativeMovement(0, -1, head), [-1, 0, 0]);
  close(viewRelativeMovement(0, 1, head), [1, 0, 0]);
  close(viewRelativeMovement(1, 0, head), [0, 0, -1]);
  close(viewRelativeMovement(-1, 0, head), [0, 0, 1]);
});

test('head turn and rig snap turn combine exactly once', () => {
  const worldFacing = facing(Math.PI / 6).multiply(facing(Math.PI / 3));
  close(viewRelativeMovement(0, -1, worldFacing), [-1, 0, 0]);
});

test('looking up or down keeps walking horizontal at the same speed', () => {
  for (const pitch of [-Math.PI / 2, -0.8, 0, 0.8, Math.PI / 2]) {
    close(viewRelativeMovement(0, -1, facing(Math.PI / 2, pitch)), [-1, 0, 0]);
  }
});

test('diagonal speed is capped while partial stick input stays slow', () => {
  const head = facing(0);
  assert.ok(Math.abs(viewRelativeMovement(1, -1, head).length() - 1) < 1e-6);
  close(viewRelativeMovement(0, -0.25, head), [0, 0, -0.25]);
  close(viewRelativeMovement(0, 0, head), [0, 0, 0]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readAvatarInputPose } from "../src/avatars/avatar-input-pose.ts";

test("bare hands use wrist joints even without a controller grip", () => {
  const wrist = {}, pose = { transform: {} };
  const source = { hand: new Map([["wrist", wrist]]) } as unknown as XRInputSource;
  const frame = { getJointPose: (joint: unknown) => { assert.equal(joint, wrist); return pose; } } as unknown as XRFrame;
  assert.equal(readAvatarInputPose(frame, source, {} as XRReferenceSpace), pose);
});

test("controllers and wrist-loss fallback use the grip pose", () => {
  const gripSpace = {}, pose = { transform: {} };
  const frame = { getJointPose: () => null, getPose: (space: unknown) => { assert.equal(space, gripSpace); return pose; } } as unknown as XRFrame;
  for (const hand of [undefined, new Map([["wrist", {}]])]) {
    assert.equal(readAvatarInputPose(frame, { gripSpace, hand } as unknown as XRInputSource, {} as XRReferenceSpace), pose);
  }
});

test("missing input poses return null", () => {
  assert.equal(readAvatarInputPose({} as XRFrame, {} as XRInputSource, {} as XRReferenceSpace), null);
});

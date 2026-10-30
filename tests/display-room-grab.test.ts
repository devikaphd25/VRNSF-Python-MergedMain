import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DisplayRoomGrab } from '../src/display-room/grab-controller.ts';
import { isClosedHand, readDisplayGrabInput, type DisplayGrabInput } from '../src/display-room/grab-input.ts';
import { DISPLAY_ROOM_RAY_DISTANCE } from '../src/display-room/ray-settings.ts';

test('gallery ray stays long while aiming and reaches distant pickup buttons', () => {
  const f = fixture();
  f.input.ray!.direction.set(0, 1, 0);
  f.update(10);
  const beam = f.grab.root.getObjectByName('DisplayRoomPickupRay') as THREE.Line;
  assert.equal(beam.visible, true);
  const points = beam.geometry.getAttribute('position');
  const origin = new THREE.Vector3().fromBufferAttribute(points, 0);
  const end = new THREE.Vector3().fromBufferAttribute(points, 1);
  assert.ok(Math.abs(origin.distanceTo(end) - DISPLAY_ROOM_RAY_DISTANCE) < 1e-5);
  assert.equal((beam.material as THREE.LineBasicMaterial).transparent, true);
  assert.equal((beam.material as THREE.LineBasicMaterial).depthTest, false);

  const pickup = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicMaterial());
  pickup.position.set(200, 1.5, -25);
  f.grab.registerPickupButton(pickup, f.exhibit);
  f.input.ray!.direction.set(0, 0, -1);
  // Move the original exhibit off the pointing ray.
  f.exhibit.position.x = 205;
  f.update(20);
  assert.ok(Math.abs(points.getZ(1) + 25) < 1e-5);
  f.input.selectPressed = true;
  f.update(30);
  assert.ok(f.copy(), 'trigger must select the distant pickup control');
});

function fixture() {
  const grab = new DisplayRoomGrab();
  const exhibit = new THREE.Group();
  exhibit.name = 'CPU';
  exhibit.position.set(200, 1.5, -2);
  exhibit.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2), new THREE.MeshBasicMaterial()));
  const source = { handedness: 'right' } as XRInputSource;
  const input: DisplayGrabInput = { source, position: new THREE.Vector3(200, 1.5, 0),
    rotation: new THREE.Quaternion(), ray: new THREE.Ray(new THREE.Vector3(200, 1.5, 0), new THREE.Vector3(0, 0, -1)), pressed: false };
  const update = (now: number, value: DisplayGrabInput | null = input) => grab.update(value, [exhibit], new THREE.Quaternion(), now);
  const copy = () => grab.root.getObjectByName('CPU hand copy')!;
  update(0);
  return { grab, exhibit, input, update, copy };
}

test('grip makes one hand-sized copy, keeps original intact, follows wrist and releases', () => {
  const f = fixture();
  f.input.pressed = true; f.update(10);
  const copy = f.copy(); assert.ok(copy);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(copy).getSize(new THREE.Vector3()).x - 0.18) < 1e-6);
  assert.deepEqual(f.exhibit.position.toArray(), [200, 1.5, -2]);
  const offset = copy.position.clone().sub(f.input.position);
  f.input.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  f.input.position.x += 1; f.update(20);
  assert.ok(copy.position.distanceTo(offset.applyQuaternion(f.input.rotation).add(f.input.position)) < 1e-6);
  assert.ok(copy.quaternion.angleTo(f.input.rotation) < 1e-6);
  f.input.pressed = false; f.update(30);
  const released = copy.position.clone();
  f.input.position.x += 1; f.update(40);
  assert.ok(copy.position.equals(released));
  assert.equal(f.copy(), copy);
  f.update(20031); assert.equal(f.copy(), undefined);
});

test('floating copy can be grabbed by proximity without a ray and without duplication', () => {
  const f = fixture(); f.input.pressed = true; f.update(10);
  const copy = f.copy(); f.input.pressed = false; f.update(20);
  f.input.ray = null; f.input.position.copy(copy.position);
  f.input.pressed = true; f.update(30);
  const offset = copy.position.clone().sub(f.input.position);
  f.input.position.y += 0.3; f.update(40);
  assert.equal(f.copy(), copy);
  assert.ok(copy.position.distanceTo(f.input.position.clone().add(offset)) < 1e-6);
  f.update(30000); assert.equal(f.copy(), copy); // held copies never time out
  f.grab.reset(); assert.equal(f.copy(), undefined);
});

test('tracking loss and input switching require release before another grab', () => {
  const f = fixture(); f.input.pressed = true; f.update(10);
  const copy = f.copy(); const heldPosition = copy.position.clone();
  f.update(100, null); assert.ok(copy.position.equals(heldPosition));
  f.update(300, null);
  f.input.position.x += 1; f.update(310); // still squeezed after tracking returns
  assert.ok(copy.position.equals(heldPosition));
  f.input.source = { handedness: 'right', hand: {} } as XRInputSource;
  f.update(320); assert.ok(copy.position.equals(heldPosition));
  f.update(20301, null); assert.equal(f.copy(), undefined);
});

test('holding grip on room entry does not create a copy', () => {
  const f = fixture(); f.grab.reset(); f.input.pressed = true; f.update(10);
  assert.equal(f.copy(), undefined);
  f.input.pressed = false; f.update(20); f.input.pressed = true; f.update(30);
  assert.ok(f.copy());
});

test('closed hand requires all fingers and tucked thumb, with release hysteresis', () => {
  assert.equal(isClosedHand([0.8, 0.8, 0.8, 0.8], 0.8, false), true);
  assert.equal(isClosedHand([0.8, 1.5, 1.5, 1.5], 0.8, false), false); // pinch alone
  assert.equal(isClosedHand([0.8, 0.8, 0.8, 0.8], 2, false), false);
  assert.equal(isClosedHand([1.1, 1.1, 1.1, 1.1], 1, false), false);
  assert.equal(isClosedHand([1.1, 1.1, 1.1, 1.1], 1, true), true);
});

const pose = (x: number, y: number, z: number) => ({ transform: {
  position: { x, y, z }, orientation: { x: 0, y: 0, z: 0, w: 1 },
  matrix: new THREE.Matrix4().makeTranslation(x, y, z).toArray(),
} });

test('closed-hand joints work without a gamepad and include rig rotation and teleport', () => {
  const joints = new Map<string, ReturnType<typeof pose>>([
    ['wrist', pose(0, 1, 0)], ['thumb-tip', pose(0.02, 1, -0.03)],
    ['index-finger-metacarpal', pose(0.02, 1, -0.02)],
    ['pinky-finger-metacarpal', pose(-0.02, 1, -0.02)],
    ['middle-finger-phalanx-proximal', pose(0, 1, -0.07)],
  ]);
  for (const finger of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
    joints.set(`${finger}-tip`, pose(0, 1, -0.04));
    joints.set(`${finger}-phalanx-intermediate`, pose(0, 1, -0.08));
  }
  const raySpace = {};
  const source = { handedness: 'right', hand: joints, targetRaySpace: raySpace } as unknown as XRInputSource;
  const frame = { getJointPose: (joint: object) => joint,
    getPose: () => pose(0, 1, 0) } as unknown as XRFrame;
  const rig = new THREE.Group(); rig.position.x = 200; rig.rotation.y = Math.PI / 2;
  const result = readDisplayGrabInput(frame, {} as XRReferenceSpace, source, rig, false)!;
  assert.equal(result.pressed, true);
  assert.ok(result.position.distanceTo(new THREE.Vector3(199.9545, 1, 0)) < 1e-6);
  assert.ok(result.rotation.angleTo(rig.quaternion) < 1e-6);
  assert.ok(result.ray!.direction.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-6);
  assert.equal(readDisplayGrabInput({ ...frame, getJointPose: () => null } as XRFrame, {} as XRReferenceSpace, source, rig, true), null);
});

test('controller uses grip instead of trigger; both hands can hold', () => {
  const source = { handedness: 'right', gripSpace: {}, targetRaySpace: {},
    gamepad: { buttons: [{ pressed: true }, { pressed: false }] } } as unknown as XRInputSource;
  const frame = { getPose: () => pose(0, 1, 0) } as unknown as XRFrame;
  const read = (s: XRInputSource) => readDisplayGrabInput(frame, {} as XRReferenceSpace, s, new THREE.Group(), false);
  assert.equal(read(source)!.pressed, false);
  (source.gamepad!.buttons[1] as { pressed: boolean }).pressed = true;
  assert.equal(read(source)!.pressed, true);
  assert.equal(read({ ...source, handedness: 'left' })!.pressed, true);
});

test('return button in front of an exhibit blocks grabbing that exhibit', () => {
  const f = fixture();
  const button = new THREE.Mesh(new THREE.PlaneGeometry(3, 1), new THREE.MeshBasicMaterial());
  button.position.set(200, 1.5, -1);
  f.input.pressed = true;
  f.grab.update(f.input, [f.exhibit], new THREE.Quaternion(), 10, button);
  assert.equal(f.copy(), undefined);
});

test('two closed hands rotate the copy and releasing support hand keeps its orientation', () => {
  const f = fixture(); f.input.colliders = []; f.input.pressed = true; f.update(10);
  const copy = f.copy();
  const left: DisplayGrabInput = {
    source: { handedness: 'left' } as XRInputSource,
    position: copy.position.clone().add(new THREE.Vector3(-0.13, 0, 0)),
    rotation: new THREE.Quaternion(), ray: null, pressed: true, colliders: [],
  };
  f.grab.update(f.input, [f.exhibit], new THREE.Quaternion(), 20, undefined, left);
  const midpoint = f.input.position.clone().add(left.position).multiplyScalar(0.5);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  for (const hand of [f.input, left]) {
    hand.position.sub(midpoint).applyQuaternion(turn).add(midpoint);
    hand.rotation.copy(turn);
  }
  f.grab.update(f.input, [f.exhibit], new THREE.Quaternion(), 30, undefined, left);
  assert.ok(copy.quaternion.angleTo(turn) < 1e-6);
  const position = copy.position.clone(), rotation = copy.quaternion.clone();
  left.pressed = false;
  f.grab.update(f.input, [f.exhibit], new THREE.Quaternion(), 40, undefined, left);
  assert.ok(copy.quaternion.angleTo(rotation) < 1e-6);
  assert.ok(copy.position.distanceTo(position) < 1e-6);
});

test('large pickup button creates the model copy with one trigger tap and second tap releases', () => {
  const f = fixture();
  f.exhibit.position.x = 202; // Exact model meshes are outside the ray.
  const button = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.6), new THREE.MeshBasicMaterial());
  button.position.set(200, 1.5, -1);
  f.grab.registerPickupButton(button, f.exhibit);
  f.update(10); // Aim at the visible button.
  f.input.selectPressed = true; f.update(20);
  const copy = f.copy(); assert.ok(copy);
  f.input.selectPressed = false; f.update(30);
  const before = copy.position.clone();
  f.input.position.x += 0.2; f.update(40);
  assert.ok(Math.abs(copy.position.x - before.x - 0.2) < 1e-6);
  f.input.selectPressed = true; f.update(50);
  const released = copy.position.clone();
  f.input.selectPressed = false; f.input.position.x += 0.2; f.update(60);
  assert.ok(copy.position.equals(released));
});

test('pinch can select despite missing other finger joints', () => {
  const joints = new Map([
    ['wrist', pose(0, 1, 0)], ['thumb-tip', pose(0, 1, -0.1)],
    ['index-finger-tip', pose(0.01, 1, -0.1)], ['pinky-finger-tip', null],
  ]);
  const source = { handedness: 'right', hand: joints, targetRaySpace: {} } as unknown as XRInputSource;
  const frame = { getJointPose: (joint: object) => joint, getPose: () => pose(0, 1, 0) } as unknown as XRFrame;
  const input = readDisplayGrabInput(frame, {} as XRReferenceSpace, source, new THREE.Group(), false);
  assert.ok(input);
  assert.equal(input.selectPressed, true);
  assert.equal(input.pressed, false); // A fist is not required.
});

test('pinching can move off the last highlighted target briefly without losing selection', () => {
  const f = fixture();
  f.input.ray!.direction.set(1, 0, 0);
  f.input.selectPressed = true; f.update(100);
  assert.ok(f.copy());
});

test('bare hand holds and rotates only while pinching, then releases when fingers open', () => {
  const f = fixture();
  f.input.source = { handedness: 'right', hand: new Map() } as unknown as XRInputSource;
  f.input.selectPressed = false; f.update(10);
  f.input.selectPressed = true; f.update(20);
  const copy = f.copy(); assert.ok(copy);
  f.input.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
  f.update(30);
  assert.ok(copy.quaternion.angleTo(f.input.rotation) < 1e-6);
  f.input.selectPressed = false; f.update(40);
  const position = copy.position.clone(), rotation = copy.quaternion.clone();
  f.input.position.x += 0.3; f.input.rotation.identity(); f.update(50);
  assert.ok(copy.position.equals(position));
  assert.ok(copy.quaternion.angleTo(rotation) < 1e-6);
});

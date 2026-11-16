import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Quaternion, Vector3 } from 'three';
import { CLASSROOM_SEATS, firstAvailableClassroomSeat } from '../shared/classroom-seats.ts';
import { alignSeatedViewer } from '../src/avatars/seated-view-calibration.ts';
import { SEATED_AVATAR_FORWARD_OFFSET } from '../src/avatars/seated-avatar-layout.ts';
import { SeatType } from '../src/classroom/seat-names.ts';

test('all five seats in each row are used before the next row; first-row left seat is not skipped', () => {
  const occupied: string[] = [];
  for (let index = 0; index < 25; index++) {
    const seat = firstAvailableClassroomSeat(occupied)!;
    assert.equal(seat, `Seat_R${Math.floor(index / 5) + 1}_${String(index % 5 + 1).padStart(2, '0')}`);
    assert.equal(SeatType[seat as keyof typeof SeatType], seat);
    occupied.push(seat);
  }
  assert.equal(occupied[4], 'Seat_R1_05'); assert.equal(occupied[5], 'Seat_R2_01');
  assert.equal(firstAvailableClassroomSeat(occupied), undefined);
  assert.equal(firstAvailableClassroomSeat(occupied.filter(seat => seat !== 'Seat_R1_05')), 'Seat_R1_05');
});

test('the classroom model contains each of the five first-row seat anchors', () => {
  const file = readFileSync('public/gltf/classroom2/theater_classroom2.glb');
  const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
  for (const seat of CLASSROOM_SEATS.slice(0, 15)) assert.ok(gltf.nodes.some((node: any) => node.name === seat), seat);
});

test('each row centers the initial headset in front of the seat back regardless of tracking offset', () => {
  for (let row = 1; row <= 5; row++) for (let col = 1; col <= 5; col++) {
    const parent = new Group(); parent.position.set(2, 0, -1); parent.rotation.y = 0.3;
    const rig = new Group(); parent.add(rig); rig.rotation.y = col * 0.2 + Math.PI;
    parent.updateMatrixWorld(true);
    const seatRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), col * 0.2);
    const seat = new Vector3(col, (row - 1) * 0.35, -row * 1.15);
    const forward = new Vector3(0, 0, 1).applyQuaternion(seatRotation);
    const anchor = seat.clone().addScaledVector(forward, SEATED_AVATAR_FORWARD_OFFSET);
    const referenceEye = new Vector3(1.25, 1.65, -0.85);
    alignSeatedViewer(rig, anchor, referenceEye, 1.2);
    const eye = rig.localToWorld(referenceEye.clone());
    assert.ok(eye.distanceTo(anchor.clone().add(new Vector3(0, 1.2, 0))) < 0.00001);
    assert.ok(eye.clone().sub(seat).dot(forward) > 0.17, 'Head must be in front of the backrest');
    const lean = new Vector3(0.08, 0, 0.1);
    const leanedEye = rig.localToWorld(referenceEye.clone().add(lean));
    assert.ok(leanedEye.distanceTo(eye) > 0.1, 'Physical leaning remains available after calibration');
  }
});

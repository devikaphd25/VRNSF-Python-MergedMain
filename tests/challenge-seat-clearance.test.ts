import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { raiseChallengeAboveSeats } from '../src/ui/challenge-seat-clearance.ts';

function box(width: number, height: number, depth: number) {
  return new Mesh(new BoxGeometry(width, height, depth), new MeshBasicMaterial());
}

test('the lowest challenge button clears the actual seat back with a gap, without changing its size or distance', () => {
  const scene = new Scene();
  const seat = box(0.7, 1.4, 0.7); seat.name = 'Seat_R1_03'; seat.position.set(0, 0.7, -1); scene.add(seat);
  const panel = box(2, 1.6, 0.01); panel.position.set(0, 1.3, -2.4); scene.add(panel);
  const lift = raiseChallengeAboveSeats(panel, scene, new Vector3(0, 1.3, 0));
  const seatBounds = new Box3().setFromObject(seat), bounds = new Box3().setFromObject(panel);
  assert.ok(lift > 0); assert.ok(bounds.min.y >= seatBounds.max.y + 0.159);
  assert.equal(panel.position.z, -2.4); assert.deepEqual(panel.scale.toArray(), [1, 1, 1]);
  assert.equal(raiseChallengeAboveSeats(panel, scene, new Vector3(0, 1.3, 0)), 0, 'repeated checks must not keep moving the panel upward');
});

test('raised rear rows behind the viewer and seats outside the panel do not lift it unnecessarily', () => {
  const scene = new Scene();
  const rear = box(1, 5, 1); rear.name = 'Seat_R5_03'; rear.position.set(0, 2.5, 3); scene.add(rear);
  const side = box(1, 5, 1); side.name = 'Seat_R1_01'; side.position.set(10, 2.5, -1); scene.add(side);
  const panel = box(2, 1.6, 0.01); panel.position.set(0, 1.3, -2.4); scene.add(panel);
  assert.equal(raiseChallengeAboveSeats(panel, scene, new Vector3(0, 1.3, 0)), 0);
});

test('clearance respects parent transforms and ignores seats in hidden environments', () => {
  const scene = new Scene(), parent = new Group(); parent.rotation.y = 0.2; parent.scale.setScalar(1.2); scene.add(parent);
  const seat = box(1, 1.5, 0.5); seat.name = 'Seat_R1_03'; seat.position.set(0, 0.75, -1); scene.add(seat);
  const panel = box(2, 1.6, 0.01); panel.position.set(0, 1, -2); parent.add(panel);
  raiseChallengeAboveSeats(panel, scene, new Vector3(0, 1.2, 0));
  assert.ok(new Box3().setFromObject(panel).min.y >= 1.659);
  const hiddenRoom = new Group(); hiddenRoom.visible = false; scene.add(hiddenRoom);
  hiddenRoom.add(seat); seat.position.y = 10;
  assert.equal(raiseChallengeAboveSeats(panel, scene, new Vector3(0, 1.2, 0)), 0);
});

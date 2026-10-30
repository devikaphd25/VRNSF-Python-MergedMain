import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Quaternion, Vector3 } from 'three';
import { separateHandContact, twoHandOrientation } from '../src/display-room/hand-contact.ts';

test('rotated copy separates from palms/fingers even when hands squeeze through it', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const position = new Vector3(200, 1.5, 0);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
    const half = new Vector3(0.12, 0.08, 0.01);
    const hands = [
      { center: new Vector3(200, 1.5, 0), radius: 0.035 },
      { center: new Vector3(200, 1.5, 0.025), radius: 0.035 },
      { center: new Vector3(200.06, 1.5, -0.015), radius: 0.014 },
    ];
    const saved = hands.map(h => h.center.clone());
    separateHandContact(position, rotation, half, hands);
    const box = new Box3(half.clone().negate(), half);
    hands.forEach((h, i) => {
      const local = h.center.clone().sub(position).applyQuaternion(rotation.clone().invert());
      assert.ok(box.distanceToPoint(local) >= h.radius - 1e-6);
      assert.ok(h.center.equals(saved[i]), 'Never change physical tracking positions');
    });
  }
});

test('no contact leaves the model still and coincident hands do not create invalid rotation', () => {
  const position = new Vector3(0, 1, 0);
  separateHandContact(position, new Quaternion(), new Vector3(0.1, 0.1, 0.1), [{ center: new Vector3(2, 1, 0), radius: 0.04 }]);
  assert.deepEqual(position.toArray(), [0, 1, 0]);
  assert.equal(twoHandOrientation(new Vector3(), new Vector3(), new Quaternion(), new Quaternion()), null);
});

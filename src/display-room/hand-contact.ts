import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

export type HandCollider = { center: Vector3; radius: number };

/** Shift the copy, never the real tracked hand. Bounds rotate with the model. */
export function separateHandContact(position: Vector3, rotation: Quaternion, halfSize: Vector3, hands: HandCollider[]) {
  const inverse = rotation.clone().invert();
  const box = new Box3(halfSize.clone().negate(), halfSize);
  const local = (hand: HandCollider) => hand.center.clone().sub(position).applyQuaternion(inverse);
  const overlaps = (hand: HandCollider) => box.distanceToPoint(local(hand)) < hand.radius;
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const hand of hands) {
      const p = local(hand);
      const nearest = box.clampPoint(p, new Vector3());
      const difference = nearest.sub(p);
      const distance = difference.length();
      if (distance >= hand.radius) continue;
      if (distance > 1e-6) {
        difference.multiplyScalar((hand.radius - distance + 0.001) / distance);
      } else {
        // Palm/joint center inside the box: move across its nearest face.
        const gaps = halfSize.clone().sub(new Vector3(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)));
        const axis = gaps.x <= gaps.y && gaps.x <= gaps.z ? 'x' : gaps.y <= gaps.z ? 'y' : 'z';
        difference.set(0, 0, 0);
        difference[axis] = -(Math.sign(p[axis]) || 1) * (gaps[axis] + hand.radius + 0.001);
      }
      position.add(difference.applyQuaternion(rotation));
      changed = true;
    }
    if (!changed) return;
  }
  // If hands squeeze closer than the object's thickness, put it outside both
  // hands on the nearest face. Two physical hands cannot be stopped by software.
  if (hands.some(overlaps)) {
    let positive = -Infinity, negative = Infinity;
    for (const hand of hands) {
      const z = local(hand).z;
      positive = Math.max(positive, z + hand.radius + halfSize.z + 0.001);
      negative = Math.min(negative, z - hand.radius - halfSize.z - 0.001);
    }
    position.add(new Vector3(0, 0, Math.abs(positive) < Math.abs(negative) ? positive : negative).applyQuaternion(rotation));
  }
}

/** Hands define a frame: their separation controls rotation; wrist roll adds twist. */
export function twoHandOrientation(left: Vector3, right: Vector3, leftRotation: Quaternion, rightRotation: Quaternion): Quaternion | null {
  const x = right.clone().sub(left);
  if (x.length() < 0.05) return null;
  x.normalize();
  const up = new Vector3(0, 1, 0).applyQuaternion(leftRotation)
    .add(new Vector3(0, 1, 0).applyQuaternion(rightRotation)).normalize();
  const z = new Vector3().crossVectors(x, up);
  if (z.lengthSq() < 1e-6) return null;
  z.normalize();
  const y = new Vector3().crossVectors(z, x);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

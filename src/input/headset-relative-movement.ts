import { Quaternion, Vector3 } from 'three';

/** Convert stick input into floor-level movement using the viewer's world facing. */
export function viewRelativeMovement(x: number, z: number, facing: Quaternion): Vector3 {
  const forward = new Vector3(0, 0, -1).applyQuaternion(facing);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) {
    // Looking straight up/down: use the head's right axis to keep movement stable.
    const headRight = new Vector3(1, 0, 0).applyQuaternion(facing);
    forward.set(headRight.z, 0, -headRight.x);
  }
  forward.normalize();
  const right = new Vector3(-forward.z, 0, forward.x);
  // WebXR reports a negative vertical stick value when pushed forward.
  const movement = right.multiplyScalar(x).addScaledVector(forward, -z);
  if (movement.lengthSq() > 1) movement.normalize();
  return movement;
}

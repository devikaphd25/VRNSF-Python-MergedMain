import { Object3D, Quaternion, Vector3 } from 'three';

/** Center the actual eyes, including a headset's physical offset and yaw. */
export function centerTheaterViewer(rig: Object3D, viewer: Object3D, eye: Vector3, screen: Vector3): void {
  rig.updateWorldMatrix(true, false);
  const oldRigRotation = rig.getWorldQuaternion(new Quaternion());
  const localEye = viewer.getWorldPosition(new Vector3()).applyMatrix4(rig.matrixWorld.clone().invert());
  const direction = new Vector3(0, 0, -1).applyQuaternion(viewer.getWorldQuaternion(new Quaternion()));
  const currentYaw = Math.atan2(-direction.x, -direction.z);
  const desiredYaw = Math.atan2(eye.x - screen.x, eye.z - screen.z);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), desiredYaw - currentYaw).multiply(oldRigRotation);
  const offset = localEye.multiply(rig.getWorldScale(new Vector3())).applyQuaternion(rotation);
  const position = eye.clone().sub(offset);
  if (rig.parent) {
    rig.quaternion.copy(rig.parent.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
    rig.position.copy(rig.parent.worldToLocal(position));
  } else {
    rig.quaternion.copy(rotation);
    rig.position.copy(position);
  }
  rig.updateWorldMatrix(false, true);
}

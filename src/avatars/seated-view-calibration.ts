import { Object3D, Quaternion, Vector3 } from 'three';

/** Offset the XR origin so its initial tracked head sits at the seat, retaining later leaning. */
export function alignSeatedViewer(rig: Object3D, anchor: Vector3, referenceEye: Vector3, eyeHeight: number): void {
  rig.updateWorldMatrix(true, false);
  const referenceOffset = referenceEye.clone().multiply(rig.getWorldScale(new Vector3()))
    .applyQuaternion(rig.getWorldQuaternion(new Quaternion()));
  const origin = anchor.clone().add(new Vector3(0, eyeHeight, 0)).sub(referenceOffset);
  rig.position.copy(rig.parent ? rig.parent.worldToLocal(origin) : origin);
  rig.updateWorldMatrix(false, true);
}

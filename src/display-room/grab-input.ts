import { Matrix4, Object3D, Quaternion, Ray, Vector3 } from 'three';

export interface DisplayGrabInput {
  source: XRInputSource;
  position: Vector3;
  rotation: Quaternion;
  ray: Ray | null;
  pressed: boolean;
  selectPressed?: boolean;
  colliders?: { center: Vector3; radius: number }[];
}

/** Four curled fingers plus a tucked thumb. Ratios adapt to different hand sizes. */
export function isClosedHand(fingerRatios: number[], thumbRatio: number, wasPressed: boolean): boolean {
  return fingerRatios.length === 4 && fingerRatios.every(r => r < (wasPressed ? 1.2 : 1.05))
    && thumbRatio < (wasPressed ? 1.5 : 1.2);
}

/** Read right-hand tap/pinch plus optional grips for two-hand support. */
export function readDisplayGrabInput(
  frame: XRFrame, reference: XRReferenceSpace, source: XRInputSource,
  rig: Object3D, wasPressed: boolean, wasSelecting = false,
): DisplayGrabInput | null {
  if (source.handedness !== 'right' && source.handedness !== 'left') return null;
  let position: Vector3;
  let rotation: Quaternion;
  let pressed: boolean;
  let selectPressed = Boolean(source.gamepad?.buttons[0]?.pressed);
  const colliders: { center: Vector3; radius: number }[] = [];
  if (source.hand) {
    if (!frame.getJointPose) return null;
    const poses = new Map<XRHandJoint, XRJointPose>();
    for (const [name, joint] of source.hand) {
      const pose = frame.getJointPose(joint, reference);
      if (!pose) continue; // A hidden pinky must not block a valid thumb/index pinch.
      poses.set(name, pose);
      const p = pose.transform.position;
      colliders.push({ center: new Vector3(p.x, p.y, p.z), radius: Math.max(pose.radius ?? 0.008, 0.008) + 0.006 });
    }
    const point = (name: XRHandJoint) => {
      const p = poses.get(name)?.transform.position;
      return p ? new Vector3(p.x, p.y, p.z) : null;
    };
    const w = poses.get('wrist'), wp = point('wrist');
    const thumb = point('thumb-tip'), indexBase = point('index-finger-metacarpal');
    const indexTip = point('index-finger-tip');
    const pinkyBase = point('pinky-finger-metacarpal'), middle = point('middle-finger-phalanx-proximal');
    if (!w || !wp) return null;
    if (thumb && indexTip) {
      selectPressed ||= thumb.distanceTo(indexTip) < (wasSelecting ? 0.04 : 0.025);
    }
    const ratios: number[] = [];
    for (const finger of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
      const tip = point(`${finger}-tip` as XRHandJoint);
      const pip = point(`${finger}-phalanx-intermediate` as XRHandJoint);
      if (!tip || !pip) continue;
      ratios.push(tip.distanceTo(wp) / Math.max(pip.distanceTo(wp), 0.001));
    }
    pressed = Boolean(thumb && indexBase && pinkyBase && isClosedHand(ratios,
      thumb.distanceTo(indexBase) / Math.max(indexBase.distanceTo(pinkyBase), 0.025), wasPressed));
    position = middle ? wp.clone().lerp(middle, 0.65) : wp.clone();
    colliders.push({ center: position.clone(), radius: 0.035 });
    const q = w.transform.orientation;
    rotation = new Quaternion(q.x, q.y, q.z, q.w);
  } else {
    if (!source.gripSpace || !source.gamepad) return null;
    const grip = frame.getPose(source.gripSpace, reference);
    if (!grip) return null;
    const p = grip.transform.position, q = grip.transform.orientation;
    position = new Vector3(p.x, p.y, p.z);
    rotation = new Quaternion(q.x, q.y, q.z, q.w);
    // Trigger taps pick up/release; side grip remains an optional hold gesture.
    pressed = Boolean(source.gamepad.buttons[1]?.pressed);
    colliders.push({ center: position.clone(), radius: 0.055 });
  }
  rig.updateWorldMatrix(true, false);
  position.applyMatrix4(rig.matrixWorld);
  for (const collider of colliders) collider.center.applyMatrix4(rig.matrixWorld);
  rotation.premultiply(rig.getWorldQuaternion(new Quaternion()));
  const target = frame.getPose(source.targetRaySpace, reference);
  let ray: Ray | null = null;
  if (target) {
    const matrix = new Matrix4().fromArray(target.transform.matrix);
    matrix.premultiply(rig.matrixWorld);
    ray = new Ray(new Vector3().setFromMatrixPosition(matrix), new Vector3(0, 0, -1).transformDirection(matrix));
  }
  // A missing ray still permits grabbing a nearby floating copy by touch.
  return { source, position, rotation, ray, pressed, selectPressed, colliders };
}

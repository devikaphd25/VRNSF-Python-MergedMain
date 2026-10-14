import { Object3D, Quaternion, Vector3 } from "three";
import type { SeatAvatarPose, AvatarHandPose } from "../../../shared/seat-avatar-tracking";

/**
 * Moves the GLB bones from tracking data. Used by BOTH local arms and seated avatars.
 * IK (inverse kinematics) bends the elbow/shoulder to bring the wrist toward a target.
 * This changes bone rotations, not the GLB file or bone lengths. No finger bones exist.
 */
export class SeatAvatarPoseDriver {
  // Save the original bone rotations so motion does not accumulate frame after frame.
  private rest = new Map<Object3D, Quaternion>();
  private head?: Object3D;
  private headOrigin = new Vector3();
  private tracked?: SeatAvatarPose;
  private receivedAt = 0;
  private raised = false;
  constructor(private root: Object3D) {
    root.updateWorldMatrix(true, true);
    root.traverse(bone => {
      if ((bone as any).isBone) this.rest.set(bone, bone.quaternion.clone());
    });
    this.head = root.getObjectByName("Head");
    if (this.head) this.headOrigin.copy(root.worldToLocal(this.head.getWorldPosition(new Vector3())));
  }
  // Store the latest snapshot; update() performs the actual movement.
  setPose(pose: SeatAvatarPose | null): void {
    this.tracked = pose ?? undefined;
    this.receivedAt = performance.now();
  }
  setRaised(raised: boolean): void { this.raised = raised; }
  update(delta: number): void {
    // Keep last frame for smoothing, then solve again from the original resting pose.
    const previous = new Map<Object3D, Quaternion>();
    for (const [bone, rest] of this.rest) {
      previous.set(bone, bone.quaternion.clone());
      bone.quaternion.copy(rest);
    }
    this.root.updateWorldMatrix(true, true);
    // Stop using frozen network poses after 700 ms and ease back toward rest.
    const pose = performance.now() - this.receivedAt < 700 ? this.tracked : undefined;
    if (this.head && pose) {
      const rootRotation = this.root.getWorldQuaternion(new Quaternion());
      const restWorld = this.head.getWorldQuaternion(new Quaternion());
      const relativeRest = rootRotation.clone().invert().multiply(restWorld);
      // 0.8 fits tracking offsets to this model; root/marker scale also affects reach.
    const target = rootRotation.multiply(new Quaternion().fromArray(pose.head)).multiply(relativeRest);
      // Bone rotations are relative to their parent, so convert from world coordinates.
      this.head.quaternion.copy(this.head.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(target));
    }
    this.poseArm("Left", pose?.left ?? null, false);
    this.poseArm("Right", pose?.right ?? null, this.raised);
    // Gradually blend rotations (slerp) to avoid jumps between network snapshots.
    // delta is elapsed seconds; 14 controls how quickly the model catches up.
    const blend = 1 - Math.exp(-14 * Math.min(delta, 0.1));
    for (const [bone, prior] of previous) {
      const target = bone.quaternion.clone();
      bone.quaternion.copy(prior).slerp(target, blend);
    }
    this.root.updateWorldMatrix(true, true);
  }
  private poseArm(side: "Left" | "Right", handPose: AvatarHandPose | null, raised: boolean): void {
    if (!handPose && !raised) return;
    // Names must match bones inside student-avatar-01-alien.glb exactly.
    const upper = this.root.getObjectByName(`${side}UpperArm`);
    const lower = this.root.getObjectByName(`${side}LowerArm`);
    const hand = this.root.getObjectByName(`${side}Hand`);
    if (!upper || !lower || !hand) return;
    this.root.updateWorldMatrix(true, true);
    const rootOrientation = this.root.getWorldQuaternion(new Quaternion());
    const restHandOrientation = rootOrientation.clone().invert().multiply(hand.getWorldQuaternion(new Quaternion()));
    // The GLB's relaxed hands point down along its resting forearms. XR's
    // neutral grip points forward (-Z, converted to model +Z). Align that
    // reference before applying tracking, otherwise level hands droop down.
    const restForward = hand.getWorldPosition(new Vector3())
      .sub(lower.getWorldPosition(new Vector3()))
      .applyQuaternion(rootOrientation.clone().invert()).normalize();
    const neutralHandOrientation = new Quaternion()
      .setFromUnitVectors(restForward, new Vector3(0, 0, 1))
      .multiply(restHandOrientation);
    // Model faces +Z; tracking has already been converted to that convention.
    const offset = raised ? new Vector3(-0.25, 0.3, 0.05) : new Vector3().fromArray(handPose!.position);
    const target = this.root.localToWorld(this.headOrigin.clone().add(offset.multiplyScalar(0.8)));
    // Rotate bones only: preserve original bone lengths and skin bindings.
    // Six passes rotate the elbow then shoulder toward the target without stretching.
    for (let iteration = 0; iteration < 6; iteration++) {
      for (const joint of [lower, upper]) {
        this.root.updateWorldMatrix(true, true);
        const origin = joint.getWorldPosition(new Vector3());
        const from = hand.getWorldPosition(new Vector3()).sub(origin).normalize();
        const to = target.clone().sub(origin).normalize();
        if (from.lengthSq() < 0.1 || to.lengthSq() < 0.1) continue;
        const world = new Quaternion().setFromUnitVectors(from, to).multiply(joint.getWorldQuaternion(new Quaternion()));
        joint.quaternion.copy(joint.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
      }
    }
    // After placing the wrist, rotate the palm using the corrected neutral orientation.
    if (handPose && !raised) {
      this.root.updateWorldMatrix(true, true);
      const worldOrientation = rootOrientation.multiply(new Quaternion().fromArray(handPose.rotation)).multiply(neutralHandOrientation);
      hand.quaternion.copy(hand.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(worldOrientation));
    }
  }
}

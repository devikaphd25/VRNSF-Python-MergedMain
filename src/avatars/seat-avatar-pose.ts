import { Euler, MathUtils, Object3D, Quaternion, Vector3 } from "three";
import type { SeatAvatarPose, AvatarHandPose } from "../../shared/seat-avatar-tracking";

/**
 * Moves the GLB bones from tracking data. Used by BOTH local arms and seated avatars.
 * IK (inverse kinematics) bends the elbow/shoulder to bring the wrist toward a target.
 * This changes bone rotations, not the GLB file or bone lengths. No finger bones exist.
 */
export class SeatAvatarPoseDriver {
  // Save the original bone rotations so motion does not accumulate frame after frame.
  private rest = new Map<Object3D, Quaternion>();
  private head?: Object3D;
  private neck?: Object3D;
  private lastHeadYaw = 0;
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
    const neck = root.getObjectByName("Neck");
    // Only drive the neck when it actually belongs to this head's parent chain.
    for (let parent = this.head?.parent; parent; parent = parent.parent) {
      if (parent === neck) { this.neck = neck; break; }
    }
    const eye = root.getObjectByName("AvatarEyeAnchor") ?? this.head;
    if (eye) this.headOrigin.copy(root.worldToLocal(eye.getWorldPosition(new Vector3())));
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
      // Interpret tracking in model-facing axes, not the GLB bone's local axes.
      const angles = new Euler().setFromQuaternion(new Quaternion().fromArray(pose.head), "YXZ");
      // Keep the same turn direction when tracking crosses +/-180 behind the body.
      // Otherwise a tiny motion there can whip a limited head to the other side.
      if (Math.abs(angles.y) > Math.PI / 2 && Math.abs(this.lastHeadYaw) > Math.PI / 4) {
        angles.y = Math.sign(this.lastHeadYaw) * Math.abs(angles.y);
      }
      angles.set(
        MathUtils.clamp(angles.x, -MathUtils.degToRad(55), MathUtils.degToRad(55)),
        MathUtils.clamp(angles.y, -MathUtils.degToRad(80), MathUtils.degToRad(80)),
        MathUtils.clamp(angles.z, -MathUtils.degToRad(25), MathUtils.degToRad(25)),
        "YXZ"
      );
      this.lastHeadYaw = angles.y;
      const look = new Quaternion().setFromEuler(angles);
      if (this.neck?.parent) {
        // Share the turn with the neck while preserving the model's rest pose.
        const neckRest = rootRotation.clone().invert().multiply(this.neck.getWorldQuaternion(new Quaternion()));
        const neckTarget = rootRotation.clone()
          .multiply(new Quaternion().slerp(look, 0.25)).multiply(neckRest);
        this.neck.quaternion.copy(this.neck.parent.getWorldQuaternion(new Quaternion()).invert().multiply(neckTarget));
        this.root.updateWorldMatrix(true, true);
      }
      const target = rootRotation.multiply(look).multiply(relativeRest);
      // Bone rotations are relative to their parent, so convert from world coordinates.
      this.head.quaternion.copy(this.head.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(target));
    } else {
      this.lastHeadYaw = 0;
    }
    this.poseArm("Left", pose?.left ?? null, false);
    this.poseArm("Right", pose?.right ?? null, this.raised);
    // Gradually blend rotations (slerp) to avoid jumps between network snapshots.
    // delta is elapsed seconds; 14 controls how quickly the model catches up.
    const blend = 1 - Math.exp(-14 * Math.min(delta, 0.1));
    for (const [bone, prior] of previous) {
      const target = bone.quaternion.clone();
      const angle = prior.angleTo(target);
      // Bound visible head/neck speed after a large or delayed network update.
      const amount = (bone === this.head || bone === this.neck) && angle > 0
        ? Math.min(blend, MathUtils.degToRad(240) * Math.max(0, Math.min(delta, 0.1)) / angle)
        : blend;
      bone.quaternion.copy(prior).slerp(target, amount);
    }
    this.root.updateWorldMatrix(true, true);
  }
  private poseArm(side: "Left" | "Right", handPose: AvatarHandPose | null, raised: boolean): void {

    // Bone names must match the supported avatar rigs.
    const upper = this.root.getObjectByName(`${side}UpperArm`);
    const lower = this.root.getObjectByName(`${side}LowerArm`);
    const hand = this.root.getObjectByName(`${side}Hand`);
    if (!upper || !lower || !hand) {
      // Supplied Avatar01/02/03 models use separate, unskinned hand meshes.
      const standalone = ["Avatar01", "Avatar02", "Avatar03"]
        .map(prefix => this.root.getObjectByName(`${prefix}_Hand${side}`))
        .find(Boolean);
      if (!standalone) return;
      if (!standalone.userData.avatarRestPosition) {
        standalone.userData.avatarRestPosition = standalone.position.clone();
        standalone.userData.avatarRestRotation = standalone.quaternion.clone();
      }
      if (!handPose && !raised) {
        standalone.position.copy(standalone.userData.avatarRestPosition);
        standalone.quaternion.copy(standalone.userData.avatarRestRotation);
        return;
      }
      const offset = raised ? new Vector3(-0.25, 0.3, 0.05) : new Vector3().fromArray(handPose!.position);
      const target = this.root.localToWorld(this.headOrigin.clone().add(offset.multiplyScalar(0.8)));
      standalone.position.copy(standalone.parent!.worldToLocal(target));
      if (handPose && !raised) {
        const orientation = this.root.getWorldQuaternion(new Quaternion()).multiply(new Quaternion().fromArray(handPose.rotation));
        standalone.quaternion.copy(standalone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(orientation));
      }
      return;
    }
    if (!handPose && !raised) return;
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

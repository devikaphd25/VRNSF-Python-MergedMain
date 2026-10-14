import { readAvatarInputPose } from "../components/instructor/avatar-input-pose";
import { createFirstPersonAvatar } from "../components/instructor/first-person-avatar";
import { SeatAvatarPoseDriver } from "../components/instructor/seat-avatar-pose";
import { AssetManager, createSystem } from "@iwsdk/core";
import { Quaternion, Vector3, Euler, Object3D } from "three";
import { socket } from "../network/socket";
import { applySeatAvatarPose, updateSeatAvatarPoses, setSeatAvatarHandRaised } from "../components/instructor/seat-markers";
import { sanitizeSeatAvatarPose, type SeatAvatarPose, type AvatarRotation } from "../../shared/seat-avatar-tracking";

/**
 * Main avatar coordinator. Start reading here.
 * Each frame: read headset/hands -> convert coordinates -> move your local arms.
 * Every ~67 ms: send the pose to server.ts so classmates can see your movement.
 * Incoming poses go to seat-markers.ts, which finds the matching seated avatar.
 * A "pose" is a snapshot of head rotation and left/right hand position/rotation.
 */
export class SeatAvatarTrackingSystem extends createSystem({}) {
  // Separate arms-only model seen by YOU; classmates use the seated model instead.
  private ownAvatar?: Object3D;
  private ownDriver?: SeatAvatarPoseDriver;
  // Original head location inside the GLB, used to align its arms with your eyes.
  private ownHeadOrigin = new Vector3();
  private ownRaised = false;
  // Remember hands briefly when the headset loses sight of them (250 ms).
  private lastHands: SeatAvatarPose = { head: [0, 0, 0, 1], left: null, right: null };
  private handSeenAt = { left: 0, right: 0 };
  private lastViewerAt = 0;
  private lastSent = 0;
  private lastFrameTime = performance.now();
  // Yaw means left/right body facing, without head tilt or looking up/down.
  private bodyYaw?: Quaternion;
  private wasTracking = false;
  private modelAxes = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  // Register network and XR listeners once when the system starts.
  init(): void {
    socket.on("seatAvatarPose", this.receivePose);
    socket.on("raiseHandUpdated", this.receiveHand);
    this.renderer.xr.addEventListener("sessionend", this.resetTracking);
    socket.on("disconnect", this.resetTracking);
  }
  private receivePose = (data: { studentId: string; pose: unknown }): void => {
    if (typeof data?.studentId !== "string") return;
    applySeatAvatarPose(data.studentId, sanitizeSeatAvatarPose(data.pose));
  };
  // The Raise Hand button is a separate right-arm override, not physical tracking.
  private receiveHand = (data: { studentId?: string; playerId?: string; raised: boolean }): void => {
    const id = data?.studentId ?? data?.playerId;
    if (id) setSeatAvatarHandRaised(id, Boolean(data.raised));
    if (id === socket.id) {
      this.ownRaised = Boolean(data.raised);
      this.ownDriver?.setRaised(this.ownRaised);
    }
  };
  // null tells other clients tracking ended; next XR session recalibrates facing.
  private resetTracking = (): void => {
    if (this.wasTracking && socket.connected) socket.emit("seatAvatarPose", null);
    if (this.ownAvatar) this.ownAvatar.visible = false;
    this.lastHands.left = this.lastHands.right = null;
    this.handSeenAt = { left: 0, right: 0 };
    this.wasTracking = false;
    this.bodyYaw = undefined;
  };
  update(): void {
    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000;
    // Animate classmates even on an instructor browser that is not in VR.
    updateSeatAvatarPoses(delta);
    this.lastFrameTime = now;
    const state = window as any;
    if (state.isInstructor || !this.renderer.xr.isPresenting || state.isLabActive || state.isPuzzleActive || state.isChallenge2Open) {
      if (this.wasTracking) this.resetTracking();
      return;
    }
    // Local arms update every frame; only network traffic is throttled.
    if (this.ownAvatar && now - this.lastViewerAt > 250) this.ownAvatar.visible = false;
    const frame = this.renderer.xr.getFrame();
    // Reference space is the headset tracking coordinate system, not the classroom.
    const reference = this.renderer.xr.getReferenceSpace();
    const session = this.renderer.xr.getSession();
    if (!frame || !reference || !session) return;
    const viewer = frame.getViewerPose(reference);
    if (!viewer) return;
    this.lastViewerAt = now;
    const orientation = viewer.transform.orientation;
    const head = new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
    // Calibrate body forward once per XR session/activity; head motion remains relative.
    this.bodyYaw ??= new Quaternion().setFromEuler(new Euler(0, new Euler().setFromQuaternion(head, "YXZ").y, 0));
    const inverseBody = this.bodyYaw.clone().invert();
    // Remove initial body facing, then convert XR -Z forward to the GLB +Z forward.
    // Quaternions store 3D rotations as four values (x, y, z, w).
    const mapped = (q: Quaternion): AvatarRotation => this.modelAxes.clone().multiply(inverseBody.clone().multiply(q))
      .multiply(this.modelAxes.clone().invert()).toArray() as AvatarRotation;
    const packet: SeatAvatarPose = { head: mapped(head), left: null, right: null };
    const eye = viewer.transform.position;
    for (const source of session.inputSources) {
      if (source.handedness !== "left" && source.handedness !== "right") continue;
      const grip = readAvatarInputPose(frame, source, reference);
      if (!grip) continue;
      const p = grip.transform.position, q = grip.transform.orientation;
      // Send hands relative to the eyes so classroom seat positions do not affect tracking.
      const offset = new Vector3(p.x - eye.x, p.y - eye.y, p.z - eye.z).applyQuaternion(inverseBody).applyQuaternion(this.modelAxes);
      packet[source.handedness] = { position: offset.toArray() as [number, number, number], rotation: mapped(new Quaternion(q.x, q.y, q.z, q.w)) };
    }
    // Hold a short tracking dropout; never retain stale hands indefinitely.
    for (const side of ["left", "right"] as const) {
      if (packet[side]) {
        this.lastHands[side] = packet[side];
        this.handSeenAt[side] = now;
      } else if (now - this.handSeenAt[side] < 250) {
        packet[side] = this.lastHands[side];
      }
    }
    // Create our arms once from the loaded asset; never reload the GLB every frame.
    if (!this.ownAvatar) {
      const asset = AssetManager.getGLTF("studentSeatAlien");
      if (asset) {
        this.ownAvatar = createFirstPersonAvatar(asset.scene);
        this.ownAvatar.updateMatrixWorld(true);
        const bone = this.ownAvatar.getObjectByName("Head");
        if (bone) this.ownHeadOrigin.copy(this.ownAvatar.worldToLocal(bone.getWorldPosition(new Vector3())));
        // First-person size. Paired with the 0.8 hand offset in seat-avatar-pose.ts.
        this.ownAvatar.scale.setScalar(1.25);
        this.world.scene.add(this.ownAvatar);
        this.ownDriver = new SeatAvatarPoseDriver(this.ownAvatar);
      }
    }
    if (this.ownAvatar && this.ownDriver) {
      // Include the player rig transform (seat/teleport) when positioning local arms.
      const rig = this.camera.parent;
      rig?.updateWorldMatrix(true, false);
      const position = new Vector3(eye.x, eye.y, eye.z);
      if (rig) position.applyMatrix4(rig.matrixWorld);
      const rotation = rig ? rig.getWorldQuaternion(new Quaternion()) : new Quaternion();
      rotation.multiply(this.bodyYaw).multiply(this.modelAxes);
      this.ownAvatar.quaternion.copy(rotation);
      // Put the model's original head point at the tracked eye position.
      this.ownAvatar.position.copy(position).sub(this.ownHeadOrigin.clone().multiplyScalar(1.25).applyQuaternion(rotation));
      this.ownAvatar.visible = Boolean(packet.left || packet.right || this.ownRaised);
      this.ownDriver.setRaised(this.ownRaised);
      this.ownDriver.setPose(packet);
      this.ownDriver.update(delta);
    }
    // Local movement is immediate; the network needs only 15 snapshots per second.
    if (socket.connected && now - this.lastSent >= 1000 / 15) {
      socket.emit("seatAvatarPose", packet);
      this.lastSent = now;
    }
    this.wasTracking = true;
  }
  // Remove our cloned geometry and listeners when this system is destroyed.
  destroy(): void {
    this.resetTracking();
    this.ownAvatar?.removeFromParent();
    this.ownAvatar?.traverse(object => {
      if ((object as any).isSkinnedMesh) (object as any).geometry.dispose();
    });
    socket.off("seatAvatarPose", this.receivePose);
    socket.off("raiseHandUpdated", this.receiveHand);
    socket.off("disconnect", this.resetTracking);
    this.renderer.xr.removeEventListener("sessionend", this.resetTracking);
  }
}

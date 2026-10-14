import { SeatAvatarPoseDriver } from "./seat-avatar-pose";
import type { SeatAvatarPose } from "../../../shared/seat-avatar-tracking";
import { Box3, Group } from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AssetManager } from "@iwsdk/core";
/** Creates seated alien models and name labels seen by other participants. */

import {
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Object3D,
  Vector3
} from "@iwsdk/core";

import { socket } from "../../network/socket";

// Hide your own seated copy: first-person-avatar.ts supplies your visible arms in VR.
function isLocalStudent(studentId: string): boolean {
  return !(window as any).isInstructor && studentId === socket.id;
}

interface Student {
  id: string;
  name?: string;
  seat: string;
  mode: string;
  isDemo?: boolean;
  handRaised?: boolean;
}

// Store markers by student ID
type SeatMarker = Group & { material: SpriteMaterial };
const markers = new Map<string, SeatMarker>();
// One independent bone animator per student, keyed by the server socket ID.
const poseDrivers = new Map<string, SeatAvatarPoseDriver>();
// The tracking system delivers incoming movement to the correct student here.
export function applySeatAvatarPose(id: string, pose: SeatAvatarPose | null): void {
  poseDrivers.get(id)?.setPose(pose);
}
export function setSeatAvatarHandRaised(id: string, raised: boolean): void {
  poseDrivers.get(id)?.setRaised(raised);
}
export function updateSeatAvatarPoses(delta: number): void {
  for (const [id, driver] of poseDrivers) {
    if (markers.get(id)?.visible) driver.update(delta);
  }
}
let playerRef: any = null;
let stagePosition = new Vector3(0, 0, 0);
let isFacingStage = false;
let markersSuppressed = false;
let markersForcedVisible = false;
let markerTheme: "default" | "astronaut" = "default";
const FACING_THRESHOLD = 0.5;

const astronautImage = new Image();
astronautImage.src = "./images/markers/astronaut-seat-marker.png";
astronautImage.onload = () => {
  if (markerTheme === "astronaut") refreshAllMarkerTextures();
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
  ctx.fill();
}

function createTexture(name: string, mode: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#111827";
  roundedRect(ctx, 2, 2, 508, 92, 18);
  ctx.strokeStyle = mode === "Presentation Mode" ? "#22c55e" : "#38bdf8";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "white";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const displayName = name.length > 22 ? name.substring(0, 21) + "..." : name;
  ctx.fillText(displayName, 256, 48, 470);
  return new CanvasTexture(canvas);
}

function refreshAllMarkerTextures(): void {
  markers.forEach(marker => {
    const material = marker.material as SpriteMaterial;
    material.map?.dispose();
    material.map = createTexture(
      String(marker.userData.displayName ?? "Student"),
      String(marker.userData.mode ?? "Classroom Mode")
    );
    material.needsUpdate = true;
  });
}

export function setSeatMarkerTheme(theme: "default" | "astronaut"): void {
  if (markerTheme === theme) return;
  markerTheme = theme;
  refreshAllMarkerTextures();
  console.log(`[SeatMarkers] Theme changed to ${theme}`);
}

// ==========================================
// Check if player is facing the stage
// ==========================================
function checkPlayerFacingStage(): boolean {
  if (!playerRef) return true;

  try {
    const forward = new Vector3(0, 0, -1);
    forward.applyQuaternion(playerRef.quaternion);

    const playerPos = new Vector3();
    playerRef.getWorldPosition(playerPos);

    // Use the classroom's real instructor/stage anchor instead of assuming
    // the stage is at the world origin.
    const toStage = stagePosition.clone().sub(playerPos);
    toStage.y = 0;
    toStage.normalize();

    const dot = forward.dot(toStage);

    return dot > FACING_THRESHOLD;
  } catch (e) {
    return true;
  }
}

// ==========================================
// Update all marker visibility
// ==========================================
export function updateMarkerVisibility(player: any) {
  playerRef = player;
  isFacingStage = checkPlayerFacingStage();
  const isInstructor = Boolean((window as any).isInstructor);

  markers.forEach((marker, studentId) => {
    marker.visible =
      !((window as any).isLabActive || (window as any).isPuzzleActive) && !isLocalStudent(studentId) &&
      !markersSuppressed &&
      (
        markersForcedVisible ||
        !isInstructor ||
        isFacingStage
      );
  });
}

// ==========================================
// Update seat markers
// ==========================================
export function updateSeatMarkers(
  students: Student[],
  scene: Object3D,
  classroom: Object3D
) {
  console.log("[SeatMarkers] Updating markers for", students.length, "students");

  // ✅ Filter out demo students and students without seats
  const realStudents = students.filter(s =>
    !s.isDemo && s.seat && s.seat !== "Not selected" && !isLocalStudent(s.id)
  );

  console.log("[SeatMarkers] Real students with seats:", realStudents.length);

  const stageAnchor = classroom.getObjectByName("InstructorAvatar_Anchor");
  if (stageAnchor) stageAnchor.getWorldPosition(stagePosition);

  // Get current student IDs
  const currentStudentIds = realStudents.map(s => s.id);

  // Remove markers for students no longer in the list
  const toRemove: string[] = [];
  markers.forEach((marker, id) => {
    if (!currentStudentIds.includes(id)) {
      scene.remove(marker);
      if (marker.material) {
        if (marker.material.map) {
          marker.material.map.dispose();
        }
        marker.material.dispose();
      }
      toRemove.push(id);
    }
  });
  toRemove.forEach(id => { markers.delete(id); poseDrivers.delete(id); });

  // Update or create markers
  realStudents.forEach(student => {
    // ✅ Use the actual student name (from server)
    const displayName = student.name || student.id.substring(0, 6);

    console.log(`[SeatMarkers] Creating marker for ${displayName} at ${student.seat}`);

    const seat = classroom.getObjectByName(student.seat);
    if (!seat) {
      console.warn(`[SeatMarkers] Seat not found: ${student.seat}`);
      return;
    }

    const pos = new Vector3();
    seat.getWorldPosition(pos);

    let marker = markers.get(student.id);

    if (!marker) {
      const texture = createTexture(displayName, student.mode);

      const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      marker = Object.assign(new Group(), { material });
      marker.name = `StudentSeatAlien-${student.id}`;
      const label = new Sprite(material);
      label.scale.set(1.15, 1.15 * 96 / 512, 1);
      label.position.y = -0.17;
      marker.add(label);
      const asset = AssetManager.getGLTF("studentSeatAlien");
      if (asset) {
        // Clone the skeleton too, so animating one student does not move every avatar.
        const alien = cloneSkeleton(asset.scene);
        const bounds = new Box3().setFromObject(alien);
        const size = bounds.getSize(new Vector3());
        // Normalize the model size; the outer marker scale below also affects final size.
        alien.scale.multiplyScalar(1.3 / Math.max(size.y, size.x, size.z, 0.001));
        alien.updateMatrixWorld(true);
        bounds.setFromObject(alien);
        const center = bounds.getCenter(new Vector3());
        alien.position.add(new Vector3(-center.x, -bounds.min.y, -center.z));
        alien.name = "SeatAlienModel";
        alien.traverse(object => { object.pointerEvents = "none"; });
        marker.add(alien);
        poseDrivers.set(student.id, new SeatAvatarPoseDriver(alien));
      }

      marker.scale.set(0.65, 0.65, 0.65);
      marker.userData.studentId = student.id;
      marker.userData.displayName = displayName;
      marker.userData.mode = student.mode;

      // ✅ Start visible by default
      marker.visible =
        !markersSuppressed &&
        (
          markersForcedVisible ||
          !(window as any).isInstructor ||
          isFacingStage
        );

      scene.add(marker);
      markers.set(student.id, marker);

      console.log(`[SeatMarkers] ✅ Created marker for ${displayName}`);
    }

    if (marker.userData.displayName !== displayName || marker.userData.mode !== student.mode) {
      marker.material.map?.dispose();
      marker.material.map = createTexture(displayName, student.mode);
    }
    marker.userData.displayName = displayName;
    marker.userData.mode = student.mode;
    poseDrivers.get(student.id)?.setRaised(Boolean(student.handRaised));
    const alien = marker.getObjectByName("SeatAlienModel");
    if (alien) seat.getWorldQuaternion(alien.quaternion);

    // Seat placement: +0.50 raises the marker above the seat anchor.
    marker.position.set(
      pos.x,
      pos.y + 0.50,
      pos.z
    );
  });

  // Update visibility based on player facing
  if (playerRef) {
    updateMarkerVisibility(playerRef);
  }
}

// ==========================================
// Force show/hide markers (for debugging)
// ==========================================
export function showAllMarkers() {
  markersSuppressed = false;
  markers.forEach((marker, studentId) => {
    marker.visible = !((window as any).isLabActive || (window as any).isPuzzleActive) && !isLocalStudent(studentId);
  });
  console.log("[SeatMarkers] All markers forced visible");
}

/**
 * Lightweight Mission Review arrival animation. The existing 2D sprites are
 * offset briefly and glide back to their assigned seats; no new models or
 * textures are loaded.
 */
export function animateSeatMarkersArrival(durationMs = 1400): Promise<void> {
  const arrivals = Array.from(markers.values())
    .filter(marker => !isLocalStudent(String(marker.userData.studentId)))
    .map((marker, index) => {
    if (!marker.userData.classroomMarkerPosition) {
      marker.userData.classroomMarkerPosition = marker.position.clone();
      marker.userData.classroomMarkerScale = marker.scale.clone();
    }
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2) % 8;
    return {
      marker,
      start: new Vector3(side * (0.55 + row * 0.08), 1.25 + (row % 3) * 0.18, 4.9),
      destination: new Vector3(side * 6.35, 1.15 + row * 0.5, 5.7),
      destinationScale: marker.scale.clone()
    };
  });

  if (arrivals.length === 0) return Promise.resolve();

  arrivals.forEach(({ marker, start, destinationScale }) => {
    marker.visible = !((window as any).isLabActive || (window as any).isPuzzleActive) && !isLocalStudent(String(marker.userData.studentId));
    marker.position.copy(start);
    marker.scale.copy(destinationScale).multiplyScalar(0.72);
  });

  return new Promise(resolve => {
    const startedAt = performance.now();
    const frame = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);

      arrivals.forEach(({ marker, start, destination, destinationScale }) => {
        marker.position.lerpVectors(start, destination, eased);
        marker.scale.copy(destinationScale).multiplyScalar(0.72 + eased * 0.28);
      });

      if (progress < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function restoreSeatMarkersAfterDebrief(): void {
  markers.forEach(marker => {
    const position = marker.userData.classroomMarkerPosition as Vector3 | undefined;
    const scale = marker.userData.classroomMarkerScale as Vector3 | undefined;
    if (position) marker.position.copy(position);
    if (scale) marker.scale.copy(scale);
    delete marker.userData.classroomMarkerPosition;
    delete marker.userData.classroomMarkerScale;
  });
}

/**
 * Keep every marker visible across the per-frame classroom visibility loop.
 * Challenge mode uses this because students are no longer expected to face
 * the classroom stage while answering the question.
 */
export function setSeatMarkersForcedVisible(forced: boolean): void {
  markersForcedVisible = forced;

  if (forced) {
    markersSuppressed = false;
    markers.forEach((marker, studentId) => {
      marker.visible = !((window as any).isLabActive || (window as any).isPuzzleActive) && !isLocalStudent(studentId);
    });
  } else if (playerRef) {
    updateMarkerVisibility(playerRef);
  }

  console.log(
    `[SeatMarkers] Forced visibility: ${forced ? "on" : "off"}`
  );
}

export function hideAllMarkers() {
  // This is the menu's temporary per-frame hide. Do not set the persistent
  // presentation suppression flag, otherwise markers remain hidden after the
  // menu closes and the normal visibility loop resumes.
  markers.forEach((marker, studentId) => {
    marker.visible = false;
  });
}

export function setSeatMarkersSuppressed(suppressed: boolean) {
  markersSuppressed = suppressed;

  if (suppressed) {
    markers.forEach((marker, studentId) => {
      marker.visible = false;
    });
  } else if (playerRef) {
    updateMarkerVisibility(playerRef);
  } else {
    markers.forEach((marker, studentId) => {
      marker.visible = !((window as any).isLabActive || (window as any).isPuzzleActive) && !isLocalStudent(studentId);
    });
  }

  console.log(
    `[SeatMarkers] Presentation suppression: ${suppressed ? "on" : "off"}`
  );
}

// ==========================================
// Clear all markers
// ==========================================
export function clearAllSeatMarkers(scene: Object3D) {
  markers.forEach((marker, id) => {
    scene.remove(marker);
    if (marker.material) {
      if (marker.material.map) {
        marker.material.map.dispose();
      }
      marker.material.dispose();
    }
  });
  markers.clear();
  poseDrivers.clear();
  console.log("[SeatMarkers] All markers cleared");
}

// ==========================================
// Get marker count (for debugging)
// ==========================================
export function getMarkerCount(): number {
  return markers.size;
}

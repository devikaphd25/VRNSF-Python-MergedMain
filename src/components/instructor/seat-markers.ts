// components/instructor/seat-markers.ts

import {
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Object3D,
  Vector3
} from "@iwsdk/core";

interface Student {
  id: string;
  name?: string;
  seat: string;
  mode: string;
  isDemo?: boolean;
}

// Store markers by student ID
const markers = new Map<string, Sprite>();
let playerRef: any = null;
let isFacingStage = false;
let markersSuppressed = false;
const FACING_THRESHOLD = 0.5;

function createTexture(name: string, mode: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;

  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, 512, 512);

  const color =
    mode === "Presentation Mode"
      ? "#22c55e"
      : "#2196f3";

  // circle
  ctx.beginPath();
  ctx.arc(256, 150, 90, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.lineWidth = 12;
  ctx.strokeStyle = color;
  ctx.stroke();

  // avatar
  ctx.fillStyle = "#555";
  ctx.beginPath();
  ctx.arc(256, 140, 38, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(256, 205, 55, Math.PI, 0);
  ctx.fill();

  // name box
  ctx.fillStyle = "#111827";
  // @ts-ignore
  if (ctx.roundRect) {
    // @ts-ignore
    ctx.roundRect(120, 300, 272, 70, 20);
    ctx.fill();
  } else {
    ctx.fillRect(120, 300, 272, 70);
  }

  ctx.fillStyle = "white";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";

  // ✅ Show actual name (not ID)
  const displayName = name.length > 8 ? name.substring(0, 8) + "..." : name;
  ctx.fillText(displayName, 256, 345);

  return new CanvasTexture(canvas);
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

    const toStage = new Vector3(0, playerPos.y, 0).sub(playerPos);
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

  markers.forEach((marker) => {
    marker.visible = !markersSuppressed && isFacingStage;
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
  const realStudents = students.filter(s => !s.isDemo && s.seat && s.seat !== "Not selected");

  console.log("[SeatMarkers] Real students with seats:", realStudents.length);

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
  toRemove.forEach(id => markers.delete(id));

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

      marker = new Sprite(
        new SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,  // ✅ Always render on top
        })
      );

      marker.scale.set(0.65, 0.65, 0.65);

      // ✅ Start visible by default
      marker.visible = !markersSuppressed;

      scene.add(marker);
      markers.set(student.id, marker);

      console.log(`[SeatMarkers] ✅ Created marker for ${displayName}`);
    }

    marker.position.set(
      pos.x,
      pos.y + 0.75,
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
  markers.forEach((marker) => {
    marker.visible = true;
  });
  console.log("[SeatMarkers] All markers forced visible");
}

export function hideAllMarkers() {
  markersSuppressed = true;
  markers.forEach((marker) => {
    marker.visible = false;
  });
  console.log("[SeatMarkers] All markers forced hidden");
}

export function setSeatMarkersSuppressed(suppressed: boolean) {
  markersSuppressed = suppressed;

  if (suppressed) {
    markers.forEach((marker) => {
      marker.visible = false;
    });
  } else if (playerRef) {
    updateMarkerVisibility(playerRef);
  } else {
    markers.forEach((marker) => {
      marker.visible = true;
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
  console.log("[SeatMarkers] All markers cleared");
}

// ==========================================
// Get marker count (for debugging)
// ==========================================
export function getMarkerCount(): number {
  return markers.size;
}

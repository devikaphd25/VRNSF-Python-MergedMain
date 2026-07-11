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
  seat: string;
  mode: string;
  isDemo?: boolean;
}

// Store markers by student ID
const markers = new Map<string, Sprite>();
let playerRef: any = null;
let isFacingStage = false;
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
  ctx.fillText(name, 256, 345);

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
    marker.visible = isFacingStage;
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

  // Get current student IDs
  const currentStudentIds = students
    .filter(s => s.seat !== "Not selected")
    .map(s => s.id);

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
  students.forEach(student => {
    if (student.seat === "Not selected") return;

    const seat = classroom.getObjectByName(student.seat);
    if (!seat) return;

    const pos = new Vector3();
    seat.getWorldPosition(pos);

    let marker = markers.get(student.id);

    if (!marker) {
      const texture = createTexture(
        student.id.substring(0, 6),
        student.mode
      );

      marker = new Sprite(
        new SpriteMaterial({
          map: texture,
          transparent: true
        })
      );

      marker.scale.set(0.75, 0.75, 0.75);
      
      // Start hidden until player faces stage
      marker.visible = false;
      
      scene.add(marker);
      markers.set(student.id, marker);
    }

    marker.position.set(
      pos.x,
      pos.y + 1.45,
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
  markers.forEach((marker) => {
    marker.visible = true;
  });
  console.log("[SeatMarkers] All markers forced visible");
}

export function hideAllMarkers() {
  markers.forEach((marker) => {
    marker.visible = false;
  });
  console.log("[SeatMarkers] All markers forced hidden");
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
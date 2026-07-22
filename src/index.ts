/// <reference types="vite/client" />
// src/index.ts

import {
  ACESFilmicToneMapping,
  AssetManager,
  AssetManifest,
  AssetType,
  EnvironmentType,
  IBLTexture,
  LocomotionEnvironment,
  PanelUI,
  RayInteractable,
  SessionMode,
  World
} from "@iwsdk/core";

import * as THREE from "three";

import { SeatComponent } from "./components/seat.component";
import { ProjectorScreenComponent } from "./components/projector-screen.component";

import { SeatSystem } from "./systems/seat.system";
import { ProjectorScreenSystem } from "./systems/projector-screen.system";
import { PresentationSystem } from "./systems/presentation.system";
import { MenuSystem } from "./systems/menu.system";
import { HintSystem } from "./systems/hint-system";
import { RaiseHandSystem } from "./systems/raise-hand.system";
import {
  InstructorDashboardSystem
} from "./systems/instructor-menu.system";
import {
  PanelSystem,
  PanelSystemComponent
} from "./panel";

import { socket } from "./network/socket";
if (typeof socket !== 'undefined') {
  socket.on("modeChanged", (data) => {
    console.log(`[Student] 🔔 TOP-LEVEL modeChanged received:`, data);
  });
}
import {
  updateSeatMarkers,
  updateMarkerVisibility,
  hideAllMarkers
} from "./components/instructor/seat-markers";
import { RaiseHandNotificationSystem }
from "./systems/raise-hand-notification.system";

// ============================================================
// USER ROLE TYPES
// ============================================================

type VRUserRole = "student" | "instructor";

interface VRUser {
  username: string;
  role: VRUserRole;
  loginTime?: string;
}

// ============================================================
// ASSETS
// ============================================================

const assets: AssetManifest = {
  classroom: {
    url: "./gltf/classroom/theater_classroom.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  classroom2: {
    url: "./gltf/classroom2/theater_classroom2.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  instructorAvatar: {
    url: "./gltf/avatars/instructor1.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  sunsetHDR: {
    url: "./hdr/venice_sunset_1k.hdr",
    type: AssetType.HDRTexture,
    priority: "critical"
  },

  raiseHandIcon: {
    url: "./gltf/icons/raise-hand1.glb",
    type: AssetType.GLTF,
    priority: "critical"
  }
};

// ============================================================
// LOGIN HELPERS
// ============================================================

function getLoggedInUser(): VRUser | null {
  const savedUser = localStorage.getItem("vrUser");

  if (!savedUser) {
    return null;
  }

  try {
    const parsedUser = JSON.parse(savedUser) as Partial<VRUser>;

    if (
      typeof parsedUser.username !== "string" ||
      parsedUser.username.trim() === ""
    ) {
      return null;
    }

    if (
      parsedUser.role !== "student" &&
      parsedUser.role !== "instructor"
    ) {
      return null;
    }

    return {
      username: parsedUser.username,
      role: parsedUser.role,
      loginTime: parsedUser.loginTime
    };
  } catch (error) {
    console.error(
      "[Login] Could not read saved user:",
      error
    );

    return null;
  }
}

function redirectToLogin(): void {
  window.location.replace("./login.html");
}

function logout(): void {
  localStorage.removeItem("vrUser");
  window.location.replace("./login.html");
}

(window as any).logout = logout;

// ============================================================
// CHECK LOGIN BEFORE CREATING THE VR WORLD
// ============================================================

const currentUser = getLoggedInUser();

if (!currentUser) {
  redirectToLogin();

  throw new Error(
    "No valid VR login was found."
  );
}

const isInstructor =
  currentUser.role === "instructor";

const isStudent =
  currentUser.role === "student";

console.log(
  "[Login] Current user:",
  currentUser.username
);

console.log(
  "[Login] Current role:",
  currentUser.role
);


(window as any).vrUser = currentUser;
(window as any).isInstructor = isInstructor;
(window as any).isStudent = isStudent;
// ============================================================
// ✅ AUTO-SEAT ON RETURN FROM LAB
// ============================================================
const urlParams = new URLSearchParams(window.location.search);
const autoSeat = urlParams.get('autoSeat') === 'true';

// ✅ If not auto-seating, clear the seat from localStorage
if (!autoSeat) {
    localStorage.removeItem('seat');
    console.log("[Student] 🧹 Cleared seat (fresh login)");
}

const returnSeat = urlParams.get('seat') || localStorage.getItem('seat');

if (returnSeat && autoSeat) {
    localStorage.setItem('seat', returnSeat);
    console.log(`[Student] 💾 Seat saved from return: ${returnSeat}`);
}
// ============================================================
// CREATE WORLD
// ============================================================

World.create(
  document.getElementById(
    "scene-container"
  ) as HTMLDivElement,
  {
    assets,

    xr: {
      sessionMode: SessionMode.ImmersiveVR,
      offer: "always",

      features: {
        handTracking: true,
        layers: true
      }
    },

    features: {
      locomotion: false,
      grabbing: false,
      physics: true,
      sceneUnderstanding: false,
      environmentRaycast: false
    }
  }
)
  .then((world) => {
    const {
      renderer,
      scene,
      camera,
      player
    } = world;

    const startupMessage =
      document.getElementById(
        "startup-message"
      );

    if (startupMessage) {
      startupMessage.textContent =
        isInstructor
          ? `Welcome Instructor ${currentUser.username}`
          : `Welcome Student ${currentUser.username}`;
    }

    document.title = isInstructor
      ? "UMES VR – Instructor"
      : "UMES VR – Student";

    // ========================================================
    // RENDERER SETTINGS
    // ========================================================

    renderer.shadowMap.enabled = false;
    renderer.toneMapping =
      ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.xr.enabled = true;

    // ========================================================
    // LIGHTING
    // ========================================================

    const levelRoot =
      world.activeLevel.value;

    levelRoot.addComponent(IBLTexture, {
      src: "sunsetHDR",
      intensity: 0.9,
      rotation: [
        0,
        Math.PI / 4,
        0
      ]
    });

    // ========================================================
    // LOAD CLASSROOM AND INSTRUCTOR AVATAR
    // ========================================================

    const classroomAsset =
      AssetManager.getGLTF("classroom2");

    const instructorAsset =
      AssetManager.getGLTF(
        "instructorAvatar"
      );

    if (!classroomAsset) {
      throw new Error(
        "The classroom2 asset could not be loaded."
      );
    }

    if (!instructorAsset) {
      throw new Error(
        "The instructorAvatar asset could not be loaded."
      );
    }

    const envMesh =
      classroomAsset.scene;

    console.log("===== CLASSROOM OBJECTS START =====");

      envMesh.traverse((object) => {
        console.log(
          "[Classroom Object]",
          object.name || "(no name)",
          object.type
        );
      });

      console.log("===== CLASSROOM OBJECTS END =====");
    const instructorMesh =
      instructorAsset.scene;

    // Hide the large box beside the instructor
    const podium =
      envMesh.getObjectByName("Podium");

    if (podium) {
      podium.visible = false;

      podium.traverse((child) => {
        child.visible = false;
      });

      console.log(
        "[Classroom] Podium hidden."
      );
    } else {
      console.warn(
        "[Classroom] Podium object was not found."
      );
    }

    envMesh.position.set(0, 0, 0);

    envMesh.updateWorldMatrix(
      true,
      true
    );

    envMesh.name =
      "theater_classroom2";

    // ========================================================
    // FIND INSTRUCTOR STAGE POSITION
    // ========================================================

    const instructorAnchor =
      envMesh.getObjectByName(
        "InstructorAvatar_Anchor"
      );

    const instructorStagePosition =
      new THREE.Vector3(
        0,
        0,
        -3
      );

    const instructorStageQuaternion =
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          0,
          Math.PI,
          0
        )
      );

    if (instructorAnchor) {
      instructorAnchor.getWorldPosition(
        instructorStagePosition
      );

      instructorAnchor.getWorldQuaternion(
        instructorStageQuaternion
      );

      console.log(
        "[Instructor] Anchor found:",
        instructorStagePosition
      );
    } else {
      console.warn(
        "[Instructor] InstructorAvatar_Anchor was not found. Using fallback position."
      );
    }

    // ========================================================
    // POSITION STATIC INSTRUCTOR AVATAR
    // ========================================================

    instructorMesh.position.copy(
      instructorStagePosition
    );

    instructorMesh.position.y += 1.3;

    instructorMesh.quaternion.copy(
      instructorStageQuaternion
    );

    instructorMesh.scale.set(
      2.5,
      2.5,
      2.5
    );

    instructorMesh.visible =
      isStudent;

    world.createTransformEntity(
      instructorMesh
    );

    console.log(
      "[Instructor] Static avatar visible:",
      instructorMesh.visible
    );

    // ========================================================
    // REGISTER COMPONENTS
    // ========================================================

    world
      .registerComponent(
        SeatComponent
      )
      .registerComponent(
        ProjectorScreenComponent
      );

    // ========================================================
    // REGISTER SHARED SYSTEMS
    // ========================================================

    world
      .registerSystem(
        PanelSystem,
        {
          priority: 1
        }
      )
      .registerSystem(
        ProjectorScreenSystem,
        {
          priority: 3
        }
      )
      .registerSystem(
        PresentationSystem,
        {
          priority: 4
        }
      )
      .registerSystem(
        MenuSystem,
        {
          priority: 6
        }
      );
 
    // ========================================================
    // REGISTER STUDENT-ONLY SYSTEMS
    // ========================================================

    if (isStudent) {
      world
        .registerSystem(
          SeatSystem,
          {
            priority: 2
          }
        )
        .registerSystem(
          HintSystem,
          {
            priority: 5
          }
        )
        .registerSystem(
          RaiseHandSystem,
          {
            priority: 7
          }
        );

      const raiseHandSystemInstance =
        world.getSystem(
          RaiseHandSystem
        );

      (window as any).RaiseHandSystem =
        raiseHandSystemInstance;

      console.log(
        "[Systems] Student systems registered."
      );
    } else {
     // ✅ Instructor-only systems
  world.registerSystem(
    InstructorDashboardSystem,
    {
      priority: 8
    }
  );
  
  world.registerSystem(
    RaiseHandNotificationSystem,
    {
      priority: 9
    }
  );

  console.log(
    "[Systems] Instructor mode active."
  );

  console.log(
    "[Systems] InstructorDashboardSystem registered."
  );
  
  console.log(
    "[Systems] RaiseHandNotificationSystem registered."
  );
    }

    // ========================================================
    // CREATE CLASSROOM ENVIRONMENT
    // ========================================================

    world
      .createTransformEntity(
        envMesh
      )
      .addComponent(
        LocomotionEnvironment,
        {
          type:
            EnvironmentType.STATIC
        }
      )
      .addComponent(
        ProjectorScreenComponent,
        {
          scene: envMesh
        }
      );

    // ========================================================
    // POSITION INSTRUCTOR PLAYER - WORKS FOR BOTH VR AND XR
    // ========================================================

    function positionInstructorOnStage(): void {
      if (!isInstructor) {
        return;
      }

      const playerObject: THREE.Object3D | undefined =
        (player as any)?.object3D ??
        (player as any);

      if (!playerObject) {
        console.error(
          "[Instructor] Could not access the player transform."
        );
        return;
      }

      // ✅ Check if we're in XR mode (desktop view)
      const isXR = renderer.xr.enabled && renderer.xr.isPresenting;

      // Place the instructor on the stage
      playerObject.position.copy(
        instructorStagePosition
      );

      // Center on stage
      playerObject.position.x = 0;

      // ✅ DIFFERENT Z VALUES FOR VR VS XR
      if (isXR) {
        // XR/DESKTOP MODE - Need to be much further forward
        // Increase this value until you're in the right position
        playerObject.position.z += 0.1; // ⬅️ ADJUST THIS VALUE
        console.log("[Instructor] XR/Desktop mode - Z offset: 6.0");
      } else {
        // VR MODE - The working value
        playerObject.position.z += 2.0;
        console.log("[Instructor] VR mode - Z offset: 2.0");
      }

      // Face the students (positive Z direction)
      playerObject.rotation.y = 0;

      playerObject.updateMatrixWorld(true);

      console.log(
        "[Instructor] Position:",
        playerObject.position.x.toFixed(2),
        playerObject.position.y.toFixed(2),
        playerObject.position.z.toFixed(2)
      );
    }

    function faceInstructorTowardStudents(): void {
      if (!isInstructor) {
        return;
      }

      const playerObject: THREE.Object3D | undefined =
        (player as any)?.object3D ??
        (player as any);

      if (!playerObject) {
        console.error(
          "[Instructor] Player transform unavailable."
        );
        return;
      }

      // Face the students (positive Z direction)
      playerObject.rotation.y = 0;
      playerObject.updateMatrixWorld(true);

      console.log(
        "[Instructor] Facing toward students (positive Z)"
      );
    }

    function prepareInstructorView(): void {
      if (!isInstructor) {
        return;
      }

      positionInstructorOnStage();

      requestAnimationFrame(() => {
        camera.updateMatrixWorld(true);
        faceInstructorTowardStudents();
      });
    }

    // ========================================================
    // INITIAL POSITIONING
    // ========================================================

    // Desktop/Non-XR initialization
    requestAnimationFrame(() => {
      prepareInstructorView();
    });

    setTimeout(() => {
      prepareInstructorView();
    }, 500);

    // ========================================================
    // XR SESSION HANDLERS - RE-APPLY POSITION
    // ========================================================

    renderer.xr.addEventListener(
      "sessionstart",
      () => {
        console.log(
          "[Instructor] XR session started."
        );

        // Multiple attempts with increasing delays
        const delays = [300, 600, 1000, 1500, 2000];

        delays.forEach((delay) => {
          setTimeout(() => {
            console.log(`[Instructor] Re-applying position (${delay}ms)`);
            prepareInstructorView();
          }, delay);
        });
      }
    );
//✅ DECLARE panelEntity FIRST (before socket handlers)
let panelEntity: any = null;
let hintEntity: any = null;
let raiseHandEntity: any = null;
let notificationEntity: any = null;
    // ========================================================
    // STUDENT LIST AND SEAT MARKERS
    // ========================================================

    socket.on(
      "studentList",
      (students) => {
        console.log(
          "[Index] Received student list:",
          students.length
        );

        updateSeatMarkers(
          students,
          scene,
          envMesh
        );
      }
    );

    socket.emit(
      "requestStudentList"
    );
// ========================================================
// STUDENT PLAYER SEAT POSITIONING
// ========================================================

function getStudentPlayerObject(): THREE.Object3D | null {
  const playerObject: THREE.Object3D | undefined =
    (player as any)?.object3D ??
    (player as any);

  if (!playerObject) {
    console.warn(
      "[Student] Player transform is not available."
    );

    return null;
  }

  return playerObject;
}

function moveStudentToSeat(
  seatName: string,
  attempt = 0
): boolean {
  const maxAttempts = 10;

  console.log(
    `[Student] Trying to move to ${seatName}, attempt ${attempt + 1}`
  );

  /*
   * Make sure the classroom world matrices are current
   * before reading the seat's world position.
   */
  envMesh.updateWorldMatrix(
    true,
    true
  );

  const seatObject =
    envMesh.getObjectByName(
      seatName
    );

  if (!seatObject) {
    if (attempt < maxAttempts - 1) {
      window.setTimeout(
        () => {
          moveStudentToSeat(
            seatName,
            attempt + 1
          );
        },
        400
      );
    } else {
      console.error(
        `[Student] Seat object was not found after ${maxAttempts} attempts: ${seatName}`
      );
    }

    return false;
  }

  const playerObject =
    getStudentPlayerObject();

  if (!playerObject) {
    if (attempt < maxAttempts - 1) {
      window.setTimeout(
        () => {
          moveStudentToSeat(
            seatName,
            attempt + 1
          );
        },
        400
      );
    }

    return false;
  }

  const seatPosition =
    new THREE.Vector3();

  const seatQuaternion =
    new THREE.Quaternion();

  seatObject.getWorldPosition(
    seatPosition
  );

  seatObject.getWorldQuaternion(
    seatQuaternion
  );

  /*
   * Match the rotation used by SeatSystem.
   */
  const flipY =
    new THREE.Quaternion()
      .setFromAxisAngle(
        new THREE.Vector3(
          0,
          1,
          0
        ),
        Math.PI
      );

  seatQuaternion.multiply(
    flipY
  );

  /*
   * Apply the seat transform to the player root.
   */
  playerObject.position.copy(
    seatPosition
  );

  playerObject.quaternion.copy(
    seatQuaternion
  );

  playerObject.updateMatrix();
  playerObject.updateMatrixWorld(
    true
  );

  camera.updateMatrixWorld(
    true
  );

  console.log(
    `[Student] ✅ Player moved to ${seatName}`,
    {
      seatPosition: {
        x: seatPosition.x,
        y: seatPosition.y,
        z: seatPosition.z
      },

      playerPosition: {
        x: playerObject.position.x,
        y: playerObject.position.y,
        z: playerObject.position.z
      }
    }
  );

  return true;
}

// ========================================================
// SEAT ACCEPTED BY SERVER
// ========================================================

socket.on(
  "seatAccepted",
  (seat: string) => {
    console.log(
      `[Student] ✅ Seat accepted: ${seat}`
    );

    localStorage.setItem(
      "seat",
      seat
    );

    if (
      panelEntity?.object3D
    ) {
      panelEntity.object3D.visible =
        false;

      console.log(
        "[Student] Seat panel hidden."
      );
    }

    /*
     * Move both new students and returning students.
     * Do not restrict movement only to autoSeat.
     */
    moveStudentToSeat(
      seat
    );

    const currentParams =
      new URLSearchParams(
        window.location.search
      );

    currentParams.set(
      "seat",
      seat
    );

    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${currentParams.toString()}`
    );
  }
);

// ========================================================
// SEAT RESTORED CONFIRMATION
// ========================================================

socket.on(
  "seatRestored",
  (data: {
    studentId: string;
    previousStudentId?: string;
    studentName: string;
    seat: string;
    mode: string;
  }) => {
    console.log(
      "[Student] ✅ Seat restored:",
      data
    );

    localStorage.setItem(
      "seat",
      data.seat
    );

    moveStudentToSeat(
      data.seat
    );
  }
);

socket.on(
  "seatRestoreRejected",
  (data: {
    seat?: string;
    message?: string;
  }) => {
    console.error(
      "[Student] ❌ Seat restoration rejected:",
      data
    );

    localStorage.removeItem(
      "seat"
    );
  }
);

// ========================================================
// AUTO-RESTORE SEAT AFTER RETURNING FROM LAB
// ========================================================

if (
  isStudent &&
  autoSeat &&
  returnSeat &&
  returnSeat !== "Unknown seat" &&
  returnSeat !== "Not selected"
) {
  const previousStudentId =
    urlParams.get(
      "previousStudentId"
    ) ||
    urlParams.get(
      "studentId"
    );

  const returningStudentName =
    urlParams.get(
      "studentName"
    ) ||
    currentUser.username;

  const requestSeatRestore =
    (): void => {
      if (!socket.connected) {
        console.log(
          "[Student] Waiting for classroom socket..."
        );

        window.setTimeout(
          requestSeatRestore,
          500
        );

        return;
      }

      console.log(
        "[Student] Requesting seat restoration:",
        {
          previousStudentId,
          studentName:
            returningStudentName,
          seat:
            returnSeat
        }
      );

      socket.emit(
        "requestRestoreSeat",
        {
          previousStudentId,
          studentName:
            returningStudentName,
          seat:
            returnSeat
        }
      );
    };

  /*
   * Allow the world, classroom model and socket
   * to finish initializing.
   */
  window.setTimeout(
    requestSeatRestore,
    1000
  );
}
// ========================================================
// REAPPLY STUDENT SEAT AFTER XR SESSION STARTS
// ========================================================

renderer.xr.addEventListener(
  "sessionstart",
  () => {
    if (
      !isStudent
    ) {
      return;
    }

    const savedSeat =
      localStorage.getItem(
        "seat"
      );

    if (
      !savedSeat ||
      savedSeat === "Unknown seat" ||
      savedSeat === "Not selected"
    ) {
      return;
    }

    console.log(
      `[Student] XR started. Reapplying seat ${savedSeat}`
    );

    const delays = [
      200,
      500,
      1000,
      1500
    ];

    delays.forEach(
      (delay) => {
        window.setTimeout(
          () => {
            moveStudentToSeat(
              savedSeat
            );
          },
          delay
        );
      }
    );
  }
);


    // ========================================================
    // GLOBAL UI FLAGS
    // ========================================================

    (window as any).isMenuOpen =
      false;

    (window as any).isPresentationOpen =
      false;

    (window as any).isHintVisible =
      isStudent;

    (window as any).isRaiseHandReady =
      false;

    // ========================================================
    // MARKER VISIBILITY LOOP
    // ========================================================

    function updateMarkersLoop(): void {
      if (player) {
        if (
          (window as any).isMenuOpen ||
          (window as any)
            .isPresentationOpen
        ) {
          hideAllMarkers();
        } else {
          updateMarkerVisibility(
            player
          );
        }
      }

      requestAnimationFrame(
        updateMarkersLoop
      );
    }

    updateMarkersLoop();

   

// ========================================================
// STUDENT SEAT-SELECTION PANEL
// ========================================================
if (isStudent) {
    const existingSeat = localStorage.getItem('seat');
    
    // ✅ Debug logs
    console.log(`[Debug] autoSeat: ${autoSeat}`);
    console.log(`[Debug] existingSeat: ${existingSeat}`);
    
    // ✅ Show seat panel only if NOT auto-seating AND no seat exists
    if (!autoSeat && !existingSeat) {
        console.log("[Seat Panel] ✅ Creating panel");
        panelEntity = world
            .createTransformEntity()
            .addComponent(
                PanelUI,
                {
                    config: "./ui/seat-panel.json",
                    maxHeight: 0.8,
                    maxWidth: 1.6
                }
            )
            .addComponent(RayInteractable)
            .addComponent(PanelSystemComponent, {
                scene: envMesh
            });

        panelEntity.object3D?.position.set(0, 1.29, -1.9);
        console.log("[Seat Panel] Created for student.");
    } else {
        console.log(`[Seat Panel] ❌ Skipped - autoSeat=${autoSeat}, existingSeat=${existingSeat}`);
        panelEntity = { object3D: null };
    }
} else {
    console.log("[Seat Panel] Not created for instructor.");
}
    // ========================================================
    // STUDENT HINT PANEL
    // ========================================================

    if (isStudent) {
      hintEntity = world
        .createTransformEntity()
        .addComponent(
          PanelUI,
          {
            config:
              "./ui/hint-panel.json",
            maxHeight: 0.3,
            maxWidth: 1.6
          }
        )
        .addComponent(
          PanelSystemComponent,
          {
            scene: envMesh
          }
        );

      hintEntity.object3D?.position.set(
        0,
        1.85,
        -1.9
      );

      console.log(
        "[Hint Panel] Created for student."
      );
    }

    // ========================================================
    // STUDENT RAISE-HAND PANEL
    // ========================================================

    if (isStudent) {
      raiseHandEntity = world
        .createTransformEntity()
        .addComponent(
          PanelUI,
          {
            config:
              "./ui/raise-hand-button.json",
            maxHeight: 0.32,
            maxWidth: 0.32
          }
        )
        .addComponent(
          RayInteractable
        )
        .addComponent(
          PanelSystemComponent,
          {
            scene: envMesh
          }
        );

      const raiseHandObject =
        raiseHandEntity.object3D;

      if (raiseHandObject) {
        camera.add(
          raiseHandObject
        );

        raiseHandObject.position.set(
          0.35,
          -0.15,
          -0.7
        );

        raiseHandObject.rotation.set(
          0,
          0,
          0
        );

        raiseHandObject.visible =
          false;
      }

      console.log(
        "[Raise Hand] Created for student."
      );
    }

    // ========================================================
    // CLASSROOM MENU
    // ========================================================

    const menuEntity = world
      .createTransformEntity()
      .addComponent(
        PanelUI,
        {
          config:
            "./ui/classroom-menu-vr.json",
          maxHeight: 7.8,
          maxWidth: 7.2
        }
      )
      .addComponent(
        RayInteractable
      );

    if (menuEntity.object3D) {
      menuEntity.object3D.position.set(
        0,
        2.1,
        2.6
      );

      menuEntity.object3D.rotation.set(
        0,
        Math.PI,
        0
      );

      menuEntity.object3D.scale.set(
        2.25,
        2.25,
        2.25
      );
    //menuEntity.object3D.visible = false;
      console.log(
        "[Index] Menu created at:",
        menuEntity.object3D.position
      );
    }
// ========================================================
// INSTRUCTOR MENU ICON
// ========================================================

let instructorMenuButtonEntity: any = null;
let instructorMenuButtonObject: THREE.Object3D | null = null;

if (isInstructor) {
  console.log(
    "[Instructor Menu] Creating menu icon..."
  );

  instructorMenuButtonEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/instructor-menu-button.json",
      maxWidth: 0.2,
      maxHeight: 0.2
    })
    .addComponent(RayInteractable);

  instructorMenuButtonObject =
    instructorMenuButtonEntity.object3D ?? null;

  if (!instructorMenuButtonObject) {
    console.error(
      "[Instructor Menu] object3D was not created."
    );
  } else {
    instructorMenuButtonObject.name =
      "InstructorMenuButton";

    instructorMenuButtonObject.visible =
      true;

    /*
     * Prevent the icon from being removed because of
     * camera-frustum calculations.
     */
    instructorMenuButtonObject.frustumCulled =
      false;

    console.log(
      "[Instructor Menu] Menu entity created."
    );
  }
}

/*
 * Attach or reattach the icon to the current camera.
 * This function is called before and after XR starts.
 */
function attachInstructorMenuToCamera(): void {
  if (
    !isInstructor ||
    !instructorMenuButtonObject
  ) {
    return;
  }

  /*
   * Reparent safely while preserving control of the object.
   */
  if (
    instructorMenuButtonObject.parent !== camera
  ) {
    camera.add(
      instructorMenuButtonObject
    );
  }

  /*
   * Place directly in front first so we can confirm
   * that it renders.
   */
  instructorMenuButtonObject.position.set(
   0.42,
  -0.22,
  -0.85
  );

  instructorMenuButtonObject.rotation.set(
    0,
    0,
    0
  );

  /*
   * Large scale for the first visual test.
   */
  instructorMenuButtonObject.scale.set(
    1,
    1,
    1
  );

  instructorMenuButtonObject.visible =
    true;

  instructorMenuButtonObject.updateMatrix();
  instructorMenuButtonObject.updateMatrixWorld(
    true
  );

  console.log(
    "[Instructor Menu] Attached to camera.",
    {
      parent:
        instructorMenuButtonObject.parent?.name ||
        instructorMenuButtonObject.parent?.type,
      position:
        instructorMenuButtonObject.position,
      visible:
        instructorMenuButtonObject.visible
    }
  );
}

/*
 * Normal browser initialization.
 */
if (isInstructor) {
  requestAnimationFrame(() => {
    attachInstructorMenuToCamera();
  });

  window.setTimeout(() => {
    attachInstructorMenuToCamera();
  }, 500);
}

/*
 * Reattach after WebXR starts.
 */
renderer.xr.addEventListener(
  "sessionstart",
  () => {
    if (!isInstructor) {
      return;
    }

    console.log(
      "[Instructor Menu] XR session started."
    );

    const delays = [
      300,
      700,
      1200,
      2000
    ];

    delays.forEach((delay) => {
      window.setTimeout(() => {
        attachInstructorMenuToCamera();
      }, delay);
    });
  }
);
// ========================================================
// INSTRUCTOR DASHBOARD PANEL
// ========================================================

let instructorDashboardEntity: any = null;
let instructorDashboardObject: THREE.Object3D | null = null;

if (isInstructor) {
  instructorDashboardEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/instructor-menu.json",
      maxWidth: 2.4,
      maxHeight: 1.8
    })
    .addComponent(RayInteractable);

  instructorDashboardObject =
    instructorDashboardEntity.object3D ?? null;

  if (!instructorDashboardObject) {
    console.error(
      "[Instructor Dashboard] object3D was not created."
    );
  } else {
    camera.add(instructorDashboardObject);

    instructorDashboardObject.position.set(
      0,
      -0.1,
      -2.0
    );

    instructorDashboardObject.rotation.set(
      0,
      0,
      0
    );

    instructorDashboardObject.scale.set(
      1.2,
      1.2,
      1.2
    );

    // Dashboard starts closed.
    instructorDashboardObject.visible = false;

    instructorDashboardObject.frustumCulled = false;

    instructorDashboardObject
      .updateMatrixWorld(true);

    console.log(
      "[Instructor Dashboard] Created and hidden."
    );
  }
}
// ========================================================
// INSTRUCTOR DASHBOARD STATE
// ========================================================

let isInstructorDashboardOpen = false;

(window as any).isInstructorDashboardOpen =
  false;

function setInstructorDashboardOpen(
  open: boolean
): void {
  if (
    !isInstructor ||
    !instructorDashboardObject
  ) {
    return;
  }

  isInstructorDashboardOpen = open;

  (window as any).isInstructorDashboardOpen =
    open;

  /*
   * Keep the dashboard attached to the camera.
   */
  if (
    instructorDashboardObject.parent !==
    camera
  ) {
    camera.add(
      instructorDashboardObject
    );
  }

  /*
   * Restore its camera-relative position
   * every time it opens.
   */
  instructorDashboardObject.position.set(
    0,
    -0.1,
    -2.0
  );

  instructorDashboardObject.rotation.set(
    0,
    0,
    0
  );

  instructorDashboardObject.scale.set(
    1.2,
    1.2,
    1.2
  );

  instructorDashboardObject.visible =
    open;

  instructorDashboardObject.frustumCulled =
    false;

  /*
   * Hide the small menu icon while the
   * dashboard is open.
   */
  if (instructorMenuButtonObject) {
    instructorMenuButtonObject.visible =
      !open;

    instructorMenuButtonObject
      .updateMatrixWorld(true);
  }

  instructorDashboardObject
    .updateMatrixWorld(true);

  console.log(
    "[Instructor Dashboard]",
    open ? "Opened" : "Closed"
  );
}

function toggleInstructorDashboard(): void {
  setInstructorDashboardOpen(
    !isInstructorDashboardOpen
  );
}

/*
 * Expose these functions before controller
 * input begins.
 */
(window as any).setInstructorDashboardOpen =
  setInstructorDashboardOpen;
// ✅ Make socket globally accessible
(window as any).socket = socket;

(window as any).toggleInstructorDashboard =
  toggleInstructorDashboard;

// ========================================================
// RAISE HAND NOTIFICATION PANEL (Instructor Only)
// ========================================================

if (isInstructor) {
  notificationEntity = world
    .createTransformEntity()
    .addComponent(
      PanelUI,
      {
        config: "./ui/raise-hand-notification.json", 
        maxWidth: 1.4,
        maxHeight: 0.5
      }
    )
    .addComponent(RayInteractable)
    .addComponent(PanelSystemComponent, {
      scene: envMesh
    });

  const notificationObject =
    notificationEntity.object3D;

  if (notificationObject) {
    camera.add(notificationObject);

    // ✅ Adjust position to be visible
    notificationObject.position.set(
      0,
      0.2,    // Higher - was 0.08
      -1.5    // Closer - was -1.1
    );

    notificationObject.rotation.set(
      0,
      0,
      0
    );

     notificationObject.scale.set(
      1,
      1,
      1
    );
    // ✅ Start hidden - system will show it
    notificationObject.visible = false;
    notificationObject.frustumCulled = false;
    notificationObject.updateMatrixWorld(true);

       "[Notification] Panel created and hidden."
  }

  console.log(
    "[Notification] Panel created for instructor."
  );
}
// ========================================================
    // ✅ EXPOSE PRESENTATION SYSTEM FOR MODE CHANGES
    // ========================================================

    const presentationSystem = world.getSystem(PresentationSystem);
    if (presentationSystem) {
      (window as any).presentationSystem = presentationSystem;
      console.log("[Index] PresentationSystem exposed globally");
    }

    // ========================================================
// ✅ LISTEN FOR MODE CHANGES FROM INSTRUCTOR (Student only)
// ========================================================

if (isStudent) {
  socket.on("modeChanged", (data: { mode: string; destination: string }) => {
    console.log(`[Student] 📢 Mode changed to: ${data.mode} (${data.destination})`);
    
    // Update UI
    const modeIndicator = document.getElementById("mode-indicator");
    if (modeIndicator) {
      const modeIcons: { [key: string]: string } = {
        "Classroom Mode": "🏫",
        "Presentation Mode": "📽️",
        "Game Mode": "🎮"
      };
      const icon = modeIcons[data.mode] || "📱";
      modeIndicator.textContent = `${icon} ${data.mode}`;
    }
    
    // Update raise-hand system mode
    if ((window as any).RaiseHandSystem) {
      (window as any).currentMode = data.mode;
    }
    
    // Trigger presentation mode change
    if ((window as any).presentationSystem) {
      console.log(`[Student] 🎬 Calling presentation system for mode: ${data.mode}`);
      if (data.mode === "Presentation Mode") {
        (window as any).presentationSystem.enterPresentationMode();
      } else if (data.mode === "Classroom Mode") {
        (window as any).presentationSystem.exitPresentationMode();
      }
    }
  });

  // Listen for studentModeChanged (broadcast to everyone)
  socket.on("studentModeChanged", (data: { 
    studentId: string; 
    mode: string; 
    destination: string; 
    name: string; 
    seat: string 
  }) => {
    console.log(`[Student] 📢 ${data.name} mode changed to: ${data.mode}`);
  });

  // ✅ LISTEN FOR GAME CHANGED (Go to Lab)
  socket.on("gameChanged", (data: { 
    gameId: string; 
    mode: string; 
    destination: string; 
    message: string 
  }) => {
    console.log(`[Student] 🎮 gameChanged received:`, data);
    
    if (data.gameId === "game1" || data.destination === "Game 1") {
      console.log(`[Student] 🎮 ${currentUser.username} being sent to Lab`);
      
      // Get student info
      const urlParams = new URLSearchParams(window.location.search);
      const studentId = urlParams.get('studentId') || socket.id || 'unknown';
      const studentName = urlParams.get('studentName') || currentUser.username || 'Student';
      const studentSeat = urlParams.get('seat') || localStorage.getItem('seat') || 'Unknown seat';
      
      // Build lab URL
     const labUrl = `${import.meta.env.VITE_LAB_URL}/?studentId=${studentId}&studentName=${encodeURIComponent(studentName)}&seat=${encodeURIComponent(studentSeat)}`;
      
      console.log(`[Student] 🔗 Redirecting to: ${labUrl}`);
      
      // Show loading overlay
      showLabLoadingOverlay();
      
      // Navigate to lab
      setTimeout(() => {
        window.location.href = labUrl;
      }, 1500);
    }
  });
}

// Helper function for loading overlay
function showLabLoadingOverlay(): void {
  const existing = document.getElementById('lab-loading-overlay');
  if (existing) existing.remove();
  
  const overlay = document.createElement('div');
  overlay.id = 'lab-loading-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    color: white;
    font-family: 'Segoe UI', Arial, sans-serif;
    backdrop-filter: blur(10px);
  `;
  
  overlay.innerHTML = `
    <div style="text-align: center; animation: pulse 1.5s ease-in-out infinite;">
      <div style="font-size: 72px; margin-bottom: 20px;">🧪</div>
      <div style="font-size: 28px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1px;">Entering Python Type Lab</div>
      <div style="font-size: 16px; opacity: 0.7;">Loading your personal lab environment...</div>
      <div style="margin-top: 30px; width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; margin-left: auto; margin-right: auto;">
        <div style="width: 100%; height: 100%; background: linear-gradient(90deg, #60a5fa, #3b82f6, #60a5fa); animation: loading-bar 1.5s ease-in-out infinite;"></div>
      </div>
    </div>
    <style>
      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
      @keyframes loading-bar {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
      }
    </style>
  `;
  
  document.body.appendChild(overlay);
}
    // ========================================================
    // DEBUGGING REFERENCES
    // ========================================================

    (window as any).menuEntity =
      menuEntity;
    
    (window as any).instructorMenuButtonEntity =
      instructorMenuButtonEntity;

    (window as any).panelEntity =
      panelEntity;

    (window as any).hintEntity =
      hintEntity;

    (window as any).raiseHandEntity =
      raiseHandEntity;

    (window as any).notificationEntity =
      notificationEntity;

    (window as any).world =
      world;

    (window as any).player =
      player;

    (window as any).instructorMesh =
      instructorMesh;

    (window as any).classroomMesh =
      envMesh;

    (window as any)
      .positionInstructorOnStage =
      positionInstructorOnStage;

    (window as any)
      .prepareInstructorView =
      prepareInstructorView;

    (window as any).instructorDashboardEntity =
      instructorDashboardEntity;

    (window as any).instructorDashboardObject =
      instructorDashboardObject;

    (window as any).toggleInstructorDashboard =
      toggleInstructorDashboard;

    (window as any).setInstructorDashboardOpen =
      setInstructorDashboardOpen;
    
    // ========================================================
    // REMOVE STARTUP SCREEN
    // ========================================================

    if (startupMessage) {
      startupMessage.style.display =
        "none";
    }

    console.log(
      `[Index] ✅ Application initialized for ${currentUser.role}: ${currentUser.username}`
    );
  })
  .catch((error) => {
    console.error(
      "Failed to create world:",
      error
    );

    const startupMessage =
      document.getElementById(
        "startup-message"
      );

    if (startupMessage) {
      startupMessage.textContent =
        "Failed to start the VR classroom. Check the browser console.";
    }
  });
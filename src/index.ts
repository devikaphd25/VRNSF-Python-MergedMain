/// <reference types="vite/client" />
// src/index.ts

import {
  ACESFilmicToneMapping,
  AssetManager,
  AssetManifest,
  AssetType,
  DomeGradient,
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

import { connectSocketForUser, socket } from "./network/socket";
import { showVRLoginPanel } from "./systems/vr-login.system";
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
import { StudentResultSystem }
from "./systems/student-result.system";
import { LabEnvironmentManager } from "./lab/LabEnvironmentManager";

// ============================================================
// USER ROLE TYPES
// ============================================================

type VRUserRole = "student" | "instructor";

interface VRUser {
  id: number;
  username: string;
  fullName?: string;
  role: VRUserRole;
  seat?: string | null;
  loginTime?: string;
}

// ============================================================
// ASSETS
// ============================================================

const assets: AssetManifest = {
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
  },

  labEnvironmentModel: {
    url: "./python-type-lab-models/lab-environment.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  tableModel: {
    url: "./python-type-lab-models/table.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  cardModel: {
    url: "./python-type-lab-models/card.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  intBinModel: {
    url: "./python-type-lab-models/bin-int.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  floatBinModel: {
    url: "./python-type-lab-models/bin-float.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  boolBinModel: {
    url: "./python-type-lab-models/bin-bool.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  strBinModel: {
    url: "./python-type-lab-models/bin-str.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  newCardButtonModel: {
    url: "./python-type-lab-models/new-card-button.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  resetButtonModel: {
    url: "./python-type-lab-models/reset-button.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  dispenserModel: {
    url: "./python-type-lab-models/card-dispenser-animation.glb",
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
    const parsedUser = JSON.parse(
      savedUser
    ) as Partial<VRUser>;

    const userId = Number(parsedUser.id);

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      console.error(
        "[Login] The saved user has no valid database ID."
      );

      return null;
    }

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
      id: userId,
      username: parsedUser.username.trim(),
      fullName: parsedUser.fullName,
      role: parsedUser.role,
      seat: parsedUser.seat ?? null,
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
  window.location.replace("./");
}

function logout(): void {
  localStorage.removeItem("vrUser");
  localStorage.removeItem("vrClassroomSession");
  window.location.replace("./");
}

(window as any).logout = logout;

// ============================================================
// CHECK LOGIN BEFORE CREATING THE VR WORLD
// ============================================================

let currentUser: VRUser | null = null;
let isInstructor = currentUser?.role === "instructor";
let isStudent = currentUser?.role === "student";
function registerCurrentClassroomUser(): void {
  if (!socket.connected) {
    return;
  }

  if (!currentUser) {
    console.warn(
      "[Classroom] Cannot register because currentUser is null."
    );

    return;
  }

  console.log(
    "[Classroom] Registering user:",
    {
      userId: currentUser.id,
      username: currentUser.username,
      role: currentUser.role
    }
  );

  let classroomSession: { roomId?: string; participantId?: string | null } = {};
  try {
    classroomSession = JSON.parse(
      localStorage.getItem("vrClassroomSession") ?? "{}"
    );
  } catch (error) {
    console.error("[Classroom] Invalid saved classroom session:", error);
  }

  socket.emit(
    "registerClassroomClient",
    {
      userId: currentUser.id,
      username: currentUser.username,
      roomId: classroomSession.roomId ?? null,
      participantId: classroomSession.participantId ?? null
    }
  );
}

socket.on("connect", () => {
  console.log(
    "[Classroom] Socket connected:",
    socket.id
  );

  registerCurrentClassroomUser();
});

if (socket.connected) {
  registerCurrentClassroomUser();
}
console.log("[Login] Saved user:", currentUser?.username ?? "none");


// ============================================================
// CREATE WORLD
// ============================================================

World.create(
  document.getElementById("scene-container") as HTMLDivElement,
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
    input: {
      canvasPointerEvents: {
        enabled: true,
        activeDuringXR: true
      }
    },
    features: {
      locomotion: false,
      grabbing: true,
      physics: true,
      sceneUnderstanding: false,
      environmentRaycast: false
    },
    render: {
      defaultLighting: true,
      camera: {
        position: [0, 1.0, 0]
      }
    }
  }
)
  .then(async (world) => {
    const { renderer, scene, camera, player } = world;
    (window as any).renderer =
  renderer;

  (window as any).scene =
    scene;

  (window as any).camera =
    camera;

    (window as any).player =
    player;

    const skyLevel = world.activeLevel.value;
    skyLevel.addComponent(DomeGradient, {
      sky: [0.04, 0.18, 0.38, 1],
      equator: [0.18, 0.52, 0.78, 1],
      ground: [0.015, 0.025, 0.06, 1],
      intensity: 1.15,
    });

    // Configure the renderer and HDR environment before waiting for the VR
    // login. On physical Quest hardware the XR session may already be
    // presenting by the time the user submits the panel.
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.xr.enabled = true;

    skyLevel.addComponent(IBLTexture, {
      src: "sunsetHDR",
      intensity: 0.9,
      rotation: [0, Math.PI / 4, 0]
    });

    const startupMessage = document.getElementById("startup-message");

    if (!currentUser) {
      if (startupMessage) startupMessage.style.display = "none";
      const login = await showVRLoginPanel(world, camera);
      currentUser = login.user;
    }

    const activeUser = currentUser;
    isInstructor = activeUser.role === "instructor";
    isStudent = activeUser.role === "student";

    (window as any).vrUser = activeUser;
    (window as any).isInstructor = isInstructor;
    (window as any).isStudent = isStudent;
    connectSocketForUser(activeUser);

    if (startupMessage) {
      startupMessage.textContent = isInstructor
        ? `Welcome Instructor ${activeUser.username}`
        : `Welcome Student ${activeUser.username}`;
    }

    document.title = isInstructor ? "UMES VR – Instructor" : "UMES VR – Student";

    // ========================================================
    // LOAD CLASSROOM AND INSTRUCTOR AVATAR
    // ========================================================

    const classroomAsset = AssetManager.getGLTF("classroom2");
    const instructorAsset = AssetManager.getGLTF("instructorAvatar");

    if (!classroomAsset) {
      throw new Error("The classroom2 asset could not be loaded.");
    }

    if (!instructorAsset) {
      throw new Error("The instructorAvatar asset could not be loaded.");
    }

    const envMesh = classroomAsset.scene;

    console.log("===== CLASSROOM OBJECTS START =====");
    envMesh.traverse((object) => {
      console.log("[Classroom Object]", object.name || "(no name)", object.type);
    });
    console.log("===== CLASSROOM OBJECTS END =====");

    const instructorMesh = instructorAsset.scene;

    // Hide the large box beside the instructor
    const podium = envMesh.getObjectByName("Podium");
    if (podium) {
      podium.visible = false;
      podium.traverse((child) => {
        child.visible = false;
      });
      console.log("[Classroom] Podium hidden.");
    } else {
      console.warn("[Classroom] Podium object was not found.");
    }

    envMesh.position.set(0, 0, 0);
    envMesh.updateWorldMatrix(true, true);
    envMesh.name = "theater_classroom2";

    // ========================================================
    // FIND INSTRUCTOR STAGE POSITION
    // ========================================================

    const instructorAnchor = envMesh.getObjectByName("InstructorAvatar_Anchor");
    const instructorStagePosition = new THREE.Vector3(0, 0, -3);
    const instructorStageQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.PI, 0)
    );

    if (instructorAnchor) {
      instructorAnchor.getWorldPosition(instructorStagePosition);
      instructorAnchor.getWorldQuaternion(instructorStageQuaternion);
      console.log("[Instructor] Anchor found:", instructorStagePosition);
    } else {
      console.warn("[Instructor] InstructorAvatar_Anchor was not found. Using fallback position.");
    }

    // ========================================================
    // POSITION STATIC INSTRUCTOR AVATAR
    // ========================================================

    instructorMesh.position.copy(instructorStagePosition);
    instructorMesh.position.y += 1.3;
    instructorMesh.quaternion.copy(instructorStageQuaternion);
    instructorMesh.scale.set(2.5, 2.5, 2.5);
    instructorMesh.visible = isStudent;
    world.createTransformEntity(instructorMesh);
    console.log("[Instructor] Static avatar visible:", instructorMesh.visible);

    // ========================================================
    // REGISTER COMPONENTS
    // ========================================================

    world
      .registerComponent(SeatComponent)
      .registerComponent(ProjectorScreenComponent);

    // ========================================================
    // REGISTER SYSTEMS
    // ========================================================

    world
      .registerSystem(PanelSystem, { priority: 1 })
      .registerSystem(ProjectorScreenSystem, { priority: 3 })
      .registerSystem(PresentationSystem, { priority: 4 })
      .registerSystem(MenuSystem, { priority: 6 });

    if (isStudent) {
      world
        .registerSystem(SeatSystem, { priority: 2 })
        .registerSystem(HintSystem, { priority: 5 })
        .registerSystem(RaiseHandSystem, { priority: 7 })
        .registerSystem(StudentResultSystem, { priority: 10 });

      const raiseHandSystemInstance = world.getSystem(RaiseHandSystem);
      (window as any).RaiseHandSystem = raiseHandSystemInstance;
      console.log("[Systems] Student systems registered.");
    } else {
      world
        .registerSystem(InstructorDashboardSystem, { priority: 8 })
        .registerSystem(RaiseHandNotificationSystem, { priority: 9 });
      console.log("[Systems] Instructor mode active.");
    }

    // ========================================================
    // CREATE CLASSROOM ENVIRONMENT
    // ========================================================

    world
      .createTransformEntity(envMesh)
      .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC })
      .addComponent(ProjectorScreenComponent, { scene: envMesh });

    // ========================================================
    // POSITION INSTRUCTOR PLAYER
    // ========================================================

    function positionInstructorOnStage(): void {
      if (!isInstructor) return;

      const playerObject = (player as any)?.object3D ?? (player as any);
      if (!playerObject) {
        console.error("[Instructor] Could not access the player transform.");
        return;
      }

      const isXR = renderer.xr.enabled && renderer.xr.isPresenting;
      playerObject.position.copy(instructorStagePosition);
      playerObject.position.x = 0;
      playerObject.position.z += isXR ? 0.1 : 2.0;
      playerObject.rotation.y = 0;
      playerObject.updateMatrixWorld(true);

      console.log("[Instructor] Position:", playerObject.position.x.toFixed(2), playerObject.position.y.toFixed(2), playerObject.position.z.toFixed(2));
    }

    function faceInstructorTowardStudents(): void {
      if (!isInstructor) return;

      const playerObject = (player as any)?.object3D ?? (player as any);
      if (!playerObject) {
        console.error("[Instructor] Player transform unavailable.");
        return;
      }

      playerObject.rotation.y = 0;
      playerObject.updateMatrixWorld(true);
      console.log("[Instructor] Facing toward students (positive Z)");
    }

    function prepareInstructorView(): void {
      if (!isInstructor) return;
      positionInstructorOnStage();
      requestAnimationFrame(() => {
        camera.updateMatrixWorld(true);
        faceInstructorTowardStudents();
      });
    }

    requestAnimationFrame(() => prepareInstructorView());
    setTimeout(() => prepareInstructorView(), 500);

    renderer.xr.addEventListener("sessionstart", () => {
      console.log("[Instructor] XR session started.");
      [300, 600, 1000, 1500, 2000].forEach((delay) => {
        setTimeout(() => {
          console.log(`[Instructor] Re-applying position (${delay}ms)`);
          prepareInstructorView();
        }, delay);
      });
    });

    // ========================================================
    // PANEL ENTITIES
    // ========================================================

    let panelEntity: any = null;
    let hintEntity: any = null;
    let raiseHandEntity: any = null;
    let notificationEntity: any = null;
    let transitionEntity: any = null;
    let studentResultEntity: any = null;

    // ========================================================
    // STUDENT LIST AND SEAT MARKERS
    // ========================================================

    socket.on("studentList", (students) => {
      console.log("[Index] Received student list:", students.length);
      updateSeatMarkers(students, scene, envMesh);
    });
    socket.emit("requestStudentList");

    // ========================================================
    // GLOBAL UI FLAGS
    // ========================================================

    (window as any).isMenuOpen = false;
    (window as any).isPresentationOpen = false;
    (window as any).isHintVisible = isStudent;
    (window as any).isRaiseHandReady = false;

    // ========================================================
    // MARKER VISIBILITY LOOP
    // ========================================================

    function updateMarkersLoop(): void {
      if (player) {
        if ((window as any).isMenuOpen || (window as any).isPresentationOpen) {
          hideAllMarkers();
        } else {
          updateMarkerVisibility(player);
        }
      }
      requestAnimationFrame(updateMarkersLoop);
    }
    updateMarkersLoop();

    // ========================================================
    // STUDENT SEAT-SELECTION PANEL (DISABLED)
    // ========================================================
    panelEntity = { object3D: null };
    console.log("[Seat Panel] Disabled - using SeatAssignmentSystem");

    // ========================================================
    // STUDENT HINT PANEL
    // ========================================================

    if (isStudent) {
      hintEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/hint-panel.json", maxHeight: 0.3, maxWidth: 1.6 })
        .addComponent(PanelSystemComponent, { scene: envMesh });
      hintEntity.object3D?.position.set(0, 1.85, -1.9);
      console.log("[Hint Panel] Created for student.");
    }

    if (isStudent) {
      transitionEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/transition-panel.json",
          maxWidth: 1.25,
          maxHeight: 0.55
        });

      if (transitionEntity.object3D) {
        camera.add(transitionEntity.object3D);
        transitionEntity.object3D.position.set(0, 0, -1.25);
        transitionEntity.object3D.visible = false;
        transitionEntity.object3D.frustumCulled = false;
      }

      let transitionRunning = false;
      (window as any).performEnvironmentTransition =
        async (action: () => void): Promise<void> => {
          if (transitionRunning) {
            action();
            return;
          }

          transitionRunning = true;
          transitionEntity.object3D.visible = true;
          await new Promise(resolve => window.setTimeout(resolve, 1200));
          action();
          await new Promise(resolve => window.setTimeout(resolve, 1600));
          transitionEntity.object3D.visible = false;
          transitionRunning = false;
        };
    }

    if (isStudent) {
      studentResultEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/student-result-panel.json",
          maxWidth: 1.3,
          maxHeight: 1.15
        })
        .addComponent(RayInteractable);

      if (studentResultEntity.object3D) {
        camera.add(studentResultEntity.object3D);
        studentResultEntity.object3D.position.set(0, -0.03, -1.45);
        studentResultEntity.object3D.visible = false;
        studentResultEntity.object3D.frustumCulled = false;
      }

      (window as any).studentResultEntity =
        studentResultEntity;
    }

    // ========================================================
    // STUDENT RAISE-HAND PANEL
    // ========================================================

    if (isStudent) {
      raiseHandEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/raise-hand-button.json", maxHeight: 0.32, maxWidth: 0.32 })
        .addComponent(RayInteractable)
        .addComponent(PanelSystemComponent, { scene: envMesh });

      const raiseHandObject = raiseHandEntity.object3D;
      if (raiseHandObject) {
        camera.add(raiseHandObject);
        raiseHandObject.position.set(0.35, -0.15, -0.7);
        raiseHandObject.rotation.set(0, 0, 0);
        raiseHandObject.visible = false;
      }
      console.log("[Raise Hand] Created for student.");
    }

    // ========================================================
    // CLASSROOM MENU
    // ========================================================

    const menuEntity = world
      .createTransformEntity()
      .addComponent(PanelUI, { config: "./ui/classroom-menu-vr.json", maxHeight: 7.8, maxWidth: 7.2 })
      .addComponent(RayInteractable);

    if (menuEntity.object3D) {
      menuEntity.object3D.position.set(0, 2.1, 2.6);
      menuEntity.object3D.rotation.set(0, Math.PI, 0);
      menuEntity.object3D.scale.set(2.25, 2.25, 2.25);
      console.log("[Index] Menu created at:", menuEntity.object3D.position);
    }

    // ========================================================
    // INSTRUCTOR MENU ICON
    // ========================================================

    let instructorMenuButtonEntity: any = null;
    let instructorMenuButtonObject: THREE.Object3D | null = null;

    if (isInstructor) {
      console.log("[Instructor Menu] Creating menu icon...");
      instructorMenuButtonEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/instructor-menu-button.json", maxWidth: 0.2, maxHeight: 0.2 })
        .addComponent(RayInteractable);

      instructorMenuButtonObject = instructorMenuButtonEntity.object3D ?? null;
      if (instructorMenuButtonObject) {
        instructorMenuButtonObject.name = "InstructorMenuButton";
        instructorMenuButtonObject.visible = true;
        instructorMenuButtonObject.frustumCulled = false;
        console.log("[Instructor Menu] Menu entity created.");
      }
    }

    function attachInstructorMenuToCamera(): void {
      if (!isInstructor || !instructorMenuButtonObject) return;

      const dashboardOpen =
        Boolean(
          (window as any)
            .isInstructorDashboardOpen
        );
      const anotherInstructorPanelOpen =
        Boolean(
          (window as any)
            .isInstructorLabMonitorOpen
        ) ||
        Boolean(
          (window as any)
            .isInstructorMistakesOpen
        );
      const targetParent =
        renderer.xr.isPresenting &&
        !dashboardOpen &&
        !anotherInstructorPanelOpen
          ? world.player.raySpaces.right
          : camera;

      if (instructorMenuButtonObject.parent !== targetParent) {
        targetParent.add(instructorMenuButtonObject);
      }

      if (targetParent === camera) {
        instructorMenuButtonObject.position.set(
          0.42,
          dashboardOpen ||
          anotherInstructorPanelOpen
            ? -100
            : -0.22,
          -0.85
        );
        instructorMenuButtonObject.rotation.set(0, 0, 0);
        instructorMenuButtonObject.scale.set(1, 1, 1);
      } else {
        // Keep the button just above and slightly in front of the
        // physical right controller so it does not overlap the model.
        instructorMenuButtonObject.position.set(0, 0.08, -0.22);
        // The IWSDK target-ray space keeps the panel aligned with
        // the controller's pointing direction on physical hardware.
        instructorMenuButtonObject.rotation.set(0, 0, 0);
        instructorMenuButtonObject.scale.set(0.8, 0.8, 0.8);
      }

      instructorMenuButtonObject.visible =
        !dashboardOpen &&
        !anotherInstructorPanelOpen;
      instructorMenuButtonObject.updateMatrix();
      instructorMenuButtonObject.updateMatrixWorld(true);
      console.log(
        "[Instructor Menu] Attached to",
        targetParent === camera
          ? "camera"
          : "IWSDK right controller ray"
      );
    }

    if (isInstructor) {
      requestAnimationFrame(() => attachInstructorMenuToCamera());
      setTimeout(() => attachInstructorMenuToCamera(), 500);
    }

    renderer.xr.addEventListener("sessionstart", () => {
      if (!isInstructor) return;
      console.log("[Instructor Menu] XR session started.");

      const session =
        renderer.xr.getSession();

      session?.addEventListener(
        "selectstart",
        (event: XRInputSourceEvent) => {
          if (
            event.inputSource
              .handedness !== "right" ||
            !instructorMenuButtonObject
              ?.visible ||
            Boolean(
              (window as any)
                .isInstructorDashboardOpen
            )
          ) {
            return;
          }

          // RT opens the menu just like selecting the
          // floating Dashboard button. While the menu is
          // open, RT remains available for normal ray input.
          (
            window as any
          ).setInstructorDashboardOpen?.(
            true
          );
        }
      );

      session?.addEventListener(
        "selectstart",
        (event: XRInputSourceEvent) => {
          if (
            event.inputSource
              .handedness !== "left" ||
            !Boolean(
              (window as any)
                .isInstructorLabMonitorAvailable
            ) ||
            Boolean(
              (window as any)
                .isInstructorLabMonitorOpen
            ) ||
            Boolean(
              (window as any)
                .isInstructorDashboardOpen
            )
          ) {
            return;
          }

          (
            window as any
          ).setInstructorLabMonitorOpen?.(
            true
          );
        }
      );

      [300, 700, 1200, 2000].forEach((delay) => {
        setTimeout(() => attachInstructorMenuToCamera(), delay);
      });
    });

    renderer.xr.addEventListener("sessionend", () => {
      if (!isInstructor) return;
      requestAnimationFrame(
        () => attachInstructorMenuToCamera()
      );
    });

    // ========================================================
    // INSTRUCTOR DASHBOARD
    // ========================================================

    let instructorDashboardEntity: any = null;
    let instructorDashboardObject: THREE.Object3D | null = null;
    let instructorLabMonitorEntity: any = null;
    let instructorLabMonitorObject: THREE.Object3D | null = null;
    let instructorLabMonitorButtonEntity: any = null;
    let instructorLabMonitorButtonObject: THREE.Object3D | null = null;
    let instructorMistakesEntity: any = null;
    let instructorMistakesObject: THREE.Object3D | null = null;
    let instructorSaveReportEntity: any = null;

    if (isInstructor) {
      instructorSaveReportEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-save-report.json",
          maxWidth: 1.4,
          maxHeight: 0.65
        });

      if (instructorSaveReportEntity.object3D) {
        camera.add(instructorSaveReportEntity.object3D);
        instructorSaveReportEntity.object3D.position.set(0, 0, -1.3);
        instructorSaveReportEntity.object3D.visible = false;
        instructorSaveReportEntity.object3D.frustumCulled = false;
      }

      instructorDashboardEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/instructor-menu.json", maxWidth: 2.7, maxHeight: 2.4 })
        .addComponent(RayInteractable);

      instructorDashboardObject = instructorDashboardEntity.object3D ?? null;
      if (instructorDashboardObject) {
        camera.add(instructorDashboardObject);
        instructorDashboardObject.pointerEventsOrder = 1000;
        instructorDashboardObject.position.set(0, -100, -2.85);
        instructorDashboardObject.rotation.set(0, 0, 0);
        instructorDashboardObject.scale.set(1.15, 1.15, 1.15);
        instructorDashboardObject.visible = false;
        instructorDashboardObject.frustumCulled = false;
        instructorDashboardObject.updateMatrixWorld(true);
        console.log("[Instructor Dashboard] Created and hidden.");
      }
    }

    if (isInstructor) {
      instructorLabMonitorEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-lab-monitor.json",
          maxWidth: 2.8,
          maxHeight: 2.45
        })
        .addComponent(RayInteractable);

      instructorLabMonitorObject =
        instructorLabMonitorEntity.object3D ?? null;

      if (instructorLabMonitorObject) {
        camera.add(instructorLabMonitorObject);
        instructorLabMonitorObject.pointerEventsOrder = 11000;
        instructorLabMonitorObject.position.set(0, -100, -2.85);
        instructorLabMonitorObject.rotation.set(0, 0, 0);
        instructorLabMonitorObject.scale.set(1, 1, 1);
        instructorLabMonitorObject.visible = false;
        instructorLabMonitorObject.frustumCulled = false;
      }

      instructorLabMonitorButtonEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-lab-monitor-button.json",
          maxWidth: 0.2,
          maxHeight: 0.2
        })
        .addComponent(RayInteractable);

      instructorLabMonitorButtonObject =
        instructorLabMonitorButtonEntity.object3D ?? null;

      if (instructorLabMonitorButtonObject) {
        camera.add(instructorLabMonitorButtonObject);
        instructorLabMonitorButtonObject.position.set(-0.38, -100, -0.9);
        instructorLabMonitorButtonObject.scale.set(0.8, 0.8, 0.8);
        instructorLabMonitorButtonObject.visible = false;
        instructorLabMonitorButtonObject.frustumCulled = false;
      }

      instructorMistakesEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-mistakes.json",
          maxWidth: 2.8,
          maxHeight: 2.55
        })
        .addComponent(RayInteractable);

      instructorMistakesObject =
        instructorMistakesEntity.object3D ?? null;

      if (instructorMistakesObject) {
        camera.add(instructorMistakesObject);
        instructorMistakesObject.pointerEventsOrder = 12000;
        instructorMistakesObject.position.set(0, -100, -2.85);
        instructorMistakesObject.rotation.set(0, 0, 0);
        instructorMistakesObject.scale.set(1, 1, 1);
        instructorMistakesObject.visible = false;
        instructorMistakesObject.frustumCulled = false;
      }

      (window as any).setInstructorMistakesOpen =
        (open: boolean): void => {
          if (!instructorMistakesObject) return;
          (window as any).isInstructorMistakesOpen = open;
          instructorMistakesObject.pointerEventsOrder = 12000;
          instructorMistakesObject.position.set(
            0,
            open ? -0.32 : -100,
            -2.85
          );
          instructorMistakesObject.rotation.set(0, 0, 0);
          instructorMistakesObject.scale.set(1, 1, 1);
          instructorMistakesObject.visible = open;
          instructorMistakesObject.updateMatrixWorld(true);

          if (instructorLabMonitorObject) {
            instructorLabMonitorObject.visible =
              !open &&
              Boolean(
                (window as any).isInstructorLabMonitorOpen
              );
            instructorLabMonitorObject.position.set(
              0,
              instructorLabMonitorObject.visible
                ? -0.32
                : -100,
              -2.85
            );
            instructorLabMonitorObject.updateMatrixWorld(true);
          }

          if (open && instructorDashboardObject) {
            isInstructorDashboardOpen = false;
            (window as any).isInstructorDashboardOpen = false;
            instructorDashboardObject.visible = false;
            instructorDashboardObject.position.set(
              0,
              -100,
              -2.85
            );
            instructorDashboardObject.updateMatrixWorld(true);
          }

          attachInstructorMenuToCamera();
          (window as any).refreshInstructorHandNotification?.();
        };

      (window as any).isInstructorLabMonitorOpen = false;
      (window as any).isInstructorLabMonitorAvailable = false;

      (window as any).setInstructorLabMonitorAvailable =
        (available: boolean): void => {
          (window as any).isInstructorLabMonitorAvailable = available;
          if (!instructorLabMonitorButtonObject) return;

          const targetParent =
            renderer.xr.isPresenting
              ? world.player.raySpaces.left
              : camera;

          if (
            instructorLabMonitorButtonObject.parent !==
            targetParent
          ) {
            targetParent.add(
              instructorLabMonitorButtonObject
            );
          }

          if (targetParent === camera) {
            instructorLabMonitorButtonObject.position.set(
              -0.38,
              available &&
              !(window as any).isInstructorLabMonitorOpen
                ? -0.2
                : -100,
              -0.9
            );
          } else {
            instructorLabMonitorButtonObject.position.set(
              0,
              available &&
              !(window as any).isInstructorLabMonitorOpen
                ? 0.08
                : -100,
              -0.22
            );
          }

          instructorLabMonitorButtonObject.rotation.set(
            0,
            0,
            0
          );
          instructorLabMonitorButtonObject.scale.set(
            0.8,
            0.8,
            0.8
          );
          instructorLabMonitorButtonObject.visible =
            available &&
            !(window as any).isInstructorLabMonitorOpen;
          instructorLabMonitorButtonObject.updateMatrixWorld(
            true
          );
        };

      (window as any).setInstructorLabMonitorOpen =
        (open: boolean): void => {
          if (!instructorLabMonitorObject) return;

          (window as any).isInstructorLabMonitorOpen = open;
          instructorLabMonitorObject.pointerEventsOrder = 11000;
          instructorLabMonitorObject.visible = open;
          instructorLabMonitorObject.position.set(
            0,
            open ? -0.32 : -100,
            -2.85
          );
          instructorLabMonitorObject.rotation.set(0, 0, 0);
          instructorLabMonitorObject.scale.set(1, 1, 1);
          instructorLabMonitorObject.updateMatrixWorld(true);

          if (open && instructorDashboardObject) {
            isInstructorDashboardOpen = false;
            (window as any).isInstructorDashboardOpen = false;
            instructorDashboardObject.visible = false;
            instructorDashboardObject.position.set(
              0,
              -100,
              -2.85
            );
            instructorDashboardObject.updateMatrixWorld(true);
          }

          if (open && instructorMistakesObject) {
            (window as any).isInstructorMistakesOpen = false;
            instructorMistakesObject.visible = false;
            instructorMistakesObject.position.set(
              0,
              -100,
              -2.85
            );
            instructorMistakesObject.updateMatrixWorld(true);
          }

          if (instructorMenuButtonObject) {
            attachInstructorMenuToCamera();
          }

          if (instructorLabMonitorButtonObject) {
            const targetParent =
              open
                ? camera
                : renderer.xr.isPresenting
                  ? world.player.raySpaces.left
                  : camera;

            if (
              instructorLabMonitorButtonObject.parent !==
              targetParent
            ) {
              targetParent.add(
                instructorLabMonitorButtonObject
              );
            }

            if (
              targetParent === camera
            ) {
              instructorLabMonitorButtonObject.position.set(
                -0.38,
                open ? -100 : -0.2,
                -0.9
              );
            } else {
              instructorLabMonitorButtonObject.position.set(
                0,
                0.08,
                -0.22
              );
            }

            instructorLabMonitorButtonObject.rotation.set(
              0,
              0,
              0
            );
            instructorLabMonitorButtonObject.visible =
              !open &&
              Boolean(
                (window as any).isInstructorLabMonitorAvailable
              );
            instructorLabMonitorButtonObject.updateMatrixWorld(true);
          }

          (window as any).refreshInstructorHandNotification?.();
        };
    }

    // ========================================================
    // INSTRUCTOR DASHBOARD STATE
    // ========================================================

    let isInstructorDashboardOpen = false;
    (window as any).isInstructorDashboardOpen = false;

    function setInstructorDashboardOpen(open: boolean): void {
      if (!isInstructor || !instructorDashboardObject) return;

      isInstructorDashboardOpen = open;
      (window as any).isInstructorDashboardOpen = open;

      if (open && instructorLabMonitorObject) {
        (window as any).isInstructorLabMonitorOpen = false;
        instructorLabMonitorObject.visible = false;
        instructorLabMonitorObject.position.set(
          0,
          -100,
          -2.85
        );
        instructorLabMonitorObject.updateMatrixWorld(true);
      }

      if (open && instructorMistakesObject) {
        (window as any).isInstructorMistakesOpen = false;
        instructorMistakesObject.visible = false;
        instructorMistakesObject.position.set(
          0,
          -100,
          -2.85
        );
        instructorMistakesObject.updateMatrixWorld(true);
      }

      if (instructorDashboardObject.parent !== camera) {
        camera.add(instructorDashboardObject);
      }
      instructorDashboardObject.pointerEventsOrder = 10000;
      // Lower and farther from the headset so the complete menu fits
      // naturally in view and its large cards are easy ray targets.
      instructorDashboardObject.position.set(
        0,
        open ? -0.32 : -100,
        -2.85
      );
      instructorDashboardObject.rotation.set(0, 0, 0);
      instructorDashboardObject.scale.set(1, 1, 1);
      instructorDashboardObject.visible = open;
      instructorDashboardObject.frustumCulled = false;

      if (instructorMenuButtonObject) {
        // When open, move the hidden launcher away from the right
        // controller ray so it cannot intercept menu selections.
        // When closed, attach it back to the right controller.
        attachInstructorMenuToCamera();
      }

      if (instructorLabMonitorButtonObject) {
        instructorLabMonitorButtonObject.visible =
          !open &&
          Boolean(
            (window as any).isInstructorLabMonitorAvailable
          );
        instructorLabMonitorButtonObject.updateMatrixWorld(true);
      }
      instructorDashboardObject.updateMatrixWorld(true);
      (window as any).refreshInstructorHandNotification?.();
      console.log("[Instructor Dashboard]", open ? "Opened" : "Closed");
    }

    function toggleInstructorDashboard(): void {
      setInstructorDashboardOpen(!isInstructorDashboardOpen);
    }

    (window as any).setInstructorDashboardOpen = setInstructorDashboardOpen;
    (window as any).socket = socket;
    (window as any).toggleInstructorDashboard = toggleInstructorDashboard;

    // ========================================================
    // RAISE HAND NOTIFICATION PANEL (Instructor Only)
    // ========================================================

    if (isInstructor) {
      notificationEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/raise-hand-notification.json", maxWidth: 1.4, maxHeight: 0.5 })
        .addComponent(RayInteractable)
        .addComponent(PanelSystemComponent, { scene: envMesh });

      const notificationObject = notificationEntity.object3D;
      if (notificationObject) {
        camera.add(notificationObject);
        notificationObject.position.set(0, 0.2, -1.5);
        notificationObject.rotation.set(0, 0, 0);
        notificationObject.scale.set(1, 1, 1);
        notificationObject.visible = false;
        notificationObject.frustumCulled = false;
        notificationObject.updateMatrixWorld(true);
        console.log("[Notification] Panel created and hidden.");
      }
      console.log("[Notification] Panel created for instructor.");
    }

    // ========================================================
    // EXPOSE PRESENTATION SYSTEM
    // ========================================================

    const presentationSystem = world.getSystem(PresentationSystem);
    if (presentationSystem) {
      (window as any).presentationSystem = presentationSystem;
      console.log("[Index] PresentationSystem exposed globally");
    }

    // ========================================================
    // LISTEN FOR MODE CHANGES
    // ========================================================

    if (isStudent) {
      socket.on("modeChanged", (data: { mode: string; destination: string }) => {
        console.log(`[Student] 📢 Mode changed to: ${data.mode} (${data.destination})`);

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

        if ((window as any).RaiseHandSystem) {
          (window as any).currentMode = data.mode;
        }

        if ((window as any).presentationSystem) {
          console.log(`[Student] 🎬 Calling presentation system for mode: ${data.mode}`);
          if (data.mode === "Presentation Mode") {
            (window as any).presentationSystem.enterPresentationMode();
          } else if (data.mode === "Classroom Mode") {
            (window as any).presentationSystem.exitPresentationMode();
          }
        }
      });

      socket.on("studentModeChanged", (data: { studentId: string; mode: string; destination: string; name: string; seat: string }) => {
        console.log(`[Student] 📢 ${data.name} mode changed to: ${data.mode}`);
      });

    }

    const labEnvironmentManager = isStudent
      ? new LabEnvironmentManager(world, [
          envMesh,
          instructorMesh,
          menuEntity.object3D,
          hintEntity?.object3D,
          raiseHandEntity?.object3D,
        ])
      : null;

    // ========================================================
    // DEBUGGING REFERENCES
    // ========================================================

    (window as any).menuEntity = menuEntity;
    (window as any).instructorMenuButtonEntity = instructorMenuButtonEntity;
    (window as any).panelEntity = panelEntity;
    (window as any).hintEntity = hintEntity;
    (window as any).raiseHandEntity = raiseHandEntity;
    (window as any).notificationEntity = notificationEntity;
    (window as any).transitionEntity = transitionEntity;
    (window as any).studentResultEntity = studentResultEntity;
    (window as any).world = world;
    (window as any).player = player;
    (window as any).instructorMesh = instructorMesh;
    (window as any).classroomMesh = envMesh;
    (window as any).positionInstructorOnStage = positionInstructorOnStage;
    (window as any).prepareInstructorView = prepareInstructorView;
    (window as any).instructorDashboardEntity = instructorDashboardEntity;
    (window as any).instructorDashboardObject = instructorDashboardObject;
    (window as any).instructorLabMonitorEntity = instructorLabMonitorEntity;
    (window as any).instructorLabMonitorObject = instructorLabMonitorObject;
    (window as any).instructorLabMonitorButtonEntity = instructorLabMonitorButtonEntity;
    (window as any).instructorLabMonitorButtonObject = instructorLabMonitorButtonObject;
    (window as any).instructorMistakesEntity = instructorMistakesEntity;
    (window as any).instructorMistakesObject = instructorMistakesObject;
    (window as any).toggleInstructorDashboard = toggleInstructorDashboard;
    (window as any).setInstructorDashboardOpen = setInstructorDashboardOpen;
    (window as any).labEnvironmentManager = labEnvironmentManager;

    // ========================================================
    // REMOVE STARTUP SCREEN
    // ========================================================

    if (startupMessage) {
      startupMessage.style.display = "none";
    }

    console.log(`[Index] ✅ Application initialized for ${activeUser.role}: ${activeUser.username}`);
  })
  .catch((error) => {
    console.error("Failed to create world:", error);
    const startupMessage = document.getElementById("startup-message");
    if (startupMessage) {
      startupMessage.textContent = "Failed to start the VR classroom. Check the browser console.";
    }
  });

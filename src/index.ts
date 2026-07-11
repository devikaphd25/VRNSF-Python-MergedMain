// index.ts - Without demo players
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
  ScreenSpace,
  SessionMode,
  World,
  PanelDocument
} from "@iwsdk/core";

import { SeatComponent } from "./components/seat.component";
import { ProjectorScreenComponent } from "./components/projector-screen.component";
import { SeatSystem } from "./systems/seat.system";
import { ProjectorScreenSystem } from "./systems/projector-screen.system";
import { PanelSystem, PanelSystemComponent } from "./panel";
import { PresentationSystem } from "./systems/presentation.system";
import * as THREE from "three";
import { socket } from "./network/socket";
import { updateSeatMarkers, updateMarkerVisibility,hideAllMarkers } from "./components/instructor/seat-markers";
import { MenuSystem } from "./systems/menu.system";
import { HintSystem } from "./systems/hint-system";


const assets: AssetManifest = {
  classroom: { 
    url: "./gltf/classroom/theater_classroom.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },
  classroom2: {
    url: "./gltf/classroom2/theater_classroom2.gltf",
    type: AssetType.GLTF,
    priority: "critical"
  },
  instructorAvatar: {
    url: "./gltf/avatars/instructor.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },
  sunsetHDR: {
    url: "./hdr/venice_sunset_1k.hdr",
    type: AssetType.HDRTexture,
    priority: "critical"
  },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    features: { handTracking: true, layers: true },
  },
  features: {
    locomotion: false,
    grabbing: false,
    physics: true,
    sceneUnderstanding: false,
    environmentRaycast: false,
  }
}).then((world) => {
  const { renderer, scene, camera, player } = world;

  // Renderer Settings
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.xr.enabled = true;

  // Apply Lighting
  const levelRoot = world.activeLevel.value;
  levelRoot.addComponent(IBLTexture, {
    src: 'sunsetHDR',
    intensity: 0.9,
    rotation: [0, Math.PI / 4, 0]
  });

  const { scene: envMesh } = AssetManager.getGLTF("classroom2")!;
  const { scene: instructorMesh } = AssetManager.getGLTF("instructorAvatar")!;

  const instructorAnchor = envMesh.getObjectByName("InstructorAvatar_Anchor");

  if (instructorAnchor) {
    instructorAnchor.getWorldPosition(instructorMesh.position);
    instructorAnchor.getWorldQuaternion(instructorMesh.quaternion);
  } else {
    instructorMesh.position.set(0, 0, -2.2);
    instructorMesh.rotation.set(0, Math.PI, 0);
  }

  instructorMesh.scale.set(1, 1, 1);
  world.createTransformEntity(instructorMesh);
  (window as any).instructorMesh = instructorMesh;
  (window as any).classroomMesh = envMesh;

  envMesh.position.set(0, 0, 0);
  envMesh.updateWorldMatrix(true, true);
  envMesh.name = "theater_classroom2";

  // ==========================================
  // SEAT MARKERS - Show when facing stage
  // ==========================================

  // Listen for student list updates
  socket.on("studentList", (students) => {
    console.log("[Index] Received student list:", students.length);
    updateSeatMarkers(students, scene, envMesh);
  });

  // Request initial student list
  socket.emit("requestStudentList");

  // ==========================================
  // MARKER VISIBILITY LOOP - Check if facing stage
  // ==========================================

  (window as any).isMenuOpen = false;
  (window as any).isPresentationOpen = false;

  function updateMarkersLoop() {
  if (player) {
    if ((window as any).isMenuOpen || (window as any).isPresentationOpen) {
      hideAllMarkers();
    } else {
      updateMarkerVisibility(player);
    }
  }

  requestAnimationFrame(updateMarkersLoop);
}
  // Start the visibility loop
  updateMarkersLoop();

  // ==========================================
  // 1. REGISTER COMPONENTS
  // ==========================================
  world
      .registerComponent(SeatComponent)
      .registerComponent(ProjectorScreenComponent);

  // ==========================================
  // 2. REGISTER SYSTEMS
  // ==========================================
  world
      .registerSystem(PanelSystem, { priority: 1 }) 
      .registerSystem(SeatSystem, { priority: 2 })
      .registerSystem(ProjectorScreenSystem, { priority: 3 })
      .registerSystem(PresentationSystem, { priority: 4 })
      .registerSystem(HintSystem, { priority: 5 })
      .registerSystem(MenuSystem, { priority: 6 });

  // ==========================================
  // 3. GENERATE STATIC ENVIRONMENT ENTITIES
  // ==========================================
  world.createTransformEntity(envMesh)
      .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC})
      .addComponent(ProjectorScreenComponent, { scene: envMesh });

 // ==========================================
  // 4. INSTANTIATE INTERACTIVE PANEL ENTITIES
  // ==========================================
  
  // Seat Panel interface - Strictly 3D Space
  const panelEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, { config: './ui/seat-panel.json', maxHeight: 0.8, maxWidth: 1.6})
    .addComponent(RayInteractable)
    .addComponent(PanelSystemComponent, { scene: envMesh });

  panelEntity.object3D!.position.set(0, 1.29, -1.9);

  // Hint Panel Interface - Strictly 3D Space
  const hintEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, { config: './ui/hint-panel.json', maxHeight: 0.3, maxWidth: 1.6 })
    .addComponent(PanelSystemComponent, { scene: envMesh });

  
    hintEntity.object3D!.position.set(0, 1.85, -1.9);
  

  // Menu Panel
  // Detect VR mode
const isVR = !!navigator.xr;

// Menu Panel - Use different UI kit for VR vs Web
const menuEntity = world
  .createTransformEntity()
  .addComponent(PanelUI, {
    config: './ui/classroom-menu-vr.json',  // <-- CHANGED
    maxHeight: 7.8,
    maxWidth: 7.2,
  })
  .addComponent(RayInteractable)
 // .addComponent(PanelSystemComponent, { scene: envMesh });
//camera.add(menuEntity.object3D!);

menuEntity.object3D!.position.set(0, 2.1, 2.6);
menuEntity.object3D!.rotation.set(0, Math.PI, 0);
menuEntity.object3D!.scale.set(2.25, 2.25, 2.25);
console.log("[Index] Menu created at position:", menuEntity.object3D!.position);
console.log("[Index] Menu scale:", menuEntity.object3D!.scale);
  // STORE REFERENCES FOR DEBUGGING
  // ==========================================
  (window as any).menuEntity = menuEntity;
  (window as any).panelEntity = panelEntity;
  (window as any).world = world;
  (window as any).player = player;

  console.log("[Index] ✅ Application initialized successfully");

}).catch((error) => {
  console.error("Failed to create world:", error);
});
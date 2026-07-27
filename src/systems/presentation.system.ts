import {
  createSystem,
  Quaternion,
  Vector3,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  DoubleSide,
  CylinderGeometry,
  BoxGeometry,
  BackSide
} from "@iwsdk/core";
import { socket } from "../network/socket";

export class PresentationSystem extends createSystem({}) {
  private isPresentationMode = false;
  private savedSeatPosition = new Vector3();
  private savedSeatQuaternion = new Quaternion();
  private savedSeatRotationY = 0;
  private presentationScreen?: Mesh;
  private blackRoom?: Mesh;
  private transitionInProgress = false;
  private savedClassroomUi = new Map<any, boolean>();

  init(): void {
    console.log("[PresentationSystem] Initializing");

    // ✅ Listen for mode changes from instructor (direct to this student)
    socket.on("modeChanged", this.onModeChanged);
    
    // ✅ Listen for student mode changes (broadcast to everyone)
    socket.on("studentModeChanged", this.onStudentModeChanged);
  }

  update() {
    const rightCtrl = this.input?.xr?.gamepads?.right;
    if (!rightCtrl) return;

    // ✅ Changed from "a-button" to "b-button"
    if (rightCtrl.getButtonDown("b-button")) {
      this.togglePresentationMode();
    }
  }

  // ✅ Handle mode change from instructor (direct to this student)
  private onModeChanged = (data: { mode: string; destination: string }): void => {
    console.log(`[PresentationSystem] Mode change received: ${data.mode}`);

    if (data.mode === "Presentation Mode") {
      if (!this.isPresentationMode) {
        console.log("[PresentationSystem] Entering presentation mode from instructor");
        this.togglePresentationMode();
      }
    } else if (data.mode === "Classroom Mode") {
      if (this.isPresentationMode) {
        console.log("[PresentationSystem] Returning to classroom mode from instructor");
        this.togglePresentationMode();
      }
    }
  };

  // ✅ Handle student mode change (broadcast to everyone)
  private onStudentModeChanged = (data: { 
    studentId: string; 
    mode: string; 
    destination: string; 
    name: string; 
    seat: string 
  }): void => {
    console.log(`[PresentationSystem] Student mode changed: ${data.name} → ${data.mode}`);
    
    // Check if this is the current student
    if (data.studentId === socket.id) {
      console.log(`[PresentationSystem] This is me! Updating mode: ${data.mode}`);
      
      if (data.mode === "Presentation Mode" && !this.isPresentationMode) {
        this.togglePresentationMode();
      } else if (data.mode === "Classroom Mode" && this.isPresentationMode) {
        this.togglePresentationMode();
      }
    }
  };

  // ✅ Public method to enter presentation mode (for external calls)
  public enterPresentationMode(): void {
    if (!this.isPresentationMode) {
      console.log("[PresentationSystem] enterPresentationMode called");
      this.togglePresentationMode();
    }
  }

  // ✅ Public method to exit presentation mode (for external calls)
  public exitPresentationMode(): void {
    if (this.isPresentationMode) {
      console.log("[PresentationSystem] exitPresentationMode called");
      this.togglePresentationMode();
    }
  }

  // ✅ Public method to set mode (for external calls)
  public setMode(mode: string): void {
    console.log(`[PresentationSystem] setMode called: ${mode}`);
    if (mode === "Presentation Mode" && !this.isPresentationMode) {
      this.togglePresentationMode();
    } else if (mode === "Classroom Mode" && this.isPresentationMode) {
      this.togglePresentationMode();
    }
  }

  private createCinemaObjects() {
    if (this.presentationScreen && this.blackRoom) return;

    const projector =
      this.world.scene.getObjectByName("ProjectorScreen") as Mesh;

    const projectorMat =
      projector?.material as MeshStandardMaterial;

    // Black cinema room
    const roomGeo = new BoxGeometry(30, 20, 30);
    const roomMat = new MeshBasicMaterial({
      color: 0x000000,
      side: BackSide
    });

    this.blackRoom = new Mesh(roomGeo, roomMat);
    this.blackRoom.position.set(0, 0, 0);
    this.blackRoom.visible = false;
    this.world.scene.add(this.blackRoom);

    // Wide presentation screen
    const screenGeo = new PlaneGeometry(11.8, 6.3, 64, 1);
   
    const screenMat = new MeshBasicMaterial({
        color: 0xffffff,
        side: DoubleSide
    });

    this.presentationScreen = new Mesh(screenGeo, screenMat);
    this.presentationScreen.position.set(0, 2.8, 6.2);
    this.presentationScreen.scale.set(1.18, 1, 1);
    this.presentationScreen.visible = false;
    this.world.scene.add(this.presentationScreen);
  }

  private togglePresentationMode() {
    if (this.transitionInProgress) {
      return;
    }

    const transition =
      (window as any).performEnvironmentTransition as
        ((action: () => void) => Promise<void>) | undefined;

    if (!transition) {
      this.applyPresentationMode();
      return;
    }

    this.transitionInProgress = true;
    void transition(() => {
      this.applyPresentationMode();
      this.transitionInProgress = false;
    });
  }

  private applyPresentationMode() {
    const instructorMesh = (window as any).instructorMesh;
    const classroomMesh = (window as any).classroomMesh;

    this.createCinemaObjects();

    if (!this.isPresentationMode) {
      this.savedSeatPosition.copy(this.player.position);
      this.savedSeatQuaternion.copy(this.player.quaternion);
      this.savedSeatRotationY = this.player.rotation.y;
      (window as any).isPresentationOpen = true;
      (window as any).isPresentationActive = true;
      if (classroomMesh) classroomMesh.visible = false;
      if (instructorMesh) instructorMesh.visible = false;
      this.setClassroomUiVisible(false);
      if (this.blackRoom) this.blackRoom.visible = true;
      if (this.presentationScreen) this.presentationScreen.visible = true;
      this.updatePresentationTexture();

      this.renderer.setClearColor(0x000000, 1);

      this.player.position.set(0, 1.0, -1.8);
      this.player.quaternion.set(0, 1, 0, 0);

      this.isPresentationMode = true;
      console.log("🎬 Entered Cinema Presentation Mode");
      socket.emit("modeChanged", "Presentation Mode");
    } else {
      this.player.position.copy(this.savedSeatPosition);
      this.player.quaternion.copy(this.savedSeatQuaternion);
      this.player.rotation.y = this.savedSeatRotationY;
      (window as any).isPresentationOpen = false;
      (window as any).isPresentationActive = false;
      if (classroomMesh) classroomMesh.visible = true;
      if (instructorMesh) instructorMesh.visible = true;
      this.setClassroomUiVisible(true);
      if (this.blackRoom) this.blackRoom.visible = false;
      if (this.presentationScreen) this.presentationScreen.visible = false;

      this.renderer.setClearColor(0x87ceeb, 1);

      this.isPresentationMode = false;
      window.dispatchEvent(
        new CustomEvent("restoreClassroomSeat")
      );
      console.log("🏫 Returned to Classroom Mode");
      socket.emit("modeChanged", "Classroom Mode");
    }
  }

  private setClassroomUiVisible(visible: boolean): void {
    const objects = [
      (window as any).menuEntity?.object3D,
      (window as any).hintEntity?.object3D,
      (window as any).raiseHandEntity?.object3D,
    ].filter(Boolean);

    if (!visible) {
      this.savedClassroomUi.clear();
      for (const object of objects) {
        this.savedClassroomUi.set(
          object,
          object.visible
        );
        object.visible = false;
      }
      return;
    }

    for (const [object, wasVisible] of this.savedClassroomUi) {
      object.visible = wasVisible;
    }
    this.savedClassroomUi.clear();
  }
  
  private updatePresentationTexture() {
    const projector = this.world.scene.getObjectByName("ProjectorScreen") as Mesh;
    const projectorMat = projector?.material as MeshStandardMaterial;

    const sourceTexture =
      projectorMat?.emissiveMap || projectorMat?.map;

    if (!sourceTexture || !this.presentationScreen) return;

    const clonedTexture = sourceTexture.clone();

    clonedTexture.repeat.y = -1;
    clonedTexture.offset.y = 1;
    clonedTexture.needsUpdate = true;

    const mat = this.presentationScreen.material as MeshBasicMaterial;
    mat.map = clonedTexture;
    mat.needsUpdate = true;
  }

  destroy(): void {
    socket.off("modeChanged", this.onModeChanged);
    socket.off("studentModeChanged", this.onStudentModeChanged);
    console.log("[PresentationSystem] Destroyed");
  }
}

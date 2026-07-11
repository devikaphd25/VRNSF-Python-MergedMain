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

  update() {
    const rightCtrl = this.input?.xr?.gamepads?.right;
    if (!rightCtrl) return;

    if (rightCtrl.getButtonDown("a-button")) {
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
   // const screenGeo = new PlaneGeometry(11.5, 6.2);
  
   const screenGeo = new PlaneGeometry(11.8, 6.3, 64, 1);
 
   
    const screenMat = new MeshBasicMaterial({
       
        color: 0xffffff,
        side: DoubleSide
    });

   this.presentationScreen = new Mesh(screenGeo, screenMat);
   this.presentationScreen.position.set(0, 2.8, 6.2);
   //this.presentationScreen.rotation.set(0, Math.PI, 0);
   this.presentationScreen.scale.set(1.18, 1, 1);

   this.presentationScreen.visible = false;
   this.world.scene.add(this.presentationScreen);
  }

  private togglePresentationMode() {
    const instructorMesh = (window as any).instructorMesh;
    const classroomMesh = (window as any).classroomMesh;

    this.createCinemaObjects();

    if (!this.isPresentationMode) {
      this.savedSeatPosition.copy(this.player.position);
      this.savedSeatQuaternion.copy(this.player.quaternion);
      this.savedSeatRotationY = this.player.rotation.y;
      (window as any).isPresentationOpen = true;
      if (classroomMesh) classroomMesh.visible = false;
      if (instructorMesh) instructorMesh.visible = false;
      if (this.blackRoom) this.blackRoom.visible = true;
      if (this.presentationScreen) this.presentationScreen.visible = true;
      this.updatePresentationTexture();

      this.renderer.setClearColor(0x000000, 1);

      this.player.position.set(0, 1.0, -1.8);
      this.player.quaternion.set(0, 1, 0, 0);

      this.isPresentationMode = true;
      console.log("Entered Cinema Presentation Mode");
      socket.emit("modeChanged", "Presentation Mode");
    } else {
      this.player.position.copy(this.savedSeatPosition);
      this.player.quaternion.copy(this.savedSeatQuaternion);
      this.player.rotation.y = this.savedSeatRotationY;
      (window as any).isPresentationOpen = false;
      if (classroomMesh) classroomMesh.visible = true;
      if (instructorMesh) instructorMesh.visible = true;
      if (this.blackRoom) this.blackRoom.visible = false;
      if (this.presentationScreen) this.presentationScreen.visible = false;

      this.renderer.setClearColor(0x87ceeb, 1);

      this.isPresentationMode = false;
      console.log("Returned to Classroom Mode");
      socket.emit("modeChanged", "Classroom Mode");
    }
  }
  private updatePresentationTexture() {
  const projector = this.world.scene.getObjectByName("ProjectorScreen") as Mesh;
  const projectorMat = projector?.material as MeshStandardMaterial;

  const sourceTexture =
    projectorMat?.emissiveMap || projectorMat?.map;

  if (!sourceTexture || !this.presentationScreen) return;

  const clonedTexture = sourceTexture.clone();

  /*clonedTexture.repeat.x = -1;
  clonedTexture.offset.x = 1;*/
  clonedTexture.repeat.y = -1;
  clonedTexture.offset.y = 1;
  clonedTexture.needsUpdate = true;

  const mat = this.presentationScreen.material as MeshBasicMaterial;
  mat.map = clonedTexture;
  mat.needsUpdate = true;
}
}
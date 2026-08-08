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
  BackSide,
  eq,
  PanelDocument,
  PanelUI,
  UIKit,
  UIKitDocument
} from "@iwsdk/core";
import { CanvasTexture, SRGBColorSpace } from "three";
import { socket } from "../network/socket";
import {
  setSeatMarkerTheme,
  setSeatMarkersSuppressed,
  showAllMarkers
} from "../components/instructor/seat-markers";

export class PresentationSystem extends createSystem({
  controls: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/instructor-video-controls.json")]
  }
}) {
  private isPresentationMode = false;
  private savedSeatPosition = new Vector3();
  private savedSeatQuaternion = new Quaternion();
  private savedSeatRotationY = 0;
  private presentationScreen?: Mesh;
  private blackRoom?: Mesh;
  private transitionInProgress = false;
  private savedClassroomUi = new Map<any, boolean>();
  private videoElement?: HTMLVideoElement;
  private videoTexture?: CanvasTexture;
  private videoCanvas?: HTMLCanvasElement;
  private videoContext?: CanvasRenderingContext2D;
  private audioContext?: AudioContext;
  private videoAudioSource?: MediaElementAudioSourceNode;
  private lastDrawnVideoTime = -1;
  private controlsEnabledAt = 0;
  private pendingVideoPath?: string;
  private pendingImagePath?: string;
  private presentationMediaType: "video" | "image" = "video";
  private controlsDocument?: UIKitDocument;

  init(): void {
    console.log("[PresentationSystem] Initializing");

    // ✅ Listen for mode changes from instructor (direct to this student)
    socket.on("modeChanged", this.onModeChanged);
    
    // ✅ Listen for student mode changes (broadcast to everyone)
    socket.on("studentModeChanged", this.onStudentModeChanged);
    socket.on("videoPlaybackCommand", this.onVideoPlaybackCommand);
    socket.on("presentationContentChanged", this.onPresentationContentChanged);
    // Quest suspends Web Audio until a user gesture occurs. Create the
    // context early and resume it on any deliberate pointer/controller press.
    this.audioContext = new AudioContext();
    window.addEventListener("pointerdown", this.unlockAudio, true);
    this.queries.controls.subscribe("qualify", entity => {
      this.controlsDocument = PanelDocument.data.document[entity.index] as UIKitDocument;
      this.bindVideoControls();
    });
  }

  private unlockAudio = (): void => {
    if (this.audioContext?.state === "suspended") {
      void this.audioContext.resume();
    }
  };

  update() {
    // Draw only when the HTML video advances. CanvasTexture is more reliable
    // than VideoTexture on Quest for locally served MP4 files.
    if (
      this.videoTexture &&
      this.videoElement &&
      !this.videoElement.paused &&
      this.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      this.videoElement.currentTime !== this.lastDrawnVideoTime
    ) {
      this.drawCurrentVideoFrame();
    }
  }

  // ✅ Handle mode change from instructor (direct to this student)
  private onModeChanged = (data: {
    mode: string;
    destination: string;
    assetPath?: string;
    mediaType?: "video" | "image";
  }): void => {
    console.log(`[PresentationSystem] Mode change received: ${data.mode}`);

    if (data.mode === "Presentation Mode") {
      if (data.assetPath) {
        if (data.mediaType === "image") this.setImageSource(data.assetPath);
        else this.setVideoSource(data.assetPath);
      }
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

  private onPresentationContentChanged = (data: {
    assetPath?: string;
    mediaType?: "video" | "image";
  }): void => {
    if (!data.assetPath) return;
    console.log("[PresentationSystem] Shared content received", data);
    if (data.mediaType === "image") this.setImageSource(data.assetPath);
    else this.setVideoSource(data.assetPath);
    this.enterPresentationMode();
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

  public enterVideoPresentation(assetPath?: string): void {
    if (assetPath) this.setVideoSource(assetPath);
    this.enterPresentationMode();
  }

  public enterImagePresentation(assetPath?: string): void {
    if (assetPath) this.setImageSource(assetPath);
    this.enterPresentationMode();
  }

  public toggleVideoPlayback(): boolean {
    if (!this.videoElement) return false;
    if (this.videoElement.paused) {
      void this.playVideo();
      this.updatePlayPauseLabel(true);
      return true;
    }
    this.videoElement.pause();
    this.updatePlayPauseLabel(false);
    return false;
  }

  public getVideoCurrentTime(): number {
    return this.videoElement?.currentTime ?? 0;
  }

  private bindVideoControls(): void {
    const playPause = this.controlsDocument?.getElementById("video-play-pause");
    const returnButton = this.controlsDocument?.getElementById("video-return-class");

    playPause?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      const playing = this.toggleVideoPlayback();
      socket.emit("instructorVideoPlayback", {
        command: playing ? "play" : "pause",
        currentTime: this.getVideoCurrentTime()
      });
    });

    returnButton?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      socket.emit("instructorReturnAllToClass");
      this.exitPresentationMode();
    });
  }

  private updatePlayPauseLabel(playing: boolean): void {
    const label = this.controlsDocument?.getElementById(
      "video-play-pause"
    ) as UIKit.Text | undefined;
    label?.setProperties({ text: playing ? "PAUSE VIDEO" : "PLAY VIDEO" });
    (this.controlsDocument as any)?.requestUpdate?.();
  }

  private setControlsVisible(visible: boolean): void {
    const object = (window as any).instructorVideoControlsObject;
    if (!object) return;
    object.visible = visible;
    // World-space placement: below the main video screen and within a
    // comfortable controller-ray distance from the instructor position.
    object.position.set(0, visible ? 1.05 : -100, 3.35);
    object.rotation.set(0, Math.PI, 0);
    object.updateMatrixWorld(true);
    if (visible) {
      this.updateControlsForMedia();
      this.updatePlayPauseLabel(!this.videoElement?.paused);
    }
  }

  private onVideoPlaybackCommand = (data: {
    command?: string;
    currentTime?: number;
    sentAt?: number;
  }): void => {
    if (!this.videoElement) return;

    const requestedTime = Number(data?.currentTime);
    if (Number.isFinite(requestedTime)) {
      const networkDelay =
        data.command === "play" && Number.isFinite(data.sentAt)
          ? Math.max(0, (Date.now() - Number(data.sentAt)) / 1000)
          : 0;
      const synchronizedTime = requestedTime + networkDelay;
      if (Math.abs(this.videoElement.currentTime - synchronizedTime) > 0.2) {
        this.videoElement.currentTime = synchronizedTime;
      }
    }

    console.log("[PresentationSystem] Playback command received", data);
    if (data?.command === "pause") {
      this.videoElement.pause();
      this.drawCurrentVideoFrame();
    } else {
      void this.playVideo();
    }
  };

  private setVideoSource(assetPath: string): void {
    if (
      !assetPath ||
      (this.pendingVideoPath === assetPath && this.presentationMediaType === "video")
    ) return;
    this.presentationMediaType = "video";
    this.pendingVideoPath = assetPath;
    this.pendingImagePath = undefined;

    if (!this.videoElement) {
      this.videoElement = document.createElement("video");
      this.videoElement.playsInline = true;
      this.videoElement.autoplay = false;
      this.videoElement.preload = "auto";
      this.videoElement.crossOrigin = "anonymous";
      this.videoElement.muted = false;
      this.videoElement.volume = 1;
      this.videoElement.addEventListener("playing", () => {
        console.log("[PresentationSystem] Video playing", {
          currentTime: this.videoElement?.currentTime,
          readyState: this.videoElement?.readyState,
          audioState: this.audioContext?.state
        });
      });
      this.videoElement.addEventListener("waiting", () => {
        console.warn("[PresentationSystem] Video waiting for data");
      });
      this.videoElement.addEventListener("error", () => {
        console.error("[PresentationSystem] Video media error", this.videoElement?.error);
      });
    }

    if (this.audioContext && !this.videoAudioSource) {
      this.videoAudioSource = this.audioContext.createMediaElementSource(this.videoElement);
      this.videoAudioSource.connect(this.audioContext.destination);
    }

    this.videoElement.pause();
    this.videoElement.src = assetPath;
    this.videoElement.currentTime = 0;
    this.videoElement.load();
    this.videoElement.addEventListener(
      "loadeddata",
      () => {
        this.videoElement?.pause();
        this.drawCurrentVideoFrame();
        this.applyVideoTexture();
      },
      { once: true }
    );

    if (!this.videoCanvas) {
      this.videoCanvas = document.createElement("canvas");
      // 1280x720 keeps the video sharp while limiting Quest GPU memory.
      this.videoCanvas.width = 1280;
      this.videoCanvas.height = 720;
      this.videoContext = this.videoCanvas.getContext("2d") ?? undefined;
    }

    this.videoTexture?.dispose();
    this.videoTexture = new CanvasTexture(this.videoCanvas);
    this.videoTexture.colorSpace = SRGBColorSpace;
    this.videoTexture.needsUpdate = true;
    this.lastDrawnVideoTime = -1;
    this.applyVideoTexture();
    this.updateControlsForMedia();
  }

  private setImageSource(assetPath: string): void {
    if (
      !assetPath ||
      (this.pendingImagePath === assetPath && this.presentationMediaType === "image")
    ) return;
    this.presentationMediaType = "image";
    this.pendingImagePath = assetPath;
    this.pendingVideoPath = undefined;
    this.videoElement?.pause();

    if (!this.videoCanvas) {
      this.videoCanvas = document.createElement("canvas");
      this.videoCanvas.width = 1280;
      this.videoCanvas.height = 720;
      this.videoContext = this.videoCanvas.getContext("2d") ?? undefined;
    }

    const image = new Image();
    image.onload = () => {
      if (!this.videoCanvas || !this.videoContext) return;
      const context = this.videoContext;
      const width = this.videoCanvas.width;
      const height = this.videoCanvas.height;
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const x = (width - drawWidth) / 2;
      const y = (height - drawHeight) / 2;
      context.save();
      context.fillStyle = "#05070a";
      context.fillRect(0, 0, width, height);
      context.translate(width, 0);
      context.scale(-1, 1);
      context.drawImage(image, x, y, drawWidth, drawHeight);
      context.restore();

      this.videoTexture?.dispose();
      this.videoTexture = new CanvasTexture(this.videoCanvas);
      this.videoTexture.colorSpace = SRGBColorSpace;
      this.videoTexture.needsUpdate = true;
      this.applyVideoTexture();
    };
    image.onerror = error => {
      console.error("[PresentationSystem] Briefing image failed to load", error);
    };
    image.src = assetPath;
    this.updateControlsForMedia();
  }

  private updateControlsForMedia(): void {
    const playPause = this.controlsDocument?.getElementById("video-play-pause") as any;
    playPause?.setProperties?.({
      display: this.presentationMediaType === "video" ? "flex" : "none"
    });
    (this.controlsDocument as any)?.requestUpdate?.();
  }

  private drawCurrentVideoFrame(): void {
    if (!this.videoElement || !this.videoCanvas || !this.videoContext) return;
    if (this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const context = this.videoContext;
    const width = this.videoCanvas.width;
    const height = this.videoCanvas.height;
    context.save();
    context.clearRect(0, 0, width, height);
    // The plane is viewed from its back face, so mirror the canvas once here
    // to make the final displayed video read normally.
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(this.videoElement, 0, 0, width, height);
    context.restore();
    this.lastDrawnVideoTime = this.videoElement.currentTime;
    if (this.videoTexture) this.videoTexture.needsUpdate = true;
  }

  private applyVideoTexture(): void {
    if (!this.presentationScreen || !this.videoTexture) return;
    const material = this.presentationScreen.material as MeshBasicMaterial;
    if (material.map && material.map !== this.videoTexture) material.map.dispose();
    material.map = this.videoTexture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  }

  private async playVideo(): Promise<void> {
    if (!this.videoElement) return;
    try {
      if (this.audioContext?.state === "suspended") {
        await this.audioContext.resume();
      }
      this.videoElement.muted = false;
      this.videoElement.volume = 1;
      await this.videoElement.play();
    } catch (error) {
      console.warn("[PresentationSystem] Browser blocked video playback", error);
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
        color: 0x05070a,
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
      const menuButton = (window as any).instructorMenuButtonObject;
      if (menuButton) menuButton.visible = false;
      if (classroomMesh) classroomMesh.visible = false;
      if (instructorMesh) instructorMesh.visible = false;
      // Keep lightweight named 2D astronaut avatars visible after the
      // physical classroom and seats are hidden for presentation mode.
      setSeatMarkerTheme("astronaut");
      setSeatMarkersSuppressed(false);
      showAllMarkers();
      this.setClassroomUiVisible(false);
      if (this.blackRoom) this.blackRoom.visible = true;
      if (this.presentationScreen) this.presentationScreen.visible = true;
      if (this.videoTexture) this.applyVideoTexture();
      else this.updatePresentationTexture();

      this.renderer.setClearColor(0x000000, 1);

      this.player.position.set(0, 1.0, -1.8);
      this.player.quaternion.set(0, 1, 0, 0);

      this.isPresentationMode = true;
      // Prevent the VIDEO-card click from passing through to the newly
      // displayed Play button in the same pointer gesture.
      this.controlsEnabledAt = Date.now() + 2000;
      this.videoElement?.pause();
      this.setControlsVisible(true);
      this.updatePlayPauseLabel(false);
      (window as any).refreshInstructorMenuButton?.();
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
      setSeatMarkersSuppressed(false);
      setSeatMarkerTheme("default");
      this.setClassroomUiVisible(true);
      if (this.blackRoom) this.blackRoom.visible = false;
      if (this.presentationScreen) this.presentationScreen.visible = false;
      this.videoElement?.pause();

      this.renderer.setClearColor(0x87ceeb, 1);

      this.isPresentationMode = false;
      this.setControlsVisible(false);
      (window as any).refreshInstructorMenuButton?.();
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
      // These tier caps are created directly under the world scene instead
      // of under classroomMesh, so hide them explicitly in presentation mode.
      this.world.scene.getObjectByName("NASA_Sealed_Tier_Ends"),
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
    if (mat.map && mat.map !== sourceTexture) {
      mat.map.dispose();
    }
    mat.map = clonedTexture;
    mat.needsUpdate = true;
  }

  public refreshPresentationTexture(): void {
    if (this.isPresentationMode) {
      this.updatePresentationTexture();
    }
  }

  destroy(): void {
    setSeatMarkersSuppressed(false);
    socket.off("modeChanged", this.onModeChanged);
    socket.off("studentModeChanged", this.onStudentModeChanged);
    socket.off("videoPlaybackCommand", this.onVideoPlaybackCommand);
    socket.off("presentationContentChanged", this.onPresentationContentChanged);
    this.videoElement?.pause();
    this.videoTexture?.dispose();
    this.setControlsVisible(false);
    console.log("[PresentationSystem] Destroyed");
  }
}

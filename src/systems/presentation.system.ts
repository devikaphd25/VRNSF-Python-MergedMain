/**
 * Synchronized presentation, video, briefing, and Mission Review renderer.
 * Goal: show instructor-controlled media to every participant, maintain video
 * state/timing, render debrief data screens, and coordinate the door transition.
 * Data arrives from week_activities and debriefReviewData Socket.IO events.
 */
import {
  createSystem,
  Quaternion,
  Vector3,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  DoubleSide,
  SphereGeometry,
  CylinderGeometry,
  BoxGeometry,
  BackSide,
  eq,
  PanelDocument,
  PanelUI,
  UIKit,
  UIKitDocument
} from "@iwsdk/core";
import { CanvasTexture, Raycaster, SRGBColorSpace, TextureLoader, Vector2 } from "three";
import { socket } from "../network/socket";
import {
  restoreSeatMarkersAfterDebrief,
  setSeatMarkerTheme,
  setSeatMarkersSuppressed,
  showAllMarkers
} from "../components/instructor/seat-markers";
import { DebriefDoorTransition } from "./debrief-door-transition";

type DebriefReviewData = {
  cycleLabel: string;
  question: string;
  options: string[];
  correctIndex: number;
  answerCounts: number[];
  studentCount: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  elapsedSeconds: number;
};

type DebriefView = "classroom" | "immersive360";

// Presentation-only demonstration data for the Mission Review side screens.
// It is never persisted to Supabase and does not replace live classroom data.
const DEBRIEF_PRESENTATION_DEMO: DebriefReviewData = {
  cycleLabel: "W1-1 · Cycle 1 of 3",
  question: "Which computer component executes instructions and acts as the system brain?",
  options: ["CPU", "RAM", "SSD", "Keyboard"],
  correctIndex: 0,
  answerCounts: [18, 3, 2, 0],
  studentCount: 23,
  answeredCount: 23,
  correctCount: 18,
  wrongCount: 5,
  elapsedSeconds: 272,
};

export class PresentationSystem extends createSystem({
  controls: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/instructor-video-controls.json")]
  }
}) {
  private isPresentationMode = false;
  private savedSeatPosition = new Vector3();
  private savedSeatQuaternion = new Quaternion();
  private presentationScreen?: Mesh;
  private blackRoom?: Mesh;
  private transitionInProgress = false;
  private pendingClassroomReturn = false;
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
  // Classroom is the safe fallback. Entering the 360 environment must always
  // be an explicit instructor selection carried by the synchronized event.
  private debriefView: DebriefView = "classroom";
  private controlsDocument?: UIKitDocument;
  private lastVideoTimerText = "";
  private briefingImage?: HTMLImageElement;
  private briefingImageRect?: { x: number; y: number; width: number; height: number };
  private briefingMarkerEnabled = false;
  private annotationDrawing = false;
  private lastAnnotationPoint?: { x: number; y: number };
  private annotationRaycaster = new Raycaster();
  private annotationPointer = new Vector2();
  private annotationEnabledAt = 0;
  private xrAnnotationSession?: XRSession;
  private xrAnnotationTriggerPressed = false;
  private markerRayOriginalColors = new Map<any, any>();
  private annotationLaser?: Mesh;
  private debriefDoorTransition?: DebriefDoorTransition;
  private debriefLeftScreen?: Mesh;
  private debriefRightScreen?: Mesh;
  private debriefCenterFrame?: Mesh;
  private debriefBoardFrame?: Mesh;
  private debriefBoardBack?: Mesh;
  private debriefSpaceSphere?: Mesh;
  private debriefLeftCanvas?: HTMLCanvasElement;
  private debriefRightCanvas?: HTMLCanvasElement;
  private debriefLeftTexture?: CanvasTexture;
  private debriefRightTexture?: CanvasTexture;
  private debriefReview?: DebriefReviewData;
  private savedClassroomLightIntensities = new Map<any, number>();
  private classroomProjector?: Mesh;
  private classroomProjectorOriginalMaterial?: any;
  private classroomProjectorDebriefMaterial?: MeshBasicMaterial;
  private classroomProjectorTexture?: CanvasTexture;

  init(): void {
    console.log("[PresentationSystem] Initializing");
    this.debriefDoorTransition = new DebriefDoorTransition(this.world.scene);

    // ✅ Listen for mode changes from instructor (direct to this student)
    socket.on("modeChanged", this.onModeChanged);
    
    // ✅ Listen for student mode changes (broadcast to everyone)
    socket.on("studentModeChanged", this.onStudentModeChanged);
    socket.on("videoPlaybackCommand", this.onVideoPlaybackCommand);
    socket.on("presentationContentChanged", this.onPresentationContentChanged);
    socket.on("briefingAnnotation", this.onBriefingAnnotation);
    socket.on("debriefReviewData", this.onDebriefReviewData);
    // Quest suspends Web Audio until a user gesture occurs. Create the
    // context early and resume it on any deliberate pointer/controller press.
    this.audioContext = new AudioContext();
    window.addEventListener("pointerdown", this.unlockAudio, true);
    this.renderer.domElement.addEventListener("pointerdown", this.onAnnotationPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onAnnotationPointerMove);
    window.addEventListener("pointerup", this.onAnnotationPointerUp);
    this.renderer.xr.addEventListener("sessionstart", this.bindXrAnnotationSession);
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

  private onDebriefReviewData = (data: any): void => {
    this.debriefReview = data;
    this.redrawDebriefScreens();
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
    if (this.isPresentationMode && this.presentationMediaType === "video") {
      this.updateVideoTimer();
    }
    if (this.renderer.xr.isPresenting && this.briefingMarkerEnabled) {
      // The system can be created after an XR session has already started, in
      // which case the sessionstart event was missed. Rebinding is idempotent.
      this.bindXrAnnotationSession();
      this.updateXrAnnotationTriggerState();
      this.setMarkerRayColor(true);
      this.updateXrAnnotationPointer(this.annotationDrawing);
    }
  }

  // ✅ Handle mode change from instructor (direct to this student)
  private onModeChanged = (data: {
    mode: string;
    destination: string;
    assetPath?: string;
    mediaType?: "video" | "image";
    debriefView?: DebriefView;
  }): void => {
    console.log(`[PresentationSystem] Mode change received: ${data.mode}`);

    if (data.mode === "Presentation Mode") {
      // Content metadata is required before entering. In particular, the
      // debrief doorway is selected from mediaType=image. Entering early with
      // the previous/default video type bypasses the transition on Quest.
      if (!data.assetPath) {
        console.log("[PresentationSystem] Waiting for shared presentation content");
        return;
      }
      if (data.mediaType === "image") {
        this.debriefView = data.debriefView ?? "classroom";
        this.setImageSource(data.assetPath);
      } else this.setVideoSource(data.assetPath);
      if (!this.isPresentationMode) {
        console.log("[PresentationSystem] Entering presentation mode with content metadata");
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
    debriefView?: DebriefView;
  }): void => {
    if (!data.assetPath) return;
    console.log("[PresentationSystem] Shared content received", data);
    if (data.mediaType === "image") {
      this.debriefView = data.debriefView ?? "classroom";
      this.setImageSource(data.assetPath);
    } else this.setVideoSource(data.assetPath);
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
    
    // Check if this is the current student. Presentation entry is handled by
    // the targeted modeChanged/presentationContentChanged events because this
    // broadcast intentionally contains no assetPath or mediaType.
    if (data.studentId === socket.id) {
      console.log(`[PresentationSystem] This is me! Updating mode: ${data.mode}`);

      if (data.mode === "Classroom Mode" && this.isPresentationMode) {
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

  public enterImagePresentation(
    assetPath?: string,
    debriefView: DebriefView = "classroom"
  ): void {
    this.debriefView = debriefView;
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

  private seekVideo(offsetSeconds: number): number {
    if (!this.videoElement) return 0;
    const duration = Number.isFinite(this.videoElement.duration)
      ? this.videoElement.duration
      : Number.POSITIVE_INFINITY;
    this.videoElement.currentTime = Math.min(
      duration,
      Math.max(0, this.videoElement.currentTime + offsetSeconds)
    );
    this.drawCurrentVideoFrame();
    return this.videoElement.currentTime;
  }

  private restartVideo(): void {
    if (!this.videoElement) return;
    this.videoElement.pause();
    this.videoElement.currentTime = 0;
    this.drawCurrentVideoFrame();
    void this.playVideo();
    this.updatePlayPauseLabel(true);
  }

  private bindVideoControls(): void {
    const playPause = this.controlsDocument?.getElementById("video-play-pause");
    const back10 = this.controlsDocument?.getElementById("video-back-10");
    const forward10 = this.controlsDocument?.getElementById("video-forward-10");
    const restart = this.controlsDocument?.getElementById("video-restart");
    const next = this.controlsDocument?.getElementById("video-next");
    const returnButton = this.controlsDocument?.getElementById("video-return-class");
    const marker = this.controlsDocument?.getElementById("briefing-highlight");
    const clearMarker = this.controlsDocument?.getElementById("briefing-highlight-clear");

    const emitPlayback = (command: string, currentTime: number): void => {
      socket.emit("instructorVideoPlayback", { command, currentTime });
    };

    back10?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      const wasPlaying = !this.videoElement?.paused;
      emitPlayback(wasPlaying ? "play" : "pause", this.seekVideo(-10));
    });

    playPause?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      const playing = this.toggleVideoPlayback();
      socket.emit("instructorVideoPlayback", {
        command: playing ? "play" : "pause",
        currentTime: this.getVideoCurrentTime()
      });
    });

    forward10?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      const wasPlaying = !this.videoElement?.paused;
      emitPlayback(wasPlaying ? "play" : "pause", this.seekVideo(10));
    });

    restart?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      this.restartVideo();
      emitPlayback("play", 0);
    });

    next?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      this.restartVideo();
      emitPlayback("pause", 0);
      (window as any).advancePresentationToChallenge?.();
    });

    returnButton?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      socket.emit("instructorReturnAllToClass");
      this.exitPresentationMode();
    });

    marker?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      this.briefingMarkerEnabled = !this.briefingMarkerEnabled;
      this.annotationDrawing = false;
      this.lastAnnotationPoint = undefined;
      this.annotationEnabledAt = Date.now() + 250;
      this.setMarkerRayColor(this.briefingMarkerEnabled);
      this.setAnnotationLaserVisible(false);
      this.updateMarkerLabel();
    });

    clearMarker?.addEventListener("click", (event: any) => {
      event?.stopPropagation?.();
      if (Date.now() < this.controlsEnabledAt) return;
      this.clearBriefingAnnotations();
      socket.emit("instructorBriefingAnnotation", { action: "clear" });
    });
  }

  private updateMarkerLabel(): void {
    const marker = this.controlsDocument?.getElementById(
      "briefing-highlight"
    ) as UIKit.Text | undefined;
    marker?.setProperties({
      text: this.briefingMarkerEnabled ? "MARKER ON" : "MARKER OFF"
    });
    (this.controlsDocument as any)?.requestUpdate?.();
  }

  private updatePlayPauseLabel(playing: boolean): void {
    const label = this.controlsDocument?.getElementById(
      "video-play-pause"
    ) as UIKit.Text | undefined;
    label?.setProperties({ text: playing ? "PAUSE" : "PLAY" });
    (this.controlsDocument as any)?.requestUpdate?.();
  }

  private formatVideoTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainder = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  private updateVideoTimer(force = false): void {
    const timer = this.controlsDocument?.getElementById(
      "video-timer"
    ) as UIKit.Text | undefined;
    if (!timer) return;
    const elapsed = this.videoElement?.currentTime ?? 0;
    const duration = this.videoElement?.duration ?? Number.NaN;
    const text = `${this.formatVideoTime(elapsed)} / ${this.formatVideoTime(duration)}`;
    if (!force && text === this.lastVideoTimerText) return;
    this.lastVideoTimerText = text;
    timer.setProperties({ text });
    (this.controlsDocument as any)?.requestUpdate?.();
  }

  private setControlsVisible(visible: boolean): void {
    const object = (window as any).instructorVideoControlsObject;
    if (!object) return;
    object.visible = visible;
    // Briefing controls sit directly below the image and slightly in front of
    // it. Video controls retain their established, comfortable position.
    const isBriefing = this.presentationMediaType === "image";
    const isClassroomBriefing = isBriefing && this.debriefView === "classroom";
    if (visible && isClassroomBriefing) {
      // Place controls in the open space between the first row and stage. This
      // avoids XR camera timing differences and keeps them above the floor.
      const bottomBezel = this.world.scene.getObjectByName(
        "ScreenBezel_Bottom"
      ) as Mesh | undefined;
      const presentationSeat = this.world.scene.getObjectByName("Seat_R1_03");
      if (bottomBezel) {
        bottomBezel.updateWorldMatrix(true, false);
        bottomBezel.geometry.computeBoundingBox();
        const bounds = bottomBezel.geometry.boundingBox;
        if (bounds) {
          const bezelCenter = bounds.getCenter(new Vector3())
            .applyMatrix4(bottomBezel.matrixWorld);
          const seatPosition = new Vector3(0, 0, -0.6);
          presentationSeat?.getWorldPosition(seatPosition);
          const towardProjector = bezelCenter.clone().sub(seatPosition);
          towardProjector.y = 0;
          towardProjector.normalize();
          object.position
            .copy(seatPosition)
            .addScaledVector(towardProjector, 1.65);
          // Keep the complete 0.39 m-tall scaled panel visibly above the floor.
          object.position.y = 0.68;
          object.lookAt(
            new Vector3(seatPosition.x, object.position.y, seatPosition.z)
          );
        }
      } else {
        object.position.set(0, 0.68, 0.65);
        object.rotation.set(0, Math.PI, 0);
      }
    } else {
      object.position.set(
        0,
        visible ? (isBriefing ? -0.72 : 1.05) : -100,
        isBriefing ? 5.35 : 3.35
      );
      object.rotation.set(0, Math.PI, 0);
    }
    // Debrief actions are intentionally larger for comfortable headset-ray
    // targeting. Restore the original scale whenever video mode is active.
    object.scale.setScalar(isClassroomBriefing ? 1.15 : isBriefing ? 1.55 : 1);
    object.updateMatrixWorld(true);
    if (visible) {
      this.updateControlsForMedia();
      this.updatePlayPauseLabel(!this.videoElement?.paused);
      this.updateVideoTimer(true);
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
    if (data?.command === "pause" || data?.command === "seek" || data?.command === "restart") {
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
    this.setDebriefReviewVisible(false);
    if (this.presentationScreen) {
      this.presentationScreen.position.z = 6.2;
    }
    this.briefingMarkerEnabled = false;
    this.annotationDrawing = false;
    this.setMarkerRayColor(false);
    this.setAnnotationLaserVisible(false);
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
      this.videoElement.addEventListener("loadedmetadata", () => {
        this.updateVideoTimer(true);
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
    this.lastVideoTimerText = "";
    this.updateVideoTimer(true);
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
    this.redrawDebriefScreens();
    // Give the large briefing graphic a little more viewing distance.
    if (this.presentationScreen) {
      this.presentationScreen.position.z = 6.75;
    }
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
      this.briefingImage = image;
      this.briefingImageRect = { x, y, width: drawWidth, height: drawHeight };
      this.redrawBriefingImage();

      this.videoTexture?.dispose();
      this.videoTexture = new CanvasTexture(this.videoCanvas);
      this.videoTexture.colorSpace = SRGBColorSpace;
      this.videoTexture.needsUpdate = true;
      this.applyVideoTexture();
      if (this.isPresentationMode && this.debriefView === "classroom") {
        this.setClassroomProjectorDebriefVisible(true);
      }
    };
    image.onerror = error => {
      console.error("[PresentationSystem] Briefing image failed to load", error);
    };
    image.src = assetPath;
    this.updateControlsForMedia();
  }

  private updateControlsForMedia(): void {
    const videoOnlyIds = [
      "video-timer",
      "video-back-10",
      "video-play-pause",
      "video-forward-10",
      "video-restart"
    ];
    const briefingOnlyIds = ["briefing-highlight", "briefing-highlight-clear"];
    const isBriefing = this.presentationMediaType === "image";
    const controlsRoot = this.controlsDocument?.getElementById(
      "presentation-controls-root"
    );
    (controlsRoot as any)?.setProperties?.({
      width: isBriefing ? 1060 : 1180,
      height: isBriefing ? 150 : 104,
      gap: isBriefing ? 20 : 12,
      padding: isBriefing ? 22 : 16
    });
    for (const id of videoOnlyIds) {
      (this.controlsDocument?.getElementById(id) as any)?.setProperties?.({
        display: this.presentationMediaType === "video" ? "flex" : "none"
      });
    }
    for (const id of briefingOnlyIds) {
      (this.controlsDocument?.getElementById(id) as any)?.setProperties?.({
        display: isBriefing ? "flex" : "none",
        width: isBriefing ? 235 : 160,
        height: isBriefing ? 102 : 70,
        fontSize: isBriefing ? 42 : 18
      });
    }
    for (const id of ["video-next", "video-return-class"]) {
      (this.controlsDocument?.getElementById(id) as any)?.setProperties?.({
        width: isBriefing ? 235 : 160,
        height: isBriefing ? 102 : 70,
        fontSize: isBriefing ? 36 : 18
      });
    }
    this.updateMarkerLabel();
    (this.controlsDocument as any)?.requestUpdate?.();
  }

  private redrawBriefingImage(): void {
    if (!this.videoCanvas || !this.videoContext || !this.briefingImage || !this.briefingImageRect) return;
    const { x, y, width: drawWidth, height: drawHeight } = this.briefingImageRect;
    const width = this.videoCanvas.width;
    const height = this.videoCanvas.height;
    const context = this.videoContext;
    context.save();
    context.fillStyle = "#05070a";
    context.fillRect(0, 0, width, height);
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(this.briefingImage, x, y, drawWidth, drawHeight);
    context.restore();
    if (this.videoTexture) this.videoTexture.needsUpdate = true;
    if (this.classroomProjectorTexture) {
      this.classroomProjectorTexture.needsUpdate = true;
    }
  }

  private clearBriefingAnnotations(): void {
    this.annotationDrawing = false;
    this.lastAnnotationPoint = undefined;
    this.redrawBriefingImage();
  }

  private drawAnnotationSegment(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): void {
    if (!this.videoCanvas || !this.videoContext || this.presentationMediaType !== "image") return;
    const width = this.videoCanvas.width;
    const height = this.videoCanvas.height;
    const context = this.videoContext;
    context.save();
    context.strokeStyle = "rgba(250, 204, 21, 0.32)";
    context.lineWidth = 12;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x * width, from.y * height);
    context.lineTo(to.x * width, to.y * height);
    context.stroke();
    context.restore();
    if (this.videoTexture) this.videoTexture.needsUpdate = true;
    if (this.classroomProjectorTexture) {
      this.classroomProjectorTexture.needsUpdate = true;
    }
  }

  private onBriefingAnnotation = (data: {
    action?: "segment" | "clear";
    from?: { x: number; y: number };
    to?: { x: number; y: number };
  }): void => {
    if (data?.action === "clear") {
      this.clearBriefingAnnotations();
      return;
    }
    if (data?.action === "segment" && data.from && data.to) {
      this.drawAnnotationSegment(data.from, data.to);
    }
  };

  private canAnnotate(): boolean {
    return Boolean(
      (window as any).isInstructor &&
      this.isPresentationMode &&
      this.presentationMediaType === "image" &&
      this.briefingMarkerEnabled &&
      Date.now() >= this.annotationEnabledAt
    );
  }

  private setMarkerRayColor(active: boolean): void {
    const raySpace = (this.world as any).player?.raySpaces?.right;
    if (!raySpace) return;
    raySpace.traverse((object: any) => {
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of materials) {
        const color = material?.uniforms?.color?.value;
        if (!color?.setHex || !color?.copy) continue;
        if (active) {
          if (!this.markerRayOriginalColors.has(material)) {
            this.markerRayOriginalColors.set(material, color.clone());
          }
          color.setHex(0xfacc15);
        } else {
          const original = this.markerRayOriginalColors.get(material);
          if (original) color.copy(original);
        }
      }
    });
    if (!active) this.markerRayOriginalColors.clear();
  }

  private pointFromScreen(clientX: number, clientY: number): { x: number; y: number } | undefined {
    if (!this.getAnnotationTarget()) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.annotationPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.annotationRaycaster.setFromCamera(this.annotationPointer, this.camera);
    return this.pointFromRaycaster();
  }

  private pointFromRaycaster(): { x: number; y: number } | undefined {
    const target = this.getAnnotationTarget();
    if (!target) return undefined;
    const hit = this.annotationRaycaster.intersectObject(target, false)[0];
    if (!hit?.uv) {
      this.setAnnotationLaserVisible(false);
      return undefined;
    }
    this.updateAnnotationLaser(hit.point);
    // Convert the geometry UV through the texture itself. This includes the
    // classroom projector clone's repeat/offset flip and CanvasTexture's
    // flipY, producing the exact top-left canvas coordinate sampled beneath
    // the yellow ray-hit dot.
    const canvasUv = hit.uv.clone();
    const targetMaterial = Array.isArray(target.material)
      ? target.material[0]
      : target.material;
    const targetTexture = (targetMaterial as MeshBasicMaterial | undefined)?.map;
    if (targetTexture) {
      targetTexture.updateMatrix();
      targetTexture.transformUv(canvasUv);
    } else {
      canvasUv.y = 1 - canvasUv.y;
    }
    return {
      x: Math.min(1, Math.max(0, canvasUv.x)),
      y: Math.min(1, Math.max(0, canvasUv.y))
    };
  }

  private getAnnotationTarget(): Mesh | undefined {
    if (this.debriefView === "classroom") {
      return this.world.scene.getObjectByName("ProjectorScreen") as Mesh | undefined;
    }
    return this.presentationScreen;
  }

  private updateAnnotationLaser(point: Vector3): void {
    if (!this.annotationLaser) {
      const geometry = new SphereGeometry(0.075, 12, 8);
      const material = new MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
        depthWrite: false
      });
      this.annotationLaser = new Mesh(geometry, material);
      this.annotationLaser.name = "BriefingMarkerLaserPreview";
      this.annotationLaser.renderOrder = 1000;
      this.world.scene.add(this.annotationLaser);
    }

    // Pull the dot slightly toward the instructor so it remains visible over
    // the image without flickering against the presentation plane.
    this.annotationLaser.position.copy(point);
    this.annotationLaser.position.z -= 0.035;
    this.annotationLaser.visible = this.canAnnotate();
  }

  private setAnnotationLaserVisible(visible: boolean): void {
    if (this.annotationLaser) this.annotationLaser.visible = visible;
  }

  private appendAnnotationPoint(point: { x: number; y: number }): void {
    const previous = this.lastAnnotationPoint;
    this.lastAnnotationPoint = point;
    if (!previous) return;
    this.drawAnnotationSegment(previous, point);
    socket.emit("instructorBriefingAnnotation", {
      action: "segment",
      from: previous,
      to: point
    });
  }

  private onAnnotationPointerDown = (event: PointerEvent): void => {
    if (!this.canAnnotate() || this.renderer.xr.isPresenting) return;
    const point = this.pointFromScreen(event.clientX, event.clientY);
    if (!point) return;
    this.annotationDrawing = true;
    this.lastAnnotationPoint = point;
    event.preventDefault();
  };

  private onAnnotationPointerMove = (event: PointerEvent): void => {
    if (!this.canAnnotate() || this.renderer.xr.isPresenting) {
      this.setAnnotationLaserVisible(false);
      return;
    }
    const point = this.pointFromScreen(event.clientX, event.clientY);
    if (point && this.annotationDrawing) this.appendAnnotationPoint(point);
  };

  private onAnnotationPointerUp = (): void => {
    if (!this.renderer.xr.isPresenting) {
      this.annotationDrawing = false;
      this.lastAnnotationPoint = undefined;
    }
  };

  private bindXrAnnotationSession = (): void => {
    const session = this.renderer.xr.getSession();
    if (!session || session === this.xrAnnotationSession) return;
    this.xrAnnotationSession = session;
    session.addEventListener("selectstart", this.onXrAnnotationSelectStart);
    session.addEventListener("selectend", this.onXrAnnotationSelectEnd);
  };

  private onXrAnnotationSelectStart = (event: XRInputSourceEvent): void => {
    if (!this.canAnnotate() || event.inputSource.handedness !== "right") return;
    this.xrAnnotationTriggerPressed = true;
    this.annotationDrawing = true;
    this.lastAnnotationPoint = undefined;
    this.updateXrAnnotationPointer(true);
  };

  private onXrAnnotationSelectEnd = (): void => {
    this.xrAnnotationTriggerPressed = false;
    this.annotationDrawing = false;
    this.lastAnnotationPoint = undefined;
  };

  private updateXrAnnotationTriggerState(): void {
    const session = this.renderer.xr.getSession();
    const rightInput = session
      ? [...session.inputSources].find(source => source.handedness === "right")
      : undefined;
    // The primary trigger is button 0 on standard WebXR gamepads. Polling it
    // is a fallback for Quest/IWER cases where UIKit consumes selectstart.
    const pressed = Boolean(rightInput?.gamepad?.buttons?.[0]?.pressed);

    if (pressed && !this.xrAnnotationTriggerPressed && this.canAnnotate()) {
      this.annotationDrawing = true;
      this.lastAnnotationPoint = undefined;
    } else if (!pressed && this.xrAnnotationTriggerPressed) {
      this.annotationDrawing = false;
      this.lastAnnotationPoint = undefined;
    }

    this.xrAnnotationTriggerPressed = pressed;
  }

  private updateXrAnnotationPointer(draw: boolean): void {
    if (!this.canAnnotate()) return;
    const raySpace = (this.world as any).player?.raySpaces?.right;
    if (!raySpace) return;
    const origin = new Vector3();
    const direction = new Vector3(0, 0, -1);
    const rotation = new Quaternion();
    raySpace.getWorldPosition(origin);
    raySpace.getWorldQuaternion(rotation);
    direction.applyQuaternion(rotation).normalize();
    this.annotationRaycaster.set(origin, direction);
    const point = this.pointFromRaycaster();
    if (point && draw) this.appendAnnotationPoint(point);
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
    // Close both dashboard surfaces before starting the return. The same
    // controller select used on EMERGENCY RETURN must not pass through and
    // reopen the dashboard while the doorway is covering the scene.
    (window as any).setInstructorDashboardOpen?.(false);
    const menuButton = (window as any).instructorMenuButtonObject;
    if (menuButton) menuButton.visible = false;
    if (this.transitionInProgress) {
      // Emergency Return can arrive from the instructor while a student's
      // doorway animation is still finishing. Never discard that request;
      // complete the doorway frame, then run the normal shared restoration.
      this.pendingClassroomReturn = true;
      return;
    }
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

    const spaceTexture = new TextureLoader().load("./textures/nasa/nasa-space-360-v1.png");
    spaceTexture.colorSpace = SRGBColorSpace;
    this.debriefSpaceSphere = new Mesh(
      new SphereGeometry(24, 32, 20),
      // Keep the mission-review space environment visible in a headset without
      // making it as bright as the classroom.
      new MeshBasicMaterial({ map: spaceTexture, color: 0xa9bad3, side: BackSide })
    );
    this.debriefSpaceSphere.visible = false;
    this.world.scene.add(this.debriefSpaceSphere);

    // Two very shallow boxes visually join the three displays into one
    // mission-review board. They are cheaper than another large texture.
    this.debriefBoardFrame = new Mesh(
      new BoxGeometry(16.2, 5.75, 0.08),
      new MeshBasicMaterial({ color: 0x42e8ff })
    );
    this.debriefBoardFrame.position.set(0, 3.0, 7.56);
    this.debriefBoardFrame.visible = false;
    this.world.scene.add(this.debriefBoardFrame);
    this.debriefBoardBack = new Mesh(
      new BoxGeometry(15.95, 5.5, 0.09),
      new MeshBasicMaterial({ color: 0x061326 })
    );
    this.debriefBoardBack.position.set(0, 3.0, 7.49);
    this.debriefBoardBack.visible = false;
    this.world.scene.add(this.debriefBoardBack);

    // A shallow luminous backplate leaves a cyan edge around the scaled
    // center image without adding another texture or post-processing pass.
    this.debriefCenterFrame = new Mesh(
      new BoxGeometry(8.35, 5.12, 0.08),
      new MeshBasicMaterial({ color: 0x42e8ff })
    );
    this.debriefCenterFrame.position.set(0, 3.0, 7.31);
    this.debriefCenterFrame.visible = false;
    this.debriefCenterFrame.renderOrder = 18;
    this.world.scene.add(this.debriefCenterFrame);

    const makeDataScreen = (side: "left" | "right"): Mesh => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 700;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const screen = new Mesh(
        new PlaneGeometry(3.8, 4.2),
        new MeshBasicMaterial({ map: texture, color: 0xffffff, side: DoubleSide })
      );
      // The center display is the deepest part of the review wall. Pull both
      // side displays toward the viewer and rotate them inward so the three
      // screens form a clear, shallow C instead of visually stacking.
      screen.position.set(side === "left" ? -5.75 : 5.75, 3.0, 6.35);
      screen.rotation.y = Math.PI + (side === "left" ? -0.44 : 0.44);
      screen.visible = false;
      screen.renderOrder = 20;
      this.world.scene.add(screen);
      if (side === "left") {
        this.debriefLeftCanvas = canvas;
        this.debriefLeftTexture = texture;
      } else {
        this.debriefRightCanvas = canvas;
        this.debriefRightTexture = texture;
      }
      return screen;
    };
    this.debriefLeftScreen = makeDataScreen("left");
    this.debriefRightScreen = makeDataScreen("right");
    this.redrawDebriefScreens();
  }

  private drawDebriefPanel(
    canvas: HTMLCanvasElement | undefined,
    kind: "summary" | "errors"
  ): void {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#08182f");
    gradient.addColorStop(1, "#102c4d");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#42e8ff";
    context.lineWidth = 16;
    context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    // Side-screen figures are intentionally fixed for presentation/demo mode.
    // Live Socket.IO data remains available in this.debriefReview for the
    // working classroom monitors, but is not exposed in this demonstration.
    const review = DEBRIEF_PRESENTATION_DEMO;
    const studentCount = Math.max(0, review?.studentCount ?? 0);
    const correctCount = Math.max(0, review?.correctCount ?? 0);
    const wrongCount = Math.max(0, review?.wrongCount ?? 0);
    const unansweredCount = Math.max(0, studentCount - (review?.answeredCount ?? 0));
    const percent = (value: number) => studentCount > 0
      ? Math.round(value * 100 / studentCount)
      : 0;
    const formatTime = (seconds: number) => {
      const safe = Math.max(0, Math.round(seconds));
      return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
    };
    const wrapText = (text: string, x: number, startY: number, width: number, lineHeight: number) => {
      let line = "";
      let y = startY;
      for (const word of text.split(" ")) {
        const test = `${line}${word} `;
        if (line && context.measureText(test).width > width) {
          context.fillText(line.trim(), x, y);
          line = `${word} `;
          y += lineHeight;
        } else {
          line = test;
        }
      }
      if (line) context.fillText(line.trim(), x, y);
      return y;
    };

    context.fillStyle = "#8af3ff";
    context.font = "700 42px Arial";
    context.fillText(kind === "summary" ? "CHALLENGE REVIEW" : "CYCLE SUMMARY", 54, 74);

    if (kind === "summary") {
      context.fillStyle = "#9db4d0";
      context.font = "700 25px Arial";
      context.fillText(review?.cycleLabel?.toUpperCase() ?? "CURRENT LEARNING CYCLE", 54, 122);
      context.fillStyle = "#ffffff";
      context.font = "700 35px Arial";
      let y = wrapText(
        review?.question ?? "Challenge question will appear when the lesson challenge is completed.",
        54,
        177,
        790,
        43
      ) + 62;
      const options = review?.options?.length
        ? review.options
        : ["No response data available"];
      options.slice(0, 4).forEach((label, index) => {
        const isCorrect = index === review?.correctIndex;
        const optionCount = review?.answerCounts?.[index] ?? 0;
        context.fillStyle = isCorrect ? "rgba(69,184,255,0.92)" : "rgba(255,102,112,0.72)";
        context.fillRect(50, y - 34, 790, 66);
        context.fillStyle = "#071426";
        context.font = "700 29px Arial";
        context.fillText(`${String.fromCharCode(65 + index)}. ${label}`, 70, y + 9);
        context.textAlign = "right";
        context.fillText(`${percent(optionCount)}%`, 815, y + 9);
        context.textAlign = "left";
        y += 82;
      });
      return;
    }

    // Mission progress mirrors the conductor sequence without exposing any
    // individual student's answer or identity on the shared review display.
    context.fillStyle = "rgba(4, 17, 35, 0.72)";
    context.fillRect(48, 104, 804, 92);
    context.strokeStyle = "rgba(66, 232, 255, 0.55)";
    context.lineWidth = 3;
    context.strokeRect(48, 104, 804, 92);

    const missionSteps = [
      ["LECTURE", "✓", "#77efb2"],
      ["QUESTIONS", "✓", "#77efb2"],
      ["CHALLENGE", "✓", "#77efb2"],
      ["DEBRIEF", "ACTIVE", "#ffc85a"],
    ] as const;
    missionSteps.forEach(([label, state, color], index) => {
      const x = 72 + index * 196;
      context.fillStyle = "#dcecff";
      context.font = "700 21px Arial";
      context.fillText(label, x, 140);
      context.fillStyle = color;
      context.font = "700 20px Arial";
      context.fillText(state, x, 174);
      if (index < missionSteps.length - 1) {
        context.fillStyle = "#7890ad";
        context.font = "700 28px Arial";
        context.fillText("›", x + 162, 160);
      }
    });

    context.fillStyle = "#9db4d0";
    context.font = "700 23px Arial";
    context.fillText("COMPLETION TIME", 54, 246);
    context.fillStyle = "#8af3ff";
    context.font = "700 58px Arial";
    context.fillText(formatTime(review?.elapsedSeconds ?? 0), 54, 310);

    context.fillStyle = "rgba(69, 184, 255, 0.14)";
    context.fillRect(48, 350, 804, 126);
    context.strokeStyle = "rgba(69, 184, 255, 0.72)";
    context.lineWidth = 4;
    context.strokeRect(48, 350, 804, 126);
    context.fillStyle = "#dcecff";
    context.font = "700 29px Arial";
    context.fillText("CORRECT ANSWERS", 76, 400);
    context.fillStyle = "#45b8ff";
    context.font = "700 58px Arial";
    context.textAlign = "right";
    context.fillText(`${percent(correctCount)}%`, 820, 438);
    context.textAlign = "left";

    context.fillStyle = "rgba(255, 200, 90, 0.12)";
    context.fillRect(48, 504, 804, 126);
    context.strokeStyle = "rgba(255, 200, 90, 0.72)";
    context.lineWidth = 4;
    context.strokeRect(48, 504, 804, 126);
    context.fillStyle = "#dcecff";
    context.font = "700 29px Arial";
    context.fillText("STUDENTS WITH A MISTAKE", 76, 554);
    context.fillStyle = "#ffc85a";
    context.font = "700 48px Arial";
    context.textAlign = "right";
    context.fillText(`${wrongCount}`, 820, 596);
    context.textAlign = "left";
  }

  private redrawDebriefScreens(): void {
    this.drawDebriefPanel(this.debriefLeftCanvas, "summary");
    this.drawDebriefPanel(this.debriefRightCanvas, "errors");
    if (this.debriefLeftTexture) this.debriefLeftTexture.needsUpdate = true;
    if (this.debriefRightTexture) this.debriefRightTexture.needsUpdate = true;
  }

  private positionDebriefSideWindows(): void {
    if (!this.debriefLeftScreen || !this.debriefRightScreen) return;

    if (this.debriefView === "immersive360") {
      this.debriefLeftScreen.scale.setScalar(1);
      this.debriefRightScreen.scale.setScalar(1);
      this.debriefLeftScreen.position.set(-5.75, 3.0, 6.35);
      this.debriefLeftScreen.rotation.set(0, Math.PI - 0.44, 0);
      this.debriefRightScreen.position.set(5.75, 3.0, 6.35);
      this.debriefRightScreen.rotation.set(0, Math.PI + 0.44, 0);
      return;
    }

    const projector = this.world.scene.getObjectByName("ProjectorScreen") as Mesh;
    const leftBezel = this.world.scene.getObjectByName("ScreenBezel_Left") as Mesh;
    const rightBezel = this.world.scene.getObjectByName("ScreenBezel_Right") as Mesh;
    if (!projector || !leftBezel || !rightBezel) return;

    // Anchor to the projector geometry's own visible screen edges. A world
    // Box3 can absorb surrounding transformed classroom geometry and place the
    // panels at the wall edges instead of at the projector frame.
    projector.updateWorldMatrix(true, false);
    leftBezel.updateWorldMatrix(true, false);
    rightBezel.updateWorldMatrix(true, false);
    projector.geometry.computeBoundingBox();
    leftBezel.geometry.computeBoundingBox();
    rightBezel.geometry.computeBoundingBox();
    const bounds = projector.geometry.boundingBox;
    const leftBounds = leftBezel.geometry.boundingBox;
    const rightBounds = rightBezel.geometry.boundingBox;
    if (!bounds || !leftBounds || !rightBounds) return;
    const localCenter = bounds.getCenter(new Vector3());
    const leftLocalCenter = leftBounds.getCenter(new Vector3());
    const rightLocalCenter = rightBounds.getCenter(new Vector3());
    const edgeA = new Vector3(
      leftBounds.min.x,
      leftLocalCenter.y,
      leftLocalCenter.z
    ).applyMatrix4(leftBezel.matrixWorld);
    const edgeB = new Vector3(
      rightBounds.max.x,
      rightLocalCenter.y,
      rightLocalCenter.z
    ).applyMatrix4(rightBezel.matrixWorld);
    const center = localCenter.clone().applyMatrix4(projector.matrixWorld);
    const screenRight = edgeB.clone().sub(edgeA).normalize();
    const viewerPosition = new Vector3();
    const presentationSeat = this.world.scene.getObjectByName("Seat_R1_03");
    if (presentationSeat) {
      presentationSeat.getWorldPosition(viewerPosition);
    } else {
      this.player.getWorldPosition(viewerPosition);
    }
    // setDebriefReviewVisible runs before the instructor is moved to the
    // presentation seat. Always use the stable first-row viewing axis here;
    // using the player's old position turns the panels almost edge-on.
    const towardViewer = viewerPosition.clone().sub(center);
    towardViewer.y = 0;
    towardViewer.normalize();
    const forwardOffset = towardViewer.clone().multiplyScalar(0.12);

    // Match the classroom projector's 3.4 m height. Full-size 360 panels are
    // 4.2 m tall and extend all the way onto the classroom side walls.
    const classroomPanelScale = 0.78;
    this.debriefLeftScreen.scale.setScalar(classroomPanelScale);
    this.debriefRightScreen.scale.setScalar(classroomPanelScale);

    // Keep both windows coplanar with the projector face. Angling them like
    // wings makes them read as objects on the classroom side walls.
    this.debriefLeftScreen.position
      .copy(edgeA)
      .addScaledVector(screenRight, -(3.8 * classroomPanelScale) / 2)
      .add(forwardOffset);
    this.debriefRightScreen.position
      .copy(edgeB)
      .addScaledVector(screenRight, (3.8 * classroomPanelScale) / 2)
      .add(forwardOffset);
    const leftFacingTarget = this.debriefLeftScreen.position
      .clone()
      .add(towardViewer);
    const rightFacingTarget = this.debriefRightScreen.position
      .clone()
      .add(towardViewer);
    this.debriefLeftScreen.lookAt(leftFacingTarget);
    this.debriefRightScreen.lookAt(rightFacingTarget);

    // Fold the outer edges gently toward the class to form a shallow C/U
    // shape. Recalculate each center around its inner bezel edge so the fold
    // behaves like a hinge and never detaches from the projector frame.
    const classroomWingAngle = 0.68;
    this.debriefLeftScreen.rotateY(-classroomWingAngle);
    this.debriefRightScreen.rotateY(classroomWingAngle);
    const halfPanelWidth = (3.8 * classroomPanelScale) / 2;
    const leftCandidate = new Vector3(halfPanelWidth, 0, 0)
      .applyQuaternion(this.debriefLeftScreen.quaternion);
    const leftInnerOffset = leftCandidate.dot(screenRight) >= 0
      ? leftCandidate
      : leftCandidate.multiplyScalar(-1);
    const rightCandidate = new Vector3(halfPanelWidth, 0, 0)
      .applyQuaternion(this.debriefRightScreen.quaternion);
    const rightInnerOffset = rightCandidate.dot(screenRight) <= 0
      ? rightCandidate
      : rightCandidate.multiplyScalar(-1);
    this.debriefLeftScreen.position
      .copy(edgeA)
      .add(forwardOffset)
      .sub(leftInnerOffset);
    this.debriefRightScreen.position
      .copy(edgeB)
      .add(forwardOffset)
      .sub(rightInnerOffset);
    this.debriefLeftScreen.updateMatrixWorld(true);
    this.debriefRightScreen.updateMatrixWorld(true);
  }

  private setDebriefReviewVisible(visible: boolean): void {
    const showSideWindows =
      visible &&
      this.presentationMediaType === "image";
    const showImmersiveRoom =
      showSideWindows && this.debriefView === "immersive360";
    // The legacy cinema box is an opaque, inward-facing room. Hide it while
    // the debrief sphere is active or it masks the 360-degree space texture.
    if (showImmersiveRoom && this.blackRoom) this.blackRoom.visible = false;
    if (showSideWindows) this.positionDebriefSideWindows();
    // Summary and mistakes flank the real classroom projector just as they
    // flank the artificial center screen in the 360-degree review room.
    if (this.debriefLeftScreen) this.debriefLeftScreen.visible = showSideWindows;
    if (this.debriefRightScreen) this.debriefRightScreen.visible = showSideWindows;
    if (this.debriefCenterFrame) this.debriefCenterFrame.visible = showImmersiveRoom;
    if (this.debriefBoardFrame) this.debriefBoardFrame.visible = showImmersiveRoom;
    if (this.debriefBoardBack) this.debriefBoardBack.visible = showImmersiveRoom;
    if (this.debriefSpaceSphere) this.debriefSpaceSphere.visible = showImmersiveRoom;
    if (this.presentationScreen) {
      this.presentationScreen.scale.set(
        showImmersiveRoom ? 0.66 : 1.18,
        showImmersiveRoom ? 0.76 : 1,
        1
      );
      this.presentationScreen.position.set(
        0,
        showImmersiveRoom ? 3.0 : 2.8,
        showImmersiveRoom ? 7.25 : 6.2
      );
    }
  }

  private togglePresentationMode() {
    if (this.transitionInProgress) {
      return;
    }

    // Both debrief destinations use the doorway. The selected view only
    // controls what is revealed after the doorway finishes.
    const transition = this.presentationMediaType === "image"
      ? (action: () => void) => {
          const viewer = this.renderer.xr.isPresenting
            ? this.renderer.xr.getCamera()
            : this.camera;
          return this.debriefDoorTransition!.play(action, viewer);
        }
      : undefined;

    if (!transition) {
      this.applyPresentationMode();
      return;
    }

    this.transitionInProgress = true;
    (window as any).isPresentationTransitionInProgress = true;
    void transition(async () => {
      this.applyPresentationMode();
      // applyPresentationMode reveals the center image, side displays, frames,
      // and space background in one frame. Avoid an extra delayed center-image
      // reveal that makes the final board look assembled in separate pieces.
    }).finally(() => {
      // The environment swap happens before the final doorway fade completes.
      // Keep presentation controls/launchers locked until the entire transfer
      // has finished, then reveal the classroom launcher at its normal parent.
      this.transitionInProgress = false;
      (window as any).isPresentationTransitionInProgress = false;
      if (this.pendingClassroomReturn) {
        this.pendingClassroomReturn = false;
        if (this.isPresentationMode) {
          this.togglePresentationMode();
          return;
        }
      }
      (window as any).refreshInstructorMenuButton?.();
    });
  }

  private applyPresentationMode() {
    const instructorMesh = (window as any).instructorMesh;
    const classroomMesh = (window as any).classroomMesh;

    this.createCinemaObjects();

    if (!this.isPresentationMode) {
      const useImmersiveRoom =
        this.presentationMediaType === "video" ||
        this.debriefView === "immersive360";
      this.savedSeatPosition.copy(this.player.position);
      this.savedSeatQuaternion.copy(this.player.quaternion);
      (window as any).isPresentationOpen = true;
      (window as any).isPresentationActive = true;
      const menuButton = (window as any).instructorMenuButtonObject;
      if (menuButton) menuButton.visible = false;
      if (classroomMesh) classroomMesh.visible = !useImmersiveRoom;
      if (instructorMesh) {
        // The static stage avatar blocks the classroom projector from the
        // presentation viewing point, so hide it for students and instructor
        // throughout either debrief destination.
        instructorMesh.visible = false;
      }
      if (useImmersiveRoom) {
        // Keep lightweight named 2D astronaut avatars visible after the
        // physical classroom and seats are hidden for presentation mode.
        setSeatMarkerTheme("astronaut");
        setSeatMarkersSuppressed(false);
        showAllMarkers();
      }
      this.setClassroomDebriefDimmed(
        this.presentationMediaType === "image" &&
        this.debriefView === "classroom"
      );
      this.setClassroomUiVisible(false);
      if (this.blackRoom) this.blackRoom.visible = useImmersiveRoom;
      if (this.presentationScreen) {
        this.presentationScreen.visible = useImmersiveRoom;
      }
      this.setClassroomProjectorDebriefVisible(!useImmersiveRoom);
      this.setDebriefReviewVisible(true);
      if (this.videoTexture) this.applyVideoTexture();
      else this.updatePresentationTexture();

      this.renderer.setClearColor(useImmersiveRoom ? 0x000000 : 0x87ceeb, 1);

      // Both debrief choices use the established presentation viewing point.
      // The classroom choice differs only in keeping the dimmed classroom and
      // targeting its real projector instead of revealing the 360 room.
      if (!useImmersiveRoom) {
        // Instructor and students share the same first-row center viewing
        // position for the in-class debrief.
        this.positionInstructorAtFirstRowCenter();
      } else {
        this.player.position.set(0, 1.0, -1.8);
      }
      if (useImmersiveRoom) {
        this.player.quaternion.set(0, 1, 0, 0);
      } else {
        this.facePlayerTowardClassroomProjector();
      }
      if ((window as any).isInstructor && instructorMesh) {
        instructorMesh.visible = false;
      }

      this.isPresentationMode = true;
      (window as any).positionStudentRaiseHand?.(true);
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
      // Restoring the quaternion is sufficient and preserves the exact saved
      // classroom orientation. Writing Euler Y afterward can partially
      // overwrite that orientation on an active XR rig.
      (window as any).isPresentationOpen = false;
      (window as any).isPresentationActive = false;
      if (classroomMesh) classroomMesh.visible = true;
      this.setClassroomDebriefDimmed(false);
      if (instructorMesh) {
        instructorMesh.visible = !(window as any).isInstructor;
      }
      setSeatMarkersSuppressed(false);
      setSeatMarkerTheme("default");
      restoreSeatMarkersAfterDebrief();
      this.setClassroomUiVisible(true);
      if (this.blackRoom) this.blackRoom.visible = false;
      if (this.presentationScreen) this.presentationScreen.visible = false;
      this.setClassroomProjectorDebriefVisible(false);
      this.setDebriefReviewVisible(false);
      this.videoElement?.pause();

      this.renderer.setClearColor(0x87ceeb, 1);

      this.isPresentationMode = false;
      this.briefingMarkerEnabled = false;
      this.setMarkerRayColor(false);
      this.setAnnotationLaserVisible(false);
      (window as any).positionStudentRaiseHand?.(false);
      this.setControlsVisible(false);
      // During a debrief return, the doorway is still fading after this scene
      // swap. Its floating dashboard launcher is restored by the transition's
      // completion handler so it never appears inside the transfer effect.
      if (!this.transitionInProgress) {
        (window as any).refreshInstructorMenuButton?.();
      }
      window.dispatchEvent(
        new CustomEvent("restoreClassroomSeat")
      );
      console.log("🏫 Returned to Classroom Mode");
      socket.emit("modeChanged", "Classroom Mode");
    }
  }

  private setClassroomDebriefDimmed(dimmed: boolean): void {
    const classroomMesh = (window as any).classroomMesh;
    if (!classroomMesh) return;

    const lights = [
      classroomMesh.getObjectByName("ClassroomBalancedFill"),
      classroomMesh.getObjectByName("ClassroomStageKey")
    ].filter(Boolean) as Array<{ intensity: number }>;

    if (dimmed) {
      for (const light of lights) {
        if (!this.savedClassroomLightIntensities.has(light)) {
          this.savedClassroomLightIntensities.set(light, light.intensity);
        }
        light.intensity =
          (this.savedClassroomLightIntensities.get(light) ?? light.intensity) * 0.52;
      }
      return;
    }

    for (const [light, intensity] of this.savedClassroomLightIntensities) {
      light.intensity = intensity;
    }
    this.savedClassroomLightIntensities.clear();
  }

  private setClassroomProjectorDebriefVisible(visible: boolean): void {
    const projector = this.world.scene.getObjectByName("ProjectorScreen") as Mesh;
    if (!projector) return;

    if (visible) {
      if (!this.classroomProjectorOriginalMaterial) {
        this.classroomProjector = projector;
        this.classroomProjectorOriginalMaterial = projector.material;
      }
      this.classroomProjectorDebriefMaterial?.dispose();
      this.classroomProjectorTexture?.dispose();
      this.classroomProjectorTexture = this.videoTexture?.clone();
      if (this.classroomProjectorTexture) {
        // The GLTF projector UVs are vertically inverted relative to the
        // canvas texture used by the cinema plane.
        this.classroomProjectorTexture.repeat.y = -1;
        this.classroomProjectorTexture.offset.y = 1;
        this.classroomProjectorTexture.needsUpdate = true;
      }
      this.classroomProjectorDebriefMaterial = new MeshBasicMaterial({
        map: this.classroomProjectorTexture,
        color: 0xffffff,
        side: DoubleSide,
        toneMapped: false
      });
      projector.material = this.classroomProjectorDebriefMaterial;
      projector.visible = true;
      return;
    }

    if (this.classroomProjector && this.classroomProjectorOriginalMaterial) {
      this.classroomProjector.material = this.classroomProjectorOriginalMaterial;
    }
    this.classroomProjectorDebriefMaterial?.dispose();
    this.classroomProjectorTexture?.dispose();
    this.classroomProjectorDebriefMaterial = undefined;
    this.classroomProjectorTexture = undefined;
    this.classroomProjector = undefined;
    this.classroomProjectorOriginalMaterial = undefined;
  }

  private facePlayerTowardClassroomProjector(): void {
    const projector = this.world.scene.getObjectByName("ProjectorScreen") as Mesh;
    if (!projector) return;

    const projectorPosition = new Vector3();
    const playerPosition = new Vector3();
    projector.getWorldPosition(projectorPosition);
    this.player.getWorldPosition(playerPosition);
    const directionX = projectorPosition.x - playerPosition.x;
    const directionZ = projectorPosition.z - playerPosition.z;
    this.player.rotation.set(
      0,
      Math.atan2(-directionX, -directionZ),
      0
    );
    this.player.updateMatrixWorld(true);
  }

  private positionInstructorAtFirstRowCenter(): void {
    const centerSeat = this.world.scene.getObjectByName("Seat_R1_03");
    if (!centerSeat) {
      // Keep a deterministic fallback if a future classroom model renames the
      // first-row center anchor.
      this.player.position.set(0, 1.0, -3.4);
      return;
    }

    const seatPosition = new Vector3();
    centerSeat.getWorldPosition(seatPosition);
    this.player.position.copy(seatPosition);
    this.player.updateMatrixWorld(true);
  }

  private setClassroomUiVisible(visible: boolean): void {
    const objects = [
      (window as any).menuEntity?.object3D,
      (window as any).hintEntity?.object3D,
      // Students keep only Raise Hand while watching. Instructor controls are
      // provided by the dedicated video panel.
      (window as any).isInstructor
        ? (window as any).raiseHandEntity?.object3D
        : null,
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
    socket.off("briefingAnnotation", this.onBriefingAnnotation);
    socket.off("debriefReviewData", this.onDebriefReviewData);
    this.renderer.domElement.removeEventListener("pointerdown", this.onAnnotationPointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.onAnnotationPointerMove);
    window.removeEventListener("pointerup", this.onAnnotationPointerUp);
    this.renderer.xr.removeEventListener("sessionstart", this.bindXrAnnotationSession);
    this.xrAnnotationSession?.removeEventListener("selectstart", this.onXrAnnotationSelectStart);
    this.xrAnnotationSession?.removeEventListener("selectend", this.onXrAnnotationSelectEnd);
    this.setMarkerRayColor(false);
    this.videoElement?.pause();
    this.videoTexture?.dispose();
    this.debriefDoorTransition?.dispose();
    this.setControlsVisible(false);
    console.log("[PresentationSystem] Destroyed");
  }
}

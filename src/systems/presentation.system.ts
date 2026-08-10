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
import { CanvasTexture, Raycaster, SRGBColorSpace, Vector2 } from "three";
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

  init(): void {
    console.log("[PresentationSystem] Initializing");

    // ✅ Listen for mode changes from instructor (direct to this student)
    socket.on("modeChanged", this.onModeChanged);
    
    // ✅ Listen for student mode changes (broadcast to everyone)
    socket.on("studentModeChanged", this.onStudentModeChanged);
    socket.on("videoPlaybackCommand", this.onVideoPlaybackCommand);
    socket.on("presentationContentChanged", this.onPresentationContentChanged);
    socket.on("briefingAnnotation", this.onBriefingAnnotation);
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
    object.position.set(
      0,
      visible ? (isBriefing ? -0.72 : 1.05) : -100,
      isBriefing ? 5.35 : 3.35
    );
    // Debrief actions are intentionally larger for comfortable headset-ray
    // targeting. Restore the original scale whenever video mode is active.
    object.scale.setScalar(isBriefing ? 1.55 : 1);
    object.rotation.set(0, Math.PI, 0);
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
    if (!this.presentationScreen) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.annotationPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.annotationRaycaster.setFromCamera(this.annotationPointer, this.camera);
    return this.pointFromRaycaster();
  }

  private pointFromRaycaster(): { x: number; y: number } | undefined {
    if (!this.presentationScreen) return undefined;
    const hit = this.annotationRaycaster.intersectObject(this.presentationScreen, false)[0];
    if (!hit?.uv) {
      this.setAnnotationLaserVisible(false);
      return undefined;
    }
    this.updateAnnotationLaser(hit.point);
    return {
      // The briefing bitmap is already mirrored once when it is painted to
      // the canvas for the back-facing presentation plane. Mirroring the UV
      // here again made the marker move in the opposite horizontal direction.
      x: Math.min(1, Math.max(0, hit.uv.x)),
      y: Math.min(1, Math.max(0, 1 - hit.uv.y))
    };
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
      this.briefingMarkerEnabled = false;
      this.setMarkerRayColor(false);
      this.setAnnotationLaserVisible(false);
      (window as any).positionStudentRaiseHand?.(false);
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
    this.renderer.domElement.removeEventListener("pointerdown", this.onAnnotationPointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.onAnnotationPointerMove);
    window.removeEventListener("pointerup", this.onAnnotationPointerUp);
    this.renderer.xr.removeEventListener("sessionstart", this.bindXrAnnotationSession);
    this.xrAnnotationSession?.removeEventListener("selectstart", this.onXrAnnotationSelectStart);
    this.xrAnnotationSession?.removeEventListener("selectend", this.onXrAnnotationSelectEnd);
    this.setMarkerRayColor(false);
    this.videoElement?.pause();
    this.videoTexture?.dispose();
    this.setControlsVisible(false);
    console.log("[PresentationSystem] Destroyed");
  }
}

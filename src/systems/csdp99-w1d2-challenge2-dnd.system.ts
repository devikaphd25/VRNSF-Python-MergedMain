/**
 * Student-side CSDP-99 Week 1 Day 2 Challenge 2 drag-and-drop.
 *
 * Uses the dedicated 360-degree Challenge 2 environment and validates
 * grab-and-drop releases against the destination boxes.
 */
import {
  createSystem,
  DistanceGrabbable,
  Grabbed,
  Interactable,
  MovementMode,
  RayInteractable,
  type Entity
} from "@iwsdk/core";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { Challenge2GrabItem } from "../components/challenge-2-item.component";
import {
  CHALLENGE_2_PART1_BOX_ORDER,
  CHALLENGE_2_PART2_BOX_ORDER,
  createChallenge2DropBoxes,
  type Challenge2DropBox
} from "../challenges/csdp99-w1d2-challenge2-dnd/drop-boxes";
import {
  CHALLENGE_2_ITEMS,
  CHALLENGE_2_PART2_CODE_LINES,
  CHALLENGE_2_PART2_PROMPT,
  CHALLENGE_2_PROMPT,
  type Challenge2Category,
  type Challenge2Item
} from "../challenges/csdp99-w1d2-challenge2-dnd/catalog";
import { socket } from "../network/socket-client";

// ============================================================
// WORLD LAYOUT AND ANIMATION SETTINGS
// ============================================================

// Place the complete activity this many meters in front of the student.
const ROOT_DISTANCE = 1.55;
// Lower the root from eye height so the boxes sit near floor/table height.
const ROOT_BELOW_CAMERA = 1.18;
// Desktop cameras have a narrower vertical viewport than a headset. Moving
// the activity farther away and centering its full height keeps the question,
// device, and all four boxes inside the browser window at the same time.
const DESKTOP_ROOT_DISTANCE = 2.40;
const DESKTOP_ROOT_BELOW_CAMERA = 0.75;
// Starting position of the current device relative to the Challenge 2 root.
// Keep the device completely below the instruction container with a visible
// gap, while still leaving enough height above the destination boxes.
// X = 0 aligns the device with the exact center of the question container.
// Positive local Z moves it toward the student, making controller reach and
// mouse selection easier without moving the fixed panel or destination boxes.
const DEVICE_LOCAL_POSITION = new THREE.Vector3(0, 0.70, 0.22);
const SNIPPET_SPACING_X = 0.62;
const SNIPPET_CARD_WIDTH = 0.52;
const SNIPPET_CARD_HEIGHT = 0.68;
const NUMBER_CARD_SIZE = 0.30;
const PART2_START_DELAY_MS = 10_000;
// Width and height of the square card that displays the device PNG.
const DEVICE_CARD_SIZE = 0.42;
// Slow idle rotation in radians per second. Rotation stops while grabbed.
const IDLE_ROTATION_SPEED = 0.42;
// Match the release tolerance to the box-highlight tolerance so releasing
// while a box is highlighted always counts as a drop into that box.
const DROP_SNAP_DISTANCE = 0.16;
const WRONG_FEEDBACK_DELAY_MS = 300;
const CORRECT_FEEDBACK_DELAY_MS = 400;
const RETURN_AFTER_COMPLETE_MS = 30_000;

type DisabledUi = {
  // Remember the original state of another student panel so it can be
  // restored exactly when Challenge 2 closes.
  entity: any;
  visible: boolean;
  pointerEvents: any;
  hadRayInteractable: boolean;
};

export class Challenge2DndSystem extends createSystem({
  devices: { required: [Challenge2GrabItem] },
  // This second query only contains an item while a controller is holding it.
  // Its "disqualify" event fires when Grabbed is removed on release.
  heldDevices: { required: [Challenge2GrabItem, Grabbed] }
}) {
  // ==========================================================
  // CURRENT CHALLENGE STATE
  // ==========================================================

  // World-space parent containing the boxes, device, and instruction panel.
  private root?: THREE.Group;
  // ECS entity for the same root. Grabbable children must explicitly use this
  // parent or IWSDK reparents them to the scene and their local X/Z coordinates
  // no longer line up with the question panel in a rotated headset view.
  private rootEntity?: Entity;
  // The reusable destination boxes for the current Challenge 2 activity.
  private boxes: Challenge2DropBox[] = [];
  // All currently grabbable snippets or devices.
  private activeDevices: Entity[] = [];
  // Desktop mouse currently holding this entity.
  private desktopHeld?: Entity;
  // Correctly classified devices remain visible inside their boxes while the
  // student answers later questions. They are no longer ray-interactive.
  private completedDevices: Entity[] = [];
  // Canvas-backed world-space plane used for instructions and feedback. A
  // Mesh is intentional: unlike a Sprite, it does not follow headset rotation.
  private statusSprite?: THREE.Mesh;
  private statusTexture?: THREE.CanvasTexture;
  private statusTitle = "";
  private statusDetail = "";
  private statusColor = "#ffffff";
  private challengeStartedAt = 0;
  private challengeDurationSeconds = 180;
  private lastCountdownSecond = -1;
  private items = [...CHALLENGE_2_ITEMS];
  private part: 1 | 2 = 1;
  private part2Timer?: number;
  private loopCodeBoard?: THREE.Mesh;
  // Index of the current item in this.items.
  private currentIndex = 0;
  private entryPending = false;
  private entryVersion = 0;
  // Server session ID used to associate every student's drop with the
  // instructor-started Challenge 2 run.
  private challengeId?: string;
  // Session-only personal review data. This mirrors server-confirmed wrong
  // answers so the student can still see details if an older server omits the
  // per-student mistake array from its final payload.
  private personalMistakes = new Map<string, {
    itemId: string;
    itemName: string;
    firstAnswer: Challenge2Category;
    correctAnswer: Challenge2Category;
  }>();
  // Prevents animation and drop handling while the challenge is closed.
  private active = false;
  // Prevents multiple releases while correct-answer feedback is displayed.
  private advancing = false;
  // Student panels temporarily hidden to avoid ray intersections.
  private disabledUi: DisabledUi[] = [];
  // Reused math objects avoid creating garbage every animation frame.
  private worldPoint = new THREE.Vector3();
  private boxWorldBounds = new THREE.Box3();
  // Desktop browsers do not add IWSDK's Grabbed component for mouse input, so
  // these objects implement an equivalent mouse drag on the render canvas.
  private desktopDragging = false;
  private desktopRaycaster = new THREE.Raycaster();
  private desktopPointer = new THREE.Vector2();
  private desktopDragPlane = new THREE.Plane();
  private desktopDragOffset = new THREE.Vector3();
  private returnTimer?: number;

  /** Connect release events, browser events, and temporary test commands. */
  init(): void {
    this.queries.heldDevices.subscribe("disqualify", device => {
      this.handleRelease(device);
    });

    window.addEventListener("challenge2:start", this.startFromEvent);
    window.addEventListener("challenge2:stop", this.stopFromEvent);
    socket.on("challenge2Started", this.handleServerStart);
    socket.on("challenge2ItemResult", this.handleServerItemResult);
    socket.on("challenge2Ended", this.handleServerEnd);
    socket.on("quickChallengeStarted", this.stopFromEvent);
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handleDesktopPointerDown,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.handleDesktopPointerMove,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointerup",
      this.handleDesktopPointerUp,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointercancel",
      this.handleDesktopPointerUp,
      true
    );
    // Temporary manual entry points for testing before instructor/server
    // synchronization is connected: startChallenge2() and stopChallenge2().
    (window as any).startChallenge2 = this.startChallenge2;
    (window as any).stopChallenge2 = this.stopChallenge2;

    this.cleanupFuncs.push(() => {
      window.removeEventListener("challenge2:start", this.startFromEvent);
      window.removeEventListener("challenge2:stop", this.stopFromEvent);
      socket.off("challenge2Started", this.handleServerStart);
      socket.off("challenge2ItemResult", this.handleServerItemResult);
      socket.off("challenge2Ended", this.handleServerEnd);
      socket.off("quickChallengeStarted", this.stopFromEvent);
      this.renderer.domElement.removeEventListener(
        "pointerdown",
        this.handleDesktopPointerDown,
        true
      );
      this.renderer.domElement.removeEventListener(
        "pointermove",
        this.handleDesktopPointerMove,
        true
      );
      this.renderer.domElement.removeEventListener(
        "pointerup",
        this.handleDesktopPointerUp,
        true
      );
      this.renderer.domElement.removeEventListener(
        "pointercancel",
        this.handleDesktopPointerUp,
        true
      );
      delete (window as any).startChallenge2;
      delete (window as any).stopChallenge2;
      this.clearReturnTimer();
      this.clearPart2Timer();
      this.disposeScene();
    });
  }

  /**
   * Runs every frame: rotate an idle device and highlight the closest box
   * while the student is actively holding the device.
   */
  update(delta: number): void {
    if (!this.active) return;
    this.updateStudentCountdown();
    const held = this.heldDevice();
    if (!held?.object3D) {
      this.boxes.forEach(box => box.setHighlighted(false));
      return;
    }

    if (!this.isCodeSnippetItem(this.itemForDevice(held))) {
      if (!this.advancing) {
        held.object3D.rotation.y += delta * IDLE_ROTATION_SPEED;
      }
    }

    // Compare world positions because the controller can move the device out
    // of the Challenge 2 root's local coordinate system while it is grabbed.
    held.object3D.getWorldPosition(this.worldPoint);
    let nearest: Challenge2DropBox | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const box of this.boxes) {
      const bounds = this.getBoxWorldBounds(box).expandByScalar(0.07);
      const distance = bounds.distanceToPoint(this.worldPoint);
      if (distance < nearestDistance) {
        nearest = box;
        nearestDistance = distance;
      }
    }

    this.boxes.forEach(box => {
      box.setHighlighted(box === nearest && nearestDistance <= 0.16);
    });
  }

  private startFromEvent = (): void => this.startChallenge2();
  private stopFromEvent = (): void => this.stopChallenge2();
  private handleServerStart = (payload: {
    id?: string;
    durationSeconds?: number;
    startedAt?: number;
    items?: Array<(typeof CHALLENGE_2_ITEMS)[number]>;
  }): void => {
    if(payload.items?.length)this.items=payload.items;
    this.challengeId = payload?.id;
    this.challengeDurationSeconds = Number(payload?.durationSeconds) || 180;
    this.challengeStartedAt = Number(payload?.startedAt) || Date.now();
    this.lastCountdownSecond = -1;
    this.personalMistakes.clear();
    this.startChallenge2();
  };
  private handleServerItemResult = (payload: {
    challengeId?: string;
    itemId?: string;
    selectedCategory?: Challenge2Category;
    expectedCategory?: Challenge2Category;
    correct?: boolean;
  }): void => {
    if (
      payload.challengeId !== this.challengeId ||
      payload.correct ||
      !payload.itemId ||
      !payload.selectedCategory ||
      !payload.expectedCategory ||
      this.personalMistakes.has(payload.itemId)
    ) return;
    const item = this.items.find(entry => entry.id === payload.itemId);
    this.personalMistakes.set(payload.itemId, {
      itemId: payload.itemId,
      itemName: item?.name ?? payload.itemId,
      firstAnswer: payload.selectedCategory,
      correctAnswer: payload.expectedCategory
    });
  };
  private handleServerEnd = (payload: {
    challengeId?: string;
    finalResults?: unknown;
  }): void => {
    if (payload?.challengeId && this.challengeId && payload.challengeId !== this.challengeId) {
      return;
    }
    this.stopChallenge2();
  };

  /** Convert a browser pointer position into a Three.js camera ray. */
  private updateDesktopRay(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.desktopPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.desktopRaycaster.setFromCamera(this.desktopPointer, this.camera);
  }

  /** Begin desktop dragging only when the left mouse button hits a snippet. */
  private handleDesktopPointerDown = (event: PointerEvent): void => {
    if (
      this.renderer.xr.isPresenting ||
      !this.active ||
      this.advancing ||
      event.button !== 0
    ) return;

    this.updateDesktopRay(event);
    const target = this.activeDevices.find(device => {
      if (!device.object3D) return false;
      device.object3D.updateMatrixWorld(true);
      return this.desktopRaycaster.intersectObject(device.object3D, true).length > 0;
    });
    if (!target?.object3D) return;

    const deviceWorldPosition = new THREE.Vector3();
    const cameraForward = new THREE.Vector3();
    target.object3D.getWorldPosition(deviceWorldPosition);
    this.camera.getWorldDirection(cameraForward);
    this.desktopDragPlane.setFromNormalAndCoplanarPoint(
      cameraForward,
      deviceWorldPosition
    );

    const planeHit = new THREE.Vector3();
    if (!this.desktopRaycaster.ray.intersectPlane(this.desktopDragPlane, planeHit)) {
      return;
    }

    // Preserve the exact point where the user clicked instead of snapping the
    // device's center directly under the cursor.
    this.desktopDragOffset.copy(deviceWorldPosition).sub(planeHit);
    this.desktopHeld = target;
    this.desktopDragging = true;
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Move the held device along a plane parallel to the student's view. */
  private handleDesktopPointerMove = (event: PointerEvent): void => {
    if (!this.desktopDragging || !this.desktopHeld?.object3D) return;

    this.updateDesktopRay(event);
    const planeHit = new THREE.Vector3();
    if (!this.desktopRaycaster.ray.intersectPlane(this.desktopDragPlane, planeHit)) {
      return;
    }

    const targetWorld = planeHit.add(this.desktopDragOffset);
    const parent = this.desktopHeld.object3D.parent;
    if (parent) parent.worldToLocal(targetWorld);
    this.desktopHeld.object3D.position.copy(targetWorld);
    this.desktopHeld.object3D.updateMatrixWorld(true);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Release the mouse-held device and run the same box validation as VR. */
  private handleDesktopPointerUp = (event: PointerEvent): void => {
    if (!this.desktopDragging) return;
    this.desktopDragging = false;
    const held = this.desktopHeld;
    this.desktopHeld = undefined;
    if (this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    }
    if (held) this.handleRelease(held);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Open Challenge 2 and show its first device. */
  private startChallenge2 = (): void => {
    if (this.active || this.entryPending) return;
    const transition = (window as any).performActivityEntrance as
      ((action: () => void) => Promise<void>) | undefined;
    if (!transition) {
      this.startChallenge2Immediately();
      return;
    }
    this.entryPending = true;
    const version = ++this.entryVersion;
    void transition(() => {
      if (version === this.entryVersion) this.startChallenge2Immediately();
    }).finally(() => {
      if (version === this.entryVersion) this.entryPending = false;
    });
  };

  private startChallenge2Immediately = (): void => {
    if (this.active) return;
    this.clearReturnTimer();
    this.active = true;
    this.advancing = false;
    this.currentIndex = 0;
    this.part = 1;
    if (!this.challengeStartedAt) this.challengeStartedAt = Date.now();

    this.createSceneIfNeeded();
    this.rebuildBoxes();
    this.positionRootInFrontOfCamera();
    if (this.root) this.root.visible = true;
    this.disableOtherStudentUi();
    this.notifyChallengeVisibility(true);
    this.showCurrentItem();
    (window as any).isChallenge2Open = true;
  };

  /** Close Challenge 2 and restore the normal classroom/UI state. */
  private stopChallenge2 = (): void => {
    this.clearReturnTimer();
    this.clearPart2Timer();
    this.entryVersion += 1;
    this.entryPending = false;
    if (!this.active && !this.root?.visible) return;
    this.active = false;
    this.advancing = false;
    this.desktopDragging = false;
    this.challengeId = undefined;
    this.desktopHeld = undefined;
    this.disposeActiveDevices();
    this.disposeCompletedDevices();
    this.disposeLoopCodeBoard();
    this.boxes.forEach(box => box.setHighlighted(false));
    if (this.root) this.root.visible = false;
    this.restoreOtherStudentUi();
    this.notifyChallengeVisibility(false);
    (window as any).isChallenge2Open = false;
  };

  /** Build the reusable boxes and status panel only once. */
  private createSceneIfNeeded(): void {
    if (this.root) return;

    const root = new THREE.Group();
    root.name = "Challenge2Root";
    root.visible = false;
    this.rootEntity = this.world.createTransformEntity(root);
    this.root = root;

    this.createStatusSprite();
  }

  private rebuildBoxes(): void {
    if (!this.root) return;
    this.boxes.forEach(box => box.dispose());
    this.boxes = createChallenge2DropBoxes(
      this.part === 2 ? CHALLENGE_2_PART2_BOX_ORDER : CHALLENGE_2_PART1_BOX_ORDER
    );
    this.boxes.forEach(box => this.root?.add(box.group));
  }

  /**
   * Place the activity in front of the current headset once at startup.
   * The root is attached to the scene, not the camera, so it stays fixed in
   * world space when the headset later moves or rotates.
   */
  private positionRootInFrontOfCamera(): void {
    if (!this.root) return;

    const cameraPosition = new THREE.Vector3();
    const forward = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();

    const desktopMode = !this.renderer.xr.isPresenting;
    const distance = desktopMode ? DESKTOP_ROOT_DISTANCE : ROOT_DISTANCE;
    const belowCamera = desktopMode
      ? DESKTOP_ROOT_BELOW_CAMERA
      : ROOT_BELOW_CAMERA;
    this.root.position.copy(cameraPosition).addScaledVector(forward, distance);
    this.root.position.y = cameraPosition.y - belowCamera;

    const towardCamera = cameraPosition.clone().sub(this.root.position);
    towardCamera.y = 0;
    this.root.rotation.set(
      0,
      Math.atan2(towardCamera.x, towardCamera.z),
      0
    );
    this.root.updateMatrixWorld(true);
  }

  /**
   * Create a non-interactive world-space plane for instructions and feedback.
   * Do not use THREE.Sprite here because sprites billboard toward the camera
   * and would appear to move or rotate with the headset.
   */
  private createStatusSprite(): void {
    if (!this.root) return;

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 320;
    this.statusTexture = new THREE.CanvasTexture(canvas);
    this.statusTexture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: this.statusTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(2.05, 0.52),
      material
    );
    sprite.name = "Challenge2Status";
    // Leave a dedicated middle band for the device: the container's bottom
    // stays above the model, and the model's bottom stays above the box rims.
    sprite.position.set(0, 1.50, -0.03);
    sprite.renderOrder = 20000;
    (sprite as any).pointerEvents = "none";
    sprite.raycast = () => undefined;
    this.root.add(sprite);
    this.statusSprite = sprite;
  }

  /** Redraw the status canvas with new title/detail text. */
  private updateStatus(title: string, detail: string, color = "#ffffff"): void {
    this.statusTitle = title;
    this.statusDetail = detail;
    this.statusColor = color;
    this.redrawStatus();
  }

  /** Redraw the fixed question panel, including the synchronized countdown. */
  private redrawStatus(): void {
    const canvas = this.statusTexture?.image as HTMLCanvasElement | undefined;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !this.statusTexture) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(7, 17, 34, 0.88)";
    context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 34);
    context.fill();
    context.strokeStyle = "rgba(103, 232, 249, 0.85)";
    context.lineWidth = 6;
    context.stroke();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = this.statusColor;
    context.font = "700 36px Arial, sans-serif";
    const titleLines = wrapStatusLines(context, this.statusTitle, canvas.width - 80);
    titleLines.forEach((line, index) => {
      context.fillText(line, canvas.width / 2, 78 + index * 42);
    });
    context.fillStyle = "#dbeafe";
    context.font = "400 30px Arial, sans-serif";
    const detailY = 78 + titleLines.length * 42 + 28;
    wrapStatusLines(context, this.statusDetail, canvas.width - 80).forEach((line, index) => {
      context.fillText(line, canvas.width / 2, detailY + index * 36);
    });
    const remaining = Math.max(
      0,
      this.challengeDurationSeconds -
        Math.floor((Date.now() - this.challengeStartedAt) / 1000)
    );
    context.textAlign = "right";
    context.fillStyle = remaining <= 15 ? "#fca5a5" : "#67e8f9";
    context.font = "700 28px Arial, sans-serif";
    context.fillText(
      `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`,
      canvas.width - 42,
      48
    );
    this.statusTexture.needsUpdate = true;
  }

  /** Refresh only when the displayed second changes. */
  private updateStudentCountdown(): void {
    const remaining = Math.max(
      0,
      this.challengeDurationSeconds -
        Math.floor((Date.now() - this.challengeStartedAt) / 1000)
    );
    if (remaining === this.lastCountdownSecond) return;
    this.lastCountdownSecond = remaining;
    this.redrawStatus();
  }

  /** Spawn every snippet or number for the current part at once. */
  private showCurrentItem(): void {
    this.disposeActiveDevices();
    this.disposeCompletedDevices();
    this.advancing = false;
    const round = this.currentPartItems().slice().sort((left, right) => {
      if (this.part !== 2) return 0;
      return Number(left.displayText ?? left.name) - Number(right.displayText ?? right.name);
    });
    if (round.length === 0) {
      if (this.part === 1) this.beginPart2AfterDelay();
      else this.finishChallenge();
      return;
    }
    this.syncLoopCodeBoard();
    this.updateStatus(
      this.partPrompt(),
      this.part === 2
        ? "Drag each number into the matching execution-order box."
        : "Drag each snippet into the box that names what it is missing."
    );
    const span = this.part === 2 ? 0.78 : SNIPPET_SPACING_X;
    this.activeDevices = round.map((item, index) => {
      const globalIndex = Math.max(0, this.items.findIndex(entry => entry.id === item.id));
      return this.createDevice(item, globalIndex, this.snippetRestPosition(index, round.length, span));
    });
  }

  private currentPartItems(): Challenge2Item[] {
    return this.items.filter(item => (item.part ?? 1) === this.part);
  }

  private partPrompt(): string {
    return this.part === 2 ? CHALLENGE_2_PART2_PROMPT : CHALLENGE_2_PROMPT;
  }

  private snippetRestPosition(
    index: number,
    count = Math.max(1, this.currentPartItems().length),
    span = SNIPPET_SPACING_X
  ): THREE.Vector3 {
    const x = count === 1 ? 0 : -span + (index * (span * 2)) / (count - 1);
    const y = this.part === 2 ? 0.38 : DEVICE_LOCAL_POSITION.y;
    return new THREE.Vector3(x, y, DEVICE_LOCAL_POSITION.z);
  }

  /**
   * Create the current device as a thin 3D card with its transparent PNG on
   * the front, then add IWSDK grabbing components for controller interaction.
   */
  private createDevice(
    item: Challenge2Item,
    itemIndex: number,
    restPosition = DEVICE_LOCAL_POSITION.clone()
  ): Entity {
    if (!this.root || !this.rootEntity) {
      throw new Error("Challenge 2 root must exist before creating a device.");
    }

    const group = new THREE.Group();
    group.name = `Challenge2Device_${item.id}`;
    group.position.copy(restPosition);
    group.userData.challenge2Disposed = false;
    group.userData.restPosition = restPosition.clone();

    // Register a centered grab surface before any asynchronous PNG/GLB load.
    // Without this mesh, the webcam entity is initially empty, so IWSDK can
    // miss it when building the controller interaction target. This surface
    // is invisible but belongs only to the visible device (not to a hidden UI
    // panel), and its center matches the model's visual center exactly.
    const cardWidth = item.codeLines
      ? SNIPPET_CARD_WIDTH
      : item.displayText
        ? NUMBER_CARD_SIZE
        : DEVICE_CARD_SIZE;
    const cardHeight = item.codeLines
      ? SNIPPET_CARD_HEIGHT
      : item.displayText
        ? NUMBER_CARD_SIZE
        : DEVICE_CARD_SIZE;
    const grabTarget = new THREE.Mesh(
      new THREE.BoxGeometry(
        cardWidth * 1.08,
        cardHeight * 1.08,
        DEVICE_CARD_SIZE * 0.48
      ),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false
      })
    );
    grabTarget.name = "DeviceGrabTarget";
    group.add(grabTarget);

    if (item.codeLines) {
      group.add(createCodeSnippetCard(item, cardWidth, cardHeight));
    } else if (item.displayText) {
      group.add(createNumberCard(item, cardWidth, cardHeight));
    }

    // Show a PNG immediately while the browser downloads and decodes the GLB.
    // The fallback also remains usable if WebGL cannot render the model.
    let modelReady = false;
    const fallbackGroup = new THREE.Group();
    fallbackGroup.name = "DeviceFallback";
    if (!item.codeLines && !item.displayText && item.imagePath) {
      // Use a blue loading card rather than an unlabelled black block. The
      // card is replaced by the PNG or GLB as soon as either asset is ready.
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(DEVICE_CARD_SIZE, DEVICE_CARD_SIZE, 0.018),
        new THREE.MeshBasicMaterial({
          color: 0x185b82,
          transparent: true,
          opacity: 0.82,
          toneMapped: false
        })
      );
      backing.castShadow = true;
      fallbackGroup.add(backing);
      new THREE.TextureLoader().load(
        item.imagePath,
        texture => {
          if (group.userData.challenge2Disposed || modelReady) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          const image = new THREE.Mesh(
            new THREE.PlaneGeometry(
              DEVICE_CARD_SIZE * 0.92,
              DEVICE_CARD_SIZE * 0.92
            ),
            new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              alphaTest: 0.02,
              side: THREE.DoubleSide,
              toneMapped: false
            })
          );
          image.name = "DeviceFallbackImage";
          image.position.z = 0.012;
          fallbackGroup.add(image);
        },
        undefined,
        error => console.error(
          `[Challenge 2] Could not load fallback ${item.imagePath}:`,
          error
        )
      );
      group.add(fallbackGroup);
    }

    const removeFallback = (): void => {
      fallbackGroup.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach(material => {
          const texture = (material as THREE.Material & {
            map?: THREE.Texture | null;
          }).map;
          texture?.dispose();
          material.dispose();
        });
      });
      fallbackGroup.removeFromParent();
    };

    if (!item.codeLines && !item.displayText && item.modelPath) {
      // The webcam uses the supplied GLB. Normalize its unknown authoring
      // scale and center so it occupies the same reachable area as PNG items.
      new GLTFLoader().load(
        item.modelPath,
        gltf => {
          // Asset loading can finish before IWSDK attaches this transform to
          // its parent. `group.parent` therefore cannot be used as a lifetime
          // check; doing so left only the fallback black square in browsers.
          if (group.userData.challenge2Disposed) {
            gltf.scene.traverse(child => {
              if (!(child instanceof THREE.Mesh)) return;
              child.geometry.dispose();
              const materials = Array.isArray(child.material)
                ? child.material
                : [child.material];
              materials.forEach(material => material.dispose());
            });
            return;
          }
          const model = gltf.scene;
          model.name = "DeviceModel";
          model.rotation.y = item.modelRotationY ?? 0;
          model.updateMatrixWorld(true);
          const initialBounds = new THREE.Box3().setFromObject(model);
          const initialSize = initialBounds.getSize(new THREE.Vector3());
          const largestDimension = Math.max(
            initialSize.x,
            initialSize.y,
            initialSize.z,
            0.0001
          );
          model.scale.multiplyScalar((DEVICE_CARD_SIZE * 0.95) / largestDimension);
          model.updateMatrixWorld(true);
          const centeredBounds = new THREE.Box3().setFromObject(model);
          const center = centeredBounds.getCenter(new THREE.Vector3());
          model.position.sub(center);
          // Recalculate once after centering and keep the visible GLB exactly
          // around the grab target's local origin.
          model.updateMatrixWorld(true);
          model.traverse(child => {
            if (!(child instanceof THREE.Mesh)) return;
            child.castShadow = true;
            child.receiveShadow = true;
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            materials.forEach(material => {
              material.side = THREE.DoubleSide;
              material.needsUpdate = true;
            });
          });
          modelReady = true;
          removeFallback();
          group.add(model);
        },
        undefined,
        error => console.error(
          `[Challenge 2] Could not load ${item.modelPath}:`,
          error
        )
      );
    }

    // Keep the device in the same rotated local coordinate space as the
    // question panel and boxes. This makes local X = 0 visually centered in
    // both desktop preview and the VR headset.
    const entity = this.world.createTransformEntity(group, {
      parent: this.rootEntity
    });
    entity.addComponent(Challenge2GrabItem, {
      itemIndex,
      expectedCategory: item.category
    });
    // Interactable exposes the device to the controller ray. DistanceGrabbable
    // is required here because IWSDK's OneHandGrabbable intentionally rejects
    // ray pointers and only supports direct hand/controller contact.
    entity.addComponent(Interactable);
    entity.addComponent(DistanceGrabbable, {
      rotate: !item.codeLines && !item.displayText,
      translate: true,
      scale: false,
      // Follow the ray endpoint instead of copying the controller's small
      // physical movement. MoveAtSource made the device feel heavy and would
      // require an unrealistic arm reach to reach the two outer boxes.
      movementMode: MovementMode.MoveFromTarget,
      detachOnGrab: false,
      returnToOrigin: false
    });
    return entity;
  }

  /**
   * Called when the controller releases the device. Find the containing box,
   * validate its category, then reset, retry, or advance to the next item.
   */
  private handleRelease(device: Entity): void {
    if (!this.active || this.advancing || !this.activeDevices.includes(device)) return;

    device.object3D?.getWorldPosition(this.worldPoint);
    // The boxes themselves never receive ray hits. Choose the closest box
    // within the same tolerance used by the visible hover highlight, so the
    // result always agrees with what the student saw before releasing.
    let droppedIn: Challenge2DropBox | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const box of this.boxes) {
      const distance = this.getBoxWorldBounds(box).distanceToPoint(this.worldPoint);
      if (distance < closestDistance) {
        droppedIn = box;
        closestDistance = distance;
      }
    }
    if (closestDistance > DROP_SNAP_DISTANCE) droppedIn = undefined;

    if (!droppedIn) {
      this.resetDevicePosition(device);
      this.updateStatus(
        this.partPrompt(),
        this.part === 2
          ? "Drop the number fully inside one of the four boxes."
          : "Drop the snippet fully inside one of the three boxes.",
        "#fbbf24"
      );
      return;
    }

    this.snapDeviceIntoBox(device, droppedIn);

    const expected = device.getValue(
      Challenge2GrabItem,
      "expectedCategory"
    ) as Challenge2Category | undefined;
    const itemIndex = Number(device.getValue(Challenge2GrabItem, "itemIndex") ?? -1);
    const currentItem = this.items[itemIndex];
    if (this.challengeId && currentItem) {
      socket.emit("challenge2ItemAnswer", {
        challengeId: this.challengeId,
        itemId: currentItem.id,
        selectedCategory: droppedIn.category
      });
    }

    if (droppedIn.category !== expected) {
      droppedIn.setHighlighted(true);
      this.updateStatus(
        "Not quite",
        currentItem?.feedback ?? "Try a different box.",
        "#fca5a5"
      );
      window.setTimeout(() => {
        droppedIn.setHighlighted(false);
        this.resetDevicePosition(device);
      }, WRONG_FEEDBACK_DELAY_MS);
      return;
    }

    droppedIn.setHighlighted(true);
    this.keepDeviceInBox(device);
    this.updateStatus(
      "Correct!",
      currentItem?.feedback ?? "That snippet is in the right box.",
      "#86efac"
    );
    window.setTimeout(() => {
      droppedIn.setHighlighted(false);
      if (!this.active) return;
      if (this.activeDevices.length === 0) {
        if (this.part === 1) this.beginPart2AfterDelay();
        else this.finishChallenge();
      } else {
        this.updateStatus(
          this.partPrompt(),
          this.part === 2
            ? "Keep going — place the remaining numbers."
            : "Keep going — match the remaining snippets."
        );
      }
    }, CORRECT_FEEDBACK_DELAY_MS);
  }

  /** Convert one box's local detection volume into current world coordinates. */
  private getBoxWorldBounds(box: Challenge2DropBox): THREE.Box3 {
    box.group.updateMatrixWorld(true);
    return this.boxWorldBounds
      .copy(box.dropBounds)
      .applyMatrix4(box.group.matrixWorld)
      .clone();
  }

  /** Center the released device inside an open-top destination box. */
  private snapDeviceIntoBox(device: Entity, box: Challenge2DropBox): void {
    if (!device.object3D) return;
    const category = device.getValue(
      Challenge2GrabItem,
      "expectedCategory"
    ) as Challenge2Category;
    const totalForBox = this.items.filter(
      item => item.category === category
    ).length;
    const placedInBox = this.completedDevices.filter(entity =>
      entity.getValue(Challenge2GrabItem, "expectedCategory") === category
    ).length;

    const columns = Math.min(totalForBox, 2);
    const row = Math.floor(placedInBox / columns);
    const column = placedInBox % columns;
    const x = columns === 1 ? 0 : (column - (columns - 1) / 2) * 0.20;
    const z = row * 0.10 - (totalForBox > 2 ? 0.05 : 0);
    const target = box.group.localToWorld(new THREE.Vector3(x, 0.18, z));
    const parent = device.object3D.parent;
    if (parent) parent.worldToLocal(target);
    device.object3D.position.copy(target);
    device.object3D.rotation.set(0, 0, 0);
    device.object3D.scale.setScalar(totalForBox > 1 ? 0.48 : 0.62);
    device.object3D.updateMatrixWorld(true);
  }

  /** Preserve a correct answer in its box without letting it block the ray. */
  private keepDeviceInBox(device: Entity): void {
    if (device.hasComponent(DistanceGrabbable)) {
      device.removeComponent(DistanceGrabbable);
    }
    if (device.hasComponent(RayInteractable)) {
      device.removeComponent(RayInteractable);
    }
    if (device.object3D) {
      device.object3D.pointerEvents = "none";
      device.object3D.traverse((child: any) => {
        child.pointerEvents = "none";
      });
    }
    this.activeDevices = this.activeDevices.filter(entry => entry !== device);
    if (this.desktopHeld === device) this.desktopHeld = undefined;
    this.completedDevices.push(device);
  }

  /** Return a missed or incorrect device to its original floating position. */
  private resetDevicePosition(device: Entity): void {
    if (!device.object3D) return;
    const rest = device.object3D.userData.restPosition as THREE.Vector3 | undefined;
    device.object3D.position.copy(rest ?? DEVICE_LOCAL_POSITION);
    device.object3D.rotation.set(0, 0, 0);
    device.object3D.scale.setScalar(1);
    device.object3D.updateMatrixWorld(true);
  }

  private heldDevice(): Entity | undefined {
    if (this.desktopHeld) return this.desktopHeld;
    for (const entity of this.queries.heldDevices.entities) return entity;
    return undefined;
  }

  private itemForDevice(device: Entity): Challenge2Item | undefined {
    const index = Number(device.getValue(Challenge2GrabItem, "itemIndex") ?? -1);
    return this.items[index];
  }

  private isCodeSnippetItem(item?: Challenge2Item): boolean {
    return Boolean(item?.codeLines?.length || item?.displayText);
  }

  private beginPart2AfterDelay(): void {
    this.clearPart2Timer();
    this.updateStatus(
      "Part 1 complete!",
      "Part 2 starts in 10 seconds.",
      "#86efac"
    );
    this.part2Timer = window.setTimeout(() => {
      this.part2Timer = undefined;
      if (!this.active) return;
      this.startPart2();
    }, PART2_START_DELAY_MS);
  }

  private startPart2(): void {
    this.part = 2;
    this.rebuildBoxes();
    this.showCurrentItem();
  }

  private clearPart2Timer(): void {
    if (this.part2Timer === undefined) return;
    window.clearTimeout(this.part2Timer);
    this.part2Timer = undefined;
  }

  private syncLoopCodeBoard(): void {
    if (!this.root) return;
    this.disposeLoopCodeBoard();
    if (this.part !== 2) return;
    const board = createLoopCodeBoard(CHALLENGE_2_PART2_CODE_LINES);
    board.position.set(0, 0.94, -0.03);
    this.root.add(board);
    this.loopCodeBoard = board;
  }

  private disposeLoopCodeBoard(): void {
    if (!this.loopCodeBoard) return;
    this.loopCodeBoard.geometry.dispose();
    const materials = Array.isArray(this.loopCodeBoard.material)
      ? this.loopCodeBoard.material
      : [this.loopCodeBoard.material];
    materials.forEach(material => {
      const texture = (material as THREE.Material & { map?: THREE.Texture | null }).map;
      texture?.dispose();
      material.dispose();
    });
    this.loopCodeBoard.removeFromParent();
    this.loopCodeBoard = undefined;
  }

  /** Keep the completed scene visible, then return this student to class. */
  private finishChallenge(): void {
    this.advancing = false;
    this.updateStatus(
      "Challenge complete!",
      "Returning to class in 30 seconds.",
      "#86efac"
    );
    window.dispatchEvent(new CustomEvent("challenge2:complete"));
    this.clearReturnTimer();
    this.returnTimer = window.setTimeout(() => {
      this.returnToClassroomAfterComplete();
    }, RETURN_AFTER_COMPLETE_MS);
  }

  private clearReturnTimer(): void {
    if (this.returnTimer === undefined) return;
    window.clearTimeout(this.returnTimer);
    this.returnTimer = undefined;
  }

  private returnToClassroomAfterComplete(): void {
    this.returnTimer = undefined;
    if (!this.active) return;
    const transition = (window as any).performActivityEntrance as
      ((action: () => void) => Promise<void>) | undefined;
    const leave = () => this.stopChallenge2();
    void (transition ? transition(leave) : Promise.resolve().then(leave));
  }

  /** Notify shared classroom UI when the challenge opens or closes. */
  private notifyChallengeVisibility(visible: boolean): void {
    window.dispatchEvent(new CustomEvent("quickChallengeVisibilityChanged", {
      detail: { visible, challengeType: "challenge-2" }
    }));
  }

  /**
   * Hide unrelated student panels and remove their RayInteractable component.
   * This prevents invisible UI from intercepting controller rays.
   */
  private disableOtherStudentUi(): void {
    if (this.disabledUi.length > 0) return;
    const names = [
      "menuEntity",
      "panelEntity",
      "hintEntity",
      "raiseHandEntity",
      "studentBoardViewButtonEntity",
      "studentResultEntity",
      "quickChallengeEntity"
    ];

    names.forEach(name => {
      const entity = (window as any)[name];
      const object = entity?.object3D;
      if (!entity || !object) return;
      const hadRayInteractable = Boolean(entity.hasComponent?.(RayInteractable));
      this.disabledUi.push({
        entity,
        visible: object.visible,
        pointerEvents: object.pointerEvents,
        hadRayInteractable
      });
      object.visible = false;
      object.pointerEvents = "none";
      object.traverse((child: any) => {
        child.pointerEvents = "none";
      });
      if (hadRayInteractable) entity.removeComponent(RayInteractable);
    });
  }

  /** Restore every panel to the state it had before Challenge 2 opened. */
  private restoreOtherStudentUi(): void {
    this.disabledUi.forEach(record => {
      const object = record.entity?.object3D;
      if (!object) return;
      object.visible = record.visible;
      object.pointerEvents = record.pointerEvents ?? "auto";
      if (record.hadRayInteractable && !record.entity.hasComponent?.(RayInteractable)) {
        record.entity.addComponent(RayInteractable);
      }
    });
    this.disabledUi = [];
  }

  /** Dispose one question device and its texture/material/geometry resources. */
  private disposeOneDevice(device: Entity): void {
    const object = device.object3D;
    if (object) object.userData.challenge2Disposed = true;
    object?.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => {
        const texture = (material as THREE.Material & {
          map?: THREE.Texture | null;
        }).map;
        texture?.dispose();
        material.dispose();
      });
    });
    device.dispose();
  }

  private disposeActiveDevices(): void {
    this.desktopDragging = false;
    this.desktopHeld = undefined;
    this.activeDevices.forEach(device => this.disposeOneDevice(device));
    this.activeDevices = [];
  }

  /** Remove the devices retained in boxes when Challenge 2 is closed. */
  private disposeCompletedDevices(): void {
    this.completedDevices.forEach(entity => {
      const object = entity.object3D;
      object?.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach(material => {
          const texture = (material as THREE.Material & {
            map?: THREE.Texture | null;
          }).map;
          texture?.dispose();
          material.dispose();
        });
      });
      entity.dispose();
    });
    this.completedDevices = [];
  }

  /** Dispose all reusable Challenge 2 scene resources when the system ends. */
  private disposeScene(): void {
    this.disposeActiveDevices();
    this.disposeCompletedDevices();
    this.disposeLoopCodeBoard();
    this.boxes.forEach(box => box.dispose());
    this.boxes = [];
    if (this.statusSprite) {
      this.statusSprite.geometry.dispose();
      const statusMaterials = Array.isArray(this.statusSprite.material)
        ? this.statusSprite.material
        : [this.statusSprite.material];
      statusMaterials.forEach(material => material.dispose());
    }
    this.statusTexture?.dispose();
    this.rootEntity?.dispose();
    this.rootEntity = undefined;
    this.root = undefined;
    this.statusSprite = undefined;
    this.statusTexture = undefined;
  }
}

function wrapStatusLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const next = `${current} ${words[index]}`;
    if (context.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[index];
    }
  }
  lines.push(current);
  return lines;
}

function createNumberCard(
  item: Challenge2Item,
  width: number,
  height: number
): THREE.Group {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const group = new THREE.Group();
  group.name = `NumberCard_${item.id}`;
  if (!context) return group;

  context.fillStyle = "rgba(7, 17, 34, 0.94)";
  context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 36);
  context.fill();
  context.strokeStyle = "rgba(103, 232, 249, 0.9)";
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = "#e2f6ff";
  context.font = "700 140px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(item.displayText ?? item.name, canvas.width / 2, canvas.height / 2 + 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide
    })
  );
  mesh.name = "NumberFace";
  mesh.position.z = 0.012;
  group.add(mesh);
  return group;
}

function createLoopCodeBoard(lines: readonly string[]): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 420;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(7, 17, 34, 0.92)";
    context.roundRect(12, 12, canvas.width - 24, canvas.height - 24, 28);
    context.fill();
    context.strokeStyle = "rgba(103, 232, 249, 0.85)";
    context.lineWidth = 6;
    context.stroke();
    context.fillStyle = "#e2f6ff";
    context.font = "600 42px Consolas, 'Courier New', monospace";
    context.textAlign = "left";
    context.textBaseline = "top";
    lines.forEach((line, index) => {
      context.fillText(line, 48, 36 + index * 70);
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.55, 0.58),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      toneMapped: false,
      depthTest: false,
      depthWrite: false
    })
  );
  mesh.name = "Challenge2LoopCode";
  mesh.renderOrder = 20000;
  (mesh as any).pointerEvents = "none";
  mesh.raycast = () => undefined;
  return mesh;
}

function createCodeSnippetCard(
  item: Challenge2Item,
  width: number,
  height: number
): THREE.Group {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 672;
  const context = canvas.getContext("2d");
  const group = new THREE.Group();
  group.name = `SnippetCard_${item.id}`;
  if (!context) return group;

  context.fillStyle = "rgba(7, 17, 34, 0.94)";
  context.roundRect(12, 12, canvas.width - 24, canvas.height - 24, 28);
  context.fill();
  context.strokeStyle = "rgba(103, 232, 249, 0.9)";
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = "#67e8f9";
  context.font = "700 72px Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(`${item.name}:`, 40, 36);
  context.fillStyle = "#e2f6ff";
  context.font = "600 44px Consolas, 'Courier New', monospace";
  (item.codeLines ?? []).forEach((line, index) => {
    context.fillText(line, 40, 138 + index * 56);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide
    })
  );
  mesh.name = "SnippetFace";
  mesh.position.z = 0.012;
  group.add(mesh);
  return group;
}

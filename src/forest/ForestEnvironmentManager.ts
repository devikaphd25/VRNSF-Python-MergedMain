/**
 * Owns the forest scene lifecycle for the "Python Puzzle 3" activity.
 * Loads a 3D forest model (FBX) as the environment, adds firefly lighting,
 * hides classroom objects while active, and restores them on return.
 */
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  type World,
} from "@iwsdk/core";
import type { Object3D } from "three";
import { loadForestModel } from "./forestModel.js";
import { VisibleInteractionSystem } from "./VisibleInteractionSystem.js";

import { socket } from "../network/socket";
import { hideAllMarkers } from "../components/instructor/seat-markers";
import { setForestRoot } from "./forestRoot.js";
import { ForestJigsawBlock, ForestJigsawButton } from "./jigsaw/forestJigsawComponents.js";
import { ForestJigsawPuzzleSystem } from "./jigsaw/ForestJigsawPuzzleSystem.js";

type VisibilityRecord = {
  object: Object3D;
  visible: boolean;
};

// ── Forest palette ────────────────────────────────────────────
const GROUND_COLOR = 0x3a5a3a;
const FIREFLY_COLOR = 0xfff3a0;

const ROOM_WIDTH = 10;
const ROOM_DEPTH = 10;

export class ForestEnvironmentManager {
  private readonly root = new Group();
  private readonly classroomObjects: Object3D[];
  private readonly playerObject: Object3D;
  private savedClassroomVisibility: VisibilityRecord[] = [];
  private active = false;
  private transitionInProgress = false;
  private readonly modelReady: Promise<void>;

  constructor(
    private readonly world: World,
    classroomObjects: Array<Object3D | null | undefined>,
  ) {
    this.classroomObjects = classroomObjects.filter(
      (object): object is Object3D => Boolean(object),
    );

    this.playerObject =
      ((world.player as any)?.object3D ?? world.player) as Object3D;

    this.root.name = "ForestClearingRoot";
    this.root.visible = false;
    const rootEntity = this.world.createTransformEntity(this.root);

    setForestRoot(this.root, rootEntity);
    this.installJigsaw();

    this.modelReady = this.buildForest();
    void this.modelReady.catch((error) => {
      console.error("[Forest] Failed to load 3D forest model:", error);
    });
    this.connectNetwork();
    this.connectExitHandler();
  }

  private installJigsaw(): void {
    this.world
      .registerComponent(ForestJigsawBlock)
      .registerComponent(ForestJigsawButton)
      // Run before IWSDK input (-4), including the headset controller hit test.
      .registerSystem(VisibleInteractionSystem, { priority: -5 })
      .registerSystem(ForestJigsawPuzzleSystem);
  }

  private connectExitHandler(): void {
    window.addEventListener("forestExitRequested", () => {
      this.returnToClassroom("student_exit");
    });
  }

  isActive(): boolean {
    return this.active;
  }

  enter(): void {
    if (this.active || this.transitionInProgress) return;

    this.transitionInProgress = true;
    void this.modelReady.then(() => {
      this.performTransition(() => {
        this.transitionInProgress = false;
        this.enterImmediately();
      });
    }).catch((error) => {
      this.transitionInProgress = false;
      console.error("[Forest] Cannot enter before the forest model is ready:", error);
    });
  }

  private enterImmediately(): void {
    if (this.active) return;

    this.active = true;
    (window as any).isForestActive = true;
    (window as any).forestPuzzleSolved = false;
    hideAllMarkers();

    this.savedClassroomVisibility = this.classroomObjects.map(object => ({
      object,
      visible: object.visible,
    }));

    for (const { object } of this.savedClassroomVisibility) {
      object.visible = false;
    }

    this.root.visible = true;

    // Player faces the front (+z) where the puzzle assembly is mounted.
    this.playerObject.position.set(0, 0, -1.0);
    this.playerObject.rotation.set(0, Math.PI, 0);
    this.playerObject.updateMatrixWorld(true);

    socket.emit("studentJoinLab", {});
    socket.emit("labProgressUpdated", {
      status: "working",
      completedCards: 0,
      totalCards: 1,
      correctAnswers: 0,
      wrongAnswers: 0,
      score: 0,
      streak: 0,
      accuracy: 0,
      durationSeconds: 0,
    });

    console.log("[Forest] Entered forest clearing.");
  }

  returnToClassroom(reason = "instructor_return"): void {
    if (!this.active || this.transitionInProgress) return;

    this.transitionInProgress = true;
    this.performTransition(() => {
      this.transitionInProgress = false;
      this.returnImmediately(reason);
    });
  }

  private returnImmediately(reason: string): void {
    if (!this.active) return;

    this.active = false;
    (window as any).isForestActive = false;
    this.root.visible = false;

    for (const { object, visible } of this.savedClassroomVisibility) {
      object.visible = visible;
    }

    window.dispatchEvent(new CustomEvent("restoreClassroomSeat"));

    const solved = (window as any).forestPuzzleSolved === true;
    (window as any).forestPuzzleSolved = false;

    const result = solved
      ? {
          status: "completed" as const,
          score: 100,
          streak: 1,
          completedCards: 1,
          totalCards: 1,
          correctAnswers: 1,
          wrongAnswers: 0,
          accuracy: 100,
          durationSeconds: 0,
        }
      : {
          status: "incomplete" as const,
          score: 0,
          streak: 0,
          completedCards: 0,
          totalCards: 1,
          correctAnswers: 0,
          wrongAnswers: 0,
          accuracy: 0,
          durationSeconds: 0,
        };

    socket.emit("labReturnConfirmed", {
      reason: solved ? "student_completed" : reason,
      result,
    });

    console.log("[Forest] Returned to classroom.");
  }

  private performTransition(action: () => void): void {
    const transition =
      (window as any).performEnvironmentTransition as
        ((action: () => void) => Promise<void>) | undefined;

    if (transition) {
      void transition(action);
      return;
    }

    action();
  }

  // ── Forest environment ───────────────────────────────────────

  private buildForest(): Promise<void> {
    // Simple ground plane as a base
    const ground = new Mesh(
      new BoxGeometry(ROOM_WIDTH + 6, 0.1, ROOM_DEPTH + 6),
      new MeshStandardMaterial({
        color: GROUND_COLOR,
        roughness: 0.98,
      }),
    );
    ground.position.y = -0.05;
    this.root.add(ground);

    // Fireflies (point lights) near the corners for ambiance
    const halfW = ROOM_WIDTH / 2;
    const halfD = ROOM_DEPTH / 2;
    const fireflyPositions: Array<[number, number]> = [
      [-halfW + 1.5, -halfD + 1.5],
      [halfW - 1.5, -halfD + 1.5],
      [-halfW + 1.5, halfD - 1.5],
      [halfW - 1.5, halfD - 1.5],
    ];
    for (const [fx, fz] of fireflyPositions) {
      const light = new PointLight(FIREFLY_COLOR, 1.8, 10, 1.5);
      light.position.set(fx, 2.5, fz);
      this.root.add(light);

      // Glowing firefly sphere
      const firefly = new Mesh(
        new SphereGeometry(0.06, 8, 8),
        new MeshStandardMaterial({
          color: FIREFLY_COLOR,
          emissive: FIREFLY_COLOR,
          emissiveIntensity: 1.0,
          roughness: 0.3,
        }),
      );
      firefly.position.set(fx, 2.5, fz);
      this.root.add(firefly);
    }

    // Match the full clearing footprint, including the enlarged puzzle props.
    return loadForestModel(Math.max(ROOM_WIDTH, ROOM_DEPTH) + 6).then((model) => {
      // Push the forest scenery back so the puzzle assembly near the player
      // sits in an open clearing instead of being occluded by tree meshes.
      model.position.z += 4;
      this.root.add(model);
      console.log("[Forest] 3D forest model and texture ready.");
    });
  }

  // ── Network ─────────────────────────────────────────────────

  private connectNetwork(): void {
    socket.on("gameChanged", data => {
      if (data?.gameId === "python-puzzle-3") {
        this.enter();
      }
    });
  }
}

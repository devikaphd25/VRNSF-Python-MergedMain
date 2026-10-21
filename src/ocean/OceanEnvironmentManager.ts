/**
 * Owns the underwater ocean scene lifecycle for the "Python Puzzle 2" activity.
 * Builds a procedural ocean environment with coral, fish, and bubbles,
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
import { buildProceduralOcean } from "./proceduralOcean.js";
import { OceanVisibleInteractionSystem } from "./OceanVisibleInteractionSystem.js";

import { socket } from "../network/socket";
import { hideAllMarkers } from "../components/instructor/seat-markers";
import { setOceanRoot } from "./oceanRoot.js";
import { OceanJigsawBlock, OceanJigsawButton } from "./jigsaw/oceanJigsawComponents.js";
import { OceanJigsawPuzzleSystem } from "./jigsaw/OceanJigsawPuzzleSystem.js";

type VisibilityRecord = {
  object: Object3D;
  visible: boolean;
};

// ── Ocean palette ─────────────────────────────────────────────
const FLOOR_COLOR = 0xc2b280;
const GLOW_COLOR = 0x4dabc0;

const ROOM_WIDTH = 10;
const ROOM_DEPTH = 10;

export class OceanEnvironmentManager {
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

    this.root.name = "OceanSceneRoot";
    this.root.visible = false;
    const rootEntity = this.world.createTransformEntity(this.root);

    setOceanRoot(this.root, rootEntity);
    this.installJigsaw();

    this.modelReady = this.buildOcean();
    void this.modelReady.catch((error) => {
      console.error("[Ocean] Failed to build ocean scene:", error);
    });
    this.connectNetwork();
    this.connectExitHandler();
  }

  private installJigsaw(): void {
    // Castle, forest and ocean share the same guard and saved input settings.
    if (!this.world.hasSystem(OceanVisibleInteractionSystem)) {
      this.world.registerSystem(OceanVisibleInteractionSystem, { priority: -5 });
    }
    this.world
      .registerComponent(OceanJigsawBlock)
      .registerComponent(OceanJigsawButton)
      .registerSystem(OceanJigsawPuzzleSystem);
  }

  private connectExitHandler(): void {
    window.addEventListener("oceanExitRequested", () => {
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
      console.error("[Ocean] Cannot enter before the ocean model is ready:", error);
    });
  }

  private enterImmediately(): void {
    if (this.active) return;

    this.active = true;
    (window as any).isOceanActive = true;
    (window as any).oceanPuzzleSolved = false;
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

    console.log("[Ocean] Entered ocean scene.");
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
    (window as any).isOceanActive = false;
    this.root.visible = false;

    for (const { object, visible } of this.savedClassroomVisibility) {
      object.visible = visible;
    }

    window.dispatchEvent(new CustomEvent("restoreClassroomSeat"));

    const solved = (window as any).oceanPuzzleSolved === true;
    (window as any).oceanPuzzleSolved = false;

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

    console.log("[Ocean] Returned to classroom.");
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

  // ── Ocean environment ───────────────────────────────────────

  private buildOcean(): Promise<void> {
    // Sandy floor
    const floor = new Mesh(
      new BoxGeometry(ROOM_WIDTH + 6, 0.1, ROOM_DEPTH + 6),
      new MeshStandardMaterial({
        color: FLOOR_COLOR,
        roughness: 0.98,
      }),
    );
    floor.position.y = -0.05;
    this.root.add(floor);

    // Ambient glow points (bioluminescent spots) near the corners
    const halfW = ROOM_WIDTH / 2;
    const halfD = ROOM_DEPTH / 2;
    const glowPositions: Array<[number, number]> = [
      [-halfW + 1.5, -halfD + 1.5],
      [halfW - 1.5, -halfD + 1.5],
      [-halfW + 1.5, halfD - 1.5],
      [halfW - 1.5, halfD - 1.5],
    ];
    for (const [gx, gz] of glowPositions) {
      const light = new PointLight(GLOW_COLOR, 1.8, 10, 1.5);
      light.position.set(gx, 2.5, gz);
      this.root.add(light);

      const glow = new Mesh(
        new SphereGeometry(0.08, 8, 8),
        new MeshStandardMaterial({
          color: GLOW_COLOR,
          emissive: GLOW_COLOR,
          emissiveIntensity: 1.0,
          roughness: 0.3,
        }),
      );
      glow.position.set(gx, 2.5, gz);
      this.root.add(glow);
    }

    // Procedural ocean with a clearing in the centre for the puzzle assembly.
    const footprint = Math.max(ROOM_WIDTH, ROOM_DEPTH) + 6;
    const clearing = 3.5;
    const ocean = buildProceduralOcean(footprint, clearing);
    this.root.add(ocean);
    console.log("[Ocean] Procedural ocean ready.");
    return Promise.resolve();
  }

  // ── Network ─────────────────────────────────────────────────

  private connectNetwork(): void {
    socket.on("gameChanged", data => {
      if (data?.gameId === "python-puzzle-2") {
        this.enter();
      }
    });
  }
}

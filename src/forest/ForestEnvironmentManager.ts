/**
 * Owns the forest scene lifecycle for the "Python Puzzle 3" activity.
 * Builds a forest clearing from Three.js primitives (no external GLB needed),
 * hides classroom objects while active, and restores them on return.
 * Animals (bunnies, deer, foxes, birds) are scattered around the clearing.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  type World,
} from "@iwsdk/core";
import type { Object3D } from "three";

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
const TRUNK_COLOR = 0x5a3a1a;
const LEAF_COLOR = 0x2d6a4f;
const LEAF_DARK = 0x1b4332;
const LEAF_LIGHT = 0x52b788;
const FIREFLY_COLOR = 0xfff3a0;
const BARK_DARK = 0x3a2a1a;

const ROOM_WIDTH = 10;
const ROOM_DEPTH = 10;
const TREE_HEIGHT = 7;
const TREE_RADIUS = 0.35;

export class ForestEnvironmentManager {
  private readonly root = new Group();
  private readonly classroomObjects: Object3D[];
  private readonly playerObject: Object3D;
  private savedClassroomVisibility: VisibilityRecord[] = [];
  private active = false;
  private transitionInProgress = false;

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
    this.world.createTransformEntity(this.root);

    setForestRoot(this.root);
    this.installJigsaw();

    this.buildForest();
    this.connectNetwork();
    this.connectExitHandler();
  }

  private installJigsaw(): void {
    this.world
      .registerComponent(ForestJigsawBlock)
      .registerComponent(ForestJigsawButton)
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
    this.performTransition(() => {
      this.transitionInProgress = false;
      this.enterImmediately();
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

  // ── Forest geometry ──────────────────────────────────────────

  private buildForest(): void {
    const groundMat = new MeshStandardMaterial({
      color: GROUND_COLOR,
      roughness: 0.98,
    });
    const trunkMat = new MeshStandardMaterial({
      color: TRUNK_COLOR,
      roughness: 0.95,
    });
    const barkDarkMat = new MeshStandardMaterial({
      color: BARK_DARK,
      roughness: 0.92,
    });
    const leafMat = new MeshStandardMaterial({
      color: LEAF_COLOR,
      roughness: 0.85,
    });
    const leafDarkMat = new MeshStandardMaterial({
      color: LEAF_DARK,
      roughness: 0.85,
    });
    const leafLightMat = new MeshStandardMaterial({
      color: LEAF_LIGHT,
      roughness: 0.8,
    });

    // Ground
    const ground = new Mesh(
      new BoxGeometry(ROOM_WIDTH + 6, 0.1, ROOM_DEPTH + 6),
      groundMat,
    );
    ground.position.y = -0.05;
    this.root.add(ground);

    // Surrounding trees forming the perimeter
    const halfW = ROOM_WIDTH / 2;
    const halfD = ROOM_DEPTH / 2;
    const treeSpacing = 2.0;

    // Back wall of trees
    for (let x = -halfW - 1; x <= halfW + 1; x += treeSpacing) {
      this.root.add(this.makeTree(x, -halfD - 0.5, trunkMat, leafMat, leafDarkMat, leafLightMat));
    }
    // Left wall of trees
    for (let z = -halfD; z <= halfD; z += treeSpacing) {
      this.root.add(this.makeTree(-halfW - 0.5, z, trunkMat, leafMat, leafDarkMat, leafLightMat));
    }
    // Right wall of trees
    for (let z = -halfD; z <= halfD; z += treeSpacing) {
      this.root.add(this.makeTree(halfW + 0.5, z, trunkMat, leafMat, leafDarkMat, leafLightMat));
    }
    // Front — leave a gap for the entrance, trees on either side
    const frontGap = 3;
    for (let x = -halfW - 1; x < -frontGap / 2; x += treeSpacing) {
      this.root.add(this.makeTree(x, halfD + 0.5, trunkMat, leafMat, leafDarkMat, leafLightMat));
    }
    for (let x = frontGap / 2; x <= halfW + 1; x += treeSpacing) {
      this.root.add(this.makeTree(x, halfD + 0.5, trunkMat, leafMat, leafDarkMat, leafLightMat));
    }

    // Scattered background trees for depth
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const r = 7 + Math.random() * 2;
      this.root.add(this.makeTree(
        Math.cos(angle) * r,
        Math.sin(angle) * r - 2,
        trunkMat, leafMat, leafDarkMat, leafLightMat,
      ));
    }

    // Fireflies (point lights) near the corners
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

    // Animals scattered around the clearing
    this.createBunny(-2.0, 2.0);
    this.createBunny(1.5, -1.5);
    this.createDeer(2.5, 1.0);
    this.createDeer(-2.5, -1.0);
    this.createFox(1.0, 2.5);
    this.createFox(-1.5, -2.5);
    this.createBird(-3.0, 3.0, 2.5);
    this.createBird(3.0, -3.0, 3.0);
    this.createBird(0, 3.5, 3.5);
  }

  private makeTree(
    x: number,
    z: number,
    trunkMat: MeshStandardMaterial,
    leafMat: MeshStandardMaterial,
    leafDarkMat: MeshStandardMaterial,
    leafLightMat: MeshStandardMaterial,
  ): Group {
    const tree = new Group();
    const scale = 0.8 + Math.random() * 0.4;

    // Trunk
    const trunk = new Mesh(
      new CylinderGeometry(TREE_RADIUS * scale * 0.8, TREE_RADIUS * scale, TREE_HEIGHT * scale, 10),
      trunkMat,
    );
    trunk.position.y = (TREE_HEIGHT * scale) / 2;
    tree.add(trunk);

    // Foliage — three stacked cones
    const foliageMats = [leafMat, leafDarkMat, leafLightMat];
    for (let i = 0; i < 3; i++) {
      const r = (2.2 - i * 0.5) * scale;
      const h = 2.0 * scale;
      const foliage = new Mesh(
        new ConeGeometry(r, h, 10),
        foliageMats[i % 3],
      );
      foliage.position.y = TREE_HEIGHT * scale - 0.3 + i * 1.2 * scale;
      tree.add(foliage);
    }

    tree.position.set(x, 0, z);
    return tree;
  }

  // ── Animals ──────────────────────────────────────────────────

  private createBunny(x: number, z: number): void {
    const bunny = new Group();
    const furMat = new MeshStandardMaterial({ color: 0xe8d5b5, roughness: 0.9 });
    const earMat = new MeshStandardMaterial({ color: 0xd4b896, roughness: 0.9 });
    const noseMat = new MeshStandardMaterial({ color: 0xe88b8b, roughness: 0.6 });

    // Body
    const body = new Mesh(new SphereGeometry(0.15, 10, 10), furMat);
    body.position.y = 0.2;
    body.scale.y = 0.8;
    bunny.add(body);

    // Head
    const head = new Mesh(new SphereGeometry(0.1, 10, 10), furMat);
    head.position.set(0, 0.32, 0.05);
    bunny.add(head);

    // Ears
    const leftEar = new Mesh(new ConeGeometry(0.025, 0.15, 6), earMat);
    leftEar.position.set(-0.04, 0.45, 0.03);
    bunny.add(leftEar);

    const rightEar = new Mesh(new ConeGeometry(0.025, 0.15, 6), earMat);
    rightEar.position.set(0.04, 0.45, 0.03);
    bunny.add(rightEar);

    // Nose
    const nose = new Mesh(new SphereGeometry(0.015, 6, 6), noseMat);
    nose.position.set(0, 0.3, 0.13);
    bunny.add(nose);

    // Tail
    const tail = new Mesh(new SphereGeometry(0.04, 6, 6), furMat);
    tail.position.set(0, 0.18, -0.12);
    bunny.add(tail);

    bunny.position.set(x, 0, z);
    bunny.lookAt(0, 0.3, -1.0);
    this.root.add(bunny);
  }

  private createDeer(x: number, z: number): void {
    const deer = new Group();
    const bodyMat = new MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.85 });
    const legMat = new MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.85 });
    const antlerMat = new MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.8 });

    // Body
    const body = new Mesh(new BoxGeometry(0.35, 0.2, 0.15), bodyMat);
    body.position.y = 0.45;
    deer.add(body);

    // Neck
    const neck = new Mesh(new CylinderGeometry(0.05, 0.07, 0.2, 8), bodyMat);
    neck.position.set(0.12, 0.55, 0);
    neck.rotation.z = -Math.PI / 4;
    deer.add(neck);

    // Head
    const head = new Mesh(new BoxGeometry(0.12, 0.1, 0.1), bodyMat);
    head.position.set(0.2, 0.65, 0);
    deer.add(head);

    // Antlers
    const leftAntler = new Mesh(new ConeGeometry(0.02, 0.15, 4), antlerMat);
    leftAntler.position.set(0.2, 0.78, -0.04);
    leftAntler.rotation.z = -0.3;
    deer.add(leftAntler);

    const rightAntler = new Mesh(new ConeGeometry(0.02, 0.15, 4), antlerMat);
    rightAntler.position.set(0.2, 0.78, 0.04);
    rightAntler.rotation.z = -0.3;
    deer.add(rightAntler);

    // Legs
    const legPositions: Array<[number, number]> = [
      [-0.12, 0.05], [0.12, 0.05], [-0.12, -0.05], [0.12, -0.05],
    ];
    for (const [lx, lz] of legPositions) {
      const leg = new Mesh(new CylinderGeometry(0.025, 0.025, 0.35, 6), legMat);
      leg.position.set(lx, 0.175, lz);
      deer.add(leg);
    }

    // Tail
    const tail = new Mesh(new SphereGeometry(0.03, 6, 6), bodyMat);
    tail.position.set(-0.18, 0.48, 0);
    deer.add(tail);

    deer.position.set(x, 0, z);
    deer.lookAt(0, 0.5, -1.0);
    this.root.add(deer);
  }

  private createFox(x: number, z: number): void {
    const fox = new Group();
    const bodyMat = new MeshStandardMaterial({ color: 0xd4651f, roughness: 0.8 });
    const bellyMat = new MeshStandardMaterial({ color: 0xe8a868, roughness: 0.8 });
    const earMat = new MeshStandardMaterial({ color: 0xb5451f, roughness: 0.8 });

    // Body
    const body = new Mesh(new SphereGeometry(0.12, 10, 10), bodyMat);
    body.position.y = 0.2;
    body.scale.set(1.3, 0.7, 0.8);
    fox.add(body);

    // Belly
    const belly = new Mesh(new SphereGeometry(0.08, 8, 8), bellyMat);
    belly.position.set(0, 0.15, 0.02);
    fox.add(belly);

    // Head
    const head = new Mesh(new SphereGeometry(0.07, 10, 10), bodyMat);
    head.position.set(0.13, 0.25, 0);
    head.scale.x = 1.2;
    fox.add(head);

    // Snout
    const snout = new Mesh(new ConeGeometry(0.03, 0.08, 6), bodyMat);
    snout.position.set(0.2, 0.22, 0);
    snout.rotation.z = -Math.PI / 2;
    fox.add(snout);

    // Ears (pointed)
    const leftEar = new Mesh(new ConeGeometry(0.025, 0.08, 4), earMat);
    leftEar.position.set(0.1, 0.33, -0.03);
    fox.add(leftEar);

    const rightEar = new Mesh(new ConeGeometry(0.025, 0.08, 4), earMat);
    rightEar.position.set(0.1, 0.33, 0.03);
    fox.add(rightEar);

    // Bushy tail
    const tail = new Mesh(new ConeGeometry(0.05, 0.2, 8), bodyMat);
    tail.position.set(-0.16, 0.22, 0);
    tail.rotation.z = Math.PI / 2.5;
    fox.add(tail);

    // Legs
    const legMat = new MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.85 });
    const legPositions: Array<[number, number]> = [
      [0.08, 0.05], [0.08, -0.05], [-0.08, 0.05], [-0.08, -0.05],
    ];
    for (const [lx, lz] of legPositions) {
      const leg = new Mesh(new CylinderGeometry(0.015, 0.015, 0.12, 4), legMat);
      leg.position.set(lx, 0.06, lz);
      fox.add(leg);
    }

    fox.position.set(x, 0, z);
    fox.lookAt(0, 0.3, -1.0);
    this.root.add(fox);
  }

  private createBird(x: number, z: number, y: number): void {
    const bird = new Group();
    const bodyMat = new MeshStandardMaterial({ color: 0x4a90d9, roughness: 0.7 });
    const wingMat = new MeshStandardMaterial({ color: 0x357abd, roughness: 0.7 });
    const beakMat = new MeshStandardMaterial({ color: 0xd4651f, roughness: 0.6 });

    // Body
    const body = new Mesh(new SphereGeometry(0.06, 8, 8), bodyMat);
    body.scale.set(1, 1, 1.3);
    bird.add(body);

    // Head
    const head = new Mesh(new SphereGeometry(0.04, 8, 8), bodyMat);
    head.position.set(0, 0.04, 0.06);
    bird.add(head);

    // Beak
    const beak = new Mesh(new ConeGeometry(0.01, 0.03, 4), beakMat);
    beak.position.set(0, 0.04, 0.11);
    beak.rotation.x = Math.PI / 2;
    bird.add(beak);

    // Wings
    const leftWing = new Mesh(new BoxGeometry(0.02, 0.03, 0.08), wingMat);
    leftWing.position.set(-0.05, 0, 0);
    bird.add(leftWing);

    const rightWing = new Mesh(new BoxGeometry(0.02, 0.03, 0.08), wingMat);
    rightWing.position.set(0.05, 0, 0);
    bird.add(rightWing);

    // Tail
    const tail = new Mesh(new BoxGeometry(0.02, 0.02, 0.06), wingMat);
    tail.position.set(0, 0, -0.07);
    bird.add(tail);

    // Branch under the bird
    const branchMat = new MeshStandardMaterial({ color: 0x4a3a1a, roughness: 0.9 });
    const branch = new Mesh(new CylinderGeometry(0.02, 0.02, 0.3, 6), branchMat);
    branch.position.y = -0.08;
    branch.rotation.z = Math.PI / 2;
    bird.add(branch);

    bird.position.set(x, y, z);
    bird.lookAt(0, y, -1.0);
    this.root.add(bird);
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

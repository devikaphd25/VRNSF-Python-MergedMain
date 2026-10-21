/**
 * Python Jigsaw Puzzle system for the forest environment.
 *
 * Creates grabbable code-line blocks, a slotted board on a tree trunk,
 * control buttons (indent / dedent / reset / exit / submit), an owl
 * holding an instructions board, a feedback panel, and a falling-leaf
 * celebration animation.  The player grabs blocks via raycast, drops
 * them into board slots, adjusts indentation, and submits to validate
 * the assembled Python program.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DistanceGrabbable,
  DoubleSide,
  Grabbed,
  Group,
  Hovered,
  Interactable,
  Mesh,
  MeshStandardMaterial,
  MovementMode,
  PanelDocument,
  PanelUI,
  PlaneGeometry,
  Pressed,
  RayInteractable,
  SphereGeometry,
  type UIKitDocument,
  Vector3,
  createSystem,
  type Entity,
} from "@iwsdk/core";
import type { Object3D } from "three";
import { ForestJigsawBlock, ForestJigsawButton } from "./forestJigsawComponents.js";
import { FOREST_PUZZLE_LINES, FOREST_SHUFFLED_ORDER, FOREST_EXPECTED_OUTPUT } from "./forestPuzzleData.js";
import { attachToForestRoot, createForestEntity } from "../forestRoot.js";
import { createJigsawBlockGeometry, jigsawPieceEdges } from "../../utils/jigsaw-block.js";
import { setTextSafe } from "../../lab/systems/uiText.js";
import { runForestPython } from "./forestPythonRunner.js";
import { socket } from "../../network/socket";

// ── Layout ────────────────────────────────────────────────────
const S = 2.2;
const BOARD_CENTER: [number, number, number] = [0, 1.4, 4.5];
const BOARD_WIDTH = 1.6 * S;
const BOARD_HEIGHT = 1.6 * S;
const SLOT_HEIGHT = 0.17 * S;
const NUM_SLOTS = 7;

const BLOCK_WIDTH = 0.9 * S;
const BLOCK_HEIGHT = 0.14 * S;
const BLOCK_THICKNESS = 0.05 * S;
const INDENT_SHIFT = 0.15 * S;
const BLOCK_BEVEL = 0.004 * S;

// Each seam is keyed to the correct code sequence (see utils/jigsaw-block.ts),
// and the knob stays shorter than the gap between two slots so a shuffled block
// never pokes into its neighbour on the shelf.
const SLOT_GAP = SLOT_HEIGHT - BLOCK_HEIGHT;
const KNOB_RADIUS = SLOT_GAP * 0.9;

// The feedback panel (wrong output / Python errors) sits directly on top of the
// centre board, where the player is already looking. It used to hang at
// 2.3 * S = 5.06 m, far above the board and out of the player's view.
const FEEDBACK_HEIGHT = 0.6 * S;
const FEEDBACK_Y =
  BOARD_CENTER[1] + BOARD_HEIGHT / 2 + FEEDBACK_HEIGHT / 2 + 0.06 * S;

const SHELF_X = 2.8;
const SHELF_Z = 1.0;
const SHELF_ROTATION_Y = Math.PI / 2;

const BUTTON_X = -(BOARD_WIDTH / 2 + 0.22 * S);
const BUTTON_Z = BOARD_CENTER[2];
const BUTTON_SPACING = 0.24 * S;
const BUTTON_SIZE = 0.14 * S;

const BIRD_X = -3.5 * S;
const BIRD_Z = 1.5 * S;
const BIRD_Y = 2.0 * S;

// ── Forest Colours ─────────────────────────────────────────────
const BLOCK_COLOR = 0x8b6f47;      // wood brown
const BOARD_COLOR = 0x3a5a3a;      // dark forest green
const SLOT_COLOR = 0x4a6a4a;
const LEAF_COLORS = [0xd4651f, 0xe8a838, 0xc04e1f, 0x6b8e23, 0x8baa3a];
const ACTIVE_GLOW = 0x7fdf6a;
const DISABLED_BUTTON_COLOR = 0x6b7280; // greyed-out control on a solved board

const BUTTON_CONFIGS: {
  type: "indent" | "dedent" | "reset" | "exit" | "submit";
  label: string;
  color: number;
}[] = [
  { type: "indent", label: "Indent", color: 0x2d6a4f },
  { type: "dedent", label: "Dedent", color: 0x1b4332 },
  { type: "reset", label: "Reset", color: 0xb5651d },
  { type: "exit", label: "Exit", color: 0x991b1b },
  { type: "submit", label: "Submit", color: 0x52796f },
];

export class ForestJigsawPuzzleSystem extends createSystem({
  blocks: { required: [ForestJigsawBlock] },
  buttons: { required: [ForestJigsawButton] },
  pressed: { required: [ForestJigsawButton, Pressed] },
  heldBlocks: { required: [ForestJigsawBlock, Grabbed] },
}) {
  private slotPositions: Vector3[] = [];
  private homePositions: Map<number, [number, number, number]> = new Map();
  private activeBlockOriginalIndex = -1;
  private blockEntities: Map<number, Entity> = new Map();
  private blockMaterials: Map<number, MeshStandardMaterial> = new Map();
  private feedbackEntity: Entity | null = null;
  private feedbackEntityIndex = -1;
  private feedbackDoc: UIKitDocument | null = null;
  private pendingFeedback: { title: string; body: string } | null = null;
  private instructionsEntity: Entity | null = null;
  private instructionsEntityIndex = -1;
  private instructionsDoc: UIKitDocument | null = null;
  private pendingInstructions: Record<string, string> | null = null;
  private pendingBlockText: Map<number, string> = new Map();
  private pendingButtonLabels: Map<number, string> = new Map();
  private leaves: { mesh: Mesh; velocity: Vector3; life: number }[] = [];
  private leafAnimation = false;
  private tmpVec = new Vector3();
  private animatingBlocks: Map<number, { entity: Entity; targetPos: Vector3; targetRotY: number }> = new Map();
  private tmpLerp = new Vector3();
  /** Set once the puzzle is solved: blocks and every button except Exit stop responding. */
  private solved = false;
  private environmentActive = false;
  private lockedHitTest = new Map<
    Object3D,
    { pointerEvents: Object3D["pointerEvents"]; intersectChildren: boolean | undefined }
  >();
  private buttonMaterials = new Map<number, MeshStandardMaterial>();

  // ── Lifecycle ──────────────────────────────────────────────

  init() {
    this.tmpVec = new Vector3();

    const startY =
      BOARD_CENTER[1] + BOARD_HEIGHT / 2 - SLOT_HEIGHT / 2;
    for (let i = 0; i < NUM_SLOTS; i++) {
      this.slotPositions.push(
        new Vector3(
          BOARD_CENTER[0],
          startY - i * SLOT_HEIGHT,
          BOARD_CENTER[2],
        ),
      );
    }

    for (let i = 0; i < NUM_SLOTS; i++) {
      const origIdx = FOREST_SHUFFLED_ORDER[i];
      this.homePositions.set(origIdx, [
        SHELF_X,
        startY - i * SLOT_HEIGHT,
        SHELF_Z,
      ]);
    }

    this.buildBoard();
    this.createBlocks();
    this.createButtons();
    this.createBird();
    this.createFeedbackPanel();

    this.queries.heldBlocks.subscribe("qualify", (block) => {
      const slot = block.getValue(ForestJigsawBlock, "slotIndex") ?? -1;
      if (slot >= 0) {
        block.setValue(ForestJigsawBlock, "slotIndex", -1);
      }
      // Reset rotation so the block faces the board while held,
      // making it easy to align with board slots.
      block.object3D!.rotation.set(0, 0, 0);
      block.object3D!.updateMatrixWorld(true);
    });

    this.queries.heldBlocks.subscribe("disqualify", (block) => {
      try {
        this.handleBlockRelease(block);
      } catch (err) {
        console.error("[ForestJigsaw] Block release error (non-fatal):", err);
      }
    });

    this.queries.pressed.subscribe("qualify", (button) => {
      try {
        this.handleButtonPress(button);
      } catch (err) {
        console.error("[ForestJigsaw] Button press error (non-fatal):", err);
      }
    });

    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number) {
    try {
      this.updateInner(delta);
    } catch (err) {
      console.error("[ForestJigsaw] Update error (non-fatal):", err);
    }
  }

  private updateInner(delta: number): void {
    const docs = PanelDocument.data?.document;
    if (docs) {
      for (const [faceIndex, text] of this.pendingBlockText) {
        const doc = docs[faceIndex] as UIKitDocument | undefined;
        if (doc) {
          setTextSafe(doc, "code", text);
          this.pendingBlockText.delete(faceIndex);
        }
      }

      for (const [labelIndex, label] of this.pendingButtonLabels) {
        const doc = docs[labelIndex] as UIKitDocument | undefined;
        if (doc) {
          doc.position.z = BUTTON_SIZE * 0.38;
          setTextSafe(doc, "label", label);
          this.pendingButtonLabels.delete(labelIndex);
        }
      }

      if (this.feedbackEntityIndex >= 0 && !this.feedbackDoc) {
        const doc = docs[this.feedbackEntityIndex] as
          | UIKitDocument
          | undefined;
        if (doc) {
          this.feedbackDoc = doc;
        }
      }

      if (this.instructionsEntityIndex >= 0 && !this.instructionsDoc) {
        const doc = docs[this.instructionsEntityIndex] as
          | UIKitDocument
          | undefined;
        if (doc) {
          this.instructionsDoc = doc;
        }
      }
    }

    if (this.instructionsDoc && this.pendingInstructions) {
      for (const [id, text] of Object.entries(this.pendingInstructions)) {
        setTextSafe(this.instructionsDoc, id, text);
      }
      this.pendingInstructions = null;
    }

    if (this.feedbackDoc && this.pendingFeedback) {
      setTextSafe(
        this.feedbackDoc,
        "feedback-title",
        this.pendingFeedback.title,
      );
      setTextSafe(
        this.feedbackDoc,
        "feedback-body",
        this.pendingFeedback.body,
      );
      this.pendingFeedback = null;
    }

    // Smoothly lerp blocks toward their target positions (placement / home / indent).
    for (const [idx, anim] of this.animatingBlocks) {
      if (anim.entity.hasComponent(Grabbed)) {
        this.animatingBlocks.delete(idx);
        continue;
      }
      const obj = anim.entity.object3D!;
      this.tmpLerp.copy(obj.position).lerp(anim.targetPos, 0.15);
      obj.position.copy(this.tmpLerp);
      let diff = anim.targetRotY - obj.rotation.y;
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;
      obj.rotation.y += diff * 0.15;
      obj.updateMatrixWorld(true);
      if (obj.position.distanceTo(anim.targetPos) < 0.01 && Math.abs(diff) < 0.01) {
        obj.position.copy(anim.targetPos);
        obj.rotation.set(0, anim.targetRotY, 0);
        obj.updateMatrixWorld(true);
        this.animatingBlocks.delete(idx);
      }
    }

    const active = (window as any).isForestActive === true;
    if (active !== this.environmentActive) {
      this.environmentActive = active;
      // Entering the clearing starts a fresh attempt, so the lock applied by
      // lockSolvedPuzzle is lifted again (this system runs after the shared
      // visibility guard, which restores the settings it saved while hidden).
      if (active) this.unlockSolvedPuzzle();
    }
    if (!active) return;

    if (this.leafAnimation) {
      this.updateLeaves(delta);
    }

    this.updateActiveBlockHighlight();
  }

  // ── Board (mounted on a tree trunk) ────────────────────────

  private buildBoard(): void {
    const boardGroup = new Group();

    // Board panel (wooden plank)
    const boardMat = new MeshStandardMaterial({
      color: BOARD_COLOR,
      roughness: 0.85,
    });
    const board = new Mesh(
      new BoxGeometry(BOARD_WIDTH, BOARD_HEIGHT, 0.04 * S),
      boardMat,
    );
    board.position.z = 0.02 * S;
    boardGroup.add(board);

    boardGroup.position.set(
      BOARD_CENTER[0],
      BOARD_CENTER[1],
      BOARD_CENTER[2],
    );
    attachToForestRoot(boardGroup);
  }

  // ── Blocks ────────────────────────────────────────────────

  private createBlocks(): void {
    // Cuts keyed to the correct line order, so only true neighbours interlock.
    const pieceEdges = jigsawPieceEdges(FOREST_PUZZLE_LINES);

    for (let i = 0; i < NUM_SLOTS; i++) {
      const origIdx = FOREST_SHUFFLED_ORDER[i];
      const line = FOREST_PUZZLE_LINES[origIdx];

      const group = new Group();

      const bodyMat = new MeshStandardMaterial({
        color: BLOCK_COLOR,
        roughness: 0.75,
      });
      const body = new Mesh(
        createJigsawBlockGeometry(
          BLOCK_WIDTH,
          BLOCK_HEIGHT,
          BLOCK_THICKNESS,
          pieceEdges[origIdx],
          { knobRadius: KNOB_RADIUS, bevel: BLOCK_BEVEL },
        ),
        bodyMat,
      );
      group.add(body);

      const block = createForestEntity(this.world, group);
      attachToForestRoot(group);
      block.addComponent(ForestJigsawBlock, {
        lineId: line.id,
        text: line.text,
        slotIndex: -1,
        indent: 0,
        originalIndex: origIdx,
        faceEntity: null,
      });
      block.addComponent(RayInteractable);
      block.addComponent(DistanceGrabbable, {
        rotate: false,
        translate: true,
        movementMode: MovementMode.MoveFromTarget,
        returnToOrigin: false,
        detachOnGrab: false,
      });

      const face = this.world.createTransformEntity(undefined, {
        parent: block,
      });
      face.addComponent(PanelUI, {
        config: "./ui/jigsaw-block.json",
        maxWidth: BLOCK_WIDTH,
        maxHeight: BLOCK_HEIGHT,
      });
      face.object3D!.position.set(
        0,
        0,
        -(BLOCK_THICKNESS / 2 + 0.006 * S),
      );
      face.object3D!.rotation.y = Math.PI;
      block.setValue(ForestJigsawBlock, "faceEntity", face);

      const home = this.homePositions.get(origIdx)!;
      group.position.set(home[0], home[1], home[2]);
      group.rotation.y = SHELF_ROTATION_Y;

      this.blockEntities.set(origIdx, block);
      this.blockMaterials.set(origIdx, bodyMat);
      this.setBlockText(block);
    }
  }

  // ── Buttons ───────────────────────────────────────────────

  private createButtons(): void {
    const startY =
      BOARD_CENTER[1] +
      ((BUTTON_CONFIGS.length - 1) * BUTTON_SPACING) / 2;

    for (let i = 0; i < BUTTON_CONFIGS.length; i++) {
      const config = BUTTON_CONFIGS[i];
      const group = new Group();

      const buttonMat = new MeshStandardMaterial({
        color: config.color,
        roughness: 0.6,
        emissive: config.color,
        emissiveIntensity: 0.15,
      });
      const button = new Mesh(
        new BoxGeometry(
          BUTTON_SIZE * 1.8,
          BUTTON_SIZE * 0.55,
          BUTTON_SIZE * 0.7,
        ),
        buttonMat,
      );
      group.add(button);

      // Wooden base under each button
      const base = new Mesh(
        new BoxGeometry(
          BUTTON_SIZE * 2.0,
          BUTTON_SIZE * 0.12,
          BUTTON_SIZE * 0.9,
        ),
        new MeshStandardMaterial({
          color: 0x4a3a1a,
          roughness: 0.85,
        }),
      );
      base.position.y = -BUTTON_SIZE * 0.34;
      group.add(base);

      const entity = createForestEntity(this.world, group);
      attachToForestRoot(group);
      entity.addComponent(ForestJigsawButton, {
        buttonType: config.type,
      });
      // The visible label and physical button share the same input entity.
      // Controller rays and hand pokes therefore produce Pressed on the entity
      // carrying ForestJigsawButton, rather than on a separate label root.
      entity.addComponent(Interactable);
      entity.addComponent(PanelUI, {
        config: "./ui/jigsaw-button.json",
        maxWidth: BUTTON_SIZE * 2.2,
        maxHeight: BUTTON_SIZE * 0.7,
      });
      this.buttonMaterials.set(entity.index, buttonMat);
      group.name = `ForestButton-${config.type}`;
      group.position.set(
        BUTTON_X,
        startY - i * BUTTON_SPACING,
        BUTTON_Z,
      );
      group.rotation.y = Math.PI;
      this.pendingButtonLabels.set(entity.index, config.label);
    }
  }

  // ── Bird holding instructions board ───────────────────────

  private createBird(): void {
    const bird = new Group();

    const bodyMat = new MeshStandardMaterial({
      color: 0x2a6db5,
      roughness: 0.7,
    });
    const bellyMat = new MeshStandardMaterial({
      color: 0xe8a838,
      roughness: 0.75,
    });
    const wingMat = new MeshStandardMaterial({
      color: 0x1a4f8a,
      roughness: 0.7,
    });
    const beakMat = new MeshStandardMaterial({
      color: 0xe8a838,
      roughness: 0.5,
    });
    const eyeMat = new MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.3,
    });
    const eyeWhiteMat = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
    });

    // Body (oval)
    const body = new Mesh(
      new SphereGeometry(0.28 * S, 16, 16),
      bodyMat,
    );
    body.scale.set(1, 1.3, 1.4);
    bird.add(body);

    // Belly patch (lighter underside)
    const belly = new Mesh(
      new SphereGeometry(0.22 * S, 12, 12),
      bellyMat,
    );
    belly.position.set(0, -0.04 * S, -0.08 * S);
    belly.scale.set(0.9, 1.1, 1.2);
    bird.add(belly);

    // Head (smaller sphere on top)
    const head = new Mesh(
      new SphereGeometry(0.18 * S, 14, 14),
      bodyMat,
    );
    head.position.set(0, 0.32 * S, 0.08 * S);
    bird.add(head);

    // Eyes — white spheres with black pupils
    const leftEyeWhite = new Mesh(
      new SphereGeometry(0.06 * S, 10, 10),
      eyeWhiteMat,
    );
    leftEyeWhite.position.set(-0.09 * S, 0.35 * S, 0.16 * S);
    bird.add(leftEyeWhite);

    const rightEyeWhite = new Mesh(
      new SphereGeometry(0.06 * S, 10, 10),
      eyeWhiteMat,
    );
    rightEyeWhite.position.set(0.09 * S, 0.35 * S, 0.16 * S);
    bird.add(rightEyeWhite);

    const leftPupil = new Mesh(
      new SphereGeometry(0.03 * S, 8, 8),
      eyeMat,
    );
    leftPupil.position.set(-0.09 * S, 0.35 * S, 0.21 * S);
    bird.add(leftPupil);

    const rightPupil = new Mesh(
      new SphereGeometry(0.03 * S, 8, 8),
      eyeMat,
    );
    rightPupil.position.set(0.09 * S, 0.35 * S, 0.21 * S);
    bird.add(rightPupil);

    // Beak — the bird holds the board in its beak
    const upperBeak = new Mesh(
      new ConeGeometry(0.05 * S, 0.14 * S, 8),
      beakMat,
    );
    upperBeak.position.set(0, 0.28 * S, 0.24 * S);
    upperBeak.rotation.x = -Math.PI / 2;
    bird.add(upperBeak);

    const lowerBeak = new Mesh(
      new ConeGeometry(0.04 * S, 0.1 * S, 8),
      beakMat,
    );
    lowerBeak.position.set(0, 0.22 * S, 0.22 * S);
    lowerBeak.rotation.x = -Math.PI / 2;
    bird.add(lowerBeak);

    // Wings (spread for floating look)
    const leftWing = new Mesh(
      new SphereGeometry(0.2 * S, 10, 10),
      wingMat,
    );
    leftWing.position.set(-0.3 * S, 0.05 * S, 0);
    leftWing.scale.set(0.25, 0.7, 1.0);
    leftWing.rotation.z = 0.3;
    bird.add(leftWing);

    const rightWing = new Mesh(
      new SphereGeometry(0.2 * S, 10, 10),
      wingMat,
    );
    rightWing.position.set(0.3 * S, 0.05 * S, 0);
    rightWing.scale.set(0.25, 0.7, 1.0);
    rightWing.rotation.z = -0.3;
    bird.add(rightWing);

    // Tail feathers
    const tail = new Mesh(
      new ConeGeometry(0.12 * S, 0.3 * S, 8),
      wingMat,
    );
    tail.position.set(0, 0, -0.3 * S);
    tail.rotation.x = Math.PI / 2;
    bird.add(tail);

    // Position the bird floating on the right side, facing the user
    bird.position.set(BIRD_X, BIRD_Y, BIRD_Z);
    bird.lookAt(0, BIRD_Y, -1.0);
    attachToForestRoot(bird);

    // ── Instructions board held in the bird's beak ──────────
    // The board hangs just below the beak, facing the user.
    const boardX = BIRD_X;
    const boardZ = BIRD_Z + 0.05 * S;
    const boardY = BIRD_Y - 0.75 * S;

    // Board backing panel
    const boardBacking = new Mesh(
      new BoxGeometry(0.85 * S, 1.15 * S, 0.03 * S),
      new MeshStandardMaterial({
        color: 0xf5f0e6,
        roughness: 0.9,
        side: DoubleSide,
      }),
    );
    boardBacking.position.set(boardX, boardY, boardZ);
    boardBacking.lookAt(0, boardY, -1.0);
    attachToForestRoot(boardBacking);

    // Small rope/string from beak to board top
    const stringMat = new MeshStandardMaterial({
      color: 0x8a7a5a,
      roughness: 0.8,
    });
    const string = new Mesh(
      new CylinderGeometry(0.008 * S, 0.008 * S, 0.4 * S, 6),
      stringMat,
    );
    string.position.set(boardX, boardY + 0.6 * S, boardZ);
    attachToForestRoot(string);

    // PanelUI for the instruction text
    const instructionsEntity = createForestEntity(this.world);
    instructionsEntity.addComponent(PanelUI, {
      config: "./ui/forest-jigsaw-instructions.json",
      maxWidth: 0.78 * S,
      maxHeight: 1.08 * S,
    });
    instructionsEntity.object3D!.position.set(boardX, boardY, boardZ - 0.02 * S);
    instructionsEntity.object3D!.rotation.y = Math.atan2(
      0 - boardX,
      -1.0 - boardZ,
    );
    attachToForestRoot(instructionsEntity.object3D!);
    this.instructionsEntity = instructionsEntity;
    this.instructionsEntityIndex = instructionsEntity.index;

    // Queue the instruction text to be set once the PanelUI document loads
    this.pendingInstructions = {
      "instructions-title": "Python Puzzle 3",
      "instructions-body":
        "The guest list is given below. Ask for a name with input().\nIf the name is on the list, print Welcome, NAME!\n— otherwise print Sorry, NAME is not on the list.\nFinish by printing the guest count with len().\nRun it twice: once with a name on the list, once with a name that is not.",
      "instructions-given": "Given:  guests = ['Ava', 'Ben', 'Cai', 'Dee', 'Eli']",
      "instructions-expected-label": "Sample Run:",
      "instructions-expected": "Name: Cai\nWelcome, Cai!\nGuests on list: 5",
    };
  }

  // ── Feedback panel ────────────────────────────────────────

  private createFeedbackPanel(): void {
    const entity = createForestEntity(this.world);
    entity.addComponent(PanelUI, {
      config: "./ui/forest-jigsaw-feedback.json",
      maxWidth: 1.2 * S,
      maxHeight: FEEDBACK_HEIGHT,
    });
    entity.object3D!.position.set(0, FEEDBACK_Y, BOARD_CENTER[2]);
    entity.object3D!.rotation.y = Math.PI;
    attachToForestRoot(entity.object3D!);
    this.feedbackEntity = entity;
    this.feedbackEntityIndex = entity.index;
  }

  // ── Block release handling ────────────────────────────────

  private handleBlockRelease(block: Entity): void {
    const obj = block.object3D!;
    obj.getWorldPosition(this.tmpVec);

    const dz = Math.abs(this.tmpVec.z - BOARD_CENTER[2]);
    if (dz > 3.0) {
      this.returnBlockHome(block);
      return;
    }

    const dx = this.tmpVec.x - BOARD_CENTER[0];
    const dy = this.tmpVec.y - BOARD_CENTER[1];
    if (
      Math.abs(dx) > BOARD_WIDTH / 2 + 0.3 * S ||
      Math.abs(dy) > BOARD_HEIGHT / 2 + 0.3 * S
    ) {
      this.returnBlockHome(block);
      return;
    }

    let nearestSlot = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < NUM_SLOTS; i++) {
      const sdy = Math.abs(this.tmpVec.y - this.slotPositions[i].y);
      if (sdy < nearestDist) {
        nearestDist = sdy;
        nearestSlot = i;
      }
    }

    const occupyingBlock = this.findBlockInSlot(nearestSlot);
    if (occupyingBlock && occupyingBlock !== block) {
      this.returnBlockHome(occupyingBlock);
    }

    this.placeBlockInSlot(block, nearestSlot);
    this.activeBlockOriginalIndex = block.getValue(
      ForestJigsawBlock,
      "originalIndex",
    ) ?? -1;
  }

  // ── Button press handling ─────────────────────────────────

  private handleButtonPress(button: Entity): void {
    if (!(window as any).isForestActive) return;
    const buttonType = button.getValue(ForestJigsawButton, "buttonType");

    // A solved puzzle is finished: only Exit still responds.
    if (this.solved && buttonType !== "exit") return;

    switch (buttonType) {
      case "indent":
        this.handleIndent(1);
        break;
      case "dedent":
        this.handleIndent(-1);
        break;
      case "reset":
        this.handleReset();
        break;
      case "exit":
        this.handleExit();
        break;
      case "submit":
        this.handleSubmit();
        break;
    }
  }

  private handleIndent(direction: number): void {
    let targetBlock: Entity | null = null;

    for (const block of this.queries.blocks.entities) {
      if (
        block.hasComponent(Hovered) &&
        (block.getValue(ForestJigsawBlock, "slotIndex") ?? -1) >= 0
      ) {
        targetBlock = block;
        break;
      }
    }

    if (
      !targetBlock &&
      this.activeBlockOriginalIndex >= 0
    ) {
      targetBlock =
        this.blockEntities.get(this.activeBlockOriginalIndex) ?? null;
    }

    if (!targetBlock) return;

    const slot = targetBlock.getValue(ForestJigsawBlock, "slotIndex") ?? -1;
    if (slot < 0) return;

    let indent = targetBlock.getValue(ForestJigsawBlock, "indent") ?? 0;
    indent = Math.max(0, Math.min(2, indent + direction));
    targetBlock.setValue(ForestJigsawBlock, "indent", indent);

    const pos = this.slotPositions[slot];
    this.animatingBlocks.set(targetBlock.index, {
      entity: targetBlock,
      targetPos: new Vector3(pos.x - indent * INDENT_SHIFT, pos.y, pos.z),
      targetRotY: 0,
    });
    this.setBlockText(targetBlock);
  }

  private handleReset(): void {
    for (const block of this.queries.blocks.entities) {
      this.returnBlockHome(block);
    }
    this.activeBlockOriginalIndex = -1;
    this.showFeedback(
      "Reset",
      "All blocks returned to the shelf.\nTry again!",
    );
  }

  private handleExit(): void {
    window.dispatchEvent(new CustomEvent("forestExitRequested"));
  }

  private handleSubmit(): void {
    const slots: { text: string; indent: number }[] = [];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const block = this.findBlockInSlot(i);
      if (!block) {
        this.showFeedback(
          "Error",
          "SyntaxError: incomplete input\n\nNot all code blocks are placed on the board.",
        );
        return;
      }
      slots.push({
        text: block.getValue(ForestJigsawBlock, "text") ?? "",
        indent: block.getValue(ForestJigsawBlock, "indent") ?? 0,
      });
    }

    const code = slots
      .map((s) => "    ".repeat(s.indent) + s.text)
      .join("\n");

    this.showFeedback("Running…", "Executing your Python code…");
    void this.executePython(code);
  }

  private async executePython(code: string): Promise<void> {
    const result = await runForestPython(code);

    if (result.success) {
      if (result.output.trim() === FOREST_EXPECTED_OUTPUT.trim()) {
        this.showFeedback(
          "Success!",
          `Correct! The code runs successfully.\n\nOutput:\n${result.output.trim()}`,
        );
        this.showFallingLeaves();
        this.reportScoreToInstructor();
        this.lockSolvedPuzzle();
      } else {
        this.showFeedback(
          "Wrong Output",
          `The code runs but produces the wrong output.\n\nYour output:\n${result.output.trim()}\n\nExpected:\n${FOREST_EXPECTED_OUTPUT.trim()}`,
        );
      }
    } else {
      this.showFeedback("Error", result.error);
    }
  }

  /** Sends the puzzle result to the server so the instructor dashboard sees it. */
  private reportScoreToInstructor(): void {
    if ((window as any).forestPuzzleSolved) return;
    (window as any).forestPuzzleSolved = true;

    const puzzleResult = {
      status: "completed" as const,
      score: 100,
      correctAnswers: 1,
      wrongAnswers: 0,
      completedCards: 1,
      totalCards: 1,
      accuracy: 100,
      durationSeconds: 0,
    };

    socket.emit("labProgressUpdated", puzzleResult);
    socket.emit("labCompleted", { result: puzzleResult });
  }

  // ── Solved-puzzle lock ────────────────────────────────────

  /**
   * Finishes the puzzle: after a correct submission the blocks can no longer be
   * grabbed and every button except Exit stops responding, so the player cannot
   * replay the board without leaving the clearing first.
   */
  private lockSolvedPuzzle(): void {
    if (this.solved) return;
    this.solved = true;

    for (const block of this.queries.blocks.entities) {
      this.setHitTestEnabled(block.object3D, false);
    }
    for (const button of this.queries.buttons.entities) {
      if (button.getValue(ForestJigsawButton, "buttonType") === "exit") continue;
      this.setHitTestEnabled(button.object3D, false);
      this.setButtonDisabled(button, true);
    }
  }

  /** Lifts the lock so the next visit to the clearing can play the puzzle again. */
  private unlockSolvedPuzzle(): void {
    for (const object of [...this.lockedHitTest.keys()]) {
      this.setHitTestEnabled(object, true);
    }
    for (const button of this.queries.buttons.entities) {
      this.setButtonDisabled(button, false);
    }
    this.solved = false;
  }

  /**
   * Turns pointer hit testing on or off for one puzzle object, remembering the
   * settings it had. Both flags are needed: UIKit children can opt back into
   * pointer hits even under a root whose own pointer events are off.
   */
  private setHitTestEnabled(
    object: Object3D | undefined,
    enabled: boolean,
  ): void {
    if (!object) return;

    const saved = this.lockedHitTest.get(object);
    if (enabled) {
      if (!saved) return;
      object.pointerEvents = saved.pointerEvents;
      object.intersectChildren = saved.intersectChildren;
      this.lockedHitTest.delete(object);
      return;
    }

    if (!saved) {
      this.lockedHitTest.set(object, {
        pointerEvents: object.pointerEvents,
        intersectChildren: object.intersectChildren,
      });
    }
    object.pointerEvents = "none";
    object.intersectChildren = false;
  }

  /** Greys a locked button out so a finished board reads as disabled. */
  private setButtonDisabled(button: Entity, disabled: boolean): void {
    const material = this.buttonMaterials.get(button.index);
    const config = BUTTON_CONFIGS.find(
      (entry) => entry.type === button.getValue(ForestJigsawButton, "buttonType"),
    );
    if (!material || !config) return;

    material.color.setHex(disabled ? DISABLED_BUTTON_COLOR : config.color);
    material.emissive.setHex(disabled ? 0x000000 : config.color);
    material.emissiveIntensity = disabled ? 0 : 0.15;
  }

  // ── Feedback ──────────────────────────────────────────────

  private showFeedback(title: string, body: string): void {
    this.pendingFeedback = { title, body };
  }

  // ── Falling leaf celebration animation ────────────────────

  private showFallingLeaves(): void {
    this.leafAnimation = true;
    const leafGeo = new PlaneGeometry(0.04 * S, 0.06 * S);

    const playerPos = this.getPlayerPosition();
    const LEAF_COUNT = 60;
    for (let i = 0; i < LEAF_COUNT; i++) {
      const color = LEAF_COLORS[i % LEAF_COLORS.length];
      const leafMat = new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.6,
        side: DoubleSide,
        transparent: true,
      });
      const leaf = new Mesh(leafGeo, leafMat);
      const angle = (i / LEAF_COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const radius = 0.1 + Math.random() * 0.5;
      leaf.position.set(
        playerPos.x + Math.cos(angle) * radius,
        playerPos.y + 1.0,
        playerPos.z + Math.sin(angle) * radius,
      );
      const velocity = new Vector3(
        Math.cos(angle) * (1.0 + Math.random() * 1.5),
        3 + Math.random() * 3,
        Math.sin(angle) * (1.0 + Math.random() * 1.5),
      );
      this.leaves.push({ mesh: leaf, velocity, life: 2.0 });
      attachToForestRoot(leaf);
    }
  }

  private getPlayerPosition(): Vector3 {
    const player = (this.world as any)?.player;
    const obj = player?.object3D ?? player;
    if (obj?.position) {
      return new Vector3(obj.position.x, obj.position.y, obj.position.z);
    }
    return new Vector3(0, 0, -1.0);
  }

  private updateLeaves(delta: number): void {
    const gravity = -3;
    let allDead = true;

    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const leaf = this.leaves[i];
      leaf.life -= delta * 0.4;

      if (leaf.life <= 0) {
        leaf.mesh.parent?.remove(leaf.mesh);
        this.leaves.splice(i, 1);
        continue;
      }

      allDead = false;
      leaf.velocity.y += gravity * delta;
      leaf.mesh.position.x += leaf.velocity.x * delta;
      leaf.mesh.position.y += leaf.velocity.y * delta;
      leaf.mesh.position.z += leaf.velocity.z * delta;
      leaf.mesh.rotation.x += delta * 4;
      leaf.mesh.rotation.z += delta * 3;

      const mat = leaf.mesh.material as MeshStandardMaterial;
      mat.opacity = Math.max(0, leaf.life / 2);
    }

    if (allDead) {
      this.leafAnimation = false;
    }
  }

  // ── Active block highlighting ─────────────────────────────

  private updateActiveBlockHighlight(): void {
    for (const [origIdx, mat] of this.blockMaterials) {
      const isActive = origIdx === this.activeBlockOriginalIndex;
      mat.emissive.setHex(isActive ? ACTIVE_GLOW : 0x000000);
      mat.emissiveIntensity = isActive ? 0.3 : 0;
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  private setBlockText(block: Entity): void {
    const text = block.getValue(ForestJigsawBlock, "text") ?? "";
    const indent = block.getValue(ForestJigsawBlock, "indent") ?? 0;
    const indentedText = "    ".repeat(indent) + text;

    const face = block.getValue(ForestJigsawBlock, "faceEntity");
    if (!face) return;

    const docs = PanelDocument.data?.document;
    if (!docs) return;

    const doc = docs[face.index] as UIKitDocument | undefined;
    if (!doc) {
      this.pendingBlockText.set(face.index, indentedText);
      return;
    }

    setTextSafe(doc, "code", indentedText);
  }

  private placeBlockInSlot(block: Entity, slot: number): void {
    block.setValue(ForestJigsawBlock, "slotIndex", slot);
    const indent = block.getValue(ForestJigsawBlock, "indent") ?? 0;
    const pos = this.slotPositions[slot];
    this.animatingBlocks.set(block.index, {
      entity: block,
      targetPos: new Vector3(pos.x - indent * INDENT_SHIFT, pos.y, pos.z),
      targetRotY: 0,
    });
    this.setBlockText(block);
  }

  private returnBlockHome(block: Entity): void {
    block.setValue(ForestJigsawBlock, "slotIndex", -1);
    block.setValue(ForestJigsawBlock, "indent", 0);
    const origIdx = block.getValue(ForestJigsawBlock, "originalIndex") ?? 0;
    const home = this.homePositions.get(origIdx)!;
    this.animatingBlocks.set(block.index, {
      entity: block,
      targetPos: new Vector3(home[0], home[1], home[2]),
      targetRotY: SHELF_ROTATION_Y,
    });
    this.setBlockText(block);
  }

  private findBlockInSlot(slot: number): Entity | null {
    for (const block of this.queries.blocks.entities) {
      if (block.getValue(ForestJigsawBlock, "slotIndex") === slot) {
        return block;
      }
    }
    return null;
  }

  // ── Teardown ──────────────────────────────────────────────

  private teardown(): void {
    for (const block of this.queries.blocks.entities) {
      const face = block.getValue(ForestJigsawBlock, "faceEntity");
      if (face) face.dispose();
      block.dispose();
    }
    for (const button of this.queries.buttons.entities) {
      button.dispose();
    }
    this.feedbackEntity?.dispose();
    this.instructionsEntity?.dispose();
    for (const leaf of this.leaves) {
      leaf.mesh.parent?.remove(leaf.mesh);
    }
    this.leaves = [];
    this.animatingBlocks.clear();
    this.blockEntities.clear();
    this.blockMaterials.clear();
    this.pendingBlockText.clear();
    this.pendingButtonLabels.clear();
  }
}

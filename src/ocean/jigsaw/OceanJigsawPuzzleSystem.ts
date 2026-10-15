/**
 * Python Jigsaw Puzzle system for the ocean environment.
 *
 * Creates grabbable code-line blocks, a slotted board, control buttons
 * (indent / dedent / reset / exit / submit), a fish holding an instructions
 * board, a feedback panel, and a bubble celebration animation.  The player
 * grabs blocks via raycast, drops them into board slots, adjusts
 * indentation, and submits to validate the assembled Python program.
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
import { ExtrudeGeometry, Shape } from "three";

import { OceanJigsawBlock, OceanJigsawButton } from "./oceanJigsawComponents.js";
import { OCEAN_PUZZLE_LINES, OCEAN_SHUFFLED_ORDER, OCEAN_EXPECTED_OUTPUT } from "./oceanPuzzleData.js";
import { attachToOceanRoot, createOceanEntity } from "../oceanRoot.js";
import { setTextSafe } from "../../lab/systems/uiText.js";
import { runOceanPython } from "./oceanPythonRunner.js";
import { socket } from "../../network/socket";

// ── Layout ────────────────────────────────────────────────────
const S = 2.2;
const BOARD_CENTER: [number, number, number] = [0, 1.4, 4.5];
const BOARD_WIDTH = 1.4 * S;
const BOARD_HEIGHT = 1.6 * S;
const SLOT_HEIGHT = 0.14 * S;
const NUM_SLOTS = 10;

const BLOCK_WIDTH = 1.1 * S;
const BLOCK_HEIGHT = 0.11 * S;
const BLOCK_THICKNESS = 0.03 * S;
const INDENT_SHIFT = 0.15 * S;
const TAB_RADIUS = BLOCK_HEIGHT * 0.35;

function createJigsawBlockGeometry(
  width: number,
  height: number,
  depth: number,
): ExtrudeGeometry {
  const w = width / 2;
  const h = height / 2;
  const r = TAB_RADIUS;

  const shape = new Shape();
  shape.moveTo(-w, -h);
  shape.lineTo(-r, -h);
  shape.absarc(0, -h, r, Math.PI, 0, true);
  shape.lineTo(w, -h);
  shape.lineTo(w, h);
  shape.lineTo(r, h);
  shape.absarc(0, h, r, 0, Math.PI, false);
  shape.lineTo(-w, h);
  shape.lineTo(-w, -h);

  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004 * S,
    bevelSize: 0.004 * S,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

const SHELF_X = 2.8;
const SHELF_Z = 1.0;
const SHELF_ROTATION_Y = Math.PI / 2;

const BUTTON_X = -(BOARD_WIDTH / 2 + 0.22 * S);
const BUTTON_Z = BOARD_CENTER[2];
const BUTTON_SPACING = 0.24 * S;
const BUTTON_SIZE = 0.14 * S;

const FISH_X = -3.5 * S;
const FISH_Z = 1.5 * S;
const FISH_Y = 2.0 * S;

// ── Ocean Colours ─────────────────────────────────────────────
const BLOCK_COLOR = 0x4dabc0;
const BOARD_COLOR = 0x1a6fa4;
const SLOT_COLOR = 0x2a8fc0;
const BUBBLE_COLORS = [0x4dabc0, 0x6bcf7f, 0xffd93d, 0xff9a44, 0xaaccff];
const ACTIVE_GLOW = 0x7fdfda;

const BUTTON_CONFIGS: {
  type: "indent" | "dedent" | "reset" | "exit" | "submit";
  label: string;
  color: number;
}[] = [
  { type: "indent", label: "Indent", color: 0x1a6fa4 },
  { type: "dedent", label: "Dedent", color: 0x0d4a7a },
  { type: "reset", label: "Reset", color: 0xb5651d },
  { type: "exit", label: "Exit", color: 0x991b1b },
  { type: "submit", label: "Submit", color: 0x4dabc0 },
];

export class OceanJigsawPuzzleSystem extends createSystem({
  blocks: { required: [OceanJigsawBlock] },
  buttons: { required: [OceanJigsawButton] },
  pressed: { required: [OceanJigsawButton, Pressed] },
  heldBlocks: { required: [OceanJigsawBlock, Grabbed] },
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
  private bubbles: { mesh: Mesh; velocity: Vector3; life: number }[] = [];
  private bubbleAnimation = false;
  private tmpVec = new Vector3();

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
      const origIdx = OCEAN_SHUFFLED_ORDER[i];
      this.homePositions.set(origIdx, [
        SHELF_X,
        startY - i * SLOT_HEIGHT,
        SHELF_Z,
      ]);
    }

    this.buildBoard();
    this.createBlocks();
    this.createButtons();
    this.createFish();
    this.createFeedbackPanel();

    this.queries.heldBlocks.subscribe("qualify", (block) => {
      const slot = block.getValue(OceanJigsawBlock, "slotIndex") ?? -1;
      if (slot >= 0) {
        block.setValue(OceanJigsawBlock, "slotIndex", -1);
      }
      // Reset rotation so the block faces the board while held.
      block.object3D!.rotation.set(0, 0, 0);
      block.object3D!.updateMatrixWorld(true);
    });

    this.queries.heldBlocks.subscribe("disqualify", (block) => {
      try {
        this.handleBlockRelease(block);
      } catch (err) {
        console.error("[OceanJigsaw] Block release error (non-fatal):", err);
      }
    });

    this.queries.pressed.subscribe("qualify", (button) => {
      try {
        this.handleButtonPress(button);
      } catch (err) {
        console.error("[OceanJigsaw] Button press error (non-fatal):", err);
      }
    });

    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number) {
    try {
      this.updateInner(delta);
    } catch (err) {
      console.error("[OceanJigsaw] Update error (non-fatal):", err);
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

    if (!(window as any).isOceanActive) return;

    if (this.bubbleAnimation) {
      this.updateBubbles(delta);
    }

    this.updateActiveBlockHighlight();
  }

  // ── Board ────────────────────────────────────────────────

  private buildBoard(): void {
    const boardGroup = new Group();

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
    attachToOceanRoot(boardGroup);
  }

  // ── Blocks ────────────────────────────────────────────────

  private createBlocks(): void {
    for (let i = 0; i < NUM_SLOTS; i++) {
      const origIdx = OCEAN_SHUFFLED_ORDER[i];
      const line = OCEAN_PUZZLE_LINES[origIdx];

      const group = new Group();

      const bodyMat = new MeshStandardMaterial({
        color: BLOCK_COLOR,
        roughness: 0.75,
      });
      const body = new Mesh(
        createJigsawBlockGeometry(BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_THICKNESS),
        bodyMat,
      );
      group.add(body);

      const block = createOceanEntity(this.world, group);
      attachToOceanRoot(group);
      block.addComponent(OceanJigsawBlock, {
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
      block.setValue(OceanJigsawBlock, "faceEntity", face);

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

      const base = new Mesh(
        new BoxGeometry(
          BUTTON_SIZE * 2.0,
          BUTTON_SIZE * 0.12,
          BUTTON_SIZE * 0.9,
        ),
        new MeshStandardMaterial({
          color: 0x0d4a7a,
          roughness: 0.85,
        }),
      );
      base.position.y = -BUTTON_SIZE * 0.34;
      group.add(base);

      const entity = createOceanEntity(this.world, group);
      attachToOceanRoot(group);
      entity.addComponent(OceanJigsawButton, {
        buttonType: config.type,
      });
      entity.addComponent(Interactable);
      entity.addComponent(PanelUI, {
        config: "./ui/jigsaw-button.json",
        maxWidth: BUTTON_SIZE * 2.2,
        maxHeight: BUTTON_SIZE * 0.7,
      });
      group.name = `OceanButton-${config.type}`;
      group.position.set(
        BUTTON_X,
        startY - i * BUTTON_SPACING,
        BUTTON_Z,
      );
      group.rotation.y = Math.PI;
      this.pendingButtonLabels.set(entity.index, config.label);
    }
  }

  // ── Fish holding instructions board ───────────────────────

  private createFish(): void {
    const fish = new Group();

    const bodyMat = new MeshStandardMaterial({
      color: 0xff9a44,
      roughness: 0.5,
    });
    const finMat = new MeshStandardMaterial({
      color: 0xe87a20,
      roughness: 0.6,
    });
    const eyeWhiteMat = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
    });
    const pupilMat = new MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.3,
    });

    // Body (large fish)
    const body = new Mesh(
      new SphereGeometry(0.35 * S, 16, 12),
      bodyMat,
    );
    body.scale.set(1, 0.8, 1.4);
    fish.add(body);

    // Tail fin
    const tail = new Mesh(
      new ConeGeometry(0.2 * S, 0.3 * S, 8),
      finMat,
    );
    tail.position.set(0, 0, 0.45 * S);
    tail.rotation.x = Math.PI / 2;
    fish.add(tail);

    // Dorsal fin (top)
    const dorsal = new Mesh(
      new ConeGeometry(0.12 * S, 0.25 * S, 6),
      finMat,
    );
    dorsal.position.set(0, 0.25 * S, 0);
    dorsal.rotation.x = 0;
    fish.add(dorsal);

    // Pectoral fins (sides)
    const leftFin = new Mesh(
      new ConeGeometry(0.1 * S, 0.2 * S, 6),
      finMat,
    );
    leftFin.position.set(-0.25 * S, 0, -0.05 * S);
    leftFin.rotation.z = Math.PI / 2;
    leftFin.rotation.y = 0.3;
    fish.add(leftFin);

    const rightFin = new Mesh(
      new ConeGeometry(0.1 * S, 0.2 * S, 6),
      finMat,
    );
    rightFin.position.set(0.25 * S, 0, -0.05 * S);
    rightFin.rotation.z = -Math.PI / 2;
    rightFin.rotation.y = -0.3;
    fish.add(rightFin);

    // Eyes
    const leftEyeWhite = new Mesh(
      new SphereGeometry(0.08 * S, 10, 10),
      eyeWhiteMat,
    );
    leftEyeWhite.position.set(-0.15 * S, 0.1 * S, -0.25 * S);
    fish.add(leftEyeWhite);

    const rightEyeWhite = new Mesh(
      new SphereGeometry(0.08 * S, 10, 10),
      eyeWhiteMat,
    );
    rightEyeWhite.position.set(0.15 * S, 0.1 * S, -0.25 * S);
    fish.add(rightEyeWhite);

    const leftPupil = new Mesh(
      new SphereGeometry(0.04 * S, 8, 8),
      pupilMat,
    );
    leftPupil.position.set(-0.15 * S, 0.1 * S, -0.31 * S);
    fish.add(leftPupil);

    const rightPupil = new Mesh(
      new SphereGeometry(0.04 * S, 8, 8),
      pupilMat,
    );
    rightPupil.position.set(0.15 * S, 0.1 * S, -0.31 * S);
    fish.add(rightPupil);

    // Mouth (open, holding the board)
    const mouthTop = new Mesh(
      new BoxGeometry(0.25 * S, 0.04 * S, 0.08 * S),
      finMat,
    );
    mouthTop.position.set(0, -0.08 * S, -0.4 * S);
    mouthTop.rotation.x = -0.2;
    fish.add(mouthTop);

    const mouthBottom = new Mesh(
      new BoxGeometry(0.25 * S, 0.04 * S, 0.08 * S),
      finMat,
    );
    mouthBottom.position.set(0, -0.16 * S, -0.4 * S);
    mouthBottom.rotation.x = 0.2;
    fish.add(mouthBottom);

    // Position the fish floating on the right side, facing the user
    fish.position.set(FISH_X, FISH_Y, FISH_Z);
    fish.lookAt(0, FISH_Y, -1.0);
    attachToOceanRoot(fish);

    // ── Instructions board held in the fish's mouth ──────────
    const boardX = FISH_X;
    const boardZ = FISH_Z + 0.05 * S;
    const boardY = FISH_Y - 0.75 * S;

    // Board backing panel
    const boardBacking = new Mesh(
      new BoxGeometry(0.85 * S, 1.15 * S, 0.03 * S),
      new MeshStandardMaterial({
        color: 0xe8f4f8,
        roughness: 0.9,
        side: DoubleSide,
      }),
    );
    boardBacking.position.set(boardX, boardY, boardZ);
    boardBacking.lookAt(0, boardY, -1.0);
    attachToOceanRoot(boardBacking);

    // String from mouth to board
    const stringMat = new MeshStandardMaterial({
      color: 0x8a7a5a,
      roughness: 0.8,
    });
    const string = new Mesh(
      new CylinderGeometry(0.008 * S, 0.008 * S, 0.4 * S, 6),
      stringMat,
    );
    string.position.set(boardX, boardY + 0.6 * S, boardZ);
    attachToOceanRoot(string);

    // PanelUI for the instruction text
    const instructionsEntity = createOceanEntity(this.world);
    instructionsEntity.addComponent(PanelUI, {
      config: "./ui/ocean-jigsaw-instructions.json",
      maxWidth: 0.78 * S,
      maxHeight: 1.08 * S,
    });
    instructionsEntity.object3D!.position.set(boardX, boardY, boardZ - 0.02 * S);
    instructionsEntity.object3D!.rotation.y = Math.atan2(
      0 - boardX,
      -1.0 - boardZ,
    );
    attachToOceanRoot(instructionsEntity.object3D!);
    this.instructionsEntity = instructionsEntity;
    this.instructionsEntityIndex = instructionsEntity.index;

    // Queue the instruction text to be set once the PanelUI document loads
    this.pendingInstructions = {
      "instructions-title": "Python Puzzle 2",
      "instructions-body":
        "Calculate ticket costs for adults and children.\nAsk how many adult and child tickets with input().\nMultiply by the prices, add for the total.\nPrint each subtotal and the total formatted to 2 decimals.",
      "instructions-given": "ADULT_PRICE = 11.50\nCHILD_PRICE = 8.25",
      "instructions-expected-label": "Sample Run:",
      "instructions-expected":
        "Adult tickets: 2\nChild tickets: 3\nAdults: $23.00\nChildren: $24.75\nTotal: $47.75",
    };
  }

  // ── Feedback panel ────────────────────────────────────────

  private createFeedbackPanel(): void {
    const entity = createOceanEntity(this.world);
    entity.addComponent(PanelUI, {
      config: "./ui/ocean-jigsaw-feedback.json",
      maxWidth: 1.2 * S,
      maxHeight: 0.6 * S,
    });
    entity.object3D!.position.set(0, 2.3 * S, BOARD_CENTER[2]);
    entity.object3D!.rotation.y = Math.PI;
    attachToOceanRoot(entity.object3D!);
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
      OceanJigsawBlock,
      "originalIndex",
    ) ?? -1;
  }

  // ── Button press handling ─────────────────────────────────

  private handleButtonPress(button: Entity): void {
    if (!(window as any).isOceanActive) return;
    const buttonType = button.getValue(OceanJigsawButton, "buttonType");

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
        (block.getValue(OceanJigsawBlock, "slotIndex") ?? -1) >= 0
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

    const slot = targetBlock.getValue(OceanJigsawBlock, "slotIndex") ?? -1;
    if (slot < 0) return;

    let indent = targetBlock.getValue(OceanJigsawBlock, "indent") ?? 0;
    indent = Math.max(0, Math.min(2, indent + direction));
    targetBlock.setValue(OceanJigsawBlock, "indent", indent);

    const pos = this.slotPositions[slot];
    targetBlock.object3D!.position.set(
      pos.x - indent * INDENT_SHIFT,
      pos.y,
      pos.z,
    );
    targetBlock.object3D!.updateMatrixWorld(true);
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
    window.dispatchEvent(new CustomEvent("oceanExitRequested"));
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
        text: block.getValue(OceanJigsawBlock, "text") ?? "",
        indent: block.getValue(OceanJigsawBlock, "indent") ?? 0,
      });
    }

    const code = slots
      .map((s) => "    ".repeat(s.indent) + s.text)
      .join("\n");

    this.showFeedback("Running…", "Executing your Python code…");
    void this.executePython(code);
  }

  private async executePython(code: string): Promise<void> {
    const result = await runOceanPython(code);

    if (result.success) {
      if (result.output.trim() === OCEAN_EXPECTED_OUTPUT.trim()) {
        this.showFeedback(
          "Success!",
          `Correct! The code runs successfully.\n\nOutput:\n${result.output.trim()}`,
        );
        this.showRisingBubbles();
        this.reportScoreToInstructor();
      } else {
        this.showFeedback(
          "Wrong Output",
          `The code runs but produces the wrong output.\n\nYour output:\n${result.output.trim()}\n\nExpected:\n${OCEAN_EXPECTED_OUTPUT.trim()}`,
        );
      }
    } else {
      this.showFeedback("Error", result.error);
    }
  }

  /** Sends the puzzle result to the server so the instructor dashboard sees it. */
  private reportScoreToInstructor(): void {
    if ((window as any).oceanPuzzleSolved) return;
    (window as any).oceanPuzzleSolved = true;

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

  // ── Feedback ──────────────────────────────────────────────

  private showFeedback(title: string, body: string): void {
    this.pendingFeedback = { title, body };
  }

  // ── Rising bubble celebration animation ───────────────────

  private showRisingBubbles(): void {
    this.bubbleAnimation = true;
    const bubbleGeo = new SphereGeometry(0.05 * S, 8, 8);

    const playerPos = this.getPlayerPosition();
    const BUBBLE_COUNT = 60;
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const color = BUBBLE_COLORS[i % BUBBLE_COLORS.length];
      const bubbleMat = new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        transparent: true,
        opacity: 0.8,
      });
      const bubble = new Mesh(bubbleGeo, bubbleMat);
      const angle = (i / BUBBLE_COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const radius = 0.1 + Math.random() * 0.5;
      bubble.position.set(
        playerPos.x + Math.cos(angle) * radius,
        playerPos.y,
        playerPos.z + Math.sin(angle) * radius,
      );
      const velocity = new Vector3(
        Math.cos(angle) * (0.5 + Math.random() * 1.0),
        2 + Math.random() * 3,
        Math.sin(angle) * (0.5 + Math.random() * 1.0),
      );
      this.bubbles.push({ mesh: bubble, velocity, life: 2.5 });
      attachToOceanRoot(bubble);
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

  private updateBubbles(delta: number): void {
    const buoyancy = 1.5;
    let allDead = true;

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bubble = this.bubbles[i];
      bubble.life -= delta * 0.35;

      if (bubble.life <= 0) {
        bubble.mesh.parent?.remove(bubble.mesh);
        this.bubbles.splice(i, 1);
        continue;
      }

      allDead = false;
      bubble.velocity.y += buoyancy * delta;
      bubble.mesh.position.x += bubble.velocity.x * delta;
      bubble.mesh.position.y += bubble.velocity.y * delta;
      bubble.mesh.position.z += bubble.velocity.z * delta;

      const mat = bubble.mesh.material as MeshStandardMaterial;
      mat.opacity = Math.max(0, bubble.life / 2.5) * 0.8;
    }

    if (allDead) {
      this.bubbleAnimation = false;
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
    const text = block.getValue(OceanJigsawBlock, "text") ?? "";
    const indent = block.getValue(OceanJigsawBlock, "indent") ?? 0;
    const indentedText = "    ".repeat(indent) + text;

    const face = block.getValue(OceanJigsawBlock, "faceEntity");
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
    block.setValue(OceanJigsawBlock, "slotIndex", slot);
    const indent = block.getValue(OceanJigsawBlock, "indent") ?? 0;
    const pos = this.slotPositions[slot];
    block.object3D!.position.set(
      pos.x - indent * INDENT_SHIFT,
      pos.y,
      pos.z,
    );
    block.object3D!.rotation.set(0, 0, 0);
    block.object3D!.updateMatrixWorld(true);
    this.setBlockText(block);
  }

  private returnBlockHome(block: Entity): void {
    block.setValue(OceanJigsawBlock, "slotIndex", -1);
    block.setValue(OceanJigsawBlock, "indent", 0);
    const origIdx = block.getValue(OceanJigsawBlock, "originalIndex") ?? 0;
    const home = this.homePositions.get(origIdx)!;
    block.object3D!.position.set(home[0], home[1], home[2]);
    block.object3D!.rotation.set(0, SHELF_ROTATION_Y, 0);
    block.object3D!.updateMatrixWorld(true);
    this.setBlockText(block);
  }

  private findBlockInSlot(slot: number): Entity | null {
    for (const block of this.queries.blocks.entities) {
      if (block.getValue(OceanJigsawBlock, "slotIndex") === slot) {
        return block;
      }
    }
    return null;
  }

  // ── Teardown ──────────────────────────────────────────────

  private teardown(): void {
    for (const block of this.queries.blocks.entities) {
      const face = block.getValue(OceanJigsawBlock, "faceEntity");
      if (face) face.dispose();
      block.dispose();
    }
    for (const button of this.queries.buttons.entities) {
      button.dispose();
    }
    this.feedbackEntity?.dispose();
    this.instructionsEntity?.dispose();
    for (const bubble of this.bubbles) {
      bubble.mesh.parent?.remove(bubble.mesh);
    }
    this.bubbles = [];
    this.blockEntities.clear();
    this.blockMaterials.clear();
    this.pendingBlockText.clear();
    this.pendingButtonLabels.clear();
  }
}

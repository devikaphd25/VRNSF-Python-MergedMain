/**
 * Python Jigsaw Puzzle system for the castle environment.
 *
 * Creates grabbable code-line blocks, a slotted board at the centre, control
 * buttons (indent / dedent / reset / exit / submit), an animated king holding
 * an instructions board, a feedback panel, and a gold-coin celebration.
 * The player grabs blocks via raycast, drops them into board slots, adjusts
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
import { JigsawBlock, JigsawButton } from "./jigsawComponents.js";
import { PUZZLE_LINES, SHUFFLED_ORDER, EXPECTED_OUTPUT } from "./puzzleData.js";
import { attachToCastleRoot, createCastleEntity } from "./castleRoot.js";
import { createJigsawBlockGeometry, jigsawPieceEdges } from "../../utils/jigsaw-block.js";
import { setTextSafe } from "../../lab/systems/uiText.js";
import { runPython } from "./pythonRunner.js";
import { socket } from "../../network/socket";

// ── Layout ────────────────────────────────────────────────────
// Mounted on the front wall (inner face at z ≈ +4.8), rotated 180° to face the player at -z.
const S = 2.2; // global scale factor for the entire puzzle assembly
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
// 2.3 * S = 5.06 m, above the room's 5 m ceiling, so a wrong result was never
// visible.
const FEEDBACK_HEIGHT = 0.6 * S;
const FEEDBACK_Y =
  BOARD_CENTER[1] + BOARD_HEIGHT / 2 + FEEDBACK_HEIGHT / 2 + 0.06 * S;

/**
 * Builds a limb segment running from `from` to `to` in the parent's local
 * space. The cylinder's axis is rotated onto +z so a plain `lookAt` can aim the
 * segment at the target, including its downward pitch.
 */
function createLimb(
  from: Vector3,
  to: Vector3,
  radius: number,
  material: MeshStandardMaterial,
): Mesh {
  const direction = new Vector3().subVectors(to, from);
  const geometry = new CylinderGeometry(
    radius,
    radius * 0.85,
    direction.length(),
    10,
  );
  geometry.rotateX(Math.PI / 2);
  const limb = new Mesh(geometry, material);
  limb.position.copy(from).addScaledVector(direction, 0.5);
  limb.lookAt(to);
  return limb;
}

const SHELF_X = 2.8;
const SHELF_Z = 1.0;
const SHELF_ROTATION_Y = Math.PI / 2;

const BUTTON_X = -(BOARD_WIDTH / 2 + 0.22 * S); // right side of the board (player's right = -x)
const BUTTON_Z = BOARD_CENTER[2]; // mounted on wall, same plane as board
const BUTTON_SPACING = 0.24 * S; // vertical spacing
const BUTTON_SIZE = 0.14 * S;

// ── King and instructions board ───────────────────────────────
// World -x is the player's right (the player enters at (0, 0, -1) facing +z),
// so the king stands on the floor to their right, mirroring the code blocks'
// shelf at +x on their left. He stays inside the 10 x 10 room: at his old spot
// (-7.7, 3.3) the board sat outside the walls, out of the player's view.
const KING_X = -3.0;
const KING_Z = 2.7;
const KING_LOOK_X = 0;
const KING_LOOK_Z = -1.0; // where the player enters the castle
const INSTRUCTION_BOARD_WIDTH = 0.85 * S;
const INSTRUCTION_BOARD_HEIGHT = 1.15 * S;
const BOARD_DISTANCE = 0.85; // how far in front of the king the board is held
const BOARD_Y = 2.15; // board centre height, at the king's chest

// ── Colours ──────────────────────────────────────────────────
const BLOCK_COLOR = 0xd4a76a;
const BOARD_COLOR = 0x4a3b2a;
const SLOT_COLOR = 0x5a4a38;
const GOLD_COLOR = 0xffd700;
const ACTIVE_GLOW = 0xffd700;

const BUTTON_CONFIGS: {
  type: "indent" | "dedent" | "reset" | "exit" | "submit";
  label: string;
  color: number;
}[] = [
  { type: "indent", label: "Indent", color: 0x2f5b8f },
  { type: "dedent", label: "Dedent", color: 0x2f8f8f },
  { type: "reset", label: "Reset", color: 0xd97706 },
  { type: "exit", label: "Exit", color: 0x991b1b },
  { type: "submit", label: "Submit", color: 0x2f6f4f },
];

export class JigsawPuzzleSystem extends createSystem({
  blocks: { required: [JigsawBlock] },
  buttons: { required: [JigsawButton] },
  pressed: { required: [JigsawButton, Pressed] },
  heldBlocks: { required: [JigsawBlock, Grabbed] },
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
  private pendingBlockText: Map<number, string> = new Map();
  private pendingButtonLabels: Map<number, string> = new Map();
  private coins: { mesh: Mesh; velocity: Vector3; life: number }[] = [];
  private coinAnimation = false;
  private tmpVec = new Vector3();
  private animatingBlocks: Map<number, { entity: Entity; targetPos: Vector3; targetRotY: number }> = new Map();
  private tmpLerp = new Vector3();
  private king: {
    robe: Mesh;
    head: Group;
    cape: Mesh;
    sceptre: Group;
    clock: number;
  } | null = null;

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
      const origIdx = SHUFFLED_ORDER[i];
      this.homePositions.set(origIdx, [
        SHELF_X,
        startY - i * SLOT_HEIGHT,
        SHELF_Z,
      ]);
    }

    this.buildBoard();
    this.createBlocks();
    this.createButtons();
    this.createKing();
    this.createFeedbackPanel();

    // Clear slot assignment when a block is grabbed off the board.
    this.queries.heldBlocks.subscribe("qualify", (block) => {
      const slot = block.getValue(JigsawBlock, "slotIndex") ?? -1;
      if (slot >= 0) {
        block.setValue(JigsawBlock, "slotIndex", -1);
      }
      // Reset rotation so the block faces the board while held.
      block.object3D!.rotation.set(0, 0, 0);
      block.object3D!.updateMatrixWorld(true);
    });

    // Handle block release — snap to nearest slot or return home.
    this.queries.heldBlocks.subscribe("disqualify", (block) => {
      try {
        this.handleBlockRelease(block);
      } catch (err) {
        console.error("[Jigsaw] Block release error (non-fatal):", err);
      }
    });

    // Handle button presses.
    this.queries.pressed.subscribe("qualify", (button) => {
      try {
        this.handleButtonPress(button);
      } catch (err) {
        console.error("[Jigsaw] Button press error (non-fatal):", err);
      }
    });

    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number) {
    try {
      this.updateInner(delta);
    } catch (err) {
      console.error("[Jigsaw] Update error (non-fatal):", err);
    }
  }

  private updateInner(delta: number): void {
    // Apply pending text updates once PanelUI documents are ready.
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

    if (!(window as any).isCastleActive) return;

    this.updateKingIdle(delta);

    if (this.coinAnimation) {
      this.updateCoins(delta);
    }

    this.updateActiveBlockHighlight();
  }

  // ── Board ──────────────────────────────────────────────────

  private buildBoard(): void {
    const boardGroup = new Group();
    boardGroup.name = "CastlePuzzleBoard";

    const boardMat = new MeshStandardMaterial({
      color: BOARD_COLOR,
      roughness: 0.9,
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
    attachToCastleRoot(boardGroup);
  }

  // ── Blocks ────────────────────────────────────────────────

  private createBlocks(): void {
    // Cuts keyed to the correct line order, so only true neighbours interlock.
    const pieceEdges = jigsawPieceEdges(PUZZLE_LINES);

    for (let i = 0; i < NUM_SLOTS; i++) {
      const origIdx = SHUFFLED_ORDER[i];
      const line = PUZZLE_LINES[origIdx];

      const group = new Group();

      const bodyMat = new MeshStandardMaterial({
        color: BLOCK_COLOR,
        roughness: 0.8,
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

      const block = createCastleEntity(this.world, group);
      attachToCastleRoot(group);
      block.addComponent(JigsawBlock, {
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
      // Offset must clear the ExtrudeGeometry bevel (0.004) so the panel
      // sits outside the opaque block mesh and is visible to the player.
      face.object3D!.position.set(
        0,
        0,
        -(BLOCK_THICKNESS / 2 + 0.006 * S),
      );
      face.object3D!.rotation.y = Math.PI;
      block.setValue(JigsawBlock, "faceEntity", face);

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
    // Buttons stacked vertically on the right side of the board, centred on
    // the board's vertical centre.
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
      // Wider-than-tall button so the label text fits clearly on its face.
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
          color: 0x3a3a3a,
          roughness: 0.8,
        }),
      );
      base.position.y = -BUTTON_SIZE * 0.34;
      group.add(base);

      const entity = createCastleEntity(this.world, group);
      attachToCastleRoot(group);
      entity.addComponent(JigsawButton, {
        buttonType: config.type,
      });
      entity.addComponent(RayInteractable);

      group.position.set(
        BUTTON_X,
        startY - i * BUTTON_SPACING,
        BUTTON_Z,
      );

      // Label sits on the front face of the button, facing the player.
      const label = this.world.createTransformEntity(undefined, {
        parent: entity,
      });
      label.addComponent(PanelUI, {
        config: "./ui/jigsaw-button.json",
        maxWidth: BUTTON_SIZE * 2.2,
        maxHeight: BUTTON_SIZE * 0.7,
      });
      label.object3D!.position.set(0, 0, -BUTTON_SIZE * 0.38);
      label.object3D!.rotation.y = Math.PI;
      this.pendingButtonLabels.set(label.index, config.label);
    }
  }

  // ── King holding the instructions board ───────────────────

  private createKing(): void {
    const king = new Group();
    king.name = "CastleKing";

    // The room is lit only by its four corner torches, so the king carries a
    // little emissive of his own — the same trick the puzzle buttons use — to
    // stay readable from the player's side of the room.
    const robeMat = new MeshStandardMaterial({
      color: 0x53308f,
      roughness: 0.72,
      emissive: 0x53308f,
      emissiveIntensity: 0.1,
    });
    const skinMat = new MeshStandardMaterial({
      color: 0xd4a76a,
      roughness: 0.8,
      emissive: 0xd4a76a,
      emissiveIntensity: 0.06,
    });
    const goldMat = new MeshStandardMaterial({
      color: GOLD_COLOR,
      roughness: 0.35,
      metalness: 0.7,
      emissive: GOLD_COLOR,
      emissiveIntensity: 0.3,
    });
    const capeMat = new MeshStandardMaterial({
      color: 0x8b1e3f,
      roughness: 0.85,
      emissive: 0x8b1e3f,
      emissiveIntensity: 0.1,
      side: DoubleSide,
    });
    const beardMat = new MeshStandardMaterial({
      color: 0xe6e2da,
      roughness: 0.9,
    });

    // Robe — one tapered cylinder from the floor to the shoulders so the figure
    // reads as a robed king at a glance. It also carries the breathing motion.
    const robe = new Mesh(new CylinderGeometry(0.6, 0.95, 2.9, 20), robeMat);
    robe.position.y = 1.45;
    king.add(robe);

    const belt = new Mesh(new CylinderGeometry(0.8, 0.8, 0.18, 20), goldMat);
    belt.position.y = 1.55;
    king.add(belt);

    const collar = new Mesh(new CylinderGeometry(0.52, 0.62, 0.28, 20), robeMat);
    collar.position.y = 3.0;
    king.add(collar);

    const cape = new Mesh(new BoxGeometry(1.7, 2.2, 0.06), capeMat);
    cape.position.set(0, 1.75, -0.78);
    cape.rotation.x = 0.18;
    king.add(cape);

    const neck = new Mesh(new CylinderGeometry(0.19, 0.19, 0.2, 12), skinMat);
    neck.position.y = 3.2;
    king.add(neck);

    // Head, beard and crown hang off one pivot at the head's centre, so the idle
    // nod never moves the shoulders or the board in his hands.
    const head = new Group();
    head.position.y = 3.62;
    king.add(head);

    const skull = new Mesh(new SphereGeometry(0.4, 16, 16), skinMat);
    head.add(skull);

    const beard = new Mesh(new ConeGeometry(0.26, 0.5, 12), beardMat);
    beard.rotation.x = Math.PI;
    beard.position.set(0, -0.26, 0.22);
    head.add(beard);

    const crownBand = new Mesh(new CylinderGeometry(0.4, 0.44, 0.2, 20), goldMat);
    crownBand.position.y = 0.48;
    head.add(crownBand);

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const spike = new Mesh(new ConeGeometry(0.08, 0.22, 8), goldMat);
      spike.position.set(Math.sin(angle) * 0.36, 0.68, Math.cos(angle) * 0.36);
      head.add(spike);
    }

    // Both arms reach forward and out to grip the board's side edges at the
    // board's own height, so the hands hold it instead of hovering near it.
    const gripX = INSTRUCTION_BOARD_WIDTH / 2 + 0.03;
    for (const side of [-1, 1]) {
      const hand = new Vector3(side * gripX, BOARD_Y, BOARD_DISTANCE);
      king.add(createLimb(new Vector3(side * 0.5, 3.0, 0), hand, 0.15, robeMat));
      const fist = new Mesh(new SphereGeometry(0.17, 12, 12), skinMat);
      fist.position.copy(hand);
      king.add(fist);
    }

    // Sceptre planted on the floor beside the board's right edge, gripped by the
    // same fist and swaying about its base with the idle motion.
    const sceptre = new Group();
    sceptre.position.set(gripX + 0.1, 0, BOARD_DISTANCE);
    const shaft = new Mesh(new CylinderGeometry(0.06, 0.06, 3.0, 10), goldMat);
    shaft.position.y = 1.5;
    sceptre.add(shaft);
    const orb = new Mesh(new SphereGeometry(0.15, 14, 14), goldMat);
    orb.position.y = 3.15;
    sceptre.add(orb);
    king.add(sceptre);

    king.position.set(KING_X, 0, KING_Z);
    // Yaw only: lookAt would also pitch the figure up toward the player's eye
    // and lean the whole king backwards.
    king.rotation.y = Math.atan2(KING_LOOK_X - KING_X, KING_LOOK_Z - KING_Z);
    attachToCastleRoot(king);

    this.king = { robe, head, cape, sceptre, clock: 0 };

    // Instructions board — left a child of the environment root rather than of
    // the king, so it keeps facing the player while the king idles behind it.
    const towardPlayerX = Math.sin(king.rotation.y);
    const towardPlayerZ = Math.cos(king.rotation.y);
    const boardX = KING_X + towardPlayerX * BOARD_DISTANCE;
    const boardZ = KING_Z + towardPlayerZ * BOARD_DISTANCE;

    const boardBacking = new Mesh(
      new BoxGeometry(
        INSTRUCTION_BOARD_WIDTH,
        INSTRUCTION_BOARD_HEIGHT,
        0.03 * S,
      ),
      new MeshStandardMaterial({
        color: 0xf5f0e6,
        roughness: 0.9,
        side: DoubleSide,
      }),
    );
    boardBacking.position.set(boardX, BOARD_Y, boardZ);
    boardBacking.lookAt(KING_LOOK_X, BOARD_Y, KING_LOOK_Z);
    attachToCastleRoot(boardBacking);

    const instructionsEntity = createCastleEntity(this.world);
    instructionsEntity.addComponent(PanelUI, {
      config: "./ui/jigsaw-instructions.json",
      maxWidth: 0.78 * S,
      maxHeight: 1.08 * S,
    });
    // Lift the text panel slightly off the backing, toward the player, so the
    // two never z-fight.
    instructionsEntity.object3D!.position.set(
      boardX + towardPlayerX * 0.02 * S,
      BOARD_Y,
      boardZ + towardPlayerZ * 0.02 * S,
    );
    // PanelUI text faces +z by default, and the king already faces the player.
    instructionsEntity.object3D!.rotation.y = king.rotation.y;
    attachToCastleRoot(instructionsEntity.object3D!);
  }

  /** Standing idle: breathing robe, nodding head, swaying cape and sceptre. */
  private updateKingIdle(delta: number): void {
    const king = this.king;
    if (!king) return;

    king.clock += delta;
    const t = king.clock;

    const breath = Math.sin(t * 1.4);
    king.robe.scale.set(1 + breath * 0.015, 1, 1 + breath * 0.015);
    king.head.rotation.y = Math.sin(t * 0.6) * 0.09;
    king.head.rotation.x = Math.sin(t * 0.9) * 0.035;
    king.cape.rotation.x = 0.18 + Math.sin(t * 0.7) * 0.02;
    king.sceptre.rotation.z = Math.sin(t * 1.1) * 0.025;
    king.sceptre.rotation.x = Math.cos(t * 0.8) * 0.02;
  }

  // ── Feedback panel ────────────────────────────────────────

  private createFeedbackPanel(): void {
    const entity = createCastleEntity(this.world);
    entity.addComponent(PanelUI, {
      config: "./ui/jigsaw-feedback.json",
      maxWidth: 1.2 * S,
      maxHeight: FEEDBACK_HEIGHT,
    });
    entity.object3D!.position.set(0, FEEDBACK_Y, BOARD_CENTER[2]);
    entity.object3D!.rotation.y = Math.PI;
    attachToCastleRoot(entity.object3D!);
    this.feedbackEntity = entity;
    this.feedbackEntityIndex = entity.index;
  }

  // ── Block release handling ────────────────────────────────

  private handleBlockRelease(block: Entity): void {
    const obj = block.object3D!;
    obj.getWorldPosition(this.tmpVec);

    // The board is a flat vertical wall at BOARD_CENTER[z]. DistanceGrabbable
    // may release the block slightly in front of the wall, so use a generous
    // z tolerance instead of a tight 3D distance from the board centre.
    const dz = Math.abs(this.tmpVec.z - BOARD_CENTER[2]);
    if (dz > 3.0) {
      this.returnBlockHome(block);
      return;
    }

    // Check that the block is within the board's x-y bounds (with margin).
    const dx = this.tmpVec.x - BOARD_CENTER[0];
    const dy = this.tmpVec.y - BOARD_CENTER[1];
    if (
      Math.abs(dx) > BOARD_WIDTH / 2 + 0.3 * S ||
      Math.abs(dy) > BOARD_HEIGHT / 2 + 0.3 * S
    ) {
      this.returnBlockHome(block);
      return;
    }

    // All slots share the same x (board centre), so find the nearest slot
    // by y position only.  If the block is anywhere on the board, snap it.
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
      JigsawBlock,
      "originalIndex",
    ) ?? -1;
  }

  // ── Button press handling ─────────────────────────────────

  private handleButtonPress(button: Entity): void {
    const buttonType = button.getValue(JigsawButton, "buttonType");

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

    // Prefer the block the player is currently pointing at.
    for (const block of this.queries.blocks.entities) {
      if (
        block.hasComponent(Hovered) &&
        (block.getValue(JigsawBlock, "slotIndex") ?? -1) >= 0
      ) {
        targetBlock = block;
        break;
      }
    }

    // Fall back to the most recently placed block.
    if (
      !targetBlock &&
      this.activeBlockOriginalIndex >= 0
    ) {
      targetBlock =
        this.blockEntities.get(this.activeBlockOriginalIndex) ?? null;
    }

    if (!targetBlock) return;

    const slot = targetBlock.getValue(JigsawBlock, "slotIndex") ?? -1;
    if (slot < 0) return;

    let indent = targetBlock.getValue(JigsawBlock, "indent") ?? 0;
    indent = Math.max(0, Math.min(2, indent + direction));
    targetBlock.setValue(JigsawBlock, "indent", indent);

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
    window.dispatchEvent(new CustomEvent("castleExitRequested"));
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
        text: block.getValue(JigsawBlock, "text") ?? "",
        indent: block.getValue(JigsawBlock, "indent") ?? 0,
      });
    }

    // Assemble the Python source from the placed blocks.
    const code = slots
      .map((s) => "    ".repeat(s.indent) + s.text)
      .join("\n");

    this.showFeedback("Running…", "Executing your Python code…");
    void this.executePython(code);
  }

  private async executePython(code: string): Promise<void> {
    const result = await runPython(code);

    if (result.success) {
      if (result.output.trim() === EXPECTED_OUTPUT.trim()) {
        this.showFeedback(
          "Success!",
          `Correct! The code runs successfully.\n\nOutput:\n${result.output.trim()}`,
        );
        this.showGoldCoins();
        this.reportScoreToInstructor();
      } else {
        this.showFeedback(
          "Wrong Output",
          `The code runs but produces the wrong output.\n\nYour output:\n${result.output.trim()}\n\nExpected:\n${EXPECTED_OUTPUT.trim()}`,
        );
      }
    } else {
      this.showFeedback("Error", result.error);
    }
  }

  /** Sends the puzzle result to the server so the instructor dashboard sees it. */
  private reportScoreToInstructor(): void {
    if ((window as any).jigsawPuzzleSolved) return; // prevent duplicate sends
    (window as any).jigsawPuzzleSolved = true;

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

  // ── Gold coin animation ───────────────────────────────────

  private showGoldCoins(): void {
    this.coinAnimation = true;
    const coinGeo = new CylinderGeometry(0.03 * S, 0.03 * S, 0.008 * S, 12);
    const coinMat = new MeshStandardMaterial({
      color: GOLD_COLOR,
      emissive: GOLD_COLOR,
      emissiveIntensity: 0.4,
      metalness: 0.9,
      roughness: 0.2,
      transparent: true,
    });

    // Splash coins from the player's position so they burst upward and rain
    // back down on the user in a celebratory fountain.
    const playerPos = this.getPlayerPosition();
    const COIN_COUNT = 80;
    for (let i = 0; i < COIN_COUNT; i++) {
      const coin = new Mesh(coinGeo, coinMat);
      const angle = (i / COIN_COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const radius = 0.1 + Math.random() * 0.5;
      coin.position.set(
        playerPos.x + Math.cos(angle) * radius,
        playerPos.y + 1.0,
        playerPos.z + Math.sin(angle) * radius,
      );
      // Shoot upward and outward; gravity brings them back down.
      const velocity = new Vector3(
        Math.cos(angle) * (1.5 + Math.random() * 2),
        4 + Math.random() * 4,
        Math.sin(angle) * (1.5 + Math.random() * 2),
      );
      this.coins.push({ mesh: coin, velocity, life: 1.5 });
      attachToCastleRoot(coin);
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

  private updateCoins(delta: number): void {
    const gravity = -5;
    let allDead = true;

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.life -= delta * 0.5;

      if (coin.life <= 0) {
        coin.mesh.parent?.remove(coin.mesh);
        this.coins.splice(i, 1);
        continue;
      }

      allDead = false;
      coin.velocity.y += gravity * delta;
      coin.mesh.position.x += coin.velocity.x * delta;
      coin.mesh.position.y += coin.velocity.y * delta;
      coin.mesh.position.z += coin.velocity.z * delta;
      coin.mesh.rotation.x += delta * 5;
      coin.mesh.rotation.z += delta * 3;

      const mat = coin.mesh.material as MeshStandardMaterial;
      mat.opacity = Math.max(0, coin.life);
    }

    if (allDead) {
      this.coinAnimation = false;
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
    const text = block.getValue(JigsawBlock, "text") ?? "";
    const indent = block.getValue(JigsawBlock, "indent") ?? 0;
    const indentedText = "    ".repeat(indent) + text;

    const face = block.getValue(JigsawBlock, "faceEntity");
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
    block.setValue(JigsawBlock, "slotIndex", slot);
    const indent = block.getValue(JigsawBlock, "indent") ?? 0;
    const pos = this.slotPositions[slot];
    this.animatingBlocks.set(block.index, {
      entity: block,
      targetPos: new Vector3(pos.x - indent * INDENT_SHIFT, pos.y, pos.z),
      targetRotY: 0,
    });
    this.setBlockText(block);
  }

  private returnBlockHome(block: Entity): void {
    block.setValue(JigsawBlock, "slotIndex", -1);
    block.setValue(JigsawBlock, "indent", 0);
    const origIdx = block.getValue(JigsawBlock, "originalIndex") ?? 0;
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
      if (block.getValue(JigsawBlock, "slotIndex") === slot) {
        return block;
      }
    }
    return null;
  }

  // ── Teardown ──────────────────────────────────────────────

  private teardown(): void {
    for (const block of this.queries.blocks.entities) {
      const face = block.getValue(JigsawBlock, "faceEntity");
      if (face) face.dispose();
      block.dispose();
    }
    for (const button of this.queries.buttons.entities) {
      button.dispose();
    }
    this.feedbackEntity?.dispose();
    for (const coin of this.coins) {
      coin.mesh.parent?.remove(coin.mesh);
    }
    this.coins = [];
    this.animatingBlocks.clear();
    this.blockEntities.clear();
    this.blockMaterials.clear();
    this.pendingBlockText.clear();
    this.pendingButtonLabels.clear();
  }
}

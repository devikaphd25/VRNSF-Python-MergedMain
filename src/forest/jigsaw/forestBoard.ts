/**
 * The forest puzzle's centre board: a round sign hung between two trees.
 *
 * The code blocks climb a circular board, so the disc's flat front cap sits
 * half a block's thickness behind the block plane — every placed code row rests
 * on the board instead of hovering off the rim. A hook on each of the board's
 * upper sides ties it to the tree standing beside it: a rope runs from the hook
 * up and outward to an iron hook on that trunk, so the two trees hold the sign
 * between them, clear of the ground and of the control buttons beside it.
 *
 * A placed code row can be indented, so the caller passes the code column's
 * widest half-width rather than half a block: the disc is sized from the real
 * bounds of the column, which keeps every row — including a doubly indented one
 * — inside the rim. `forestBoardMetrics` gives the caller what it needs before
 * the board exists: the disc's top edge, which the feedback panel hangs above,
 * and the trees' x, which the owl perches inside of.
 */
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";

/** Same layout scale as ForestJigsawPuzzleSystem. */
const S = 2.2;

// ── Palette ───────────────────────────────────────────────────
const BOARD_GREEN = 0x3a5a3a; // the forest board's own dark green paint
const RIM_WOOD = 0x6b4a2a;
const BARK = 0x4a3520;
const BARK_DARK = 0x3a2a15;
const FOLIAGE_COLORS = [0x2d6a4f, 0x1b4332, 0x40916c];
const ROPE_COLOR = 0x8a7a5a;
const HOOK_IRON = 0x6b6f74;

/** Each tree stands this far outside the disc's rim. */
const TREE_GAP = 1.0;
const TREE_TRUNK_RADIUS = 0.3;
/** The board's own hooks sit this far up its rim, to either side of the middle. */
const HOOK_ANGLE = Math.PI / 5;
/** The trunk hook sits this far above the board hook, so the ropes rise. */
const ROPE_RISE = 0.45;
/** How far the trunk's hook stands off the bark, facing the board. */
const HOOK_STANDOFF = 0.1;
/** Nothing may be built past this, in either direction. */
const RIM_TUBE = 0.05 * S;
const ROPE_RADIUS = 0.035;

export interface ForestBoardLayout {
  /** The board's centre x, in world metres (the code column is centred on it). */
  centerX: number;
  /** Half the width of the widest a code row ever gets, indent included. */
  halfWidth: number;
  /** Top edge of the highest code row, in world y. */
  top: number;
  /** Bottom edge of the lowest code row, in world y. */
  bottom: number;
  /** The z the code blocks sit at: the plane the disc's face belongs behind. */
  z: number;
  /** A code block's thickness: the face parks half of it behind the plane. */
  blockThickness: number;
}

export interface ForestBoardMetrics {
  /** Centre y and radius of the disc the code rows are placed against. */
  centerY: number;
  radius: number;
  /** The disc's top edge: the feedback panel hangs just above it. */
  top: number;
  /** |x| of the two trees that hold the board, and where the owl perches. */
  treeX: number;
}

/** The disc that backs the code column, worked out from the column's bounds. */
export function forestBoardMetrics(
  layout: ForestBoardLayout,
): ForestBoardMetrics {
  const halfHeight = (layout.top - layout.bottom) / 2;
  const centerY = (layout.top + layout.bottom) / 2;
  // The column's far corner, plus a margin so no row sits on the rim.
  const radius = Math.hypot(layout.halfWidth, halfHeight) + 0.25;
  return {
    centerY,
    radius,
    top: centerY + radius,
    treeX: radius + TREE_GAP,
  };
}

/** A tapered limb running from `from` to `to`, aimed with a plain `lookAt`. */
function createLimb(
  from: Vector3,
  to: Vector3,
  radius: number,
  material: MeshStandardMaterial,
): Mesh {
  const direction = new Vector3().subVectors(to, from);
  const geometry = new CylinderGeometry(
    radius,
    radius * 0.78,
    direction.length(),
    8,
  );
  // Point the cylinder along +z so `lookAt` aims the whole segment, pitch
  // included. `lookAt` reads the object's world matrix, so this must run before
  // the limb is added to a parent.
  geometry.rotateX(Math.PI / 2);
  const limb = new Mesh(geometry, material);
  limb.position.copy(from).addScaledVector(direction, 0.5);
  limb.lookAt(to);
  return limb;
}

/** One of the two trees the board hangs between. */
function createHangingTree(
  x: number,
  z: number,
  height: number,
  inward: number,
  hookY: number,
  hookMat: MeshStandardMaterial,
): Group {
  const tree = new Group();
  tree.name = "ForestHangingTree";
  tree.position.set(x, 0, z);

  const barkMat = new MeshStandardMaterial({ color: BARK, roughness: 0.95 });
  const trunk = new Mesh(
    new CylinderGeometry(
      TREE_TRUNK_RADIUS * 0.72,
      TREE_TRUNK_RADIUS,
      height,
      10,
    ),
    barkMat,
  );
  trunk.name = "ForestTreeTrunk";
  trunk.position.y = height / 2;
  tree.add(trunk);

  // Two limbs, so the trunk does not read as a bare pole.
  for (const [up, out, tilt] of [
    [0.62, 0.9, 0.5],
    [0.78, 0.7, -0.35],
  ]) {
    const from = new Vector3(0, height * up, 0);
    const to = new Vector3(
      inward * out * 0.1,
      height * up + 0.55,
      out * 0.55 * Math.cos(tilt),
    );
    tree.add(createLimb(from, to, 0.09, barkMat));
  }

  // Canopy: a cluster of foliage above the trunk.
  for (let i = 0; i < 4; i++) {
    const blob = new Mesh(
      new SphereGeometry(0.85 - i * 0.07, 10, 8),
      new MeshStandardMaterial({
        color: FOLIAGE_COLORS[i % FOLIAGE_COLORS.length],
        roughness: 0.9,
        flatShading: true,
      }),
    );
    blob.position.set(
      inward * (i - 1.5) * 0.32,
      height + 0.35 + i * 0.34,
      (i % 2 === 0 ? 0.24 : -0.28),
    );
    tree.add(blob);
  }

  // The iron hook the rope ties to, on the side facing the board: a peg driven
  // into the trunk with a ring hanging off it.
  const peg = new Mesh(
    new CylinderGeometry(0.055, 0.055, 0.34, 8),
    hookMat,
  );
  peg.rotation.z = Math.PI / 2;
  peg.position.set(inward * (TREE_TRUNK_RADIUS - 0.05), hookY, 0);
  tree.add(peg);

  const hook = new Mesh(new TorusGeometry(0.11, 0.032, 8, 18), hookMat);
  hook.name = "ForestTreeHook";
  // Turned to face the board, so the rope passes through the ring's opening.
  hook.rotation.y = Math.PI / 2;
  hook.position.set(inward * (TREE_TRUNK_RADIUS + HOOK_STANDOFF), hookY, 0);
  tree.add(hook);

  return tree;
}

/**
 * Build the round board, its two hooks, the ropes and the two trees, positioned
 * in world space and ready to attach to the forest root.
 */
export function createForestBoard(layout: ForestBoardLayout): Group {
  const group = new Group();
  group.name = "ForestHangingBoard";

  const metrics = forestBoardMetrics(layout);
  const thickness = 0.09 * S;
  const hookMat = new MeshStandardMaterial({
    color: HOOK_IRON,
    roughness: 0.45,
    metalness: 0.6,
  });
  const ropeMat = new MeshStandardMaterial({
    color: ROPE_COLOR,
    roughness: 0.85,
  });

  // ── The round sign ────────────────────────────────────────
  const discGeometry = new CylinderGeometry(
    metrics.radius,
    metrics.radius,
    thickness,
    56,
  );
  // A cylinder stands on its y axis; turn it so its flat caps face the player.
  discGeometry.rotateX(Math.PI / 2);
  discGeometry.computeBoundingBox();

  const disc = new Mesh(
    discGeometry,
    new MeshStandardMaterial({ color: BOARD_GREEN, roughness: 0.82 }),
  );
  disc.name = "ForestBoardDisc";
  // Park the cap nearest the player half a block's thickness behind the block
  // plane: that is the face the placed code rows come to rest on.
  const faceZ = layout.blockThickness / 2;
  disc.position.y = metrics.centerY;
  disc.position.z = faceZ - (discGeometry.boundingBox?.min.z ?? 0);
  group.add(disc);

  const rim = new Mesh(
    new TorusGeometry(metrics.radius - RIM_TUBE, RIM_TUBE, 10, 64),
    new MeshStandardMaterial({ color: RIM_WOOD, roughness: 0.9 }),
  );
  rim.name = "ForestBoardRim";
  rim.position.y = metrics.centerY;
  rim.position.z = faceZ + thickness / 2;
  group.add(rim);

  // ── A hook on each upper side ─────────────────────────────
  const hookAt = (side: number) =>
    new Vector3(
      side * metrics.radius * Math.cos(HOOK_ANGLE),
      metrics.centerY + metrics.radius * Math.sin(HOOK_ANGLE),
      faceZ - 0.03,
    );

  const boardHooks = new Map<number, Vector3>();
  for (const side of [-1, 1]) {
    const at = hookAt(side);
    const hook = new Mesh(new TorusGeometry(0.14, 0.04 * S, 8, 20), hookMat);
    hook.name = "ForestBoardHook";
    hook.position.copy(at);
    group.add(hook);
    boardHooks.set(side, at);
  }

  // ── The two trees, and a rope from each board hook to its trunk ──
  const treeHookY = (boardHooks.get(1) as Vector3).y + ROPE_RISE;
  for (const side of [-1, 1]) {
    const inward = -side;
    group.add(
      createHangingTree(
        side * metrics.treeX,
        0,
        side < 0 ? 4.9 : 4.6,
        inward,
        treeHookY,
        hookMat,
      ),
    );

    // The rope is aimed before it joins the group, so `lookAt` resolves in the
    // group's own space.
    const from = boardHooks.get(side) as Vector3;
    const to = new Vector3(
      side * (metrics.treeX - TREE_TRUNK_RADIUS - HOOK_STANDOFF),
      treeHookY,
      0,
    );
    const rope = createLimb(from, to, ROPE_RADIUS, ropeMat);
    rope.name = "ForestBoardRope";
    group.add(rope);
  }

  // The group sits on the block plane, so its local z is the code plane.
  group.position.set(layout.centerX, 0, layout.z);
  return group;
}

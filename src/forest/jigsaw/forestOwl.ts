/**
 * The owl that presents the forest puzzle's instructions.
 *
 * The player enters the clearing at (0, 0, -1) facing +z, so -x is their right:
 * the owl perches on a branch of the tree that holds the round board's
 * right-hand rope, the branch reaching out toward the player and away from the
 * board. It sits facing the player, talons over the branch, and the instruction
 * board hangs from a crossbar lashed under that branch — below the owl's feet,
 * so the owl stays in view above the sign. The sign is narrow enough to hang
 * clear of both the round board and the control buttons beside it, so neither a
 * code row nor a control is ever covered.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";

/** Same layout scale as ForestJigsawPuzzleSystem. */
const S = 2.2;

// ── Owl palette ───────────────────────────────────────────────
const FEATHER = 0x7a5a3a;
const FEATHER_DARK = 0x5b4229;
const BREAST = 0xd8c39f;
const FACE = 0xe8dcc0;
const IRIS = 0xffb703;
const PUPIL = 0x14161c;
const BEAK = 0x9c8054;
const TALON = 0x4a4a4a;

// ── Perch ─────────────────────────────────────────────────────
/** Height of the branch the owl grips, in world y. */
const PERCH_Y = 3.5;
/** How far the branch reaches out from the trunk, away from the board. */
const PERCH_OUT = 0.55;
/** How far it reaches toward the player's entry point. */
const PERCH_FORWARD = 1.0;
const BRANCH_RADIUS = 0.11;

// ── Instruction board ─────────────────────────────────────────
const SIGN_WIDTH = 0.85 * S;
const SIGN_HEIGHT = 1.15 * S;
/** The crossbar hangs this far under the branch, and the sign this far under it. */
const CROSSBAR_DROP = 0.3;
const SIGN_GAP = 0.12;
const ROPE_RADIUS = 0.025;
const SIGN_PARCHMENT = 0xf5f0e6;
const ROPE_COLOR = 0x8a7a5a;

export interface OwlSignLayout {
  /** Centre of the instruction board's backing, in world metres. */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Yaw of the board: it faces the player's entry point. */
  yaw: number;
  width: number;
  height: number;
  /** Unit direction from the board toward the player, for lifting the text off it. */
  towardPlayerX: number;
  towardPlayerZ: number;
}

export interface OwlProp {
  /** The owl, its perch branch and the hanging sign's backing, already placed. */
  group: Group;
  /** Where the instruction board hangs, for the PanelUI the system adds. */
  sign: OwlSignLayout;
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
    radius * 0.85,
    direction.length(),
    8,
  );
  // Point the cylinder along +z so `lookAt` aims the whole segment. `lookAt`
  // reads the object's world matrix, so this must run before the limb is added
  // to a parent.
  geometry.rotateX(Math.PI / 2);
  const limb = new Mesh(geometry, material);
  limb.position.copy(from).addScaledVector(direction, 0.5);
  limb.lookAt(to);
  return limb;
}

/** The owl itself, built in its own local space with its feet on y = 0. */
function createOwl(): Group {
  const owl = new Group();
  owl.name = "ForestOwl";

  const featherMat = new MeshStandardMaterial({
    color: FEATHER,
    roughness: 0.88,
  });
  const darkMat = new MeshStandardMaterial({
    color: FEATHER_DARK,
    roughness: 0.9,
  });
  const breastMat = new MeshStandardMaterial({
    color: BREAST,
    roughness: 0.92,
  });
  const faceMat = new MeshStandardMaterial({ color: FACE, roughness: 0.9 });
  const irisMat = new MeshStandardMaterial({
    color: IRIS,
    roughness: 0.4,
    emissive: IRIS,
    emissiveIntensity: 0.15,
  });
  const pupilMat = new MeshStandardMaterial({ color: PUPIL, roughness: 0.3 });
  const beakMat = new MeshStandardMaterial({ color: BEAK, roughness: 0.55 });
  const talonMat = new MeshStandardMaterial({ color: TALON, roughness: 0.45 });

  // Body, with the paler breast patch the owl faces the player with.
  const body = new Mesh(new SphereGeometry(0.3, 18, 14), featherMat);
  body.name = "ForestOwlBody";
  body.position.set(0, 0.33, 0);
  body.scale.set(1, 1.12, 0.92);
  owl.add(body);

  const breast = new Mesh(new SphereGeometry(0.24, 14, 12), breastMat);
  breast.position.set(0, 0.34, 0.11);
  breast.scale.set(0.78, 1.0, 0.55);
  owl.add(breast);

  // Folded wings on either side.
  for (const side of [-1, 1]) {
    const wing = new Mesh(new SphereGeometry(0.24, 12, 10), darkMat);
    wing.position.set(side * 0.29, 0.36, -0.03);
    wing.scale.set(0.2, 0.9, 0.55);
    wing.rotation.z = -side * 0.12;
    owl.add(wing);
  }

  // Head with the two facial discs, oversized eyes and a small hooked beak.
  const head = new Mesh(new SphereGeometry(0.2, 16, 14), featherMat);
  head.name = "ForestOwlHead";
  head.position.set(0, 0.79, 0.02);
  owl.add(head);

  for (const side of [-1, 1]) {
    const disc = new Mesh(new SphereGeometry(0.135, 14, 12), faceMat);
    disc.position.set(side * 0.09, 0.8, 0.13);
    disc.scale.set(1, 1.1, 0.4);
    owl.add(disc);

    const eye = new Mesh(new SphereGeometry(0.065, 12, 10), irisMat);
    eye.name = "ForestOwlEye";
    eye.position.set(side * 0.09, 0.81, 0.2);
    owl.add(eye);

    const pupil = new Mesh(new SphereGeometry(0.034, 10, 8), pupilMat);
    pupil.position.set(side * 0.09, 0.81, 0.243);
    owl.add(pupil);

    // Ear tufts, so it reads as a horned owl rather than a ball of feathers.
    const tuft = new Mesh(new ConeGeometry(0.055, 0.15, 8), darkMat);
    tuft.position.set(side * 0.12, 0.93, 0);
    tuft.rotation.z = -side * 0.32;
    owl.add(tuft);
  }

  const beak = new Mesh(new ConeGeometry(0.045, 0.1, 8), beakMat);
  beak.position.set(0, 0.74, 0.19);
  beak.rotation.x = Math.PI * 0.62;
  owl.add(beak);

  const tail = new Mesh(new SphereGeometry(0.18, 10, 8), darkMat);
  tail.position.set(0, 0.2, -0.26);
  tail.scale.set(0.6, 0.5, 0.9);
  owl.add(tail);

  // Talons, wrapped forward and down over the branch.
  for (const side of [-1, 1]) {
    const ankle = new Mesh(new SphereGeometry(0.055, 10, 8), darkMat);
    ankle.position.set(side * 0.15, 0.08, 0);
    owl.add(ankle);

    for (const spread of [-0.06, 0, 0.06]) {
      const from = new Vector3(side * 0.15, 0.07, 0.01);
      const to = new Vector3(side * 0.15 + spread, -0.015, 0.15);
      const toe = createLimb(from, to, 0.022, talonMat);
      toe.name = "ForestOwlTalon";
      owl.add(toe);
    }
  }

  return owl;
}

/**
 * Build the owl, the branch it grips, and the instruction board hanging from
 * that branch, all positioned in world space and ready to attach to the forest
 * root. `treeX` is the tree it perches on (the right-hand hanger, at the
 * player's right), `treeZ` the z that tree stands at.
 */
export function createOwlProp(treeX: number, treeZ: number): OwlProp {
  const group = new Group();
  group.name = "ForestOwlProp";

  const outward = treeX < 0 ? -1 : 1;
  const perch = new Vector3(
    treeX + outward * PERCH_OUT,
    PERCH_Y,
    treeZ - PERCH_FORWARD,
  );
  const yaw = Math.atan2(0 - perch.x, -1.0 - perch.z);
  // The owl faces the player's entry point; its local +z is that same yaw.
  const toward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const barkMat = new MeshStandardMaterial({ color: 0x4a3520, roughness: 0.95 });
  const ropeMat = new MeshStandardMaterial({
    color: ROPE_COLOR,
    roughness: 0.85,
  });

  // ── The branch the owl grips ──────────────────────────────
  // From the trunk out toward the player and away from the board, rising so its
  // far end's top surface is the perch the talons close on.
  const branch = createLimb(
    new Vector3(treeX + outward * 0.18, PERCH_Y - 0.62, treeZ + 0.12),
    new Vector3(perch.x, PERCH_Y - BRANCH_RADIUS, perch.z),
    BRANCH_RADIUS,
    barkMat,
  );
  branch.name = "ForestOwlBranch";
  group.add(branch);

  // ── The board that hangs from that branch ─────────────────
  // A crossbar lashed just under the branch, and the sign's two top corners
  // roped to the crossbar's ends.
  const hanger = new Vector3(
    perch.x + toward.x * 0.08,
    PERCH_Y - CROSSBAR_DROP,
    perch.z + toward.z * 0.08,
  );
  const topEdge = hanger.y - SIGN_GAP;
  const signCenterY = topEdge - SIGN_HEIGHT / 2;
  // The sign's own width axis, after its yaw.
  const along = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const barHalf = (SIGN_WIDTH * 0.82) / 2;

  const lashing = createLimb(
    new Vector3(perch.x, PERCH_Y - 0.04, perch.z),
    new Vector3(hanger.x, hanger.y + 0.03, hanger.z),
    ROPE_RADIUS,
    ropeMat,
  );
  lashing.name = "ForestOwlLashing";
  group.add(lashing);

  const crossbar = createLimb(
    hanger.clone().addScaledVector(along, -barHalf),
    hanger.clone().addScaledVector(along, barHalf),
    0.045,
    barkMat,
  );
  crossbar.name = "ForestOwlCrossbar";
  group.add(crossbar);

  for (const side of [-1, 1]) {
    const corner = new Vector3(
      hanger.x + along.x * side * (SIGN_WIDTH / 2 - 0.1),
      topEdge,
      hanger.z + along.z * side * (SIGN_WIDTH / 2 - 0.1),
    );
    const rope = createLimb(
      hanger.clone().addScaledVector(along, side * barHalf),
      corner,
      ROPE_RADIUS,
      ropeMat,
    );
    rope.name = "ForestOwlSignRope";
    group.add(rope);
  }

  const backing = new Mesh(
    new BoxGeometry(SIGN_WIDTH, SIGN_HEIGHT, 0.03 * S),
    new MeshStandardMaterial({
      color: SIGN_PARCHMENT,
      roughness: 0.9,
      side: DoubleSide,
    }),
  );
  backing.name = "ForestOwlSignBoard";
  backing.position.set(hanger.x, signCenterY, hanger.z);
  backing.rotation.y = yaw;
  group.add(backing);

  // ── The owl, sitting on the branch above the sign ─────────
  const owl = createOwl();
  owl.position.copy(perch);
  owl.rotation.y = yaw;
  group.add(owl);

  return {
    group,
    sign: {
      centerX: hanger.x,
      centerY: signCenterY,
      centerZ: hanger.z,
      yaw,
      width: SIGN_WIDTH,
      height: SIGN_HEIGHT,
      towardPlayerX: toward.x,
      towardPlayerZ: toward.z,
    },
  };
}

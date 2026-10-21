/**
 * The crab that holds the ocean puzzle's instructions board.
 *
 * The player enters the reef at (0, 0, -1) facing +z, so -x is their right:
 * the crab stands on the sand there, inside the coral clearing, facing the
 * player with its claws holding the big instructions board up in front of
 * itself. The board's bottom edge clears the crab's head, so the crab stays
 * visible below the sign instead of hiding behind it.
 *
 * The crab is built in its own local space (+z toward the player) and placed by
 * one yaw, so the board — created by OceanJigsawPuzzleSystem from the exported
 * INSTRUCTION_BOARD_* constants — lines up with the claws holding it.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";

/** Same layout scale as OceanJigsawPuzzleSystem. */
const S = 2.2;

// ── Where the crab stands ─────────────────────────────────────
export const CRAB_X = -2.8;
export const CRAB_Z = 1.6;
export const CRAB_LOOK_X = 0;
export const CRAB_LOOK_Z = -1.0;

/** Yaw facing the player's entry point; yaw only, so the crab stays upright. */
export const CRAB_YAW = Math.atan2(CRAB_LOOK_X - CRAB_X, CRAB_LOOK_Z - CRAB_Z);
export const TOWARD_PLAYER_X = Math.sin(CRAB_YAW);
export const TOWARD_PLAYER_Z = Math.cos(CRAB_YAW);

// ── Instructions board the crab holds ─────────────────────────
/** How far in front of the crab the board is held. */
export const INSTRUCTION_BOARD_DISTANCE = 0.85;
/**
 * Board centre height. The crab holds the sign up overhead, so from the
 * player's eye the whole crab — body, eyes and claws — stays in the clear band
 * below the board instead of hiding behind it.
 */
export const INSTRUCTION_BOARD_Y = 2.6;
export const INSTRUCTION_BOARD_WIDTH = 0.85 * S;
export const INSTRUCTION_BOARD_HEIGHT = 1.15 * S;
export const INSTRUCTION_BOARD_X =
  CRAB_X + TOWARD_PLAYER_X * INSTRUCTION_BOARD_DISTANCE;
export const INSTRUCTION_BOARD_Z =
  CRAB_Z + TOWARD_PLAYER_Z * INSTRUCTION_BOARD_DISTANCE;

/** Claws grip the board just inside its lower corners. */
const GRIP_X = INSTRUCTION_BOARD_WIDTH / 2 - 0.1;
const GRIP_Y = INSTRUCTION_BOARD_Y - INSTRUCTION_BOARD_HEIGHT / 2 + 0.05;
const GRIP_Z = INSTRUCTION_BOARD_DISTANCE - 0.03;

const SHELL_COLOR = 0xd9542b;
const CLAW_COLOR = 0xc2431f;
const STALK_COLOR = 0xe4a13c;
const EYE_WHITE = 0xf2faff;
const PUPIL_DARK = 0x14161c;

/**
 * A tapered limb running from `from` to `to` in the parent's local space: the
 * cylinder's axis is rotated onto +z so a plain `lookAt` aims the segment,
 * including its pitch.
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
    radius * 0.72,
    direction.length(),
    8,
  );
  geometry.rotateX(Math.PI / 2);
  const limb = new Mesh(geometry, material);
  limb.position.copy(from).addScaledVector(direction, 0.5);
  limb.lookAt(to);
  return limb;
}

export function createCrab(): Group {
  const crab = new Group();
  crab.name = "OceanCrab";

  const shellMat = new MeshStandardMaterial({
    color: SHELL_COLOR,
    roughness: 0.6,
    emissive: SHELL_COLOR,
    emissiveIntensity: 0.12,
  });
  const clawMat = new MeshStandardMaterial({
    color: CLAW_COLOR,
    roughness: 0.55,
    emissive: CLAW_COLOR,
    emissiveIntensity: 0.1,
  });
  const stalkMat = new MeshStandardMaterial({
    color: STALK_COLOR,
    roughness: 0.7,
  });
  const eyeWhiteMat = new MeshStandardMaterial({
    color: EYE_WHITE,
    roughness: 0.35,
  });
  const pupilMat = new MeshStandardMaterial({
    color: PUPIL_DARK,
    roughness: 0.3,
  });

  // Six legs, splayed out to the sand so the crab stands on the floor.
  for (const side of [-1, 1]) {
    for (const spread of [-0.32, 0, 0.32]) {
      const hip = new Vector3(side * 0.42, 0.42, spread * 0.8);
      const toe = new Vector3(
        side * (spread === 0 ? 1.0 : 0.88),
        0.06,
        spread * 1.5,
      );
      crab.add(createLimb(hip, toe, 0.045 * S, clawMat));
      const foot = new Mesh(new SphereGeometry(0.05 * S, 8, 8), clawMat);
      foot.position.copy(toe);
      crab.add(foot);
    }
  }

  // Carapace: one flattened shell, the crab's whole body.
  const shell = new Mesh(new SphereGeometry(0.26 * S, 18, 12), shellMat);
  shell.name = "OceanCrabShell";
  shell.scale.set(1.25, 0.55, 1.0);
  shell.position.set(0, 0.5, 0);
  crab.add(shell);

  // Eyes on stalks, kept below the board's bottom edge so they stay in view.
  for (const side of [-1, 1]) {
    const base = new Vector3(side * 0.26, 0.68, 0.3);
    const tip = new Vector3(side * 0.4, 0.82, 0.44);
    crab.add(createLimb(base, tip, 0.035 * S, stalkMat));

    const white = new Mesh(new SphereGeometry(0.045 * S, 10, 10), eyeWhiteMat);
    white.name = "OceanCrabEye";
    white.position.copy(tip);
    crab.add(white);

    const pupil = new Mesh(new SphereGeometry(0.025 * S, 8, 8), pupilMat);
    pupil.position.copy(tip).add(new Vector3(0, 0, 0.07));
    crab.add(pupil);
  }

  // Both arms reach up and forward to the board's lower corners, where a
  // two-jawed pincer clamps onto the edge — the crab holds the sign up.
  for (const side of [-1, 1]) {
    const shoulder = new Vector3(side * 0.42, 0.62, 0.28);
    const grip = new Vector3(side * GRIP_X, GRIP_Y, GRIP_Z);
    crab.add(createLimb(shoulder, grip, 0.075 * S, clawMat));

    const jaws: Array<[number, number, number]> = [
      [0.06, 0.09, 0.3],
      [0.02, -0.08, -0.22],
    ];
    for (const [out, up, tilt] of jaws) {
      const jaw = new Mesh(new BoxGeometry(0.32, 0.075, 0.14), clawMat);
      jaw.name = "OceanCrabClaw";
      jaw.position.set(
        side * (GRIP_X + out),
        GRIP_Y + up,
        GRIP_Z - 0.06,
      );
      jaw.rotation.z = side * tilt;
      crab.add(jaw);
    }
  }

  crab.position.set(CRAB_X, 0, CRAB_Z);
  crab.rotation.y = CRAB_YAW;
  return crab;
}

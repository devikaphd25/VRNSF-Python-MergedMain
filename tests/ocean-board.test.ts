/**
 * Layout of the ocean puzzle's centre board (a large blue whale the code blocks
 * climb) and of the crab that holds its instruction board.
 *
 * Neither prop can be checked by eye from the reef's own code, and a headset is
 * the only place the room renders, so this suite pins the geometry down: the
 * whale's flat flank carries every code row and stays clear of the control
 * buttons, its head stops under the feedback panel that hangs in front of the
 * board, and the crab holds the sign up in front of itself with both claws —
 * below the board, so the crab itself stays visible.
 *
 * Both builders are plain three.js object graphs, so they are built here
 * directly, with no ECS world or renderer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, ExtrudeGeometry, Mesh, Raycaster, Vector3 } from "three";
import { createWhaleBoard } from "../src/ocean/jigsaw/oceanWhaleBoard.ts";
import {
  CRAB_X,
  CRAB_YAW,
  CRAB_Z,
  INSTRUCTION_BOARD_HEIGHT,
  INSTRUCTION_BOARD_WIDTH,
  INSTRUCTION_BOARD_X,
  INSTRUCTION_BOARD_Y,
  INSTRUCTION_BOARD_Z,
  TOWARD_PLAYER_X,
  TOWARD_PLAYER_Z,
  createCrab,
} from "../src/ocean/jigsaw/oceanCrab.ts";

// The ocean puzzle's own layout (OceanJigsawPuzzleSystem): ten rows pitched
// 0.17 * S apart, the top row's upper edge on the board's top edge, and the
// feedback panel anchored above the board centre.
const S = 2.2;
const SLOT_HEIGHT = 0.17 * S;
const BLOCK_HEIGHT = 0.14 * S;
const BLOCK_WIDTH = 0.9 * S;
const NUM_SLOTS = 10;
const BOARD_CENTER: [number, number, number] = [0, 1.4, 4.5];
const BOARD_WIDTH = 1.6 * S;
const BOARD_HEIGHT = 2.0 * S;
const BUTTON_SIZE = 0.14 * S;
const FEEDBACK_HEIGHT = 0.6 * S;
const FEEDBACK_Y =
  BOARD_CENTER[1] + BOARD_HEIGHT / 2 + FEEDBACK_HEIGHT / 2 + 0.06 * S;

const startY = BOARD_CENTER[1] + BOARD_HEIGHT / 2 - SLOT_HEIGHT / 2;
const rowY = (row: number) => startY - row * SLOT_HEIGHT;

const COLUMN = {
  centerX: BOARD_CENTER[0],
  halfWidth: BLOCK_WIDTH / 2,
  top: rowY(0) + BLOCK_HEIGHT / 2,
  bottom: rowY(NUM_SLOTS - 1) - BLOCK_HEIGHT / 2,
  z: BOARD_CENTER[2],
  headLimit: FEEDBACK_Y - FEEDBACK_HEIGHT / 2,
};

/** Inner edge of the buttons that hang beside the board. */
const BUTTON_INNER_X =
  -(BOARD_WIDTH / 2 + 0.22 * S) + (BUTTON_SIZE * 1.8) / 2;

function whaleBody(whale: ReturnType<typeof createWhaleBoard>): Mesh {
  const body = whale.children.find(
    (child): child is Mesh =>
      child instanceof Mesh && child.geometry instanceof ExtrudeGeometry,
  );
  assert.ok(body, "the whale must be built from an extruded silhouette");
  return body;
}

test("the whale's flank carries every code row and clears the buttons", () => {
  const whale = createWhaleBoard(COLUMN);
  whale.updateMatrixWorld(true);
  const body = whaleBody(whale);

  const box = new Box3().setFromObject(body);
  assert.ok(
    box.min.z > COLUMN.z,
    `the whale's face must sit behind the block plane (got ${box.min.z})`,
  );
  assert.ok(
    box.min.z < COLUMN.z + BLOCK_HEIGHT / 2 + 0.02,
    "a placed block must rest on the whale, not float off it",
  );
  assert.ok(
    box.max.z - box.min.z > 0.3,
    "the whale must be a body with depth, not a flat panel",
  );

  // Every row below the top one lands on the whale: a ray from the front, at
  // the row's own outer edges, has to meet the whale's body.
  const raycaster = new Raycaster();
  const backed = (x: number, y: number) => {
    raycaster.set(new Vector3(x, y, COLUMN.z - 2), new Vector3(0, 0, 1));
    return raycaster.intersectObject(body, false).length > 0;
  };
  for (let row = 1; row < NUM_SLOTS; row++) {
    for (const x of [-COLUMN.halfWidth, 0, COLUMN.halfWidth]) {
      assert.ok(
        backed(x, rowY(row)),
        `the whale must back the code row at (${x}, ${rowY(row)})`,
      );
    }
  }

  // The top row sits at the feedback panel's edge, and the panel hangs in front
  // of the whale: the head stops clear of the panel while still reaching behind
  // that row, so the row is never left with open water behind it.
  const headTop = new Box3().setFromObject(whale).max.y;
  assert.ok(
    headTop < COLUMN.headLimit,
    `the head must stay clear of the feedback panel (got ${headTop})`,
  );
  assert.ok(
    headTop > COLUMN.top - BLOCK_HEIGHT + 0.05,
    `the head must still reach behind the top code row (got ${headTop})`,
  );

  // Nothing on the whale reaches into the buttons' column beside the board.
  const whole = new Box3().setFromObject(whale);
  assert.ok(
    whole.min.x > BUTTON_INNER_X,
    `the whale must not reach the buttons (${whole.min.x} vs ${BUTTON_INNER_X})`,
  );
});

test("the crab holds the instructions board up clear of its own head", () => {
  const crab = createCrab();
  crab.updateMatrixWorld(true);

  const boardCentre = new Vector3(
    INSTRUCTION_BOARD_X,
    INSTRUCTION_BOARD_Y,
    INSTRUCTION_BOARD_Z,
  );
  const boardBottom = INSTRUCTION_BOARD_Y - INSTRUCTION_BOARD_HEIGHT / 2;
  const facing = new Vector3(TOWARD_PLAYER_X, 0, TOWARD_PLAYER_Z);

  // The crab faces the player's entry point, and holds the board out in front.
  const toPlayer = new Vector3(0 - CRAB_X, 0, -1.0 - CRAB_Z).normalize();
  assert.ok(
    facing.dot(toPlayer) > 0.999,
    "the crab must face the player's entry point",
  );
  const fromCrab = boardCentre.clone().sub(new Vector3(CRAB_X, 0, CRAB_Z));
  assert.ok(
    fromCrab.dot(facing) > 0.5,
    "the board must be held out in front of the crab",
  );

  // The sign is held up at reading height, clear of the sand.
  assert.ok(
    boardBottom > 0.5,
    `the board must be held up, not laid on the sand (bottom ${boardBottom})`,
  );
  assert.ok(
    INSTRUCTION_BOARD_Y > 1.2 && INSTRUCTION_BOARD_Y < 3.0,
    "the board must sit at a readable height",
  );

  // Crab body and eyes stay below the board, so the crab stays visible.
  const shell = crab.getObjectByName("OceanCrabShell");
  assert.ok(shell, "the crab needs a shell");
  assert.ok(
    new Box3().setFromObject(shell).max.y < boardBottom,
    "the crab's shell must stay below the board",
  );
  const eyes = crab.children.filter(child => child.name === "OceanCrabEye");
  assert.equal(eyes.length, 2, "the crab needs both eyes");
  for (const eye of eyes) {
    assert.ok(
      new Box3().setFromObject(eye).max.y < boardBottom,
      "the crab's eyes must stay below the board, not hide behind it",
    );
  }

  // A two-jawed claw clamps each of the board's lower corners.
  const claws = crab.children
    .filter(child => child.name === "OceanCrabClaw")
    .map(child => child.getWorldPosition(new Vector3()));
  assert.equal(claws.length, 4, "each claw has two jaws");
  const alongBoard = new Vector3(Math.cos(CRAB_YAW), 0, -Math.sin(CRAB_YAW));
  for (const side of [-1, 1]) {
    const corner = boardCentre
      .clone()
      .addScaledVector(alongBoard, side * (INSTRUCTION_BOARD_WIDTH / 2 - 0.1))
      .setY(boardBottom + 0.05);
    const nearest = Math.min(...claws.map(claw => claw.distanceTo(corner)));
    assert.ok(
      nearest < 0.2,
      `a claw must clamp the board's lower corner (nearest ${nearest.toFixed(3)} m)`,
    );
  }

  // The crab stands inside the reef's coral clearing (OceanEnvironmentManager
  // builds the ocean with a 3.5 m clearing around the puzzle).
  const shellAt = shell.getWorldPosition(new Vector3());
  assert.ok(
    Math.hypot(shellAt.x, shellAt.z) < 3.5,
    `the crab must stand inside the coral clearing (${Math.hypot(shellAt.x, shellAt.z)})`,
  );
});

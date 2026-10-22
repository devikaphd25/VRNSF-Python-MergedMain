/**
 * Layout of the forest puzzle's centre board — a round sign hung between two
 * trees — and of the owl that perches on one of them with the instructions
 * board.
 *
 * The clearing only renders inside a headset behind the student login, so this
 * suite pins both props down from their own code: the disc backs every code row
 * (an indented one included) and hangs clear of the ground and of the control
 * buttons, each of the two trees stands outside the rim with a rope from the
 * board's own hook up to the trunk beside it, and the owl perches well above the
 * ground facing the player, with the sign hanging below its feet at reading
 * height, clear of both the board and the buttons. The feedback panel hangs just
 * above the disc's top edge, where the player is already looking.
 *
 * Both builders are plain three.js object graphs, so they are built here
 * directly, with no ECS world and no renderer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Mesh, Object3D, Raycaster, Vector3 } from "three";
import {
  createForestBoard,
  forestBoardMetrics,
} from "../src/forest/jigsaw/forestBoard.ts";
import { createOwlProp } from "../src/forest/jigsaw/forestOwl.ts";

// The forest puzzle's own layout (ForestJigsawPuzzleSystem): seven rows pitched
// 0.17 * S apart from the board's top edge, and the feedback panel anchored to
// the round board's top.
const S = 2.2;
const SLOT_HEIGHT = 0.17 * S;
const BLOCK_HEIGHT = 0.14 * S;
const BLOCK_WIDTH = 0.9 * S;
const BLOCK_THICKNESS = 0.05 * S;
const INDENT_SHIFT = 0.15 * S;
const NUM_SLOTS = 7;
const BOARD_CENTER: [number, number, number] = [0, 1.9, 4.5];
const BOARD_WIDTH = 1.6 * S;
const BOARD_HEIGHT = 1.6 * S;
const BUTTON_SIZE = 0.14 * S;
const FEEDBACK_HEIGHT = 0.6 * S;

const SLOT_START_Y = BOARD_CENTER[1] + BOARD_HEIGHT / 2 - SLOT_HEIGHT / 2;
const rowY = (row: number) => SLOT_START_Y - row * SLOT_HEIGHT;

const COLUMN = {
  centerX: BOARD_CENTER[0],
  halfWidth: BLOCK_WIDTH / 2 + INDENT_SHIFT,
  top: rowY(0) + BLOCK_HEIGHT / 2,
  bottom: rowY(NUM_SLOTS - 1) - BLOCK_HEIGHT / 2,
  z: BOARD_CENTER[2],
  blockThickness: BLOCK_THICKNESS,
};
const METRICS = forestBoardMetrics(COLUMN);
const FEEDBACK_Y = METRICS.top + FEEDBACK_HEIGHT / 2 + 0.06 * S;

/** Outer edge of the buttons that hang beside the board. */
const BUTTON_OUTER_X =
  -(BOARD_WIDTH / 2 + 0.22 * S) - (BUTTON_SIZE * 1.8) / 2;

const at = (object: Object3D) => object.getWorldPosition(new Vector3());

test("the round board backs every code row and hangs clear of the ground", () => {
  const board = createForestBoard(COLUMN);
  board.updateMatrixWorld(true);

  const disc = board.getObjectByName("ForestBoardDisc") as Mesh | undefined;
  assert.ok(disc, "the board must be a disc");
  const discBox = new Box3().setFromObject(disc);

  assert.ok(
    discBox.min.y > 0.05,
    `the board must hang clear of the ground (bottom ${discBox.min.y})`,
  );
  assert.ok(
    discBox.max.y > COLUMN.top,
    "the rim must reach above the top code row",
  );
  assert.ok(
    FEEDBACK_Y - FEEDBACK_HEIGHT / 2 > discBox.max.y,
    "the feedback panel must sit above the board, not across it",
  );
  assert.ok(
    discBox.min.x > BUTTON_OUTER_X,
    `the board must not reach the buttons (${discBox.min.x} vs ${BUTTON_OUTER_X})`,
  );
  // The face the blocks rest on: behind the block plane by half a block, close
  // enough that a placed row touches it instead of floating.
  assert.ok(
    discBox.min.z > COLUMN.z,
    `the board's face must sit behind the block plane (got ${discBox.min.z})`,
  );
  assert.ok(
    discBox.min.z <= COLUMN.z + BLOCK_THICKNESS / 2 + 0.01,
    "a placed block must rest on the board, not float off it",
  );

  // Every row — the widest indented one included — lands on the disc: a ray from
  // the player's side, at that row's own outer edges, has to meet the board.
  const raycaster = new Raycaster();
  const backed = (x: number, y: number) => {
    raycaster.set(new Vector3(x, y, COLUMN.z - 2), new Vector3(0, 0, 1));
    return raycaster.intersectObject(disc, false).length > 0;
  };
  for (let row = 0; row < NUM_SLOTS; row++) {
    for (const x of [-COLUMN.halfWidth, COLUMN.halfWidth]) {
      assert.ok(
        backed(x, rowY(row)),
        `the board must back the code row at (${x}, ${rowY(row)})`,
      );
    }
  }
});

test("the two trees hold the board's hooks with a rope each", () => {
  const board = createForestBoard(COLUMN);
  board.updateMatrixWorld(true);

  const trees = board.children.filter(
    child => child.name === "ForestHangingTree",
  );
  assert.equal(trees.length, 2, "the board hangs between two trees");

  const boardHooks = board.children
    .filter(child => child.name === "ForestBoardHook")
    .map(at);
  const ropes = board.children.filter(
    child => child.name === "ForestBoardRope",
  );
  assert.equal(boardHooks.length, 2, "a hook on each of the board's sides");
  assert.equal(ropes.length, 2, "a rope from each hook to its own tree");

  for (const tree of trees) {
    const trunkAt = at(tree);
    const treeBox = new Box3().setFromObject(tree);

    // Outside the disc's rim, rooted in the ground, rising above the board.
    assert.ok(
      Math.abs(trunkAt.x) > METRICS.radius,
      `each tree must stand outside the board (${trunkAt.x})`,
    );
    assert.ok(
      trunkAt.z === BOARD_CENTER[2],
      "both trees must stand in the board's own plane",
    );
    assert.ok(
      Math.abs(treeBox.min.y) < 0.05,
      `each tree must stand on the ground (${treeBox.min.y})`,
    );
    assert.ok(
      treeBox.max.y > discTop(COLUMN),
      "the trees must rise above the board they hold",
    );

    // The rope ties this tree's hook to the board hook on the same side, and it
    // rises outward, so the board hangs from it.
    const treeHook = tree.getObjectByName("ForestTreeHook");
    assert.ok(treeHook, "each tree needs a hook for its rope");
    const treeHookAt = at(treeHook);
    assert.ok(
      Math.sign(treeHookAt.x) === Math.sign(trunkAt.x),
      "each tree's hook must face the board it holds",
    );
    const hookAt = boardHooks.find(hook => Math.sign(hook.x) === Math.sign(trunkAt.x));
    assert.ok(hookAt, "each tree must have a board hook on its own side");
    assert.ok(
      treeHookAt.y > hookAt.y,
      "the rope must rise to the tree, so the board hangs from it",
    );

    const rope = ropes.find(
      rope => Math.sign(at(rope).x) === Math.sign(trunkAt.x),
    );
    assert.ok(rope, "each side needs its own rope");
    const ropeBox = new Box3().setFromObject(rope).expandByScalar(0.12);
    assert.ok(
      ropeBox.containsPoint(hookAt),
      "the rope must reach the board's hook",
    );
    assert.ok(
      ropeBox.containsPoint(treeHookAt),
      "the rope must reach the tree's hook",
    );
  }

  // The right-hand tree, and the hook and rope it holds the board with, clear
  // the buttons beside the board, so its hanger never stands in front of a
  // control. (The canopy spreads inward high above them and is not in question.)
  const rightTree = trees.find(tree => at(tree).x < 0) as Object3D;
  for (const name of ["ForestTreeTrunk", "ForestTreeHook"]) {
    const part = rightTree.getObjectByName(name) as Object3D;
    assert.ok(part, `the right-hand tree must have its ${name}`);
    assert.ok(
      new Box3().setFromObject(part).max.x < BUTTON_OUTER_X,
      `the tree's ${name} must clear the buttons`,
    );
  }
});

test("the owl perches on the tree above its sign, clear of the board", () => {
  const treeX = -METRICS.treeX;
  const { group, sign } = createOwlProp(treeX, BOARD_CENTER[2]);
  group.updateMatrixWorld(true);

  const owl = group.getObjectByName("ForestOwl");
  assert.ok(owl, "the owl prop must contain the owl");
  const perch = at(owl);
  const owlBox = new Box3().setFromObject(owl);

  // Perched on the tree at the player's right, up in its branches.
  assert.ok(perch.x < 0, "the owl must perch at the player's right");
  assert.ok(
    Math.abs(perch.x - treeX) < 1.2,
    `the owl must perch on the tree that holds the board (${perch.x})`,
  );
  assert.ok(
    Math.abs(perch.z - BOARD_CENTER[2]) < 1.4,
    "the owl must perch on the branch reaching toward the player",
  );
  assert.ok(
    owlBox.min.y > 1.5,
    `the owl must sit up in the tree, not on the ground (${owlBox.min.y})`,
  );

  // It faces the player's entry point.
  const facing = new Vector3(Math.sin(sign.yaw), 0, Math.cos(sign.yaw));
  const toPlayer = new Vector3(0 - perch.x, 0, -1.0 - perch.z).normalize();
  assert.ok(
    facing.dot(toPlayer) > 0.999,
    "the owl must face the player's entry point",
  );

  // The sign hangs below the owl's feet, at reading height, clear of the ground.
  const backing = group.getObjectByName("ForestOwlSignBoard") as Mesh | undefined;
  assert.ok(backing, "the owl must present an instruction board");
  const signBox = new Box3().setFromObject(backing);
  assert.ok(
    signBox.min.y > 0.3,
    `the sign must hang clear of the ground (bottom ${signBox.min.y})`,
  );
  assert.ok(
    signBox.max.y < owlBox.min.y,
    "the sign must hang below the owl, so the owl stays in view",
  );
  assert.ok(
    sign.centerY > 1.2 && sign.centerY < 2.6,
    "the sign must hang at a readable height",
  );
  assert.equal(sign.width, 0.85 * S);
  assert.equal(sign.height, 1.15 * S);

  // Hanging outside the round board and clear of the control buttons, so the
  // sign covers neither a code row nor a control.
  assert.ok(
    signBox.max.x < COLUMN.centerX - METRICS.radius,
    `the sign must hang outside the board (${signBox.max.x})`,
  );
  assert.ok(
    signBox.max.x < BUTTON_OUTER_X,
    `the sign must clear the buttons (${signBox.max.x} vs ${BUTTON_OUTER_X})`,
  );
});

/** The disc's top edge, as the system derives it for the feedback panel. */
function discTop(layout: typeof COLUMN): number {
  return forestBoardMetrics(layout).top;
}

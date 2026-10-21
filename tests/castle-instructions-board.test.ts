/**
 * The castle instructions board has to be readable in a headset. It hangs off
 * the environment root at the player's right, inside the 10 x 10 room, within
 * the player's forward view, and in front of the king that holds it — it used
 * to sit at x = -7.7, outside the walls and out of sight. This guards the
 * layout in src/castle/jigsaw/JigsawPuzzleSystem.ts.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import * as THREE from "three";
import { createComponent, ne, Types } from "elics";
import { World, VisibilityState } from "@iwsdk/core/dist/ecs/world.js";
import { createSystem } from "@iwsdk/core/dist/ecs/system.js";
import { Transform, TransformSystem } from "@iwsdk/core/dist/transform/transform.js";
import { LevelTag } from "@iwsdk/core/dist/level/level-tag.js";
import { PanelUI, PanelDocument } from "@iwsdk/core/dist/ui/ui.js";
import * as tags from "@iwsdk/core/dist/input/state-tags.js";
import { DistanceGrabbable, Grabbed, MovementMode } from "@iwsdk/core/dist/grab/index.js";

// Real ECS/TransformSystem geometry. No XR gesture, login or WebGL is simulated;
// only network, browser-only SDK exports and seat markers are replaced.
mock.module("@iwsdk/core", {
  namedExports: {
    ...THREE, ...tags, createComponent, ne, Types, createSystem,
    PanelUI, PanelDocument, DistanceGrabbable, Grabbed, MovementMode, UIKit: {},
  },
});
const listeners = new Map<string, Array<(data: any) => void>>();
mock.module("../src/network/socket.ts", {
  namedExports: { socket: {
    on(event: string, handler: (data: any) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    emit() {},
  } },
});
mock.module("../src/components/instructor/seat-markers.ts", {
  namedExports: { hideAllMarkers() {} },
});
const { CastleEnvironmentManager } = await import("../src/castle/CastleEnvironmentManager.ts");
const { JigsawPuzzleSystem } = await import("../src/castle/jigsaw/JigsawPuzzleSystem.ts");

// CastleEnvironmentManager builds a 10 x 10 room (walls at +/-5) and puts the
// player rig at (0, 0, -1) facing +z, with the eye about 1.6 m above it. World
// -x is therefore the player's right and +x their left, where the code blocks
// are shelved.
const ROOM_HALF = 5;
const WALL_HEIGHT = 5;
const EYE = new THREE.Vector3(0, 1.6, -1);
const FORWARD = new THREE.Vector3(0, 0, 1);
// The feedback panel is sized 1.2 * S wide and 0.6 * S tall (S = 2.2), so half
// of it reaches 0.3 * S above and below its centre.
const PANEL_HALF_HEIGHT = 0.3 * 2.2;

let world: World;
let classroom: THREE.Group;
const originalWindow = globalThis.window;

beforeEach(() => {
  listeners.clear();
  globalThis.window = Object.assign(new EventTarget(), {
    isLabActive: false, isCastleActive: false, isForestActive: false,
  }) as any;
  world = new World();
  world.scene = new THREE.Scene();
  world.camera = new THREE.PerspectiveCamera();
  world.renderer = { xr: { addEventListener() {} } } as any;
  world.player = new THREE.Group() as any;
  world.visibilityState.value = VisibilityState.Visible;
  for (const component of [Transform, LevelTag, PanelUI, PanelDocument,
    ...Object.values(tags), DistanceGrabbable, Grabbed]) {
    world.registerComponent(component);
  }
  world.sceneEntity = world.createTransformEntity(world.scene, { persistent: true });
  world.activeLevel = { value: world.sceneEntity } as any;
  world.registerSystem(TransformSystem);
  classroom = new THREE.Group();
  classroom.name = "Classroom";
  world.scene.add(classroom);
});

afterEach(() => {
  for (const system of [JigsawPuzzleSystem, TransformSystem]) {
    world.unregisterSystem(system);
  }
  world.scene.clear();
  globalThis.window = originalWindow;
});

function tick(): void {
  world.update(1 / 60, performance.now());
  world.scene.updateMatrixWorld(true);
}
function receive(event: string, data: any): void {
  for (const handler of listeners.get(event) ?? []) handler(data);
}
function castleRoot(): THREE.Object3D {
  return world.scene.getObjectByName("CastleRoomRoot")!;
}
function instructionsBoard(root: THREE.Object3D): THREE.Object3D {
  const board = root.children.find(object =>
    object.entityIdx !== undefined &&
    PanelUI.data.config[object.entityIdx]?.includes("instructions"),
  );
  assert.ok(board, "the instructions board must stay parented to the environment root");
  return board!;
}
function feedbackPanel(root: THREE.Object3D): THREE.Object3D {
  const panel = root.children.find(object =>
    object.entityIdx !== undefined &&
    PanelUI.data.config[object.entityIdx]?.includes("feedback"),
  );
  assert.ok(panel, "the feedback panel must stay parented to the environment root");
  return panel!;
}

test("the feedback panel sits on top of the centre board, not above the ceiling", () => {
  new CastleEnvironmentManager(world, [classroom]);
  tick(); tick();

  const root = castleRoot();
  const panel = feedbackPanel(root);
  const board = root.getObjectByName("CastlePuzzleBoard");
  assert.ok(board, "the castle must have a centre puzzle board");
  const boardMesh = board!.children[0] as THREE.Mesh;

  const panelPosition = panel.getWorldPosition(new THREE.Vector3());
  const boardTop =
    boardMesh.getWorldPosition(new THREE.Vector3()).y +
    (boardMesh.geometry as THREE.BoxGeometry).parameters.height / 2;

  // A wrong Python result was invisible: the panel hung at 2.3 * S = 5.06 m,
  // i.e. above the 5 m ceiling (and far above the board it explains).
  assert.ok(
    panelPosition.y > boardTop,
    `the panel must sit above the board's top edge (y=${panelPosition.y}, top=${boardTop})`,
  );
  assert.ok(
    panelPosition.y + PANEL_HALF_HEIGHT < WALL_HEIGHT,
    `the whole panel must fit under the ceiling, got y=${panelPosition.y}`,
  );
  assert.ok(
    panelPosition.y - PANEL_HALF_HEIGHT > boardTop,
    `the panel must not cover the board's code slots, got y=${panelPosition.y}`,
  );

  // Facing the player, or the error text would be edge-on in the headset.
  const facing = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(panel.getWorldQuaternion(new THREE.Quaternion()))
    .setY(0)
    .normalize();
  const toPlayer = EYE.clone().sub(panelPosition).setY(0).normalize();
  assert.ok(
    facing.dot(toPlayer) > 0.98,
    `the panel must face the player, dot=${facing.dot(toPlayer)}`,
  );
});

test("the instructions board is held at the player's right, in view and inside the room", () => {
  new CastleEnvironmentManager(world, [classroom]);
  tick(); tick();

  const root = castleRoot();
  const king = root.getObjectByName("CastleKing");
  assert.ok(king, "the castle must have a king holding the instructions board");
  const board = instructionsBoard(root);

  const boardPosition = board.getWorldPosition(new THREE.Vector3());
  const kingPosition = king!.getWorldPosition(new THREE.Vector3());

  // Off the wall and to the player's right, inside the room rather than behind
  // the walls the way the old (-7.7, 3.3) placement was.
  assert.ok(
    boardPosition.x < 0,
    `the board must sit on the player's right (world -x), got x=${boardPosition.x}`,
  );
  assert.ok(
    Math.abs(boardPosition.x) < ROOM_HALF - 0.5 &&
    Math.abs(boardPosition.z) < ROOM_HALF - 0.5,
    `the board must stay inside the room, got ${boardPosition.x}, ${boardPosition.z}`,
  );
  assert.ok(
    boardPosition.y > 0.5 && boardPosition.y < WALL_HEIGHT,
    `the board must sit between the floor and the ceiling, got y=${boardPosition.y}`,
  );

  // Held in front of the king: nearer the player than the king's own centre.
  assert.ok(
    boardPosition.distanceTo(EYE) < kingPosition.distanceTo(EYE),
    "the board must be held between the king and the player",
  );

  // Facing the player: the panel's +z has to point back at the entry position,
  // or the text would be edge-on (or mirrored) in the headset.
  const facing = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion()))
    .setY(0)
    .normalize();
  const toPlayer = EYE.clone().sub(boardPosition).setY(0).normalize();
  assert.ok(
    facing.dot(toPlayer) > 0.98,
    `the board must face the player, dot=${facing.dot(toPlayer)}`,
  );

  // In view when the player looks straight ahead at the puzzle.
  const toBoard = boardPosition.clone().sub(EYE).setY(0).normalize();
  const offAxis = THREE.MathUtils.radToDeg(FORWARD.angleTo(toBoard));
  assert.ok(offAxis < 45, `the board must stay in the player's view, off axis by ${offAxis} degrees`);
});

test("the king stands on the floor inside the room instead of clipping the walls", () => {
  new CastleEnvironmentManager(world, [classroom]);
  tick(); tick();

  const king = castleRoot().getObjectByName("CastleKing");
  assert.ok(king, "the castle must have a king holding the instructions board");

  const bounds = new THREE.Box3().setFromObject(king!);
  assert.ok(bounds.min.y >= -0.1, `the king must stand on the floor, got min y=${bounds.min.y}`);
  assert.ok(bounds.max.y < WALL_HEIGHT, `the king must fit under the ceiling, got max y=${bounds.max.y}`);
  assert.ok(
    bounds.min.x > -ROOM_HALF && bounds.max.x < ROOM_HALF &&
    bounds.min.z > -ROOM_HALF && bounds.max.z < ROOM_HALF,
    `the king must stand inside the room, got x ${bounds.min.x}..${bounds.max.x}, z ${bounds.min.z}..${bounds.max.z}`,
  );
});

test("the king idles only while the castle is the active environment", () => {
  const manager = new CastleEnvironmentManager(world, [classroom]);
  tick(); tick();

  const system: any = world.getSystem(JigsawPuzzleSystem);
  const head = system.king?.head;
  assert.ok(head, "the king idle state must be built with the castle");

  const idleInClassroom = head.rotation.y;
  tick(); tick();
  assert.equal(
    head.rotation.y,
    idleInClassroom,
    "the king must not animate while the castle is hidden",
  );

  receive("gameChanged", { gameId: "python-puzzle-1" });
  tick(); tick();
  assert.equal(manager.isActive(), true);

  const before = head.rotation.y;
  tick(); tick(); tick();
  assert.notEqual(
    head.rotation.y,
    before,
    "the king's standing idle motion must run while the castle is active",
  );
});

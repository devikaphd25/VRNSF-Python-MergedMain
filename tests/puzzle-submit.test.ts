/**
 * Submit-button regression for a fully-filled board.
 *
 * tests/castle-input.test.ts presses Submit on an empty board only, so it never
 * reaches the assembled-code path. This file fills every slot, presses Submit
 * through the real ECS/pointer/InputSystem stack, then walks the whole
 * post-submit path: assembling the program from the placed blocks, running it
 * with the real Pyodide compiler (the same CPython build the browser loads from
 * the CDN), the success feedback, the gold-coin celebration, and the score
 * report the instructor dashboard reads.
 */
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import * as THREE from "three";
import { createComponent, Types } from "elics";
import { createRayPointer } from "@pmndrs/pointer-events";
import { loadPyodide } from "pyodide";
import { World, VisibilityState } from "@iwsdk/core/dist/ecs/world.js";
import { createSystem } from "@iwsdk/core/dist/ecs/system.js";
import { InputSystem } from "@iwsdk/core/dist/input/input-system.js";
import * as tags from "@iwsdk/core/dist/input/state-tags.js";
import { Transform, TransformSystem } from "@iwsdk/core/dist/transform/transform.js";
import { LevelTag } from "@iwsdk/core/dist/level/level-tag.js";
import { PanelUI, PanelDocument } from "@iwsdk/core/dist/ui/ui.js";
import {
  DistanceGrabbable,
  Grabbed,
  GrabSystem,
  OneHandGrabbable,
  TwoHandsGrabbable,
  MovementMode,
} from "@iwsdk/core/dist/grab/index.js";

// Only the browser-only SDK barrel is replaced (same substitution as the
// ray-input suite). ECS queries, transforms, InputSystem listeners, grab
// handles and pointer hit testing are real; no renderer or XR hardware is.
mock.module("@iwsdk/core", {
  namedExports: {
    ...THREE, ...tags, createComponent, Types, createSystem,
    PanelUI, PanelDocument, DistanceGrabbable, Grabbed, MovementMode, UIKit: {},
  },
});

const emissions: Array<{ event: string; data: any }> = [];
const dispatched: string[] = [];
mock.module("../src/network/socket.ts", {
  namedExports: { socket: { emit: (event: string, data: any) => emissions.push({ event, data }) } },
});

const { JigsawPuzzleSystem } = await import("../src/castle/jigsaw/JigsawPuzzleSystem.ts");
const { JigsawBlock, JigsawButton } = await import("../src/castle/jigsaw/jigsawComponents.ts");
const { CastleVisibleInteractionSystem } = await import("../src/castle/CastleVisibleInteractionSystem.ts");
const { setCastleRoot } = await import("../src/castle/jigsaw/castleRoot.ts");
const { PUZZLE_LINES } = await import("../src/castle/jigsaw/puzzleData.ts");

type Harness = {
  world: any;
  system: any;
  castle: THREE.Group;
  space: THREE.PerspectiveCamera;
  pointer: any;
};

let active: Harness | null = null;
const originalWindow = globalThis.window;

/** Builds the real castle puzzle on top of the real pointer/input stack. */
function build(): Harness {
  const world: any = new World();
  emissions.length = dispatched.length = 0;

  globalThis.window = {
    isCastleActive: true,
    jigsawPuzzleSolved: false,
    // The browser injects the CDN bootstrap; Node uses the identical packaged
    // 0.27.0 build so the assembled program really executes.
    loadPyodide: () => loadPyodide(),
    dispatchEvent: (event: any) => { dispatched.push(event.type); return true; },
  } as any;

  world.scene = new THREE.Scene();
  world.camera = new THREE.PerspectiveCamera();
  world.renderer = { xr: {} };
  world.player = new THREE.Group();
  world.input = {
    update() {},
    xr: { gamepads: {}, isPrimary: () => false, multiPointers: {
      left: { toggleSubPointer() {} }, right: { toggleSubPointer() {} },
    } },
  };
  world.visibilityState.value = VisibilityState.Visible;
  for (const component of [Transform, LevelTag, PanelUI, PanelDocument,
    ...Object.values(tags), DistanceGrabbable, Grabbed, OneHandGrabbable,
    TwoHandsGrabbable, JigsawBlock, JigsawButton]) {
    world.registerComponent(component);
  }
  world.registerSystem(TransformSystem, { priority: 0 });
  world.sceneEntity = world.createTransformEntity(world.scene, { persistent: true });
  world.activeLevel = { value: world.sceneEntity };
  const castle = new THREE.Group();
  world.scene.add(castle);
  setCastleRoot(castle, world.createTransformEntity(castle));

  world.registerSystem(CastleVisibleInteractionSystem, { priority: -5 });
  world.registerSystem(InputSystem, { priority: -4 });
  world.registerSystem(GrabSystem, { priority: -3 });
  world.registerSystem(JigsawPuzzleSystem, { priority: 1 });

  // A controller ray travels down local -Z. Camera.lookAt aligns -Z, whereas
  // Object3D.lookAt aligns +Z and would aim this fixture away from the puzzle.
  const space = new THREE.PerspectiveCamera();
  world.scene.add(space);
  const pointer = createRayPointer(() => world.camera, { current: space }, {});

  active = { world, castle, space, pointer, system: world.getSystem(JigsawPuzzleSystem) };
  tick();
  return active;
}

afterEach(() => {
  if (!active) return;
  active.pointer.exit({ timeStamp: performance.now() });
  for (const entity of [...active.world.getSystem(InputSystem).queries.rayInteractables.entities]) {
    entity.removeComponent(tags.RayInteractable);
  }
  for (const entity of [...active.world.getSystem(GrabSystem).queries.distanceGrabbables.entities]) {
    entity.removeComponent(DistanceGrabbable);
  }
  for (const systemClass of [JigsawPuzzleSystem, GrabSystem, InputSystem,
    CastleVisibleInteractionSystem, TransformSystem]) {
    active.world.unregisterSystem(systemClass);
  }
  active.world.scene.clear();
  active = null;
  globalThis.window = originalWindow;
});

function tick() {
  const { world } = active!;
  world.update(1 / 60, performance.now());
  world.scene.updateMatrixWorld(true);
}

function button(type: string): any {
  const entity = [...active!.system.queries.buttons.entities].find((entity: any) =>
    entity.getValue(JigsawButton, "buttonType") === type,
  );
  assert.ok(entity, `Missing ${type} button`);
  return entity;
}

/** Walks the hit object up to the entity root it belongs to. */
function ownerOf(entity: any, intersection: any): THREE.Object3D | null {
  let owner: THREE.Object3D | null = intersection.object;
  while (owner && owner !== entity.object3D) owner = owner.parent;
  return owner;
}

function press(type: string) {
  const entity = button(type);
  const position = entity.object3D.getWorldPosition(new THREE.Vector3());
  const { space, pointer, world } = active!;
  space.position.set(position.x, position.y, -1);
  space.lookAt(position);
  space.updateMatrixWorld(true);
  pointer.move(world.scene, { timeStamp: performance.now() });

  const intersection = pointer.getIntersection();
  assert.ok(intersection?.object, `Ray missed ${type}`);
  assert.ok(ownerOf(entity, intersection) === entity.object3D, `Ray hit another entity instead of ${type}`);

  pointer.down({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(entity.hasComponent(tags.Pressed), true, `${type} never received Pressed`);
  pointer.up({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(entity.hasComponent(tags.Pressed), false, `${type} stayed pressed`);
}

/** True when the controller ray aimed at the entity still reaches it. */
function reachable(entity: any): boolean {
  const position = entity.object3D.getWorldPosition(new THREE.Vector3());
  const { space, pointer, world } = active!;
  space.position.set(position.x, position.y, -1);
  space.lookAt(position);
  space.updateMatrixWorld(true);
  pointer.move(world.scene, { timeStamp: performance.now() });

  const intersection = pointer.getIntersection();
  return Boolean(intersection?.object && ownerOf(entity, intersection) === entity.object3D);
}

/**
 * Places every block on the board. Blocks carry their own line and indent, so
 * the board is filled by assigning slot numbers exactly as a finished drop
 * would; `slotFor` lets a test assemble a valid-but-wrong program.
 */
function fillBoard(slotFor: (line: any) => number = line => line.correctSlot): void {
  const { system } = active!;
  assert.equal(system.queries.blocks.entities.size, PUZZLE_LINES.length);
  for (const block of system.queries.blocks.entities) {
    const line = PUZZLE_LINES[block.getValue(JigsawBlock, "originalIndex")];
    assert.ok(line, "Block has no matching puzzle line");
    block.setValue(JigsawBlock, "slotIndex", slotFor(line));
    block.setValue(JigsawBlock, "indent", line.correctIndent);
  }
}

/** Presses Submit and ticks the world until the asynchronous run reports back. */
async function submit(timeoutMs = 90000): Promise<{ title: string; body: string }> {
  const { system } = active!;
  press("submit");
  assert.equal(system.pendingFeedback?.title, "Running…", "Submit did not start the Python run");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    tick();
    const feedback = system.pendingFeedback;
    if (feedback && feedback.title !== "Running…") return feedback;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`Submit never reported a result (stuck on ${JSON.stringify(system.pendingFeedback)})`);
}

test("A fully-filled board runs the real compiler and celebrates the correct answer", async () => {
  const { castle, system } = build();
  fillBoard();

  const feedback = await submit();
  assert.equal(feedback.title, "Success!", feedback.body);

  // Celebration: coins must hang off the castle root, not a detached parent.
  assert.ok(system.coins.length > 0, "no celebration coins were spawned");
  assert.equal(system.coins.every((coin: any) => coin.mesh.parent === castle), true,
    "celebration coins detached from the castle root");

  const completed = emissions.filter(entry => entry.event === "labCompleted");
  assert.equal(completed.length, 1, "the completed score was not reported exactly once");
  assert.equal(completed[0].data.result.score, 100);
  assert.equal(emissions.filter(entry => entry.event === "labProgressUpdated").length, 1);

  // The animation must finish and clean itself up without tearing the puzzle down.
  for (let frame = 0; frame < 400; frame++) tick();
  assert.equal(system.coins.length, 0, "celebration coins were never cleaned up");
  assert.equal(system.coinAnimation, false);
  assert.equal(system.queries.buttons.entities.size, 5, "the board lost its buttons");
  assert.equal(system.queries.blocks.entities.size, PUZZLE_LINES.length);
});

test("A correct answer locks the board for the rest of the visit", async () => {
  const { system } = build();
  fillBoard();

  assert.equal((await submit()).title, "Success!");

  // The finished puzzle is out of the ray's reach: no block can be grabbed and
  // no control except Exit responds, so it cannot be played again.
  for (const block of system.queries.blocks.entities) {
    assert.equal(reachable(block), false, "a solved board still lets blocks be grabbed");
  }
  for (const type of ["indent", "dedent", "reset", "submit"]) {
    assert.equal(reachable(button(type)), false, `${type} still responds on a solved board`);
  }
  assert.equal(reachable(button("exit")), true, "Exit must stay reachable");

  // Exit still returns to the classroom, and the score is reported only once.
  press("exit");
  assert.deepEqual(dispatched, ["castleExitRequested"]);
  assert.equal(emissions.filter(entry => entry.event === "labCompleted").length, 1,
    "the completed score was reported more than once");
});

test("Leaving and re-entering the castle makes the solved board playable again", async () => {
  const { system, castle } = build();
  fillBoard();
  assert.equal((await submit()).title, "Success!");

  // Leaving hides the castle root, so the shared visibility guard saves the
  // locked hit-test settings while the room is hidden.
  (window as any).isCastleActive = false;
  castle.visible = false;
  tick();

  (window as any).isCastleActive = true;
  castle.visible = true;
  tick();

  assert.equal(reachable(button("submit")), true, "the board stayed locked after re-entry");
  assert.equal(reachable([...system.queries.blocks.entities][0]), true,
    "blocks stayed ungrabbable after re-entry");
});

test("A valid but wrongly ordered program reports wrong output and no score", async () => {
  const { system } = build();
  // Line 7 ("Average:") before line 6 ("Total:"): still valid Python, other output.
  const swapped: Record<string, number> = { line6: 6, line7: 5 };
  fillBoard(line => swapped[line.id] ?? line.correctSlot);

  const feedback = await submit();
  assert.equal(feedback.title, "Wrong Output");
  assert.match(feedback.body, /produces the wrong output/);
  assert.equal(system.coins.length, 0, "a wrong answer played the celebration");
  assert.equal(emissions.filter(entry => entry.event === "labCompleted").length, 0,
    "a wrong answer reported a completed score");
});

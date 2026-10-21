import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import * as THREE from "three";
import { createComponent, Types } from "elics";
import { createRayPointer } from "@pmndrs/pointer-events";
import { World, VisibilityState } from "@iwsdk/core/dist/ecs/world.js";
import { createSystem } from "@iwsdk/core/dist/ecs/system.js";
import { InputSystem } from "@iwsdk/core/dist/input/input-system.js";
import * as tags from "@iwsdk/core/dist/input/state-tags.js";
import { Transform, TransformSystem } from "@iwsdk/core/dist/transform/transform.js";
import { LevelTag } from "@iwsdk/core/dist/level/level-tag.js";
import { PanelUI, PanelDocument } from "@iwsdk/core/dist/ui/ui.js";
import { DistanceGrabbable, Grabbed, OneHandGrabbable, TwoHandsGrabbable, MovementMode } from "@iwsdk/core/dist/grab/index.js";

// The SDK barrel starts browser-only audio/rendering services. Replace ONLY
// that barrel with its real, Node-safe exports: ECS queries, components,
// transforms, InputSystem listeners and pointer hit testing are NOT mocked.
// No WebGL renderer, XR hardware, classroom identity or database is involved.
mock.module("@iwsdk/core", {
  namedExports: {
    ...THREE, ...tags, createComponent, Types, createSystem,
    PanelUI, PanelDocument, DistanceGrabbable, Grabbed, MovementMode, UIKit: {},
  },
});
const emissions: Array<{ event: string; data: any }> = [];
mock.module("../src/network/socket.ts", {
  namedExports: { socket: { emit: (event: string, data: any) => emissions.push({ event, data }) } },
});
const { ForestJigsawPuzzleSystem } = await import("../src/forest/jigsaw/ForestJigsawPuzzleSystem.ts");
const { ForestJigsawBlock, ForestJigsawButton } = await import("../src/forest/jigsaw/forestJigsawComponents.ts");
const { VisibleInteractionSystem } = await import("../src/forest/VisibleInteractionSystem.ts");
const { setForestRoot } = await import("../src/forest/forestRoot.ts");

let world: any;
let system: any;
let forest: THREE.Group;
let space: THREE.Object3D;
let pointer: ReturnType<typeof createRayPointer>;
let exits: string[];
const originalWindow = globalThis.window;

beforeEach(() => {
  emissions.length = 0;
  exits = [];
  globalThis.window = {
    isForestActive: true,
    forestPuzzleSolved: false,
    dispatchEvent: (event: Event) => { exits.push(event.type); return true; },
  } as any;
  world = new World();
  world.scene = new THREE.Scene();
  world.camera = new THREE.PerspectiveCamera();
  world.renderer = { xr: {} };
  world.player = new THREE.Group();
  // No hardware samples in a headless fixture; rays below use the real pointer
  // library, which dispatches events consumed by the real InputSystem.
  world.input = {
    update() {},
    xr: { multiPointers: {
      left: { toggleSubPointer() {} }, right: { toggleSubPointer() {} },
    } },
  };
  world.visibilityState.value = VisibilityState.Visible;
  for (const component of [Transform, LevelTag, PanelUI, PanelDocument,
    ...Object.values(tags), DistanceGrabbable, Grabbed, OneHandGrabbable,
    TwoHandsGrabbable, ForestJigsawBlock, ForestJigsawButton]) {
    world.registerComponent(component);
  }
  world.sceneEntity = world.createTransformEntity(world.scene, { persistent: true });
  world.activeLevel = { value: world.sceneEntity };
  forest = new THREE.Group();
  world.scene.add(forest);
  const forestEntity = world.createTransformEntity(forest);
  setForestRoot(forest, forestEntity);
  world.registerSystem(VisibleInteractionSystem, { priority: -5 });
  world.registerSystem(InputSystem, { priority: -4 });
  world.registerSystem(TransformSystem, { priority: 0 });
  world.registerSystem(ForestJigsawPuzzleSystem, { priority: 1 });
  system = world.getSystem(ForestJigsawPuzzleSystem);
  // A controller ray travels down local -Z. Camera.lookAt aligns -Z, whereas
  // Object3D.lookAt aligns +Z and would aim this fixture away from the puzzle,
  // so the ray met the sky dome instead of the buttons.
  space = new THREE.PerspectiveCamera();
  world.scene.add(space);
  pointer = createRayPointer(() => world.camera, { current: space }, {});
  tick();
});

afterEach(() => {
  pointer.exit({ timeStamp: performance.now() });
  for (const systemClass of [ForestJigsawPuzzleSystem, InputSystem, VisibleInteractionSystem, TransformSystem]) {
    world.unregisterSystem(systemClass);
  }
  world.scene.clear();
  globalThis.window = originalWindow;
});

function tick() {
  world.update(1 / 60, performance.now());
  world.scene.updateMatrixWorld(true);
}
function button(type: string): any {
  const entity = [...system.queries.buttons.entities].find((entity: any) =>
    entity.getValue(ForestJigsawButton, "buttonType") === type,
  );
  assert.ok(entity, `Missing ${type} button`);
  return entity;
}
function pointAt(entity: any) {
  const position = entity.object3D.getWorldPosition(new THREE.Vector3());
  space.position.set(position.x, position.y, -1);
  space.lookAt(position);
  space.updateMatrixWorld(true);
  pointer.move(world.scene, { timeStamp: performance.now() });
  return pointer.getIntersection();
}
function press(type: string) {
  const entity = button(type);
  const intersection = pointAt(entity);
  assert.ok(intersection?.object, `Ray missed ${type}`);
  let owner: THREE.Object3D | null = intersection.object;
  while (owner && owner !== entity.object3D) owner = owner.parent;
  // Compare identity with a boolean: formatting a failed object comparison
  // walks the whole ECS/scene graph and exhausts memory in the headless runner.
  assert.equal(owner === entity.object3D, true, `Ray hit another entity instead of ${type}`);
  pointer.down({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(entity.hasComponent(tags.Pressed), true, `${type} never received Pressed`);
  pointer.up({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(entity.hasComponent(tags.Pressed), false, `${type} stayed pressed`);
}

for (const type of ["indent", "dedent", "reset", "exit", "submit"]) {
  test(`Real SDK ray hit and down/up reach the ${type} button`, () => {
    press(type);
    if (type === "reset") assert.equal(system.pendingFeedback.title, "Reset");
    if (type === "exit") assert.deepEqual(exits, ["forestExitRequested"]);
    if (type === "submit") {
      assert.equal(system.pendingFeedback.title, "Error");
      assert.match(system.pendingFeedback.body, /Not all code blocks/);
      assert.equal(emissions.length, 0);
    }
  });
}

test("Hidden classroom targets cannot steal a forest button ray", () => {
  const classroom = new THREE.Group();
  world.scene.add(classroom);
  const blocker = world.createTransformEntity(new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 0.1), new THREE.MeshBasicMaterial(),
  )).addComponent(tags.RayInteractable);
  tick();
  classroom.add(blocker.object3D);
  blocker.object3D.position.copy(button("reset").object3D.position);
  blocker.object3D.position.z -= 1;
  classroom.visible = false;
  tick();
  press("reset");
  assert.equal(blocker.hasComponent(tags.Pressed), false);
  assert.equal(system.pendingFeedback.title, "Reset");
});

test("Hiding and reopening the forest disables then restores real ray hits", () => {
  forest.visible = false;
  window.isForestActive = false;
  tick();
  pointAt(button("exit"));
  pointer.down({ timeStamp: performance.now(), button: 0 });
  tick();
  pointer.up({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.deepEqual(exits, []);
  forest.visible = true;
  window.isForestActive = true;
  tick();
  press("exit");
  assert.deepEqual(exits, ["forestExitRequested"]);
});

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
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
import {
  DistanceGrabbable,
  Grabbed,
  GrabSystem,
  OneHandGrabbable,
  TwoHandsGrabbable,
  MovementMode,
} from "@iwsdk/core/dist/grab/index.js";

// The SDK barrel starts browser-only audio/rendering services. Replace ONLY
// that barrel with its real, Node-safe exports: ECS queries, components,
// transforms, InputSystem listeners, grab handles and pointer hit testing are
// NOT mocked. No WebGL renderer, XR hardware, classroom identity or database
// is involved.
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
const { JigsawPuzzleSystem } = await import("../src/castle/jigsaw/JigsawPuzzleSystem.ts");
const { JigsawBlock, JigsawButton } = await import("../src/castle/jigsaw/jigsawComponents.ts");
const { CastleVisibleInteractionSystem } = await import("../src/castle/CastleVisibleInteractionSystem.ts");
const { setCastleRoot } = await import("../src/castle/jigsaw/castleRoot.ts");

type Harness = {
  world: any;
  system: any;
  castle: THREE.Group;
  space: THREE.Object3D;
  pointer: ReturnType<typeof createRayPointer>;
  exits: string[];
};

let active: Harness | null = null;
const originalWindow = globalThis.window;

/** Builds the real castle puzzle on top of the real pointer/input stack. */
function build({ guard }: { guard: boolean }): Harness {
  const exits: string[] = [];
  const world: any = new World();
  const pointerHolder: { pointer?: ReturnType<typeof createRayPointer> } = {};

  globalThis.window = {
    isCastleActive: true,
    jigsawPuzzleSolved: false,
    dispatchEvent: (event: Event) => { exits.push(event.type); return true; },
  } as any;

  world.scene = new THREE.Scene();
  world.camera = new THREE.PerspectiveCamera();
  world.renderer = { xr: {} };
  world.player = new THREE.Group();
  // No hardware samples in a headless fixture; the ray below uses the real
  // pointer library, which dispatches events consumed by the real InputSystem.
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
  world.sceneEntity = world.createTransformEntity(world.scene, { persistent: true });
  world.activeLevel = { value: world.sceneEntity };
  const castle = new THREE.Group();
  world.scene.add(castle);
  setCastleRoot(castle, world.createTransformEntity(castle));

  if (guard) world.registerSystem(CastleVisibleInteractionSystem, { priority: -5 });
  world.registerSystem(InputSystem, { priority: -4 });
  world.registerSystem(GrabSystem, { priority: -3 });
  world.registerSystem(TransformSystem, { priority: 0 });
  world.registerSystem(JigsawPuzzleSystem, { priority: 1 });

  const space = new THREE.Object3D();
  world.scene.add(space);
  pointerHolder.pointer = createRayPointer(() => world.camera, { current: space }, {});

  active = {
    world, castle, space, exits,
    system: world.getSystem(JigsawPuzzleSystem),
    pointer: pointerHolder.pointer,
  };
  tick();
  return active;
}

afterEach(() => {
  if (!active) return;
  active.pointer.exit({ timeStamp: performance.now() });
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

function pointAt(target: THREE.Object3D | THREE.Vector3) {
  const { space, pointer, world } = active!;
  const position = target instanceof THREE.Vector3
    ? target.clone()
    : target.getWorldPosition(new THREE.Vector3());
  space.position.set(position.x, position.y, -1);
  space.lookAt(position);
  space.updateMatrixWorld(true);
  pointer.move(world.scene, { timeStamp: performance.now() });
  return pointer.getIntersection();
}

/** Walks the hit object up to the entity root it belongs to. */
function ownerOf(entity: any, intersection: any): THREE.Object3D | null {
  let owner: THREE.Object3D | null = intersection.object;
  while (owner && owner !== entity.object3D) owner = owner.parent;
  return owner;
}

function press(type: string) {
  const entity = button(type);
  const intersection = pointAt(entity.object3D);
  assert.ok(intersection?.object, `Ray missed ${type}`);
  assert.equal(ownerOf(entity, intersection), entity.object3D, `Ray hit another entity instead of ${type}`);
  active!.pointer.down({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(entity.hasComponent(tags.Pressed), true, `${type} never received Pressed`);
  active!.pointer.up({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(entity.hasComponent(tags.Pressed), false, `${type} stayed pressed`);
}

/**
 * The classroom raise-hand / Screen HUD controls are hidden while an
 * environment runs but stay in the scene, exactly like this blocker: an
 * invisible panel in front of the puzzle with a high pointer-events order.
 */
function addHiddenClassroomBlocker(near: THREE.Object3D): any {
  const { world } = active!;
  const classroom = new THREE.Group();
  world.scene.add(classroom);
  const blocker = world.createTransformEntity(new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 0.1), new THREE.MeshBasicMaterial(),
  )).addComponent(tags.RayInteractable);
  tick();
  classroom.add(blocker.object3D);
  blocker.object3D.pointerEventsOrder = 60000;
  blocker.object3D.position.copy(near.getWorldPosition(new THREE.Vector3()));
  blocker.object3D.position.z -= 1;
  classroom.updateMatrixWorld(true);
  classroom.visible = false;
  tick();
  return blocker;
}

for (const type of ["indent", "dedent", "reset", "exit", "submit"]) {
  test(`Real SDK ray hit and down/up reach the ${type} button`, () => {
    build({ guard: true });
    press(type);
    if (type === "reset") assert.equal(active!.system.pendingFeedback.title, "Reset");
    if (type === "exit") assert.deepEqual(active!.exits, ["castleExitRequested"]);
    if (type === "submit") {
      assert.equal(active!.system.pendingFeedback.title, "Error");
      assert.match(active!.system.pendingFeedback.body, /Not all code blocks/);
      assert.equal(emissions.length, 0);
    }
  });
}

test("Without the castle interaction guard a hidden classroom control steals the ray", () => {
  build({ guard: false });
  const reset = button("reset");
  const blocker = addHiddenClassroomBlocker(reset.object3D);

  const intersection = pointAt(reset.object3D);
  assert.equal(ownerOf(blocker, intersection), blocker.object3D, "Blocker was not the nearest hit");
  active!.pointer.down({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(blocker.hasComponent(tags.Pressed), true);
  assert.equal(reset.hasComponent(tags.Pressed), false);
  active!.pointer.up({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(active!.system.pendingFeedback, null);
});

test("The castle interaction guard gives the puzzle the ray back", () => {
  build({ guard: true });
  const reset = button("reset");
  const blocker = addHiddenClassroomBlocker(reset.object3D);
  assert.equal(blocker.object3D.pointerEvents, "none");
  assert.equal(blocker.object3D.intersectChildren, false);

  press("reset");
  assert.equal(blocker.hasComponent(tags.Pressed), false);
  assert.equal(active!.system.pendingFeedback.title, "Reset");
});

test("A real ray grabs a puzzle block and the guard never blocks visible blocks", () => {
  build({ guard: true });
  const block = [...active!.system.queries.blocks.entities][0] as any;
  assert.equal(block.object3D.pointerEvents, "auto");

  const intersection = pointAt(block.object3D);
  assert.ok(intersection?.object, "Ray missed the puzzle block");
  assert.equal(ownerOf(block, intersection), block.object3D, "Ray hit another entity instead of a block");

  active!.pointer.down({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(block.hasComponent(Grabbed), true, "Block was never grabbed");
  active!.pointer.up({ timeStamp: performance.now(), button: 0 });
  tick();
  assert.equal(block.hasComponent(Grabbed), false, "Block stayed grabbed");
});

test("Hidden castle puzzle entities are not hit, and work again when the castle is visible", () => {
  build({ guard: true });
  const exit = button("exit");
  active!.castle.visible = false;
  (globalThis.window as any).isCastleActive = false;
  tick();

  const hidden = pointAt(exit.object3D);
  if (hidden?.object) {
    active!.pointer.down({ timeStamp: performance.now(), button: 0 });
    tick();
    active!.pointer.up({ timeStamp: performance.now(), button: 0 });
    tick();
  }
  assert.deepEqual(active!.exits, []);

  active!.castle.visible = true;
  (globalThis.window as any).isCastleActive = true;
  tick();
  press("exit");
  assert.deepEqual(active!.exits, ["castleExitRequested"]);
});

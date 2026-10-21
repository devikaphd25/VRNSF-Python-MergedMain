import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

// Real ECS/TransformSystem regressions. No XR gesture, login, WebGL or database
// is simulated; only network, browser-only SDK exports and model I/O are replaced.
mock.module("@iwsdk/core", {
  namedExports: {
    ...THREE, ...tags, createComponent, ne, Types, createSystem,
    PanelUI, PanelDocument, DistanceGrabbable, Grabbed, MovementMode, UIKit: {},
  },
});
const listeners = new Map<string, Array<(data: any) => void>>();
const emissions: Array<{ event: string; data: any }> = [];
mock.module("../src/network/socket.ts", {
  namedExports: { socket: {
    on(event: string, handler: (data: any) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    emit(event: string, data: any) { emissions.push({ event, data }); },
  } },
});
mock.module("../src/components/instructor/seat-markers.ts", {
  namedExports: { hideAllMarkers() {} },
});
mock.module("../src/forest/forestModel.ts", {
  namedExports: { loadForestModel: async () => new THREE.Group() },
});
const { CastleEnvironmentManager } = await import("../src/castle/CastleEnvironmentManager.ts");
const { ForestEnvironmentManager } = await import("../src/forest/ForestEnvironmentManager.ts");
const { JigsawPuzzleSystem } = await import("../src/castle/jigsaw/JigsawPuzzleSystem.ts");
const { ForestJigsawPuzzleSystem } = await import("../src/forest/jigsaw/ForestJigsawPuzzleSystem.ts");
const { OceanEnvironmentManager } = await import("../src/ocean/OceanEnvironmentManager.ts");
const { OceanJigsawPuzzleSystem } = await import("../src/ocean/jigsaw/OceanJigsawPuzzleSystem.ts");
const { SeatSystem } = await import("../src/systems/seat.system.ts");

let world: World;
let classroom: THREE.Group;
const originalWindow = globalThis.window;

beforeEach(() => {
  listeners.clear();
  emissions.length = 0;
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
  for (const system of [ForestJigsawPuzzleSystem, OceanJigsawPuzzleSystem,
    JigsawPuzzleSystem, TransformSystem]) {
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
function visibleInScene(object: THREE.Object3D): boolean {
  for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) {
    if (!ancestor.visible) return false;
  }
  return true;
}
function assertPuzzleParenting(system: any, root: THREE.Object3D, blockCount = 7): void {
  assert.equal(system.queries.blocks.entities.size, blockCount);
  assert.equal(system.queries.buttons.entities.size, 5);
  for (const entity of [...system.queries.blocks.entities, ...system.queries.buttons.entities,
    system.feedbackEntity]) {
    assert.equal(entity.object3D.parent, root, "TransformSystem must not detach puzzle props");
    assert.equal(entity.getValue(Transform, "parent").object3D, root);
  }
  const instructions = root.children.find(object =>
    object.entityIdx !== undefined &&
    PanelUI.data.config[object.entityIdx]?.includes("instructions"),
  );
  assert.ok(instructions, "Instructions must share the puzzle's ECS root too");
}

// "python-puzzle-2" is the ocean scene now, so the castle opens for
// "python-puzzle-1" only; the ocean has its own test below.
test("python-puzzle-1 opens the castle with persistent puzzle parenting after multiple frames", () => {
  const manager = new CastleEnvironmentManager(world, [classroom]);
  tick(); tick();
  const system: any = world.getSystem(JigsawPuzzleSystem);
  const root = world.scene.getObjectByName("CastleRoomRoot")!;
  assertPuzzleParenting(system, root);
  const block = [...system.queries.blocks.entities][0] as any;
  assert.equal(visibleInScene(block.object3D), false);
  receive("gameChanged", { gameId: "python-puzzle-1" });
  tick(); tick();
  assert.equal(manager.isActive(), true);
  assert.equal(classroom.visible, false);
  assert.equal(visibleInScene(block.object3D), true);
  assert.deepEqual(world.player.position.toArray(), [0, 0, -1]);
  assertPuzzleParenting(system, root);
  manager.returnToClassroom("student_exit");
  tick();
  assert.equal(classroom.visible, true);
  assert.equal(visibleInScene(block.object3D), false);
});

test("python-puzzle-2 opens the ocean with persistent puzzle parenting after multiple frames", async () => {
  const manager = new OceanEnvironmentManager(world, [classroom]);
  tick(); tick();
  const system: any = world.getSystem(OceanJigsawPuzzleSystem);
  const root = world.scene.getObjectByName("OceanSceneRoot")!;
  assertPuzzleParenting(system, root, 10);
  const block = [...system.queries.blocks.entities][0] as any;
  assert.equal(visibleInScene(block.object3D), false);
  receive("gameChanged", { gameId: "python-puzzle-2" });
  // The ocean only opens once its procedural scene has finished building.
  await new Promise(resolve => setImmediate(resolve));
  tick(); tick();
  assert.equal(manager.isActive(), true);
  assert.equal(classroom.visible, false);
  assert.equal(visibleInScene(block.object3D), true);
  assertPuzzleParenting(system, root, 10);
  manager.returnToClassroom("student_exit");
  tick();
  assert.equal(classroom.visible, true);
  assert.equal(visibleInScene(block.object3D), false);
});

test("python-puzzle-3 waits for its forest and retains all puzzle entities on entry and exit", async () => {
  const manager = new ForestEnvironmentManager(world, [classroom]);
  tick(); tick();
  const system: any = world.getSystem(ForestJigsawPuzzleSystem);
  const root = world.scene.getObjectByName("ForestClearingRoot")!;
  assertPuzzleParenting(system, root);
  const block = [...system.queries.blocks.entities][0] as any;
  assert.equal(visibleInScene(block.object3D), false);
  receive("gameChanged", { gameId: "python-puzzle-3" });
  await new Promise(resolve => setImmediate(resolve));
  tick(); tick();
  assert.equal(manager.isActive(), true);
  assert.equal(classroom.visible, false);
  assert.equal(visibleInScene(block.object3D), true);
  assertPuzzleParenting(system, root);
  manager.returnToClassroom("student_exit");
  tick();
  assert.equal(classroom.visible, true);
  assert.equal(visibleInScene(block.object3D), false);
});

for (const flag of ["isLabActive", "isCastleActive", "isForestActive"]) {
  test(`Seat restoration leaves the game origin alone while ${flag} is true`, () => {
    const system: any = Object.create(SeatSystem.prototype);
    system.player = world.player;
    const seat = new THREE.Group();
    seat.name = "Seat_R1_01";
    seat.position.set(2, 0.5, 3);
    classroom.add(seat);
    Object.assign(window, { classroomMesh: classroom, [flag]: true });
    world.player.position.set(0, 0, -1);
    world.player.rotation.y = Math.PI;
    assert.equal(system.moveToExactSeat(seat.name), true);
    assert.deepEqual(world.player.position.toArray(), [0, 0, -1]);
    assert.equal(world.player.rotation.y, Math.PI);
    (window as any)[flag] = false;
    assert.equal(system.moveToExactSeat(seat.name), true);
    assert.deepEqual(world.player.position.toArray(), [2, 0.5, 3]);
  });
}

test("The student socket starts only after all game managers and classroom references are ready", async () => {
  const entry = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const connectAt = entry.indexOf("connectSocketForUser(activeUser)");
  for (const setup of ["new LabEnvironmentManager", "new CastleEnvironmentManager",
    "new ForestEnvironmentManager", "(window as any).classroomMesh = envMesh", "disposeVRLoginResources();"]) {
    assert.ok(connectAt > entry.indexOf(setup), `Socket must connect after ${setup}`);
  }
});

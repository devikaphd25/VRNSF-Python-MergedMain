import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import * as THREE from "three";

// These are isolated logic/wiring tests, not simulated XR gestures. The ECS
// adapter models query qualification; real controller hit testing needs a headset.
const tags = Object.fromEntries([
  "DistanceGrabbable", "Grabbed", "Hovered", "PanelUI", "Pressed", "RayInteractable", "PokeInteractable",
].map(name => [name, name]));
const documents: Record<number, any> = {};
mock.module("@iwsdk/core", {
  namedExports: {
    ...THREE, ...tags,
    Interactable: tags.RayInteractable,
    MovementMode: { MoveFromTarget: "MoveFromTarget" },
    Types: { String: "string", Int32: "int", Entity: "entity", Enum: "enum" },
    createComponent: (name: string) => name,
    PanelDocument: { data: { document: documents } },
    UIKit: {},
    createSystem: (spec: Record<string, unknown>) => class {
      world: any;
      cleanupFuncs: any[] = [];
      queries = Object.fromEntries(Object.keys(spec).map(key => [key, {
        entities: [] as any[],
        listeners: {} as Record<string, (entity: any) => void>,
        subscribe(event: string, callback: (entity: any) => void) { this.listeners[event] = callback; },
      }]));
    },
  },
});
const emissions: any[] = [];
mock.module("../src/network/socket.ts", {
  namedExports: { socket: { emit: (event: string, data: unknown) => emissions.push({ event, data }) } },
});
let pythonResult: any;
const pythonCalls: string[] = [];
mock.module("../src/forest/jigsaw/forestPythonRunner.ts", {
  namedExports: { runForestPython: async (code: string) => { pythonCalls.push(code); return pythonResult; } },
});
const { ForestJigsawPuzzleSystem } = await import("../src/forest/jigsaw/ForestJigsawPuzzleSystem.ts");
const { ForestJigsawBlock, ForestJigsawButton } = await import("../src/forest/jigsaw/forestJigsawComponents.ts");
const { VisibleInteractionSystem } = await import("../src/forest/VisibleInteractionSystem.ts");
const { FOREST_PUZZLE_LINES, FOREST_EXPECTED_OUTPUT } = await import("../src/forest/jigsaw/forestPuzzleData.ts");
const { setForestRoot } = await import("../src/forest/forestRoot.ts");

let system: any;
let root: THREE.Group;
let exits: string[];
let nextIndex = 0;
class TestEntity {
  index = nextIndex++;
  components = new Map<any, any>();
  constructor(public object3D = new THREE.Group()) {}
  addComponent(component: any, values: any = {}) {
    this.components.set(component, { ...values });
    if (component === ForestJigsawBlock) system.queries.blocks.entities.push(this);
    if (component === ForestJigsawButton) system.queries.buttons.entities.push(this);
    return this;
  }
  getValue(component: any, key: string) { return this.components.get(component)?.[key]; }
  setValue(component: any, key: string, value: any) { this.components.get(component)[key] = value; }
  hasComponent(component: any) { return this.components.has(component); }
  dispose() { this.object3D.removeFromParent(); }
}

beforeEach(() => {
  emissions.length = pythonCalls.length = 0;
  for (const key of Object.keys(documents)) delete documents[Number(key)];
  nextIndex = 0;
  exits = [];
  globalThis.window = {
    isForestActive: true,
    forestPuzzleSolved: false,
    dispatchEvent: (event: Event) => { exits.push(event.type); return true; },
  } as any;
  root = new THREE.Group();
  setForestRoot(root, new TestEntity(root) as any);
  system = new ForestJigsawPuzzleSystem();
  system.world = {
    createTransformEntity(object = new THREE.Group(), options: any = {}) {
      const entity = new TestEntity(object);
      options.parent?.object3D.add(object);
      return entity;
    },
  };
  system.init();
  pythonResult = { success: true, output: FOREST_EXPECTED_OUTPUT, error: "" };
});

function block(index: number): TestEntity {
  const result = system.blockEntities.get(index);
  assert.ok(result);
  return result;
}
function press(type: string) {
  const button = system.queries.buttons.entities.find((entity: TestEntity) => entity.getValue(ForestJigsawButton, "buttonType") === type);
  assert.ok(button);
  system.queries.pressed.listeners.qualify(button);
}
function place(index: number, slot = index) {
  const entity = block(index);
  entity.object3D.position.copy(system.slotPositions[slot]);
  entity.object3D.updateMatrixWorld(true);
  system.queries.heldBlocks.listeners.disqualify(entity);
}
const settled = () => new Promise(resolve => setImmediate(resolve));

/**
 * Runs the block-movement animation to completion the way the render loop does.
 * Blocks no longer snap on placement/indent/reset: they lerp toward their target
 * each frame, so a position assertion must advance the frames first.
 */
function settleAnimations() {
  for (let frame = 0; frame < 600 && system.animatingBlocks.size > 0; frame++) {
    system.update(1 / 60);
  }
  assert.equal(system.animatingBlocks.size, 0, "block movement never settled");
}

test("All five visible labels share their ray-interactable button owner", () => {
  assert.equal(system.queries.buttons.entities.length, 5);
  for (const entity of system.queries.buttons.entities as TestEntity[]) {
    assert.equal(entity.hasComponent(tags.RayInteractable), true);
    assert.equal(entity.hasComponent(tags.PanelUI), true);
    assert.match(entity.object3D.name, /^ForestButton-/);
    assert.ok(system.pendingButtonLabels.has(entity.index));
  }
});

test("Indent and Dedent modify the last placed block and clamp to zero through two", () => {
  place(3);
  press("indent");
  assert.equal(block(3).getValue(ForestJigsawBlock, "indent"), 1);
  settleAnimations();
  assert.equal(block(3).object3D.position.x, -0.33);
  press("indent"); press("indent");
  assert.equal(block(3).getValue(ForestJigsawBlock, "indent"), 2);
  press("dedent");
  assert.equal(block(3).getValue(ForestJigsawBlock, "indent"), 1);
  press("dedent"); press("dedent");
  assert.equal(block(3).getValue(ForestJigsawBlock, "indent"), 0);
  settleAnimations();
  assert.equal(block(3).object3D.position.x, 0);
});

test("Reset clears every slot and indentation and restores shelf positions", () => {
  place(3); press("indent"); place(5); press("indent");
  press("reset");
  settleAnimations();
  for (let index = 0; index < 7; index++) {
    assert.equal(block(index).getValue(ForestJigsawBlock, "slotIndex"), -1);
    assert.equal(block(index).getValue(ForestJigsawBlock, "indent"), 0);
    assert.deepEqual(block(index).object3D.position.toArray(), system.homePositions.get(index));
  }
  assert.equal(system.activeBlockOriginalIndex, -1);
  assert.equal(system.pendingFeedback.title, "Reset");
});

test("Exit dispatches the forest-specific return request", () => {
  press("exit");
  assert.deepEqual(exits, ["forestExitRequested"]);
});

test("Submit rejects an incomplete board without running Python or sending scores", () => {
  press("submit");
  assert.equal(system.pendingFeedback.title, "Error");
  assert.match(system.pendingFeedback.body, /Not all code blocks/);
  assert.equal(pythonCalls.length, 0);
  assert.equal(emissions.length, 0);
});

test("Submit assembles indented code, shows success, celebrates and emits one completion", async () => {
  for (let index = 0; index < 7; index++) {
    place(index);
    if (FOREST_PUZZLE_LINES[index].correctIndent) press("indent");
  }
  press("submit");
  await settled();
  assert.equal(pythonCalls[0], FOREST_PUZZLE_LINES.map(line => "    ".repeat(line.correctIndent) + line.text).join("\n"));
  assert.equal(system.pendingFeedback.title, "Success!");
  assert.equal(system.leaves.length, 60);
  // The gold-coin cheer is shared by every puzzle: it must spawn here too, and
  // hang off the forest root so leaving the clearing removes it.
  assert.equal(system.coinSplash.coins.length, 60);
  assert.equal(system.coinSplash.coins.every((coin: any) => coin.mesh.parent === root), true,
    "celebration coins detached from the forest root");
  assert.equal(window.forestPuzzleSolved, true);
  assert.deepEqual(emissions.map(item => item.event), ["labProgressUpdated", "labCompleted"]);
  assert.equal(emissions[1].data.result.score, 100);
  press("submit");
  await settled();
  assert.equal(emissions.length, 2);
});

test("Incorrect output and compiler errors never publish a successful score", async () => {
  for (let index = 0; index < 7; index++) place(index);
  pythonResult = { success: true, output: "Wrong output", error: "" };
  press("submit"); await settled();
  assert.equal(system.pendingFeedback.title, "Wrong Output");
  pythonResult = { success: false, output: "", error: "IndentationError: expected an indented block" };
  press("submit"); await settled();
  assert.equal(system.pendingFeedback.title, "Error");
  assert.match(system.pendingFeedback.body, /IndentationError/);
  assert.equal(emissions.length, 0);
});

test("Hidden forest buttons cannot trigger actions", () => {
  window.isForestActive = false;
  for (const type of ["indent", "dedent", "reset", "exit", "submit"]) press(type);
  assert.deepEqual(exits, []);
  assert.equal(system.pendingFeedback, null);
  assert.equal(pythonCalls.length, 0);
});

test("Hidden ancestor hit-test settings restore when the environment becomes visible", () => {
  const visibility: any = new VisibleInteractionSystem();
  const entity = system.queries.buttons.entities[0] as TestEntity;
  const initial = { pointerEvents: entity.object3D.pointerEvents, intersectChildren: entity.object3D.intersectChildren };
  visibility.queries.rays.entities.push(entity);
  root.visible = false;
  visibility.update();
  assert.equal(entity.object3D.pointerEvents, "none");
  assert.equal(entity.object3D.intersectChildren, false);
  root.visible = true;
  visibility.update();
  assert.equal(entity.object3D.pointerEvents, initial.pointerEvents);
  assert.equal(entity.object3D.intersectChildren, initial.intersectChildren);
});

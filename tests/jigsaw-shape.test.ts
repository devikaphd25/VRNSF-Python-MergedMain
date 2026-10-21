/**
 * The code blocks of the three Python jigsaw activities used to be cut
 * identically — knob on top, socket underneath — so every block fitted every
 * other one and the "puzzle" read as a stack of identical planks. Each joint now
 * carries its own key (where along the edge the knob sits, and which of the two
 * pieces owns it) and no key is reused inside a puzzle, so two blocks only
 * interlock when they are neighbours in the correct code sequence.
 *
 * These are isolated shape/wiring tests: they read the outlines the blocks are
 * extruded from and the geometry the systems really attach, not a headset view.
 */
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import * as THREE from "three";

// The puzzle system reaches the SDK, the socket and Pyodide through the usual
// imports; only the block geometry is under test here.
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
mock.module("../src/network/socket.ts", {
  namedExports: { socket: { on() {}, emit() {} } },
});
mock.module("../src/forest/jigsaw/forestPythonRunner.ts", {
  namedExports: { runForestPython: async () => ({ success: true, output: "", error: "" }) },
});

const { createJigsawBlockGeometry, createJigsawBlockShape, jigsawPieceEdges } =
  await import("../src/utils/jigsaw-block.ts");
const { PUZZLE_LINES } = await import("../src/castle/jigsaw/puzzleData.ts");
const { FOREST_PUZZLE_LINES } = await import("../src/forest/jigsaw/forestPuzzleData.ts");
const { OCEAN_PUZZLE_LINES } = await import("../src/ocean/jigsaw/oceanPuzzleData.ts");
const { ForestJigsawPuzzleSystem } = await import("../src/forest/jigsaw/ForestJigsawPuzzleSystem.ts");
const { ForestJigsawBlock, ForestJigsawButton } =
  await import("../src/forest/jigsaw/forestJigsawComponents.ts");
const { setForestRoot } = await import("../src/forest/forestRoot.ts");

interface CodeLine { id: string; text: string }
interface Cut { kind: string; offset: number }

// Block layout as shipped by the systems: S is their block scale factor and
// SLOT_HEIGHT the row pitch on the board, so neighbouring rows always keep one
// slot gap between their flat edge lines.
const S = 2.2;
const BLOCK_WIDTH = 0.9 * S;
const BLOCK_HEIGHT = 0.14 * S;
const BLOCK_THICKNESS = 0.05 * S;
const BLOCK_BEVEL = 0.004 * S;
const HALF_WIDTH = BLOCK_WIDTH / 2;
const HALF_HEIGHT = BLOCK_HEIGHT / 2;
const SLOT_HEIGHT = 0.17 * S;
const SLOT_GAP = SLOT_HEIGHT - BLOCK_HEIGHT;
const KNOB_RADIUS = SLOT_GAP * 0.9;

const PUZZLES: CodeLine[][] = [PUZZLE_LINES, FOREST_PUZZLE_LINES, OCEAN_PUZZLE_LINES];

function buildShape(lines: CodeLine[], index: number): THREE.Shape {
  return createJigsawBlockShape(BLOCK_WIDTH, BLOCK_HEIGHT, jigsawPieceEdges(lines)[index], {
    knobRadius: KNOB_RADIUS,
    bevel: BLOCK_BEVEL,
  });
}

/**
 * The outline points a piece carries on one edge, without the straight side
 * edges (which sit at half width) and without the flat part of the edge itself
 * (which sits exactly on the edge line).
 */
function edgePoints(shape: THREE.Shape, edge: "top" | "bottom"): THREE.Vector2[] {
  const sign = edge === "top" ? 1 : -1;
  const band = KNOB_RADIUS * 4;
  return shape
    .getPoints(48)
    .filter((point) => Math.abs(point.x) < HALF_WIDTH - 1e-6)
    .filter((point) => Math.abs(sign * point.y - HALF_HEIGHT) > 1e-6)
    .filter((point) => sign * point.y > HALF_HEIGHT - band);
}

/** Where along the edge the cut sits, or null for a flat edge. */
function edgeFeatureCenter(shape: THREE.Shape, edge: "top" | "bottom"): number | null {
  const xs = edgePoints(shape, edge).map((point) => point.x);
  if (xs.length === 0) return null;
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}

/** How far the cut leaves the piece's own edge line: positive for a knob crown,
 *  negative for a socket (which is cut into the piece), zero for a flat edge. */
function edgeFeatureReach(shape: THREE.Shape, edge: "top" | "bottom"): number {
  const sign = edge === "top" ? 1 : -1;
  const ys = edgePoints(shape, edge).map((point) => sign * point.y - HALF_HEIGHT);
  if (ys.length === 0) return 0;
  return Math.max(...ys) > 1e-9 ? Math.max(...ys) : Math.min(...ys);
}

/** Two facing edges mesh when one carries the knob and the other the socket that
 *  receives it, at the same point along the edge. */
function meshes(upper: Cut, lower: Cut): boolean {
  return (
    upper.offset === lower.offset &&
    upper.kind !== lower.kind &&
    upper.kind !== "flat" &&
    lower.kind !== "flat"
  );
}

let system: any;
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
  nextIndex = 0;
  globalThis.window = { isForestActive: true, forestPuzzleSolved: false } as any;
  const root = new THREE.Group();
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
});

/** The block body mesh the forest system attached for the line at `index`. */
function blockBody(index: number): THREE.Mesh {
  const entity = system.blockEntities.get(index);
  assert.ok(entity, `Line ${index} has a block`);
  const body = entity.object3D.children.find((child: THREE.Object3D) => child instanceof THREE.Mesh);
  assert.ok(body, `Line ${index}'s block has a body mesh`);
  return body as THREE.Mesh;
}

test("No two pieces of a puzzle are cut the same", () => {
  for (const lines of PUZZLES) {
    const cuts = jigsawPieceEdges(lines).map(
      (edges) => `${edges.top.kind}@${edges.top.offset}|${edges.bottom.kind}@${edges.bottom.offset}`,
    );
    assert.equal(new Set(cuts).size, lines.length, `a puzzle of ${lines.length} pieces`);
  }
});

test("Only neighbours in the correct sequence mesh edge to edge", () => {
  for (const lines of PUZZLES) {
    const pieces = jigsawPieceEdges(lines);
    for (let upper = 0; upper < pieces.length; upper++) {
      for (let lower = 0; lower < pieces.length; lower++) {
        assert.equal(
          meshes(pieces[upper].bottom, pieces[lower].top),
          lower === upper + 1,
          `line ${upper} placed above line ${lower}`,
        );
      }
    }
  }
});

test("A puzzle keeps flat outer edges like a real jigsaw border", () => {
  for (const lines of PUZZLES) {
    const pieces = jigsawPieceEdges(lines);
    assert.equal(pieces[0].top.kind, "flat");
    assert.equal(pieces[pieces.length - 1].bottom.kind, "flat");
  }
});

test("A knob lands squarely in the socket of the piece above it", () => {
  for (const lines of PUZZLES) {
    const shapes = lines.map((_, index) => buildShape(lines, index));
    const pieces = jigsawPieceEdges(lines);
    for (let lower = 1; lower < lines.length; lower++) {
      const socket = edgeFeatureCenter(shapes[lower - 1], "bottom");
      const knob = edgeFeatureCenter(shapes[lower], "top");
      assert.ok(socket !== null && knob !== null, `line ${lower} meets line ${lower - 1} with a cut`);
      assert.ok(
        Math.abs(socket! - knob!) < 1e-6,
        `line ${lower}'s knob at ${knob} centres on line ${lower - 1}'s socket at ${socket}`,
      );
      // One of the two facing cuts carries the knob, the other the socket.
      const above = edgeFeatureReach(shapes[lower - 1], "bottom");
      const below = edgeFeatureReach(shapes[lower], "top");
      assert.ok(above * below < 0, `lines ${lower - 1}/${lower} meet with a knob and a socket`);
    }
  }
});

test("No cut reaches the flat face of the neighbouring piece", () => {
  // The two blocks' front faces are coplanar, so a cut that crossed the slot gap
  // would leave overlapping faces flickering against each other. Both the knob
  // crown and, on the other side, the socket's mouth stay inside the gap.
  for (const lines of PUZZLES) {
    for (let index = 0; index < lines.length; index++) {
      const shape = buildShape(lines, index);
      assert.ok(edgeFeatureReach(shape, "top") < SLOT_GAP, `line ${index}'s top cut stays in the gap`);
      assert.ok(-edgeFeatureReach(shape, "bottom") < SLOT_GAP, `line ${index}'s bottom cut stays in the gap`);
    }
  }
});

test("A knob slips inside the socket of the piece above it", () => {
  // Extrusion swells the cut by the bevel at mid-depth, which is where the two
  // blocks actually meet, so the nesting is checked with that swell included.
  for (const lines of PUZZLES) {
    for (let lower = 1; lower < lines.length; lower++) {
      const reaches = [
        edgeFeatureReach(buildShape(lines, lower - 1), "bottom"),
        edgeFeatureReach(buildShape(lines, lower), "top"),
      ];
      const knob = Math.max(...reaches) + BLOCK_BEVEL;
      const socket = -Math.min(...reaches) - BLOCK_BEVEL;
      const knobWidthAtMouth = Math.sqrt(Math.max(0, knob * knob - SLOT_GAP * SLOT_GAP));
      assert.ok(knob > SLOT_GAP, `line ${lower}'s pair really nests (${knob} past the ${SLOT_GAP} gap)`);
      assert.ok(knobWidthAtMouth <= socket, `the knob (${knobWidthAtMouth} wide) passes the socket mouth (${socket})`);
      assert.ok(knob < SLOT_GAP + socket, "the knob nests in the socket without pushing through it");
    }
  }
});

test("The extruded block carries the knob with flat faces that stay inside the gap", () => {
  const geometry = createJigsawBlockGeometry(
    BLOCK_WIDTH,
    BLOCK_HEIGHT,
    BLOCK_THICKNESS,
    { top: { kind: "knob", offset: 0 }, bottom: { kind: "socket", offset: 0 } },
    { knobRadius: KNOB_RADIUS, bevel: BLOCK_BEVEL },
  );
  geometry.computeBoundingBox();
  const crown = geometry.boundingBox!.max.y - HALF_HEIGHT;
  assert.ok(crown >= KNOB_RADIUS, `the knob is extruded (${crown})`);
  assert.ok(crown <= KNOB_RADIUS + 2 * BLOCK_BEVEL, `the knob keeps its size (${crown})`);

  // The front and back faces are the outermost layers and lie flat against the
  // neighbouring block, so they must never cross into that block's own faces.
  const position = geometry.getAttribute("position");
  let faceDepth = 0;
  for (let index = 0; index < position.count; index++) {
    faceDepth = Math.max(faceDepth, Math.abs(position.getZ(index)));
  }
  let faceCrown = -Infinity;
  for (let index = 0; index < position.count; index++) {
    if (Math.abs(Math.abs(position.getZ(index)) - faceDepth) < 1e-6) {
      faceCrown = Math.max(faceCrown, position.getY(index));
    }
  }
  assert.ok(faceCrown - HALF_HEIGHT <= SLOT_GAP, `the flat face stops inside the gap (${faceCrown - HALF_HEIGHT})`);
});

test("Each block is cut for its own line, not for its shuffled shelf position", () => {
  const expected = jigsawPieceEdges(FOREST_PUZZLE_LINES);
  for (let index = 0; index < FOREST_PUZZLE_LINES.length; index++) {
    const drawn = createJigsawBlockGeometry(
      BLOCK_WIDTH,
      BLOCK_HEIGHT,
      BLOCK_THICKNESS,
      expected[index],
      { knobRadius: KNOB_RADIUS, bevel: BLOCK_BEVEL },
    );
    assert.deepEqual(
      blockBody(index).geometry.getAttribute("position").array,
      drawn.getAttribute("position").array,
      `block for line ${index}`,
    );
  }
});

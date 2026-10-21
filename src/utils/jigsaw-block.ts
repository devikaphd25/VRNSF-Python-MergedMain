/**
 * Shared cut geometry for the Python jigsaw activities in the castle, forest
 * and ocean environments.
 *
 * Each activity is a column of code lines, and — like a real jigsaw — its
 * pieces only fit together along the one sequence they were cut from. Every
 * joint between two consecutive lines owns a key: how far along the edge the
 * knob sits, and whether the upper or the lower piece carries it. The piece
 * above the joint takes the key, the piece below its exact complement, and no
 * key is reused inside a puzzle. Complementary cuts therefore meet only in the
 * correct order, while a wrong neighbour shows two knobs butting together, two
 * sockets facing each other, or a knob over solid material.
 *
 * Knobs are deliberately shallow: callers pass a radius no wider than the gap
 * between two slots, so a shuffled block sitting on the shelf never reaches
 * into the piece above it and blocks can be reordered freely.
 */
import { ExtrudeGeometry, Shape } from "three";

/** A puzzle line, in the order it belongs to in the finished program. */
export interface JigsawCodeLine {
  id: string;
  text: string;
}

export type JigsawEdgeKind = "flat" | "knob" | "socket";

/** The cut along one horizontal edge of a piece. */
export interface JigsawEdge {
  kind: JigsawEdgeKind;
  /** Knob centre along the edge: -1 far left, 1 far right. Flat edges ignore it. */
  offset: number;
}

/** The two cut edges of a piece; the side edges stay straight. */
export interface JigsawPieceEdges {
  top: JigsawEdge;
  bottom: JigsawEdge;
}

/** Where along an edge a knob may sit, as a fraction of the free shoulder. */
const FEATURE_OFFSETS = [-0.72, -0.36, 0, 0.36, 0.72];

/** A socket is cut a little wider than the knob that fills it, so a joined pair
 *  never leaves two coincident, z-fighting surfaces. */
const SOCKET_CLEARANCE = 1.08;

const FLAT_EDGE: JigsawEdge = { kind: "flat", offset: 0 };

interface JigsawJoint {
  offset: number;
  /** True when the upper piece of the joint carries the knob. */
  knobOnTop: boolean;
}

/** Every key a joint can take. Ten keys cover the nine joints of the longest
 *  activity (the ocean's ten lines), and no puzzle reuses one. */
const JOINT_KEYS: JigsawJoint[] = FEATURE_OFFSETS.reduce<JigsawJoint[]>(
  (keys, offset) => keys.concat({ offset, knobOnTop: true }, { offset, knobOnTop: false }),
  [],
);

/** Stable string hash, so each puzzle's cuts follow its own code. */
function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

/** The two facing edges a joint produces: the knob on one piece, the socket on
 *  the other, both at the same offset. */
function jointEdges(joint: JigsawJoint): { upperBottom: JigsawEdge; lowerTop: JigsawEdge } {
  return {
    upperBottom: { kind: joint.knobOnTop ? "knob" : "socket", offset: joint.offset },
    lowerTop: { kind: joint.knobOnTop ? "socket" : "knob", offset: joint.offset },
  };
}

/**
 * Cuts for every line of a puzzle, indexed by the line's position in the correct
 * sequence. The first line's top edge and the last line's bottom edge stay flat,
 * like the border of a real puzzle.
 */
export function jigsawPieceEdges(lines: JigsawCodeLine[]): JigsawPieceEdges[] {
  const jointCount = Math.max(0, lines.length - 1);
  const seed = hashText(lines.map((line) => `${line.id}:${line.text}`).join("|")) % JOINT_KEYS.length;

  const joints = Array.from(
    { length: jointCount },
    (_, index) => JOINT_KEYS[(seed + index) % JOINT_KEYS.length],
  );

  return lines.map((_, index) => ({
    top: index === 0 ? FLAT_EDGE : jointEdges(joints[index - 1]).lowerTop,
    bottom: index === jointCount ? FLAT_EDGE : jointEdges(joints[index]).upperBottom,
  }));
}

export interface JigsawBlockGeometryOptions {
  /** Knob radius. Keep it at or below the gap between two slots so knobs never
   *  reach the neighbouring piece while the blocks sit shuffled on the shelf. */
  knobRadius: number;
  bevel: number;
}

/**
 * Extrudes one puzzle piece: a rectangle whose top and bottom edges carry the
 * knob or socket described by `edges`. Only the vertical seams are cut, because
 * the pieces of these activities interlock along the code sequence alone.
 */
export function createJigsawBlockGeometry(
  width: number,
  height: number,
  depth: number,
  edges: JigsawPieceEdges,
  options: JigsawBlockGeometryOptions,
): ExtrudeGeometry {
  const shape = createJigsawBlockShape(width, height, edges, options);

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: options.bevel,
    bevelSize: options.bevel,
    bevelSegments: 2,
  });
  // Centre on z so the face panel position stays the same as with BoxGeometry.
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** The flat outline the block is extruded from: the cut itself, without depth. */
export function createJigsawBlockShape(
  width: number,
  height: number,
  edges: JigsawPieceEdges,
  options: JigsawBlockGeometryOptions,
): Shape {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const { knobRadius } = options;
  // Both edges of a joint place their cut from the same, widest radius, so a
  // knob always sits dead centre in the socket that receives it.
  const widestRadius = knobRadius * SOCKET_CLEARANCE;

  const shape = new Shape();
  // Outlined counter-clockwise: bottom edge, right edge, top edge, left edge.
  shape.moveTo(-halfWidth, -halfHeight);
  addEdge(shape, edges.bottom, -halfHeight, 1, halfWidth, widestRadius, knobRadius);
  shape.lineTo(halfWidth, halfHeight);
  addEdge(shape, edges.top, halfHeight, -1, halfWidth, widestRadius, knobRadius);
  shape.lineTo(-halfWidth, -halfHeight);

  return shape;
}

/**
 * Walks one horizontal edge of the outline, detouring through the knob or socket
 * the edge carries. `direction` is 1 when the edge is drawn left to right (the
 * bottom) and -1 when it is drawn right to left (the top).
 */
function addEdge(
  shape: Shape,
  edge: JigsawEdge,
  y: number,
  direction: 1 | -1,
  halfWidth: number,
  widestRadius: number,
  knobRadius: number,
): void {
  if (edge.kind === "flat") {
    shape.lineTo(direction * halfWidth, y);
    return;
  }

  const radius = edge.kind === "socket" ? knobRadius * SOCKET_CLEARANCE : knobRadius;
  const centerX = edge.offset * (halfWidth - widestRadius);

  shape.lineTo(centerX - radius * direction, y);
  // A knob bulges out of the piece and a socket is cut into it, so the arc runs
  // the opposite way round the feature's centre for each.
  const clockwise = edge.kind === "socket";
  if (direction === 1) {
    shape.absarc(centerX, y, radius, Math.PI, 0, clockwise);
  } else {
    shape.absarc(centerX, y, radius, 0, Math.PI, clockwise);
  }
  shape.lineTo(direction * halfWidth, y);
}

/**
 * The ocean puzzle's centre board: a large blue whale.
 *
 * The code blocks climb the whale's flank, so its body is a whale-shaped slab
 * (an extruded silhouette) whose flat front face sits just behind the block
 * plane — every placed block rests on the whale instead of hovering off a
 * curved surface. Eyes, flippers and tail flukes are separate volumes in the
 * margins: clear of the code column down the middle, and clear of the control
 * buttons beside the board.
 *
 * The caller passes the real bounds of the code column and the lowest y the
 * head may reach (the feedback panel's bottom edge, which sits in front of the
 * whale), so the body always backs every code row and the head never hides
 * behind that panel.
 */
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { ExtrudeGeometry, Shape } from "three";

/** Same layout scale as OceanJigsawPuzzleSystem. */
const S = 2.2;

const BODY_BLUE = 0x2f86bf;
const FIN_BLUE = 0x1f6390;
const EYE_WHITE = 0xf2faff;
const PUPIL_DARK = 0x0b1a26;

export interface WhaleBoardLayout {
  /** The board's centre x, in world metres (the code column is centred on it). */
  centerX: number;
  /** Half the width of a placed code stack. */
  halfWidth: number;
  /** Top edge of the highest code row, in world y. */
  top: number;
  /** Bottom edge of the lowest code row, in world y. */
  bottom: number;
  /** The z the code blocks sit at: the plane the whale's face belongs behind. */
  z: number;
  /** Lowest y the head may reach — the feedback panel's bottom edge. */
  headLimit: number;
}

export function createWhaleBoard(layout: WhaleBoardLayout): Group {
  const whale = new Group();
  whale.name = "OceanWhaleBoard";

  // Half a block's thickness behind the block plane: the placed blocks' back
  // faces come to rest on this face instead of sinking into the body.
  const faceZ = layout.z + 0.06;

  // ── Silhouette ────────────────────────────────────────────
  // A whale breaching head-up, sized from the code column: a wide, flat-topped
  // head like a blue whale's, a chest as wide as the head, and a tail stock
  // that keeps the column's own width all the way down before the sand buries
  // it. The code rows therefore always sit against the whale, never in water.
  const headTop = Math.min(layout.top + 0.06, layout.headLimit - 0.02);
  const headTopHalf = layout.halfWidth + 0.1;
  const headHalf = layout.halfWidth + 0.26;
  const shoulderHalf = layout.halfWidth + 0.68;
  const shoulderY = layout.top - 1.15;
  const bodyHalf = layout.halfWidth + 0.56;
  const bodyY = layout.top - 2.5;
  const tailHalf = layout.halfWidth + 0.06;
  const tailY = layout.bottom;
  const bellyY = layout.bottom - 0.45;
  const eyeY = layout.top - 0.78;
  const eyeX = layout.halfWidth + 0.26;

  // Right half, top to bottom, as [control x, control y, end x, end y].
  const rightHalf: Array<[number, number, number, number]> = [
    [headHalf + 0.06, headTop, headHalf, headTop - 0.4],
    [shoulderHalf * 0.95, layout.top - 0.75, shoulderHalf, shoulderY],
    [bodyHalf + 0.04, bodyY + 0.45, bodyHalf, bodyY],
    [tailHalf + 0.03, tailY + 0.45, tailHalf, tailY],
    [tailHalf * 0.86, bellyY + 0.15, 0, bellyY],
  ];

  const outline = new Shape();
  outline.moveTo(-headTopHalf, headTop);
  outline.lineTo(headTopHalf, headTop);
  const corners: Array<[number, number]> = [[headTopHalf, headTop]];
  for (const [cx, cy, x, y] of rightHalf) {
    outline.quadraticCurveTo(cx, cy, x, y);
    corners.push([x, y]);
  }
  for (let i = rightHalf.length - 1; i >= 0; i--) {
    const [cx, cy] = rightHalf[i];
    const [px, py] = corners[i];
    outline.quadraticCurveTo(-cx, cy, -px, py);
  }
  outline.closePath();

  const geometry = new ExtrudeGeometry(outline, {
    depth: 0.27 * S,
    bevelEnabled: true,
    bevelThickness: 0.02 * S,
    bevelSize: 0.04 * S,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.computeBoundingBox();

  const body = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: BODY_BLUE,
      roughness: 0.72,
      emissive: BODY_BLUE,
      emissiveIntensity: 0.12,
    }),
  );
  // The bevel pushes the front cap back off the extrusion's z origin. Park the
  // flat cap on the group's own z = 0 plane so the front face is predictable.
  body.position.z = -(geometry.boundingBox?.min.z ?? 0);
  whale.add(body);

  // ── Face ──────────────────────────────────────────────────
  const face = new Group();
  face.position.z = 0;
  whale.add(face);

  const eyeWhiteMat = new MeshStandardMaterial({
    color: EYE_WHITE,
    roughness: 0.35,
  });
  const pupilMat = new MeshStandardMaterial({
    color: PUPIL_DARK,
    roughness: 0.3,
  });

  for (const side of [-1, 1]) {
    const white = new Mesh(
      new SphereGeometry(0.08 * S, 12, 12),
      eyeWhiteMat,
    );
    white.position.set(side * eyeX, eyeY, 0);
    face.add(white);

    const pupil = new Mesh(
      new SphereGeometry(0.045 * S, 10, 10),
      pupilMat,
    );
    // Toward the player, so the whale looks back at the student.
    pupil.position.set(side * eyeX, eyeY, -0.13);
    face.add(pupil);
  }

  // ── Flippers and tail flukes ──────────────────────────────
  const finMat = new MeshStandardMaterial({
    color: FIN_BLUE,
    roughness: 0.65,
    emissive: FIN_BLUE,
    emissiveIntensity: 0.1,
  });

  for (const side of [-1, 1]) {
    // Pectoral flippers, swept down and outward off the chest. They stop short
    // of the control buttons' column beside the board.
    const flipper = new Mesh(
      new SphereGeometry(1, 10, 8),
      finMat,
    );
    flipper.position.set(side * (shoulderHalf - 0.22), bodyY + 0.45, -0.04);
    flipper.scale.set(0.55, 0.08, 0.22);
    flipper.rotation.z = -side * 0.85;
    whale.add(flipper);

    // Tail flukes, splayed out at the bottom of the tail stock.
    const fluke = new Mesh(
      new SphereGeometry(1, 10, 8),
      finMat,
    );
    fluke.position.set(side * (tailHalf + 0.37), tailY + 0.3, 0);
    fluke.scale.set(0.42, 0.07, 0.26);
    fluke.rotation.z = -side * 0.5;
    whale.add(fluke);
  }

  whale.position.set(layout.centerX, 0, faceZ);
  return whale;
}

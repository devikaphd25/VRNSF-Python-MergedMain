import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from "three";

/** Build only perimeter quads, so no triangulated face can span the screen. */
export function createClassroomBoardFrame(width: number, height: number): Group {
  const frame = new Group();
  frame.name = "ClassroomBoardFrame";
  const bezel = Math.min(width, height) * 0.025;
  const ring = (outer: number, inner: number, color: number, depth: number, z: number) => {
    const vertices: number[] = [];
    const indices: number[] = [];
    // Both contours share corner centers and angles. This guarantees nested
    // outlines, including the narrow cyan trim at each rounded corner.
    const contour = (margin: number, planeZ: number) => {
      for (let corner = 0; corner < 4; corner++) {
        const cx = corner === 0 || corner === 3 ? width / 2 : -width / 2;
        const cy = corner < 2 ? height / 2 : -height / 2;
        for (let step = 0; step <= 8; step++) {
          const angle = (corner + step / 8) * Math.PI / 2;
          vertices.push(cx + Math.cos(angle) * margin, cy + Math.sin(angle) * margin, planeZ);
        }
      }
    };
    contour(outer, z);
    contour(inner, z);
    contour(outer, z + depth);
    contour(inner, z + depth);
    const count = 36;
    const connect = (a: number, b: number) => {
      for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        indices.push(a + i, a + next, b + next, a + i, b + next, b + i);
      }
    };
    connect(0, count);
    connect(count * 2, count * 3);
    connect(0, count * 2);
    connect(count, count * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ color, toneMapped: false, side: DoubleSide }));
    mesh.pointerEvents = "none";
    frame.add(mesh);
  };
  // Stepped casing gives the board a finished edge at oblique headset angles.
  ring(bezel * 2.15, 0.006, 0x050c17, bezel * 1.8, -bezel * 1.3);
  ring(bezel * 1.95, bezel * 1.7, 0x25394d, 0.012, bezel * 0.5);
  ring(bezel * 1.7, 0.006, 0x0b1c2e, 0.012, bezel * 0.53);
  ring(bezel * 1.52, bezel * 1.40, 0x70d8e9, 0.008, bezel * 0.7);
  frame.pointerEvents = "none";
  return frame;
}

import { Box3, Matrix4, Object3D, Vector3, type BufferGeometry } from 'three';

/** Geometry measured in the object's own coordinates, independent of its scene placement. */
export function objectLocalBounds(root: Object3D): Box3 {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const bounds = new Box3();
  root.traverse(object => {
    for (let current: Object3D | null = object; current && current !== root; current = current.parent) if (!current.visible) return;
    if (object.userData.isDepthMask) return;
    const geometry = (object as Object3D & { geometry?: BufferGeometry }).geometry;
    if (!geometry) return;
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
  });
  return bounds;
}

export function fitObjectHeight(root: Object3D, height: number): void {
  const bounds = objectLocalBounds(root), size = bounds.getSize(new Vector3());
  if (bounds.isEmpty() || size.y < 0.001) return;
  const center = bounds.getCenter(new Vector3()), scale = height / size.y;
  root.scale.setScalar(scale);
  root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  root.updateWorldMatrix(false, true);
}

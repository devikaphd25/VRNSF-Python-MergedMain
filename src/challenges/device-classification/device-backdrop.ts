import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

/** A light showcase backing, separate from the model and its grab surface. */
export function createDeviceBackdrop(): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const panel = new Mesh(new PlaneGeometry(0.64, 0.6), new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.48,
    depthWrite: false, side: DoubleSide, toneMapped: false,
  }));
  panel.name = 'DeviceShowcaseBackdrop';
  panel.position.set(0, 0.7, -0.08);
  panel.pointerEvents = 'none';
  panel.raycast = () => {};
  return panel;
}

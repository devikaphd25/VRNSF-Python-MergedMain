/** Stores the forest scene root so forest jigsaw systems can attach objects safely. */
import type { Object3D } from "three";

let forestRoot: Object3D | null = null;

export function setForestRoot(root: Object3D): void {
  forestRoot = root;
}

export function attachToForestRoot(object: Object3D): void {
  forestRoot?.add(object);
}

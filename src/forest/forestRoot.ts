/** Keeps both the scene and ECS parent for all forest puzzle objects. */
import type { Entity, World } from "@iwsdk/core";
import type { Object3D } from "three";

let forestRoot: Object3D | null = null;
let forestRootEntity: Entity | null = null;

export function setForestRoot(root: Object3D, entity: Entity): void {
  forestRoot = root;
  forestRootEntity = entity;
}

export function createForestEntity(world: World, object?: Object3D): Entity {
  if (!forestRootEntity) throw new Error("Forest root is not initialized.");
  // A raw Object3D.add is overwritten by IWSDK's first transform update.
  return world.createTransformEntity(object, { parent: forestRootEntity });
}

export function attachToForestRoot(object: Object3D): void {
  forestRoot?.add(object);
}

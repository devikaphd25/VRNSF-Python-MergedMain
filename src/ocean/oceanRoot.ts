/** Keeps both the scene and ECS parent for all ocean puzzle objects. */
import type { Entity, World } from "@iwsdk/core";
import type { Object3D } from "three";

let oceanRoot: Object3D | null = null;
let oceanRootEntity: Entity | null = null;

export function setOceanRoot(root: Object3D, entity: Entity): void {
  oceanRoot = root;
  oceanRootEntity = entity;
}

export function createOceanEntity(world: World, object?: Object3D): Entity {
  if (!oceanRootEntity) throw new Error("Ocean root is not initialized.");
  return world.createTransformEntity(object, { parent: oceanRootEntity });
}

export function attachToOceanRoot(object: Object3D): void {
  oceanRoot?.add(object);
}

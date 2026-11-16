/** Keeps both the scene and ECS parent for all castle puzzle objects. */
import type { Entity, World } from "@iwsdk/core";
import type { Object3D } from "three";

let castleRoot: Object3D | null = null;
let castleRootEntity: Entity | null = null;

export function setCastleRoot(root: Object3D, entity: Entity): void {
  castleRoot = root;
  castleRootEntity = entity;
}

export function createCastleEntity(world: World, object?: Object3D): Entity {
  if (!castleRootEntity) throw new Error("Castle root is not initialized.");
  // A raw Object3D.add is overwritten by IWSDK's first transform update.
  return world.createTransformEntity(object, { parent: castleRootEntity });
}

export function attachToCastleRoot(object: Object3D): void {
  castleRoot?.add(object);
}

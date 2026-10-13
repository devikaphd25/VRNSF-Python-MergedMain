/** Keep hidden classroom/puzzle entities out of mouse, controller and hand hit tests. */
import {
  createSystem,
  DistanceGrabbable,
  PokeInteractable,
  RayInteractable,
} from "@iwsdk/core";
import type { Object3D } from "three";

export class VisibleInteractionSystem extends createSystem({
  rays: { required: [RayInteractable] },
  pokes: { required: [PokeInteractable] },
  blocks: { required: [DistanceGrabbable] },
}) {
  private hiddenObjects = new Map<Object3D, {
    pointerEvents: Object3D["pointerEvents"];
    intersectChildren: Object3D["intersectChildren"];
  }>();

  init(): void {
    this.cleanupFuncs.push(() => {
      for (const [object, settings] of this.hiddenObjects) {
        object.pointerEvents = settings.pointerEvents;
        object.intersectChildren = settings.intersectChildren;
      }
      this.hiddenObjects.clear();
    });
  }

  update(): void {
    const entities = new Set([
      ...this.queries.rays.entities,
      ...this.queries.pokes.entities,
      ...this.queries.blocks.entities,
    ]);

    for (const entity of entities) {
      const object = entity.object3D;
      if (!object) continue;

      let visible = true;
      for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) {
          visible = false;
          break;
        }
      }

      const saved = this.hiddenObjects.get(object);
      if (!visible) {
        if (!saved) {
          this.hiddenObjects.set(object, {
            pointerEvents: object.pointerEvents,
            intersectChildren: object.intersectChildren,
          });
        }
        // IWSDK publishes entity roots directly, skipping their hidden parents.
        // Disable both the root and its label/mesh descendants, not just rendering.
        object.pointerEvents = "none";
        object.intersectChildren = false;
      } else if (saved) {
        object.pointerEvents = saved.pointerEvents;
        object.intersectChildren = saved.intersectChildren;
        this.hiddenObjects.delete(object);
      }
    }
  }
}

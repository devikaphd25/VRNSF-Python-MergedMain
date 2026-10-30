import { Material, Mesh, Object3D } from "three";

/** Keep tracked controllers/hands visible over the instructor's overlay UI. */
export class InstructorControllerVisuals {
  private readonly orders = new Map<Object3D, number>();
  private readonly materials = new Map<Material, {
    transparent: boolean; depthTest: boolean; depthWrite: boolean;
  }>();

  update(models: Object3D[]): void {
    if (!models.length) { this.restore(); return; }
    for (const model of models) model.traverse(object => {
      if (!this.orders.has(object)) this.orders.set(object, object.renderOrder);
      // Every nested Group needs the order: groupOrder precedes renderOrder.
      object.renderOrder = 110000;
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!this.materials.has(material)) {
          this.materials.set(material, { transparent: material.transparent,
            depthTest: material.depthTest, depthWrite: material.depthWrite });
          // The menu uses the transparent pass. Opaque models render before it.
          material.transparent = true;
          material.depthTest = false;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
      }
    });
  }

  restore(): void {
    for (const [object, order] of this.orders) object.renderOrder = order;
    for (const [material, properties] of this.materials) {
      Object.assign(material, properties);
      material.needsUpdate = true;
    }
    this.orders.clear();
    this.materials.clear();
  }
}

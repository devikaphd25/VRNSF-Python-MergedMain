import { createRayPointer, type Pointer } from "@pmndrs/pointer-events";
import {
  BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial,
  Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, SphereGeometry, Vector3,
} from "three";

export interface DashboardControllerSample {
  hand: "left" | "right";
  space: Object3D;
  pressed: boolean;
}

/** Dedicated UI rays: full-length visuals and trigger events scoped to the open panel. */
export class DashboardControllerRays {
  private readonly scope = new Scene();
  private readonly visuals = new Group();
  private target: Object3D | null = null;
  private readonly hands = new Map<string, {
    pointer: Pointer; space: { current: Object3D }; beam: Line; cursor: Mesh;
    down: boolean; armed: boolean;
  }>();
  private readonly origin = new Vector3();
  private readonly end = new Vector3();

  constructor(private readonly scene: Scene, private readonly camera: PerspectiveCamera) {
    // Pointer-events skips childless roots before consulting its descendant list.
    // Keep a sentinel child; the real panel remains parented to the world scene.
    this.scope.add(new Object3D());
    this.visuals.name = "InstructorDashboardRayVisuals";
    this.visuals.renderOrder = 120000;
    this.visuals.pointerEvents = "none";
    scene.add(this.visuals);
  }

  get active(): boolean { return this.target !== null; }

  update(target: Object3D | null, samples: DashboardControllerSample[]): void {
    const changed = target !== this.target;
    this.target = target;
    this.scope.interactableDescendants = target ? [target] : [];
    for (const hand of ["left", "right"] as const) {
      const sample = target ? samples.find(input => input.hand === hand) : undefined;
      let entry = this.hands.get(hand);
      if (sample && !entry) {
        const space = { current: sample.space };
        const pointer = createRayPointer(() => this.camera, space,
          { instructorDashboardRay: true }, { contextMenuButton: -1 });
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(6), 3));
        const beam = new Line(geometry, new LineBasicMaterial({
          color: 0x67e8f9, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
        }));
        beam.name = `InstructorDashboardRay-${hand}`;
        beam.renderOrder = 120000;
        beam.frustumCulled = false;
        beam.pointerEvents = "none";
        const cursor = new Mesh(new SphereGeometry(0.008, 8, 6), new MeshBasicMaterial({
          color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
        }));
        cursor.name = `InstructorDashboardCursor-${hand}`;
        cursor.renderOrder = 120001;
        cursor.pointerEvents = "none";
        this.visuals.add(beam, cursor);
        entry = { pointer, space, beam, cursor, down: false, armed: false };
        this.hands.set(hand, entry);
      }
      if (!entry) continue;
      const event = { button: 0, timeStamp: performance.now() };
      if (!sample || changed) {
        entry.pointer.cancel(event);
        entry.down = false;
        entry.armed = false;
      }
      entry.beam.visible = Boolean(sample);
      entry.cursor.visible = false;
      if (!sample) continue;
      entry.space.current = sample.space;
      sample.space.updateWorldMatrix(true, false);
      target?.updateWorldMatrix(true, true);
      entry.pointer.move(this.scope, event);
      if (!sample.pressed) entry.armed = true;
      if (entry.armed && sample.pressed && !entry.down) entry.pointer.down(event);
      // Activation is on trigger-down. Up only releases UIKit hover/press state.
      if (!sample.pressed && entry.down) entry.pointer.up(event);
      entry.down = sample.pressed;

      this.origin.setFromMatrixPosition(sample.space.matrixWorld);
      const hit = entry.pointer.getIntersection();
      if (hit && !hit.object.isVoidObject) {
        this.end.copy(hit.point);
        entry.cursor.position.copy(hit.point);
        entry.cursor.visible = true;
      }
      else this.end.set(0, 0, -4).applyMatrix4(sample.space.matrixWorld);
      const positions = entry.beam.geometry.getAttribute("position");
      positions.setXYZ(0, this.origin.x, this.origin.y, this.origin.z);
      positions.setXYZ(1, this.end.x, this.end.y, this.end.z);
      positions.needsUpdate = true;
      (entry.beam.material as LineBasicMaterial).color.setHex(sample.pressed ? 0x22c55e : 0x67e8f9);
    }
  }

  dispose(): void {
    this.update(null, []);
    for (const { beam, cursor } of this.hands.values()) {
      beam.removeFromParent();
      beam.geometry.dispose();
      (beam.material as LineBasicMaterial).dispose();
      cursor.removeFromParent();
      cursor.geometry.dispose();
      (cursor.material as MeshBasicMaterial).dispose();
    }
    this.hands.clear();
    this.visuals.removeFromParent();
  }
}

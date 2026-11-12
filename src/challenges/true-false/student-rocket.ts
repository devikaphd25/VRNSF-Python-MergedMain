import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { SCORE_SERIF } from "../../ui/serif-type";
import { fitObjectHeight, objectLocalBounds } from '../../ui/object-local-bounds';

const MODEL_CANDIDATES = [
  "/models/challenge-1/rocket-five-parts.glb",
  "/models/rocket-five-parts.glb",
  "/gltf/challenge-1/rocket-five-parts.glb",
];

const TARGET_HEIGHT = 1.18;
const GHOST_OPACITY = 0.38;
const CELL_SIZE = 0.24;
const CELL_GAP = 0.05;
const ROCKET_DROP_PADDING = 0.05;
const OVERLAY_ORDER = 10000;
const PART_COUNT = 5;

export class StudentRocketRig {
  readonly root = new THREE.Group();
  readonly launchButton: THREE.Mesh;
  private readonly body = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly rack = new THREE.Group();
  private readonly flame: THREE.Mesh;
  private slots: THREE.Object3D[] = [];
  private pickups: Array<{
    cell: THREE.Group;
    wrapper: THREE.Group;
    visual: THREE.Object3D;
    hit: THREE.Mesh;
    lock: THREE.Sprite;
    rest: THREE.Vector3;
  }> = [];
  private unlocked = [false, false, false, false, false];
  private assembled = [false, false, false, false, false];
  private launching = false;
  private hasLaunched = false;
  private launchElapsed = 0;
  private restPosition = new THREE.Vector3();
  private draggingIndex: number | null = null;
  private dragOffset = new THREE.Vector3();
  private dragPlane = new THREE.Plane();
  private worldHit = new THREE.Vector3();
  private lockTexture?: THREE.CanvasTexture;

  constructor(private readonly onLaunch = () => {}, private readonly onReset = () => {}) {
    this.root.name = "StudentRocketRig";
    this.root.userData.isStudentRocket = true;
    this.root.userData.isClassRocket = true;
    this.root.add(this.body);
    this.body.add(this.inner);
    this.root.add(this.rack);
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.22, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffb36b,
        transparent: true,
        opacity: 0.85,
        depthTest: true,
        depthWrite: true,
      })
    );
    this.flame.rotation.x = Math.PI;
    this.flame.position.y = -0.04;
    this.flame.visible = false;
    this.body.add(this.flame);

    this.launchButton = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.16),
      new THREE.MeshBasicMaterial({
        map: makeButtonTexture("LAUNCH", false),
        transparent: true,
        depthTest: true,
        depthWrite: true,
      })
    );
    this.launchButton.name = "StudentRocketLaunch";
    this.launchButton.position.copy(launchButtonPosition());
    this.root.add(this.launchButton);

    this.root.visible = false;
    this.root.frustumCulled = false;
    this.buildFallbackSlots();
    this.buildRackFromSlots();
    this.refreshLocks();
    this.refreshLaunchButton();
    this.cacheFrameBounds();
    void this.tryLoadModel();
  }

  attach(parent: THREE.Object3D, localPosition: THREE.Vector3, yaw = 0): void {
    if (this.root.parent !== parent) parent.add(this.root);
    this.root.position.copy(localPosition);
    this.root.rotation.set(0, yaw, 0);
    this.restPosition.copy(localPosition);
    this.applyOverlay();
    this.refreshPointerEvents();
  }

  private cacheFrameBounds(): void {
    const y = this.body.position.y;
    const buttonVisible = this.launchButton.visible, rackVisible = this.rack.visible;
    this.body.position.y = 0;
    this.launchButton.visible = true;
    this.rack.visible = true;
    this.root.userData.panelFrameBounds = objectLocalBounds(this.root);
    this.body.position.y = y;
    this.launchButton.visible = buttonVisible;
    this.rack.visible = rackVisible;
    this.root.updateMatrixWorld(true);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) {
      this.cancelDrag();
      this.resetMotion(false);
    }
    this.refreshLaunchButton();
    this.refreshPointerEvents();
  }

  setUnlocks(next: boolean[]): void {
    for (let index = 0; index < PART_COUNT; index += 1) {
      this.unlocked[index] = Boolean(next[index]);
      if (!this.unlocked[index] && this.assembled[index]) {
        this.assembled[index] = false;
        this.styleSlot(index, false);
        this.resetPickup(index);
      }
    }
    this.refreshLocks();
    this.refreshLaunchButton();
  }

  resetAll(): void {
    this.cancelDrag();
    this.hasLaunched = false;
    this.resetMotion(true);
    this.unlocked = [false, false, false, false, false];
    this.assembled = [false, false, false, false, false];
    for (let index = 0; index < PART_COUNT; index += 1) {
      this.styleSlot(index, false);
      this.resetPickup(index);
    }
    this.launchButton.visible = true;
    this.refreshLocks();
    this.refreshLaunchButton();
  }

  canLaunch(): boolean {
    return (
      this.root.visible &&
      !this.hasLaunched &&
      !this.launching &&
      this.assembled.every(Boolean)
    );
  }

  launch(): void {
    if (!this.canLaunch()) return;
    this.onLaunch();
    this.hasLaunched = true;
    this.launching = true;
    this.launchElapsed = 0;
    this.flame.visible = true;
    this.launchButton.visible = false;
    this.rack.visible = false;
  }

  hitLaunch(raycaster: THREE.Raycaster): boolean {
    if (!this.canLaunch() || !this.launchButton.visible) return false;
    this.launchButton.updateMatrixWorld(true);
    return raycaster.intersectObject(this.launchButton, true).length > 0;
  }

  /** Only the five flat pickup targets and launch button are interactive.
   * Never raycast the detailed rocket model/ghost meshes on every XR frame. */
  hitControls(raycaster: THREE.Raycaster): boolean {
    if (!this.root.visible || this.launching || this.hasLaunched) return false;
    return this.hitLaunch(raycaster) || this.hitUnlockedPickup(raycaster) !== null;
  }

  beginDrag(raycaster: THREE.Raycaster): boolean {
    if (!this.root.visible || this.launching || this.hasLaunched) return false;
    if (this.hitLaunch(raycaster)) {
      this.launch();
      return false;
    }
    const hit = this.hitUnlockedPickup(raycaster);
    if (!hit) return false;
    this.draggingIndex = hit.index;
    const wrapper = this.pickups[hit.index].wrapper;
    wrapper.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    wrapper.getWorldPosition(world);
    this.dragPlane.setFromNormalAndCoplanarPoint(hit.normal, world);
    if (!raycaster.ray.intersectPlane(this.dragPlane, this.worldHit)) {
      this.draggingIndex = null;
      return false;
    }
    this.dragOffset.copy(world).sub(this.worldHit);
    return true;
  }

  updateDrag(raycaster: THREE.Raycaster): void {
    if (this.draggingIndex === null) return;
    if (!raycaster.ray.intersectPlane(this.dragPlane, this.worldHit)) return;
    const target = this.worldHit.clone().add(this.dragOffset);
    const wrapper = this.pickups[this.draggingIndex].wrapper;
    const parent = wrapper.parent;
    if (parent) parent.worldToLocal(target);
    wrapper.position.copy(target);
  }

  endDrag(): void {
    if (this.draggingIndex === null) return;
    const index = this.draggingIndex;
    this.draggingIndex = null;
    const slot = this.slots[index];
    const wrapper = this.pickups[index].wrapper;
    if (!slot || !this.unlocked[index] || this.assembled[index]) {
      this.resetPickup(index);
      return;
    }
    this.inner.updateMatrixWorld(true);
    wrapper.updateMatrixWorld(true);
    const rocketBounds = new THREE.Box3()
      .setFromObject(this.inner)
      .expandByScalar(ROCKET_DROP_PADDING);
    const partCenter = new THREE.Box3()
      .setFromObject(wrapper)
      .getCenter(new THREE.Vector3());
    const overRocket =
      rocketBounds.containsPoint(partCenter) ||
      rocketBounds.distanceToPoint(partCenter) <= 0.03;
    if (overRocket) {
      this.assembled[index] = true;
      this.styleSlot(index, true);
      wrapper.visible = false;
      this.refreshLaunchButton();
      return;
    }
    this.resetPickup(index);
  }

  isDragging(): boolean {
    return this.draggingIndex !== null;
  }

  update(deltaSeconds: number): void {
    const dt = Math.min(0.05, Math.max(0, deltaSeconds));
    if (!this.launching) return;
    this.launchElapsed += dt;
    this.body.position.y = this.launchElapsed * 1.55;
    const pulse = 0.7 + Math.sin(this.launchElapsed * 14) * 0.25;
    (this.flame.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.flame.scale.setScalar(0.85 + pulse * 0.35);
    if (this.launchElapsed > 5.5) {
      this.launching = false;
      this.flame.visible = false;
    }
  }

  refreshPointerEvents(): void {
    this.root.traverse(object => {
      (object as any).pointerEvents = "none";
    });
    this.pickups.forEach((pickup, index) => {
      pickup.wrapper.traverse(object => {
        (object as any).pointerEvents = "none";
      });
      pickup.cell.traverse(object => {
        (object as any).pointerEvents = "none";
      });
      const interactive =
        this.root.visible &&
        this.unlocked[index] &&
        !this.assembled[index] &&
        !this.hasLaunched;
      (pickup.hit as any).pointerEvents = interactive ? "auto" : "none";
    });
    (this.launchButton as any).pointerEvents = this.canLaunch() ? "auto" : "none";
  }

  private cancelDrag(): void {
    if (this.draggingIndex === null) return;
    const index = this.draggingIndex;
    this.draggingIndex = null;
    this.resetPickup(index);
  }

  private hitUnlockedPickup(raycaster: THREE.Raycaster):
    | { index: number; normal: THREE.Vector3 }
    | null {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.pickups.forEach((pickup, index) => {
      if (!this.unlocked[index] || this.assembled[index] || !pickup.wrapper.visible) {
        return;
      }
      pickup.hit.updateMatrixWorld(true);
      const hits = raycaster.intersectObject(pickup.hit, false);
      const first = hits[0];
      if (!first) return;
      if (bestIndex < 0 || first.distance < bestDistance) {
        bestIndex = index;
        bestDistance = first.distance;
      }
    });
    if (bestIndex < 0) return null;
    const cameraNormal = new THREE.Vector3(0, 0, 1);
    this.root.getWorldDirection(cameraNormal);
    return { index: bestIndex, normal: cameraNormal };
  }

  private resetPickup(index: number): void {
    const pickup = this.pickups[index];
    if (!pickup) return;
    pickup.wrapper.position.copy(pickup.rest);
    pickup.wrapper.visible = !this.assembled[index];
  }

  private resetMotion(keepVisible: boolean): void {
    this.onReset();
    this.launching = false;
    this.launchElapsed = 0;
    this.flame.visible = false;
    this.body.position.y = 0;
    this.root.position.copy(this.restPosition);
    this.rack.visible = true;
    this.root.visible = keepVisible && this.root.visible;
  }

  private async tryLoadModel(): Promise<void> {
    const loader = new GLTFLoader();
    for (const url of MODEL_CANDIDATES) {
      try {
        const gltf = await new Promise<any>((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });
        this.installModel(gltf.scene);
        return;
      } catch {
        // Keep the procedural rocket if the GLB is missing.
      }
    }
  }

  private installModel(scene: THREE.Object3D): void {
    this.slots.forEach(part => part.removeFromParent());
    this.inner.clear();
    this.inner.add(scene);
    const named = [1, 2, 3, 4, 5].map(
      index =>
        scene.getObjectByName(`Q${index}`) ||
        scene.getObjectByName(`q${index}`) ||
        scene.getObjectByName(`Rocket/Q${index}`)
    );
    const fallback = named.some(part => !part)
      ? this.meshesSortedByHeight(scene)
      : (named as THREE.Object3D[]);
    this.slots = fallback.slice(0, PART_COUNT);
    this.slots.forEach(part => {
      part.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(material => material.clone())
          : mesh.material.clone();
      });
    });
    this.normalizeInner();
    this.slots.forEach((_, index) => this.styleSlot(index, this.assembled[index]));
    this.rebuildRack();
    this.cacheFrameBounds();
    this.applyOverlay();
    this.refreshLocks();
    this.refreshPointerEvents();
  }

  private buildFallbackSlots(): void {
    const geometries: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(0.09, 0.15, 0.26, 10),
      new THREE.CylinderGeometry(0.14, 0.16, 0.3, 10),
      new THREE.CylinderGeometry(0.13, 0.14, 0.32, 10),
      new THREE.CylinderGeometry(0.1, 0.13, 0.26, 10),
      new THREE.ConeGeometry(0.1, 0.28, 10),
    ];
    const ys = [0.14, 0.42, 0.74, 1.04, 1.3];
    geometries.forEach((geometry, index) => {
      const mesh = new THREE.Mesh(
        geometry,
        this.makeSlotMaterial(false)
      );
      mesh.position.y = ys[index];
      mesh.name = `Q${index + 1}`;
      mesh.frustumCulled = false;
      this.inner.add(mesh);
      this.slots.push(mesh);
    });
    this.normalizeInner();
  }

  private buildRackFromSlots(): void {
    this.rebuildRack();
  }

  private rebuildRack(): void {
    this.rack.clear();
    this.pickups = [];
    this.slots.forEach((slot, index) => {
      const rest = cellRestPosition(index);
      const cell = new THREE.Group();
      cell.name = `RocketCell-Q${index + 1}`;
      cell.position.copy(rest);
      const hit = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          colorWrite: false,
          depthTest: false,
          depthWrite: false,
        })
      );
      hit.name = `RocketPickupHit-Q${index + 1}`;
      hit.position.z = 0.012;
      hit.renderOrder = OVERLAY_ORDER + 5;
      cell.add(hit);
      this.rack.add(cell);

      const wrapper = new THREE.Group();
      wrapper.name = `RocketPickup-Q${index + 1}`;
      const visual = this.makeCenteredCellVisual(slot);
      wrapper.add(visual);
      const lock = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.getLockTexture(),
          transparent: true,
          depthTest: true,
          depthWrite: false,
        })
      );
      lock.position.set(-0.02, 0, 0.04);
      lock.scale.set(0.13, 0.13, 1);
      lock.renderOrder = OVERLAY_ORDER + 1;
      wrapper.add(lock);
      wrapper.position.copy(rest);
      this.rack.add(wrapper);
      this.pickups.push({ cell, wrapper, visual, hit, lock, rest });
      this.stylePickup(index);
      if (this.assembled[index]) wrapper.visible = false;
    });
  }

  private makeCenteredCellVisual(source: THREE.Object3D): THREE.Group {
    const fitted = new THREE.Group();
    const clone = source.clone(true);
    clone.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (object.userData?.isDepthMask) {
        object.visible = false;
        return;
      }
      if (!mesh.isMesh || !mesh.material) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(material => material.clone())
        : mesh.material.clone();
      (mesh as any).raycast = () => undefined;
    });
    const leftoverMasks: THREE.Object3D[] = [];
    clone.traverse(object => {
      if (object.userData?.isDepthMask) leftoverMasks.push(object);
    });
    leftoverMasks.forEach(object => object.removeFromParent());
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);
    fitted.add(clone);
    fitted.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(fitted);
    const center = bounds.getCenter(new THREE.Vector3());
    clone.position.sub(center);
    fitted.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(fitted).getSize(new THREE.Vector3());
    const fit = (CELL_SIZE * 0.62) / Math.max(size.x, size.y, size.z, 0.001);
    fitted.scale.setScalar(fit);
    return fitted;
  }

  private normalizeInner(): void {
    fitObjectHeight(this.inner, TARGET_HEIGHT);
  }

  private meshesSortedByHeight(root: THREE.Object3D): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    root.updateMatrixWorld(true);
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData?.isDepthMask) meshes.push(mesh);
    });
    meshes.sort((left, right) => {
      const a = new THREE.Box3().setFromObject(left).getCenter(new THREE.Vector3()).y;
      const b = new THREE.Box3().setFromObject(right).getCenter(new THREE.Vector3()).y;
      return a - b;
    });
    return meshes;
  }

  private styleSlot(index: number, assembled: boolean): void {
    this.styleObject(this.slots[index], assembled ? 1 : GHOST_OPACITY, !assembled);
  }

  private stylePickup(index: number): void {
    const pickup = this.pickups[index];
    if (!pickup) return;
    const unlocked = this.unlocked[index];
    this.styleObject(pickup.visual, unlocked ? 1 : 0.35, !unlocked);
  }

  private styleObject(object: THREE.Object3D | undefined, opacity: number, ghost: boolean): void {
    if (!object) return;
    object.traverse(child => {
      if (child.userData?.isDepthMask) {
        child.visible = ghost;
        return;
      }
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mask = this.ensureDepthMask(mesh);
      mask.visible = ghost;
      mesh.renderOrder = ghost ? OVERLAY_ORDER + 1 : OVERLAY_ORDER;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => {
        const mat = material as THREE.MeshBasicMaterial;
        mat.transparent = ghost || opacity < 1;
        mat.opacity = opacity;
        mat.wireframe = false;
        mat.side = THREE.FrontSide;
        mat.depthTest = true;
        mat.depthWrite = !ghost;
        mat.needsUpdate = true;
      });
    });
  }

  private ensureDepthMask(mesh: THREE.Mesh): THREE.Mesh {
    const existing = mesh.children.find(
      child => child.userData?.isDepthMask
    ) as THREE.Mesh | undefined;
    if (existing) return existing;
    const mask = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.FrontSide,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        colorWrite: false,
      })
    );
    mask.name = "RocketGhostDepth";
    mask.userData.isDepthMask = true;
    mask.frustumCulled = false;
    mask.renderOrder = OVERLAY_ORDER;
    (mask as any).raycast = () => undefined;
    (mask as any).pointerEvents = "none";
    mesh.add(mask);
    return mask;
  }

  private makeSlotMaterial(assembled: boolean): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: assembled ? 0xe4eef8 : 0x88b7e6,
      transparent: !assembled,
      opacity: assembled ? 1 : GHOST_OPACITY,
      wireframe: false,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
    });
  }

  private refreshLocks(): void {
    this.pickups.forEach((pickup, index) => {
      pickup.lock.visible = !this.unlocked[index] && !this.assembled[index];
      this.stylePickup(index);
      pickup.wrapper.visible = !this.assembled[index];
      pickup.cell.visible = true;
    });
    this.refreshPointerEvents();
  }

  private refreshLaunchButton(): void {
    const ready = this.canLaunch();
    this.launchButton.visible = this.root.visible && !this.hasLaunched && !this.launching;
    const material = this.launchButton.material as THREE.MeshBasicMaterial;
    if (material.map) material.map.dispose();
    material.map = makeButtonTexture("LAUNCH", ready);
    material.opacity = 1;
    material.needsUpdate = true;
    (this.launchButton as any).pointerEvents = ready ? "auto" : "none";
  }

  private getLockTexture(): THREE.CanvasTexture {
    if (this.lockTexture) return this.lockTexture;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = "#7a2218";
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(64, 64, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(34, 94);
      ctx.lineTo(94, 34);
      ctx.stroke();
    }
    this.lockTexture = new THREE.CanvasTexture(canvas);
    this.lockTexture.needsUpdate = true;
    return this.lockTexture;
  }

  private applyOverlay(): void {
    this.root.traverse(object => {
      object.frustumCulled = false;
      const sprite = object as THREE.Sprite;
      if (sprite.isSprite) {
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.depthTest = true;
        mat.depthWrite = false;
        mat.needsUpdate = true;
        sprite.renderOrder = OVERLAY_ORDER + 1;
        return;
      }
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if (mesh.userData?.isDepthMask) {
        const maskMat = mesh.material as THREE.MeshBasicMaterial;
        maskMat.colorWrite = false;
        maskMat.transparent = false;
        maskMat.depthTest = true;
        maskMat.depthWrite = true;
        maskMat.side = THREE.FrontSide;
        maskMat.needsUpdate = true;
        mesh.renderOrder = OVERLAY_ORDER;
        return;
      }
      const isHud =
        mesh.name.startsWith("RocketPickupHit") ||
        mesh.parent?.name?.startsWith("RocketCell");
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => {
        const mat = material as THREE.MeshBasicMaterial;
        mat.side = THREE.FrontSide;
        if (mesh === this.launchButton || mesh === this.flame) {
          mat.depthTest = true;
          mat.depthWrite = true;
        } else if (isHud) {
          mat.depthTest = false;
          mat.depthWrite = false;
          if (mesh.name.startsWith("RocketPickupHit")) {
            mat.opacity = 0;
            mat.colorWrite = false;
          }
        }
        mat.needsUpdate = true;
      });
      mesh.renderOrder = isHud ? OVERLAY_ORDER + 2 : OVERLAY_ORDER + 1;
    });
    this.flame.renderOrder = OVERLAY_ORDER + 1;
    this.launchButton.renderOrder = OVERLAY_ORDER + 1;
  }
}

function cellRestPosition(index: number): THREE.Vector3 {
  const pitch = CELL_SIZE + CELL_GAP;
  const left = 0.5;
  const top = 0.86;
  const col = index === 4 ? 0.5 : index % 2;
  const row = index === 4 ? 2 : Math.floor(index / 2);
  return new THREE.Vector3(left + col * pitch, top - row * pitch, 0.08);
}

function launchButtonPosition(): THREE.Vector3 {
  const lowest = cellRestPosition(4);
  return new THREE.Vector3(lowest.x, lowest.y - CELL_SIZE * 0.5 - 0.14, 0.08);
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function makeButtonTexture(text: string, enabled = true): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 256, 80);
    drawEllipse(ctx, 128, 40, 120, 34);
    ctx.fillStyle = enabled ? "#2a6cb5" : "#3a3f4c";
    ctx.fill();
    drawEllipse(ctx, 128, 40, 118, 32);
    ctx.strokeStyle = enabled ? "#c5dcff" : "#6b7280";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = enabled ? "#f8fafc" : "#9ca3af";
    ctx.font = `500 28px ${SCORE_SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 42);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

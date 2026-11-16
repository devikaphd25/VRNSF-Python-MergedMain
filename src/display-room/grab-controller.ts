import * as THREE from 'three';
import type { DisplayGrabInput } from './grab-input';
import { separateHandContact, twoHandOrientation } from './hand-contact';
import { DISPLAY_ROOM_RAY_DISTANCE } from './ray-settings';

/** Local-only copies: no shared scene models or multiplayer state are modified. */
export class DisplayRoomGrab {
  readonly root = new THREE.Group();
  private copy: THREE.Group | null = null;
  private holding = false;
  private pressed = true;
  private selecting = true;
  private tapHolding = false;
  private pickupButtons = new Map<THREE.Object3D, THREE.Object3D>();
  private lastTarget: THREE.Object3D | null = null;
  private lastTargetAt = 0;
  private source: XRInputSource | null = null;
  private lastTracked = 0;
  private expiresAt = Infinity;
  private offset = new THREE.Vector3();
  private relativeRotation = new THREE.Quaternion();
  private halfSize = new THREE.Vector3();
  private twoHand: { source: XRInputSource; offset: THREE.Vector3; rotation: THREE.Quaternion } | null = null;
  private raycaster = new THREE.Raycaster();
  private bounds = new THREE.Box3();
  private highlight = new THREE.Box3Helper(new THREE.Box3(), 0x67e8f9);
  private beam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
  );

  constructor() {
    this.root.name = 'PersonalDisplayCopy';
    this.root.renderOrder = 120000;
    this.beam.name = 'DisplayRoomPickupRay';
    this.beam.renderOrder = 120000;
    this.beam.pointerEvents = 'none';
    this.highlight.visible = this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.root.add(this.highlight, this.beam);
  }

  get isPressed(): boolean { return this.pressed; }
  get isSelecting(): boolean { return this.selecting; }
  get inputSource(): XRInputSource | null { return this.source; }

  registerPickupButton(button: THREE.Object3D, exhibit: THREE.Object3D) {
    this.pickupButtons.set(button, exhibit);
  }

  reset() {
    this.removeCopy();
    this.source = null;
    this.pressed = true; // Require releasing a grip already held while entering.
    this.selecting = true;
    this.lastTarget = null;
    this.highlight.visible = this.beam.visible = false;
  }

  private removeCopy() {
    this.lastTarget = null;
    // Clones share original geometry/materials. Never dispose those shared assets.
    this.copy?.removeFromParent();
    this.copy = null;
    this.holding = false;
    this.tapHolding = false;
    this.twoHand = null;
    this.expiresAt = Infinity;
  }

  private release(now: number) {
    if (this.holding) this.expiresAt = now + 20_000;
    this.holding = false;
    this.tapHolding = false;
    this.twoHand = null;
  }

  private makeCopy(exhibit: THREE.Object3D, facing: THREE.Quaternion) {
    this.removeCopy();
    const model = exhibit.clone(true);
    // Discard pedestal placement and automatic exhibit rotation, keep model mounting.
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    model.position.sub(bounds.getCenter(new THREE.Vector3()));
    this.copy = new THREE.Group();
    this.copy.name = `${exhibit.name} hand copy`;
    this.copy.add(model);
    const width = exhibit.userData.handCopySize ?? 0.18;
    this.copy.scale.setScalar(width / Math.max(size.x, size.y, size.z, 0.001));
    this.halfSize.copy(size).multiplyScalar(this.copy.scale.x / 2);
    this.copy.quaternion.copy(facing);
    this.root.add(this.copy);
  }

  update(input: DisplayGrabInput | null, exhibits: THREE.Object3D[],
    facing: THREE.Quaternion, now: number, blocker?: THREE.Object3D, left: DisplayGrabInput | null = null) {
    this.highlight.visible = this.beam.visible = false;
    if (!this.holding && now >= this.expiresAt) this.removeCopy();
    if (!input) {
      // Freeze briefly on tracking loss, then release at the last valid position.
      if (now - this.lastTracked > 250) {
        this.release(now);
        this.source = null;
        this.pressed = true;
        this.selecting = true;
        this.lastTarget = null;
      }
      return;
    }
    this.lastTracked = now;
    if (input.source !== this.source) {
      this.release(now);
      this.source = input.source;
      this.pressed = true; // Switching controllers/hands must not accidentally grab.
      this.selecting = true;
      this.lastTarget = null;
    }
    const handTracking = Boolean(input.source.hand);
    const justPressed = !handTracking && input.pressed && !this.pressed;
    const justSelected = Boolean(input.selectPressed) && !this.selecting;
    this.pressed = input.pressed;
    this.selecting = Boolean(input.selectPressed);
    if (this.holding && justSelected && !handTracking) {
      this.release(now);
      this.lastTarget = null;
      return; // One tap releases; do not pick up again during the same press.
    }
    // Bare hands hold only while thumb/index remain pinched. Controllers retain
    // trigger-tap pickup/release, or continuous side-grip holding.
    const holdPressed = handTracking ? Boolean(input.selectPressed) : input.pressed;
    if (this.holding && !this.tapHolding && !holdPressed) this.release(now);

    let target: THREE.Object3D | null = null;
    if (!this.holding) {
      // Touching a floating copy takes priority over distant ray targets.
      if (this.copy) {
        this.copy.updateWorldMatrix(true, true);
        if (this.bounds.setFromObject(this.copy).distanceToPoint(input.position) < 0.08) target = this.copy;
      }
      if (!target && input.ray) {
        const buttons = [...this.pickupButtons.keys()].filter(b => b.visible && this.pickupButtons.get(b)!.children.length > 0);
        const candidates = [...exhibits.filter(e => e.children.length > 0), ...buttons, ...(this.copy ? [this.copy] : [])];
        candidates.forEach(e => e.updateWorldMatrix(true, true));
        this.raycaster.ray.copy(input.ray);
        this.raycaster.near = 0;
        this.raycaster.far = DISPLAY_ROOM_RAY_DISTANCE;
        const hit = this.raycaster.intersectObjects(candidates, true)[0];
        blocker?.updateWorldMatrix(true, false);
        const obstruction = blocker?.visible ? this.raycaster.intersectObject(blocker)[0] : undefined;
        const nearest = obstruction && (!hit || obstruction.distance <= hit.distance) ? obstruction : hit;
        const end = nearest?.point ?? input.ray.at(DISPLAY_ROOM_RAY_DISTANCE, new THREE.Vector3());
        const positions = this.beam.geometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, input.ray.origin.x, input.ray.origin.y, input.ray.origin.z);
        positions.setXYZ(1, end.x, end.y, end.z);
        positions.needsUpdate = true;
        this.beam.visible = true;
        if (obstruction && (!hit || obstruction.distance <= hit.distance)) this.lastTarget = null;
        if (hit && (!obstruction || hit.distance < obstruction.distance)) {
          target = hit.object;
          while (target && !candidates.includes(target)) target = target.parent;
        }
      }
      if (target) {
        this.lastTarget = this.pickupButtons.get(target) ?? target;
        this.lastTargetAt = now;
      } else if (justSelected && this.lastTarget && now - this.lastTargetAt < 350) {
        // A pinch can shift the hand ray slightly. Keep the just-highlighted target.
        target = this.lastTarget;
      }
      if (target) {
        this.highlight.box.setFromObject(target);
        this.highlight.visible = true;
        if (justPressed || justSelected) {
          target = this.pickupButtons.get(target) ?? target;
          if (target !== this.copy) {
            this.makeCopy(target, facing);
            // Present just above the fingertips/controller so the hand stays visible.
            this.copy!.position.copy(input.position).add(new THREE.Vector3(0, 0.10, -0.08).applyQuaternion(facing));
          } else if (this.copy!.position.distanceTo(input.position) > 0.35) {
            this.copy!.position.copy(input.position).add(new THREE.Vector3(0, 0.10, -0.08).applyQuaternion(facing));
          }
          const inverse = input.rotation.clone().invert();
          this.offset.copy(this.copy!.position).sub(input.position).applyQuaternion(inverse);
          this.relativeRotation.copy(inverse).multiply(this.copy!.quaternion);
          this.holding = true;
          this.tapHolding = justSelected && !handTracking;
          this.expiresAt = Infinity;
          this.highlight.visible = this.beam.visible = false;
        }
      }
    }
    if (this.holding && this.copy) {
      const near = left && this.bounds.setFromObject(this.copy).distanceToPoint(left.position) < 0.14;
      const frame = left?.pressed && (near || this.twoHand?.source === left.source)
        ? twoHandOrientation(left.position, input.position, left.rotation, input.rotation) : null;
      if (frame && left) {
        const midpoint = left.position.clone().add(input.position).multiplyScalar(0.5);
        if (!this.twoHand || this.twoHand.source !== left.source) {
          const inverse = frame.clone().invert();
          this.twoHand = { source: left.source,
            offset: this.copy.position.clone().sub(midpoint).applyQuaternion(inverse),
            rotation: inverse.multiply(this.copy.quaternion) };
        }
        this.copy.position.copy(this.twoHand.offset).applyQuaternion(frame).add(midpoint);
        this.copy.quaternion.copy(frame).multiply(this.twoHand.rotation);
      } else {
        if (this.twoHand) {
          // Releasing the support hand must not snap the model back to its old pose.
          const inverse = input.rotation.clone().invert();
          this.offset.copy(this.copy.position).sub(input.position).applyQuaternion(inverse);
          this.relativeRotation.copy(inverse).multiply(this.copy.quaternion);
          this.twoHand = null;
        }
        this.copy.position.copy(this.offset).applyQuaternion(input.rotation).add(input.position);
        this.copy.quaternion.copy(input.rotation).multiply(this.relativeRotation);
      }
    }
    if (this.copy) {
      const hands = [input, left].flatMap(hand => hand
        ? hand.colliders ?? [{ center: hand.position, radius: 0.045 }] : []);
      separateHandContact(this.copy.position, this.copy.quaternion, this.halfSize, hands);
      if (this.holding && !this.twoHand) {
        // Retain the surface contact offset instead of moving back inside next frame.
        this.offset.copy(this.copy.position).sub(input.position).applyQuaternion(input.rotation.clone().invert());
      }
    }
  }
}

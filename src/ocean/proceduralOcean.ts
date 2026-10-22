/**
 * Procedurally builds an underwater ocean scene using Three.js primitives.
 * Creates coral, seaweed, fish, bubbles, and a sandy floor with a clearing
 * in the centre for the puzzle assembly.
 */
import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  CylinderGeometry,
} from "three";

type Color = number;

const OCEAN_BLUE = 0x1a5276;
const SAND_COLOR = 0xc2b280;
const CORAL_COLORS = [0xff6b6b, 0xff9a44, 0xffd93d, 0x6bcf7f, 0x4dabc0, 0xc44dff];
const SEAWEED_COLORS = [0x2d6a4f, 0x40916c, 0x52b788, 0x1b4332];
const FISH_COLORS = [0xff9a44, 0x4dabc0, 0xff6b6b, 0xffd93d, 0x6bcf7f];

function rand(seed: { v: number }): number {
  seed.v = (seed.v * 9301 + 49297) % 233280;
  return seed.v / 233280;
}

export function buildProceduralOcean(footprint: number, clearing: number): Group {
  const group = new Group();
  const seed = { v: 12345 };

  // Sandy ocean floor
  const floor = new Mesh(
    new BoxGeometry(footprint + 4, 0.15, footprint + 4),
    new MeshStandardMaterial({ color: SAND_COLOR, roughness: 0.95 }),
  );
  floor.position.y = -0.08;
  group.add(floor);

  // Water volume (semi-transparent blue box surrounding the scene).
  // The player stands *inside* this box, so it must never write depth: its
  // inner faces are in front of everything and would depth-reject the rest of
  // the scene (including the puzzle and the celebration bubbles), which shows
  // as a black screen once the headset renders from inside the volume.
  const water = new Mesh(
    new BoxGeometry(footprint + 6, 8, footprint + 6),
    new MeshStandardMaterial({
      color: OCEAN_BLUE,
      transparent: true,
      opacity: 0.15,
      roughness: 0.1,
      depthWrite: false,
      side: 2, // DoubleSide
    }),
  );
  water.position.y = 3.5;
  group.add(water);

  // ── Coral formations around the clearing ──────────────────
  const coralCount = 18;
  for (let i = 0; i < coralCount; i++) {
    const angle = (i / coralCount) * Math.PI * 2;
    const radius = clearing + 1.5 + rand(seed) * 3;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const color = CORAL_COLORS[i % CORAL_COLORS.length];
    group.add(createCoral(x, 0, z, color, seed));
  }

  // ── Seaweed strands ───────────────────────────────────────
  const seaweedCount = 24;
  for (let i = 0; i < seaweedCount; i++) {
    const angle = (i / seaweedCount) * Math.PI * 2 + rand(seed) * 0.3;
    const radius = clearing + 0.8 + rand(seed) * 4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const color = SEAWEED_COLORS[i % SEAWEED_COLORS.length];
    group.add(createSeaweed(x, 0, z, color, seed));
  }

  // ── Fish swimming around ──────────────────────────────────
  const fishCount = 12;
  for (let i = 0; i < fishCount; i++) {
    const angle = (i / fishCount) * Math.PI * 2;
    const radius = clearing + 2 + rand(seed) * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = 1.0 + rand(seed) * 2.5;
    const color = FISH_COLORS[i % FISH_COLORS.length];
    group.add(createFish(x, y, z, color, seed));
  }

  // ── Bubbles rising ────────────────────────────────────────
  const bubbleCount = 20;
  for (let i = 0; i < bubbleCount; i++) {
    const angle = (i / bubbleCount) * Math.PI * 2 + rand(seed) * 0.5;
    const radius = clearing + 1.0 + rand(seed) * 3;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = 0.5 + rand(seed) * 4;
    const size = 0.04 + rand(seed) * 0.08;
    const bubble = new Mesh(
      new SphereGeometry(size, 8, 8),
      new MeshStandardMaterial({
        color: 0xaaccff,
        transparent: true,
        opacity: 0.3,
        roughness: 0.1,
        emissive: 0x88aacc,
        emissiveIntensity: 0.1,
      }),
    );
    bubble.position.set(x, y, z);
    group.add(bubble);
  }

  // ── Rocks ────────────────────────────────────────────────
  const rockCount = 8;
  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + rand(seed) * 0.4;
    const radius = clearing + 3 + rand(seed) * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const size = 0.3 + rand(seed) * 0.4;
    const rock = new Mesh(
      new SphereGeometry(size, 8, 6),
      new MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9 }),
    );
    rock.position.set(x, size * 0.5, z);
    rock.scale.y = 0.6;
    group.add(rock);
  }

  return group;
}

function createCoral(x: number, _y: number, z: number, color: Color, seed: { v: number }): Group {
  const coral = new Group();
  const mat = new MeshStandardMaterial({ color, roughness: 0.7 });

  const branches = 3 + Math.floor(rand(seed) * 3);
  for (let i = 0; i < branches; i++) {
    const height = 0.3 + rand(seed) * 0.5;
    const radius = 0.05 + rand(seed) * 0.08;
    const branch = new Mesh(
      new CylinderGeometry(radius * 0.7, radius, height, 8),
      mat,
    );
    branch.position.set(
      (rand(seed) - 0.5) * 0.3,
      height / 2,
      (rand(seed) - 0.5) * 0.3,
    );
    branch.rotation.set(
      (rand(seed) - 0.5) * 0.4,
      rand(seed) * Math.PI,
      (rand(seed) - 0.5) * 0.4,
    );
    coral.add(branch);

    // Small sphere on top
    const top = new Mesh(
      new SphereGeometry(radius * 1.2, 8, 8),
      mat,
    );
    top.position.set(branch.position.x, height, branch.position.z);
    coral.add(top);
  }

  coral.position.set(x, 0, z);
  return coral;
}

function createSeaweed(x: number, _y: number, z: number, color: Color, seed: { v: number }): Group {
  const seaweed = new Group();
  const mat = new MeshStandardMaterial({ color, roughness: 0.8 });

  const segments = 4 + Math.floor(rand(seed) * 3);
  const segHeight = 0.25;
  for (let i = 0; i < segments; i++) {
    const seg = new Mesh(
      new CylinderGeometry(0.04, 0.06, segHeight, 6),
      mat,
    );
    seg.position.set(
      (rand(seed) - 0.5) * 0.1,
      i * segHeight + segHeight / 2,
      (rand(seed) - 0.5) * 0.1,
    );
    seg.rotation.z = (rand(seed) - 0.5) * 0.2;
    seaweed.add(seg);
  }

  seaweed.position.set(x, 0, z);
  return seaweed;
}

function createFish(x: number, y: number, z: number, color: Color, seed: { v: number }): Group {
  const fish = new Group();
  const mat = new MeshStandardMaterial({ color, roughness: 0.5 });

  // Body
  const body = new Mesh(new SphereGeometry(0.12, 10, 8), mat);
  body.scale.set(1, 0.7, 1.5);
  fish.add(body);

  // Tail
  const tail = new Mesh(
    new ConeGeometry(0.08, 0.15, 6),
    mat,
  );
  tail.position.z = 0.2;
  tail.rotation.x = Math.PI / 2;
  fish.add(tail);

  // Eyes
  const eyeMat = new MeshStandardMaterial({ color: 0x1a1a1a });
  const leftEye = new Mesh(new SphereGeometry(0.02, 6, 6), eyeMat);
  leftEye.position.set(-0.05, 0.03, -0.1);
  fish.add(leftEye);
  const rightEye = new Mesh(new SphereGeometry(0.02, 6, 6), eyeMat);
  rightEye.position.set(0.05, 0.03, -0.1);
  fish.add(rightEye);

  fish.position.set(x, y, z);
  fish.rotation.y = rand(seed) * Math.PI * 2;
  return fish;
}

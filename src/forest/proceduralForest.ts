/**
 * Procedurally-built dense forest using Three.js primitives.
 * Replaces the FBX forest model with trees, bushes, rocks, and animals.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";

// ── Palette ───────────────────────────────────────────────────
const TRUNK_COLORS = [0x4a3520, 0x5a3a1a, 0x3a2a15, 0x6b4a2a];
const FOLIAGE_COLORS = [
  0x2d6a4f, 0x1b4332, 0x40916c, 0x52b788,
  0x2d6a4f, 0x1b7332, 0x386a4d, 0x4a7c59,
];
const BUSH_COLORS = [0x2d6a4f, 0x40916c, 0x1b4332, 0x52b788];
const ROCK_COLORS = [0x6b6b6b, 0x808080, 0x555555, 0x7a7a7a];
const FLOWER_COLORS = [0xff6b6b, 0xffd93d, 0xff8e3c, 0xc44dff, 0x6bcfff];

// Animal colors
const DEER_BODY = 0x8b6914;
const DEER_BELLY = 0xd4b896;
const RABBIT_COLOR = 0xc4a884;
const BIRD_COLORS = [0xe74c3c, 0x3498db, 0xf39c12, 0x2ecc71];
const BUTTERFLY_COLORS = [
  [0xff6b9d, 0xc44569],
  [0x7bed9d, 0x2ed573],
  [0x70a1ff, 0x3742fa],
  [0xffa502, 0xff6348],
];

// ── Seeded RNG for deterministic placement ─────────────────────
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

// ── Tree builder ──────────────────────────────────────────────
function createTree(rng: () => number, scale: number): Group {
  const tree = new Group();
  const trunkColor = pick(rng, TRUNK_COLORS);
  const trunkHeight = range(rng, 2.5, 4.5) * scale;
  const trunkRadius = range(rng, 0.18, 0.32) * scale;

  const trunk = new Mesh(
    new CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkHeight, 8),
    new MeshStandardMaterial({ color: trunkColor, roughness: 0.95 }),
  );
  trunk.position.y = trunkHeight / 2;
  tree.add(trunk);

  // Foliage layers (cone-based pine style or sphere-based deciduous)
  const isPine = rng() > 0.4;
  if (isPine) {
    const numLayers = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < numLayers; i++) {
      const coneRadius = range(rng, 1.0, 1.6) * scale * (1 - i * 0.15);
      const coneHeight = range(rng, 1.2, 1.8) * scale;
      const cone = new Mesh(
        new ConeGeometry(coneRadius, coneHeight, 8),
        new MeshStandardMaterial({
          color: pick(rng, FOLIAGE_COLORS),
          roughness: 0.9,
          flatShading: true,
        }),
      );
      cone.position.y = trunkHeight + i * coneHeight * 0.55;
      cone.rotation.y = rng() * Math.PI;
      tree.add(cone);
    }
  } else {
    const numBlobs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < numBlobs; i++) {
      const blobRadius = range(rng, 0.8, 1.4) * scale;
      const blob = new Mesh(
        new SphereGeometry(blobRadius, 8, 8),
        new MeshStandardMaterial({
          color: pick(rng, FOLIAGE_COLORS),
          roughness: 0.9,
          flatShading: true,
        }),
      );
      blob.position.set(
        range(rng, -0.5, 0.5) * scale,
        trunkHeight + range(rng, 0, 1.5) * scale,
        range(rng, -0.5, 0.5) * scale,
      );
      blob.scale.y = range(rng, 0.8, 1.2);
      tree.add(blob);
    }
  }

  return tree;
}

// ── Bush / undergrowth ─────────────────────────────────────────
function createBush(rng: () => number): Mesh {
  const radius = range(rng, 0.3, 0.6);
  const bush = new Mesh(
    new SphereGeometry(radius, 8, 6),
    new MeshStandardMaterial({
      color: pick(rng, BUSH_COLORS),
      roughness: 0.9,
      flatShading: true,
    }),
  );
  bush.scale.set(range(rng, 0.8, 1.3), range(rng, 0.6, 0.9), range(rng, 0.8, 1.3));
  bush.position.y = radius * 0.5;
  return bush;
}

// ── Rock ───────────────────────────────────────────────────────
function createRock(rng: () => number): Mesh {
  const radius = range(rng, 0.2, 0.5);
  const rock = new Mesh(
    new SphereGeometry(radius, 6, 5),
    new MeshStandardMaterial({
      color: pick(rng, ROCK_COLORS),
      roughness: 0.95,
      flatShading: true,
    }),
  );
  rock.scale.set(range(rng, 0.8, 1.4), range(rng, 0.5, 0.8), range(rng, 0.8, 1.4));
  rock.position.y = radius * 0.3;
  rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  return rock;
}

// ── Flower ────────────────────────────────────────────────────
function createFlower(rng: () => number): Group {
  const flower = new Group();
  const color = pick(rng, FLOWER_COLORS);

  // Stem
  const stem = new Mesh(
    new CylinderGeometry(0.01, 0.01, 0.15, 4),
    new MeshStandardMaterial({ color: 0x2d6a4f }),
  );
  stem.position.y = 0.075;
  flower.add(stem);

  // Petals
  const petals = new Mesh(
    new SphereGeometry(0.04, 6, 4),
    new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.15,
      roughness: 0.6,
    }),
  );
  petals.position.y = 0.15;
  petals.scale.set(1.5, 0.5, 1.5);
  flower.add(petals);

  return flower;
}

// ── Animals ───────────────────────────────────────────────────

function createDeer(rng: () => number, scale: number): Group {
  const deer = new Group();
  const s = scale * range(rng, 0.8, 1.2);

  // Body
  const body = new Mesh(
    new SphereGeometry(0.35 * s, 8, 8),
    new MeshStandardMaterial({ color: DEER_BODY, roughness: 0.85, flatShading: true }),
  );
  body.position.y = 0.55 * s;
  body.scale.set(1.4, 0.8, 0.7);
  deer.add(body);

  // Belly
  const belly = new Mesh(
    new SphereGeometry(0.25 * s, 6, 6),
    new MeshStandardMaterial({ color: DEER_BELLY, roughness: 0.85 }),
  );
  belly.position.set(0, 0.48 * s, 0.05 * s);
  belly.scale.set(1.2, 0.6, 0.6);
  deer.add(belly);

  // Head
  const head = new Mesh(
    new SphereGeometry(0.18 * s, 8, 8),
    new MeshStandardMaterial({ color: DEER_BODY, roughness: 0.85, flatShading: true }),
  );
  head.position.set(0.45 * s, 0.7 * s, 0);
  head.scale.set(1.2, 0.9, 0.8);
  deer.add(head);

  // Snout
  const snout = new Mesh(
    new SphereGeometry(0.1 * s, 6, 6),
    new MeshStandardMaterial({ color: DEER_BELLY, roughness: 0.85 }),
  );
  snout.position.set(0.6 * s, 0.62 * s, 0);
  snout.scale.set(1.0, 0.7, 0.6);
  deer.add(snout);

  // Ears
  for (const side of [-1, 1]) {
    const ear = new Mesh(
      new ConeGeometry(0.05 * s, 0.12 * s, 4),
      new MeshStandardMaterial({ color: DEER_BODY, roughness: 0.85 }),
    );
    ear.position.set(0.4 * s, 0.82 * s, side * 0.1 * s);
    ear.rotation.z = side * 0.3;
    deer.add(ear);
  }

  // Antlers
  for (const side of [-1, 1]) {
    const antler = new Mesh(
      new CylinderGeometry(0.015 * s, 0.025 * s, 0.25 * s, 4),
      new MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }),
    );
    antler.position.set(0.38 * s, 0.92 * s, side * 0.06 * s);
    antler.rotation.set(0.3, 0, side * 0.2);
    deer.add(antler);
  }

  // Legs
  const legGeo = new CylinderGeometry(0.04 * s, 0.05 * s, 0.5 * s, 5);
  const legMat = new MeshStandardMaterial({ color: DEER_BODY, roughness: 0.85 });
  const legPositions: [number, number][] = [
    [0.3, 0.18], [0.3, -0.18], [-0.25, 0.18], [-0.25, -0.18],
  ];
  for (const [lx, lz] of legPositions) {
    const leg = new Mesh(legGeo, legMat);
    leg.position.set(lx * s, 0.25 * s, lz * s);
    deer.add(leg);
  }

  // Tail
  const tail = new Mesh(
    new SphereGeometry(0.08 * s, 6, 6),
    new MeshStandardMaterial({ color: DEER_BELLY, roughness: 0.85 }),
  );
  tail.position.set(-0.48 * s, 0.6 * s, 0);
  tail.scale.set(0.8, 0.6, 0.6);
  deer.add(tail);

  return deer;
}

function createRabbit(rng: () => number): Group {
  const rabbit = new Group();
  const color = RABBIT_COLOR;

  // Body
  const body = new Mesh(
    new SphereGeometry(0.12, 8, 8),
    new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }),
  );
  body.position.y = 0.12;
  body.scale.set(1.3, 1.0, 0.9);
  rabbit.add(body);

  // Head
  const head = new Mesh(
    new SphereGeometry(0.08, 8, 8),
    new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }),
  );
  head.position.set(0.13, 0.18, 0);
  rabbit.add(head);

  // Ears
  for (const side of [-1, 1]) {
    const ear = new Mesh(
      new CylinderGeometry(0.015, 0.02, 0.1, 5),
      new MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    ear.position.set(0.14, 0.26, side * 0.03);
    ear.rotation.z = side * 0.15;
    rabbit.add(ear);
  }

  // Eyes
  for (const side of [-1, 1]) {
    const eye = new Mesh(
      new SphereGeometry(0.012, 4, 4),
      new MeshStandardMaterial({ color: 0x1a1a1a }),
    );
    eye.position.set(0.18, 0.2, side * 0.04);
    rabbit.add(eye);
  }

  // Tail (cotton ball)
  const tail = new Mesh(
    new SphereGeometry(0.04, 6, 6),
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
  );
  tail.position.set(-0.14, 0.13, 0);
  rabbit.add(tail);

  return rabbit;
}

function createBird(rng: () => number): Group {
  const bird = new Group();
  const color = pick(rng, BIRD_COLORS);

  // Body
  const body = new Mesh(
    new SphereGeometry(0.08, 8, 8),
    new MeshStandardMaterial({ color, roughness: 0.7, flatShading: true }),
  );
  body.scale.set(1.3, 1.0, 0.8);
  bird.add(body);

  // Head
  const head = new Mesh(
    new SphereGeometry(0.05, 6, 6),
    new MeshStandardMaterial({ color, roughness: 0.7, flatShading: true }),
  );
  head.position.set(0.08, 0.04, 0);
  bird.add(head);

  // Beak
  const beak = new Mesh(
    new ConeGeometry(0.015, 0.04, 4),
    new MeshStandardMaterial({ color: 0xffaa00, roughness: 0.6 }),
  );
  beak.position.set(0.13, 0.03, 0);
  beak.rotation.z = -Math.PI / 2;
  bird.add(beak);

  // Eyes
  for (const side of [-1, 1]) {
    const eye = new Mesh(
      new SphereGeometry(0.008, 4, 4),
      new MeshStandardMaterial({ color: 0x1a1a1a }),
    );
    eye.position.set(0.1, 0.05, side * 0.03);
    bird.add(eye);
  }

  // Wings
  for (const side of [-1, 1]) {
    const wing = new Mesh(
      new SphereGeometry(0.06, 6, 6),
      new MeshStandardMaterial({ color, roughness: 0.7, flatShading: true }),
    );
    wing.position.set(0, 0, side * 0.06);
    wing.scale.set(0.8, 0.4, 0.5);
    bird.add(wing);
  }

  // Tail
  const tail = new Mesh(
    new ConeGeometry(0.04, 0.1, 4),
    new MeshStandardMaterial({ color, roughness: 0.7, flatShading: true }),
  );
  tail.position.set(-0.1, 0, 0);
  tail.rotation.z = Math.PI / 2;
  bird.add(tail);

  return bird;
}

function createButterfly(rng: () => number): Group {
  const butterfly = new Group();
  const [colorA, colorB] = pick(rng, BUTTERFLY_COLORS);

  // Body
  const body = new Mesh(
    new CylinderGeometry(0.008, 0.012, 0.05, 5),
    new MeshStandardMaterial({ color: 0x2a2a2a }),
  );
  body.rotation.z = Math.PI / 2;
  butterfly.add(body);

  // Wings (two pairs)
  for (const side of [-1, 1]) {
    const wingUpper = new Mesh(
      new SphereGeometry(0.04, 8, 6),
      new MeshStandardMaterial({
        color: colorA,
        emissive: colorA,
        emissiveIntensity: 0.2,
        roughness: 0.5,
        side: DoubleSide,
      }),
    );
    wingUpper.position.set(0, 0.01, side * 0.04);
    wingUpper.scale.set(0.7, 0.9, 0.3);
    butterfly.add(wingUpper);

    const wingLower = new Mesh(
      new SphereGeometry(0.025, 6, 5),
      new MeshStandardMaterial({
        color: colorB,
        emissive: colorB,
        emissiveIntensity: 0.2,
        roughness: 0.5,
        side: DoubleSide,
      }),
    );
    wingLower.position.set(0, -0.03, side * 0.03);
    wingLower.scale.set(0.6, 0.8, 0.3);
    butterfly.add(wingLower);
  }

  return butterfly;
}

function createMushroom(rng: () => number): Group {
  const mushroom = new Group();

  // Stem
  const stem = new Mesh(
    new CylinderGeometry(0.03, 0.04, 0.12, 6),
    new MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.8 }),
  );
  stem.position.y = 0.06;
  mushroom.add(stem);

  // Cap
  const capColor = rng() > 0.5 ? 0xe74c3c : 0xc0392b;
  const cap = new Mesh(
    new SphereGeometry(0.07, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshStandardMaterial({ color: capColor, roughness: 0.7, flatShading: true }),
  );
  cap.position.y = 0.12;
  cap.scale.y = 0.7;
  mushroom.add(cap);

  // White spots
  for (let i = 0; i < 4; i++) {
    const spot = new Mesh(
      new SphereGeometry(0.012, 5, 4),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    );
    const angle = (i / 4) * Math.PI * 2;
    spot.position.set(
      Math.cos(angle) * 0.04,
      0.13,
      Math.sin(angle) * 0.04,
    );
    mushroom.add(spot);
  }

  return mushroom;
}

function createFallenLog(rng: () => number): Group {
  const log = new Group();
  const length = range(rng, 0.6, 1.2);
  const radius = range(rng, 0.08, 0.14);

  const logMesh = new Mesh(
    new CylinderGeometry(radius * 0.8, radius, length, 8),
    new MeshStandardMaterial({
      color: pick(rng, TRUNK_COLORS),
      roughness: 0.95,
      flatShading: true,
    }),
  );
  logMesh.rotation.z = Math.PI / 2;
  logMesh.position.y = radius;
  log.add(logMesh);

  // Moss on top
  const moss = new Mesh(
    new BoxGeometry(length * 0.8, 0.02, radius * 1.4),
    new MeshStandardMaterial({ color: 0x52b788, roughness: 0.9 }),
  );
  moss.position.y = radius * 2;
  log.add(moss);

  return log;
}

function createGrassTuft(rng: () => number): Mesh {
  const grass = new Mesh(
    new ConeGeometry(range(rng, 0.05, 0.1), range(rng, 0.15, 0.3), 4),
    new MeshStandardMaterial({
      color: pick(rng, [0x2d6a4f, 0x40916c, 0x52b788]),
      roughness: 0.9,
      flatShading: true,
    }),
  );
  grass.position.y = 0.12;
  return grass;
}

// ── Puzzle assembly keep-out ──────────────────────────────────
// The forest puzzle's round board hangs at (0, 4.5) — outside the circular
// clearing the environment manager asks for, which is centred on the player's
// spawn and only reaches 3.5 m. A seeded tree that lands on that disc covers
// the code blocks placed on the board, so the tree ring below drops them.
const PUZZLE_BOARD_X = 0;
const PUZZLE_BOARD_Z = 4.5;
/** The board's own 2.09 m disc, plus a margin so foliage clears the rim. */
const PUZZLE_KEEPOUT_RADIUS = 2.5;

// ── Main forest builder ───────────────────────────────────────
export function buildProceduralForest(
  footprint: number,
  clearingRadius: number,
): Group {
  const forest = new Group();
  forest.name = "ProceduralForest";
  forest.pointerEvents = "none";
  forest.intersectChildren = false;

  const rng = mulberry32(42);
  const half = footprint / 2;

  // Disable raycasting on all forest meshes so they don't block puzzle interactions
  const disableRaycast = (obj: Mesh) => {
    obj.raycast = () => {};
    obj.frustumCulled = false;
  };

  // ── Trees: dense ring around the clearing ──────────────────
  const TREE_COUNT = 45;
  for (let i = 0; i < TREE_COUNT; i++) {
    // Place trees in a ring, avoiding the clearing
    let x: number, z: number;
    let attempts = 0;
    do {
      x = range(rng, -half, half);
      z = range(rng, -half, half);
      attempts++;
    } while (Math.sqrt(x * x + z * z) < clearingRadius && attempts < 10);

    const tree = createTree(rng, range(rng, 0.7, 1.3));
    tree.position.set(x, 0, z);
    tree.rotation.y = rng() * Math.PI * 2;
    tree.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    // A tree on the puzzle board hides the code rows placed on it. It is still
    // built from the shared seeded sequence — skipping its draws would shift
    // every later tree, bush and animal — and just not added to the forest.
    if (
      Math.hypot(x - PUZZLE_BOARD_X, z - PUZZLE_BOARD_Z) <
      PUZZLE_KEEPOUT_RADIUS
    ) {
      continue;
    }
    forest.add(tree);
  }

  // ── Bushes scattered around ───────────────────────────────
  const BUSH_COUNT = 30;
  for (let i = 0; i < BUSH_COUNT; i++) {
    let x: number, z: number;
    let attempts = 0;
    do {
      x = range(rng, -half, half);
      z = range(rng, -half, half);
      attempts++;
    } while (Math.sqrt(x * x + z * z) < clearingRadius * 0.8 && attempts < 10);

    const bush = createBush(rng);
    bush.position.set(x, 0, z);
    disableRaycast(bush);
    forest.add(bush);
  }

  // ── Rocks ──────────────────────────────────────────────────
  const ROCK_COUNT = 15;
  for (let i = 0; i < ROCK_COUNT; i++) {
    let x: number, z: number;
    let attempts = 0;
    do {
      x = range(rng, -half, half);
      z = range(rng, -half, half);
      attempts++;
    } while (Math.sqrt(x * x + z * z) < clearingRadius * 0.7 && attempts < 10);

    const rock = createRock(rng);
    rock.position.set(x, 0, z);
    disableRaycast(rock);
    forest.add(rock);
  }

  // ── Grass tufts ───────────────────────────────────────────
  const GRASS_COUNT = 50;
  for (let i = 0; i < GRASS_COUNT; i++) {
    const x = range(rng, -half, half);
    const z = range(rng, -half, half);
    const grass = createGrassTuft(rng);
    grass.position.set(x, 0, z);
    grass.rotation.y = rng() * Math.PI * 2;
    disableRaycast(grass);
    forest.add(grass);
  }

  // ── Flowers ───────────────────────────────────────────────
  const FLOWER_COUNT = 25;
  for (let i = 0; i < FLOWER_COUNT; i++) {
    const x = range(rng, -half, half);
    const z = range(rng, -half, half);
    if (Math.sqrt(x * x + z * z) < clearingRadius * 0.6) continue;
    const flower = createFlower(rng);
    flower.position.set(x, 0, z);
    flower.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    forest.add(flower);
  }

  // ── Mushrooms ─────────────────────────────────────────────
  const MUSHROOM_COUNT = 12;
  for (let i = 0; i < MUSHROOM_COUNT; i++) {
    let x: number, z: number;
    let attempts = 0;
    do {
      x = range(rng, -half, half);
      z = range(rng, -half, half);
      attempts++;
    } while (Math.sqrt(x * x + z * z) < clearingRadius * 0.7 && attempts < 10);

    const mushroom = createMushroom(rng);
    mushroom.position.set(x, 0, z);
    mushroom.rotation.y = rng() * Math.PI * 2;
    mushroom.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    forest.add(mushroom);
  }

  // ── Fallen logs ────────────────────────────────────────────
  const LOG_COUNT = 5;
  for (let i = 0; i < LOG_COUNT; i++) {
    let x: number, z: number;
    let attempts = 0;
    do {
      x = range(rng, -half, half);
      z = range(rng, -half, half);
      attempts++;
    } while (Math.sqrt(x * x + z * z) < clearingRadius * 0.8 && attempts < 10);

    const log = createFallenLog(rng);
    log.position.set(x, 0, z);
    log.rotation.y = rng() * Math.PI * 2;
    log.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    forest.add(log);
  }

  // ── Animals ───────────────────────────────────────────────

  // Deer (2-3, standing in the distance)
  const DEER_COUNT = 3;
  for (let i = 0; i < DEER_COUNT; i++) {
    let x: number, z: number;
    let attempts = 0;
    do {
      x = range(rng, -half * 0.85, half * 0.85);
      z = range(rng, half * 0.3, half * 0.85);
      attempts++;
    } while (Math.sqrt(x * x + z * z) < clearingRadius + 1 && attempts < 10);

    const deer = createDeer(rng, 1.0);
    deer.position.set(x, 0, z);
    deer.rotation.y = range(rng, -Math.PI / 3, Math.PI / 3);
    deer.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    forest.add(deer);
  }

  // Rabbits (4-5, near bushes)
  const RABBIT_COUNT = 5;
  for (let i = 0; i < RABBIT_COUNT; i++) {
    let x: number, z: number;
    let attempts = 0;
    do {
      x = range(rng, -half * 0.8, half * 0.8);
      z = range(rng, -half * 0.8, half * 0.8);
      attempts++;
    } while (Math.sqrt(x * x + z * z) < clearingRadius + 0.5 && attempts < 10);

    const rabbit = createRabbit(rng);
    rabbit.position.set(x, 0, z);
    rabbit.rotation.y = rng() * Math.PI * 2;
    rabbit.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    forest.add(rabbit);
  }

  // Birds (4-5, perched on branches or stumps)
  const BIRD_COUNT = 5;
  for (let i = 0; i < BIRD_COUNT; i++) {
    const x = range(rng, -half * 0.7, half * 0.7);
    const z = range(rng, -half * 0.7, half * 0.7);
    const y = range(rng, 1.5, 3.5);
    const bird = createBird(rng);
    bird.position.set(x, y, z);
    bird.rotation.y = rng() * Math.PI * 2;
    bird.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    forest.add(bird);
  }

  // Butterflies (6-8, floating at various heights)
  const BUTTERFLY_COUNT = 8;
  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    const x = range(rng, -half * 0.6, half * 0.6);
    const z = range(rng, -half * 0.6, half * 0.6);
    const y = range(rng, 0.5, 2.0);
    const butterfly = createButterfly(rng);
    butterfly.position.set(x, y, z);
    butterfly.rotation.y = rng() * Math.PI * 2;
    butterfly.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) disableRaycast(m);
    });
    forest.add(butterfly);
  }

  forest.updateMatrixWorld(true);
  return forest;
}

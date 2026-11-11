/**
 * Lesson 2 - Challenge 2 reusable drop boxes.
 *
 * These open-top boxes keep the existing Challenge 2 drop-box mesh. Labels
 * change with the current activity. Drop detection uses each box's bounds,
 * while decorative box meshes are excluded from controller raycasts so they
 * cannot block grabbing or interfere with the student's controller ray.
 */
import * as THREE from "three";

import type { Challenge2Category } from "./catalog";

export type Challenge2DropBox = {
  category: Challenge2Category;
  group: THREE.Group;
  dropBounds: THREE.Box3;
  setHighlighted: (highlighted: boolean) => void;
  dispose: () => void;
};

type DropBoxTheme = {
  label: string;
  color: number;
};

const DROP_BOX_THEMES: Record<Challenge2Category, DropBoxTheme> = {
  input: { label: "INPUT", color: 0x16b8d4 },
  output: { label: "OUTPUT", color: 0x2563d9 },
  both: { label: "BOTH", color: 0x8b43c6 },
  storage: { label: "STORAGE", color: 0xd99a20 },
  initialization: { label: "Missing Initialization", color: 0x16b8d4 },
  comparison: { label: "Missing Comparison", color: 0x2563d9 },
  update: { label: "Missing Update", color: 0x8b43c6 },
  print1: { label: "1st Print", color: 0x16b8d4 },
  print2: { label: "2nd Print", color: 0x2563d9 },
  print3: { label: "3rd Print", color: 0x8b43c6 },
  finalN: { label: "Final Value of n", color: 0xd99a20 }
};

export const CHALLENGE_2_PART1_BOX_ORDER: readonly Challenge2Category[] = [
  "initialization",
  "comparison",
  "update"
];

export const CHALLENGE_2_PART2_BOX_ORDER: readonly Challenge2Category[] = [
  "print1",
  "print2",
  "print3",
  "finalN"
];

export const CHALLENGE_2_DROP_BOX_ORDER = CHALLENGE_2_PART1_BOX_ORDER;

// Local positions inside the Challenge 2 root. The root can later be placed
// in the existing 360-degree Quick Challenge environment as one world-space
// group without changing the panorama or the student's assigned position.
export const CHALLENGE_2_DROP_BOX_POSITIONS: Readonly<
  Record<Challenge2Category, readonly [number, number, number]>
> = {
  input: [-0.78, 0, 0],
  output: [-0.26, 0, 0],
  both: [0.26, 0, 0],
  storage: [0.78, 0, 0],
  initialization: [-0.62, -0.22, 0],
  comparison: [0, -0.22, 0],
  update: [0.62, -0.22, 0],
  print1: [-0.78, -0.34, 0],
  print2: [-0.26, -0.34, 0],
  print3: [0.26, -0.34, 0],
  finalN: [0.78, -0.34, 0]
};

const BOX_WIDTH = 0.42;
const BOX_HEIGHT = 0.28;
const BOX_DEPTH = 0.34;
const WALL_THICKNESS = 0.025;
const HOVER_EMISSIVE_INTENSITY = 0.9;

function disableRayIntersection(object: THREE.Object3D): void {
  // Drop detection will use dropBounds rather than ray hits. Keeping every
  // decorative surface out of the raycast prevents a box from stealing the
  // controller ray from the device being grabbed.
  object.traverse(child => {
    (child as any).pointerEvents = "none";
    if (child instanceof THREE.Mesh) {
      child.raycast = () => undefined;
    }
  });
}

function createLabelTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Challenge 2 could not create a drop-box label canvas.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(7, 17, 34, 0.78)";
  context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 24);
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.8)";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const words = label.trim().split(/\s+/);
  if (words.length >= 2) {
    const mid = Math.ceil(words.length / 2);
    context.font = "700 44px Arial, sans-serif";
    context.fillText(words.slice(0, mid).join(" "), canvas.width / 2, canvas.height / 2 - 28);
    context.fillText(words.slice(mid).join(" "), canvas.width / 2, canvas.height / 2 + 28);
  } else {
    context.font = "700 64px Arial, sans-serif";
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createChallenge2DropBox(
  category: Challenge2Category
): Challenge2DropBox {
  const theme = DROP_BOX_THEMES[category];
  const group = new THREE.Group();
  group.name = `Challenge2DropBox_${category}`;
  group.userData.challenge2Category = category;

  const boxMaterial = new THREE.MeshStandardMaterial({
    color: theme.color,
    roughness: 0.62,
    metalness: 0.08,
    transparent: true,
    opacity: 0.94
  });
  const rimMaterial = boxMaterial.clone();
  rimMaterial.color.offsetHSL(0, 0, 0.12);

  const addPart = (
    name: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material = boxMaterial
  ): void => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      material
    );
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // Open top: floor plus four walls. The front wall is shorter so the label
  // and a dropped device remain visible from the student's seated view.
  addPart("Floor", [BOX_WIDTH, WALL_THICKNESS, BOX_DEPTH], [0, 0, 0]);
  addPart(
    "BackWall",
    [BOX_WIDTH, BOX_HEIGHT, WALL_THICKNESS],
    [0, BOX_HEIGHT / 2, -BOX_DEPTH / 2]
  );
  addPart(
    "FrontWall",
    [BOX_WIDTH, BOX_HEIGHT * 0.72, WALL_THICKNESS],
    [0, BOX_HEIGHT * 0.36, BOX_DEPTH / 2]
  );
  addPart(
    "LeftWall",
    [WALL_THICKNESS, BOX_HEIGHT, BOX_DEPTH],
    [-BOX_WIDTH / 2, BOX_HEIGHT / 2, 0]
  );
  addPart(
    "RightWall",
    [WALL_THICKNESS, BOX_HEIGHT, BOX_DEPTH],
    [BOX_WIDTH / 2, BOX_HEIGHT / 2, 0]
  );

  const rimY = BOX_HEIGHT + WALL_THICKNESS / 2;
  addPart("BackRim", [BOX_WIDTH + 0.025, WALL_THICKNESS, 0.04], [0, rimY, -BOX_DEPTH / 2], rimMaterial);
  addPart("LeftRim", [0.04, WALL_THICKNESS, BOX_DEPTH], [-BOX_WIDTH / 2, rimY, 0], rimMaterial);
  addPart("RightRim", [0.04, WALL_THICKNESS, BOX_DEPTH], [BOX_WIDTH / 2, rimY, 0], rimMaterial);

  const labelTexture = createLabelTexture(theme.label);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false
  });
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(BOX_WIDTH * 0.9, 0.13),
    labelMaterial
  );
  label.name = "Label";
  label.position.set(0, BOX_HEIGHT * 0.38, BOX_DEPTH / 2 + 0.014);
  group.add(label);

  const position = CHALLENGE_2_DROP_BOX_POSITIONS[category];
  group.position.set(position[0], position[1], position[2]);
  disableRayIntersection(group);

  const dropBounds = new THREE.Box3(
    new THREE.Vector3(
      -BOX_WIDTH / 2 + WALL_THICKNESS,
      WALL_THICKNESS,
      -BOX_DEPTH / 2 + WALL_THICKNESS
    ),
    new THREE.Vector3(
      BOX_WIDTH / 2 - WALL_THICKNESS,
      BOX_HEIGHT + 0.16,
      BOX_DEPTH / 2 - WALL_THICKNESS
    )
  );

  return {
    category,
    group,
    dropBounds,
    setHighlighted: highlighted => {
      boxMaterial.emissive.setHex(highlighted ? theme.color : 0x000000);
      boxMaterial.emissiveIntensity = highlighted
        ? HOVER_EMISSIVE_INTENSITY
        : 0;
      rimMaterial.emissive.setHex(highlighted ? 0xffffff : 0x000000);
      rimMaterial.emissiveIntensity = highlighted ? 0.45 : 0;
    },
    dispose: () => {
      group.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
      });
      boxMaterial.dispose();
      rimMaterial.dispose();
      labelMaterial.dispose();
      labelTexture.dispose();
      group.removeFromParent();
    }
  };
}

export function createChallenge2DropBoxes(
  order: readonly Challenge2Category[] = CHALLENGE_2_DROP_BOX_ORDER
): Challenge2DropBox[] {
  return order.map(createChallenge2DropBox);
}

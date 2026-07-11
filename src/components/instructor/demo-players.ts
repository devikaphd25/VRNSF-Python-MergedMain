import {
  Object3D,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  Vector3
} from "@iwsdk/core";

interface DemoPlayer {
  name: string;
  seatName: string;
  mode: "Classroom Mode" | "Presentation Mode";
  color: string;
}

const demoPlayers: DemoPlayer[] = [
  {
    name: "Demo 1",
    seatName: "Seat_R1_01",
    mode: "Classroom Mode",
    color: "#1e90ff"
  },
  {
    name: "Demo 2",
    seatName: "Seat_R1_02",
    mode: "Presentation Mode",
    color: "#22c55e"
  },
  {
    name: "Demo 3",
    seatName: "Seat_R1_03",
    mode: "Classroom Mode",
    color: "#1e90ff"
  }
];

function createMarkerTexture(name: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;

  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, 512, 512);

  // Circle
  ctx.beginPath();
  ctx.arc(256, 170, 100, 0, Math.PI * 2);
  ctx.fillStyle = "#111827";
  ctx.fill();

  ctx.lineWidth = 14;
  ctx.strokeStyle = color;
  ctx.stroke();

  // Simple avatar face
  ctx.beginPath();
  ctx.arc(256, 155, 45, 0, Math.PI * 2);
  ctx.fillStyle = "#f2c6a0";
  ctx.fill();

  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(240, 150, 6, 0, Math.PI * 2);
  ctx.arc(272, 150, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#222";
  ctx.fillRect(215, 90, 82, 35);

  // Name box
  ctx.fillStyle = "#111827";
  ctx.fillRect(120, 300, 272, 70);

  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.strokeRect(120, 300, 272, 70);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px Arial";
  ctx.textAlign = "center";
  ctx.fillText(name, 256, 348);

  // Pointer triangle
  ctx.beginPath();
  ctx.moveTo(256, 430);
  ctx.lineTo(215, 370);
  ctx.lineTo(297, 370);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  return new CanvasTexture(canvas);
}

export function createDemoPlayers(scene: Object3D, classroom: Object3D) {
  demoPlayers.forEach((demo) => {
    const seat = classroom.getObjectByName(demo.seatName);

    if (!seat) {
      console.warn("Seat not found:", demo.seatName);
      return;
    }

    const seatPos = new Vector3();
    seat.getWorldPosition(seatPos);

    const texture = createMarkerTexture(demo.name, demo.color);

    const material = new SpriteMaterial({
      map: texture,
      transparent: true
    });

    const marker = new Sprite(material);

    marker.position.set(
      seatPos.x,
      seatPos.y + 1.4,
      seatPos.z
    );

    marker.scale.set(0.75, 0.75, 0.75);

    scene.add(marker);
  });
}
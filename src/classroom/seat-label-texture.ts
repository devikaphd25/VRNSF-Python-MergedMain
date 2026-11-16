/** Draws the reusable name label shown below each seated avatar. */
import { CanvasTexture } from "three";

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
  ctx.fill();
}

export function createSeatLabelTexture(name: string, mode: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#111827";
  roundedRect(ctx, 2, 2, 508, 92, 18);
  ctx.strokeStyle = mode === "Presentation Mode" ? "#22c55e" : "#38bdf8";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "white";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const displayName = name.length > 22 ? name.substring(0, 21) + "..." : name;
  ctx.fillText(displayName, 256, 48, 470);
  return new CanvasTexture(canvas);
}

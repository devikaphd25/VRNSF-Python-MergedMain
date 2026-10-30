import { C1, getImage } from "../challenges/true-false/question-art";

export function paintCountdownRing(options: {
  canvas: HTMLCanvasElement;
  remainingSeconds: number;
  durationSeconds: number;
  clockText: string;
  caption?: string;
}): string {
  const size = options.canvas.width;
  const ctx = options.canvas.getContext("2d");
  if (!ctx) return options.canvas.toDataURL("image/png");

  const duration = Math.max(0.001, options.durationSeconds);
  const remaining = Math.max(0, Math.min(duration, options.remainingSeconds));
  const progress = Math.min(1, remaining / duration);
  const urgent = remaining <= 60;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.4;
  const line = Math.max(10, size * 0.062);

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = urgent ? "#3f121c" : "#10172e";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#2a3558";
  ctx.lineWidth = line;
  ctx.stroke();

  if (progress > 0.0005) {
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + progress * Math.PI * 2,
      false
    );
    ctx.strokeStyle = urgent ? "#fb7185" : "#b7a6f5";
    ctx.lineWidth = line;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.fillStyle = "#f4efe4";
  ctx.font = `600 ${Math.round(size * 0.2)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(options.clockText, cx, options.caption ? cy - size * 0.04 : cy);

  if (options.caption) {
    ctx.fillStyle = "#cbb79a";
    ctx.font = `500 ${Math.round(size * 0.062)}px Inter, sans-serif`;
    ctx.fillText(options.caption, cx, cy + size * 0.12);
  }

  return options.canvas.toDataURL("image/png");
}

export function paintChallenge1Countdown(options: {
  canvas: HTMLCanvasElement;
  remainingSeconds: number;
  durationSeconds: number;
  clockText: string;
  caption?: string;
  clockSrc?: string;
  onReady?: () => void;
}): string {
  const size = options.canvas.width;
  const ctx = options.canvas.getContext("2d");
  if (!ctx) return options.canvas.toDataURL("image/png");

  const duration = Math.max(0.001, options.durationSeconds);
  const remaining = Math.max(0, Math.min(duration, options.remainingSeconds));
  const progress = Math.min(1, remaining / duration);
  const urgent = remaining <= 60;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  const line = Math.max(8, size * 0.055);

  ctx.clearRect(0, 0, size, size);
  const plate = getImage(options.clockSrc ?? C1.clock, options.onReady);
  if (plate) ctx.drawImage(plate, 0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = urgent ? "rgba(255,120,120,0.35)" : "rgba(180, 240, 255, 0.28)";
  ctx.lineWidth = line;
  ctx.stroke();

  if (progress > 0.0005) {
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + progress * Math.PI * 2,
      false
    );
    ctx.strokeStyle = urgent ? "#ff8a8a" : "#e7fbff";
    ctx.lineWidth = line;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.fillStyle = "#f4fbff";
  ctx.font = `700 ${Math.round(size * 0.18)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(options.clockText, cx, options.caption ? cy - size * 0.04 : cy);

  if (options.caption) {
    ctx.fillStyle = urgent ? "#ffd0d0" : "#c5eef8";
    ctx.font = `600 ${Math.round(size * 0.055)}px Inter, sans-serif`;
    ctx.fillText(options.caption, cx, cy + size * 0.12);
  }

  return options.canvas.toDataURL("image/png");
}

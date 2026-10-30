import { C1, getImage } from "../challenges/true-false/question-art";

type StepTone = "idle" | "current" | "done" | "miss";

const STEP_SRC: Record<StepTone, string> = {
  idle: C1.idle,
  current: C1.current,
  done: C1.done,
  miss: C1.miss,
};

// Opaque left-right tip span as a fraction of each PNG. Current art has
// extra padding, so it must be drawn larger to match the other diamonds.
const TIP_RATIO: Record<StepTone, number> = {
  idle: 910 / 962,
  current: 914 / 1280,
  done: 912 / 962,
  miss: 910 / 962,
};

const STEP_COUNT = 5;

export function layoutStepRail(width: number, height: number): {
  visual: number;
  barGap: number;
  pitch: number;
  halfTip: number;
  centers: number[];
} {
  const visual = Math.round(height * 0.70);
  const barGap = visual * 0.38;
  const pitch = visual + barGap;
  const origin = (width - (STEP_COUNT - 1) * pitch) / 2;
  return {
    visual,
    barGap,
    pitch,
    halfTip: visual / 2,
    centers: Array.from(
      { length: STEP_COUNT },
      (_, index) => origin + index * pitch
    ),
  };
}

export function hitStepIndex(u: number, v = 0.5): number | null {
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const width = 780;
  const height = 130;
  const { centers, halfTip } = layoutStepRail(width, height);
  const x = u * width;
  for (let index = 0; index < STEP_COUNT; index += 1) {
    if (Math.abs(x - centers[index]) <= halfTip) return index;
  }
  return null;
}

export function paintStepsRail(options: {
  canvas: HTMLCanvasElement;
  states: StepTone[];
  onReady?: () => void;
}): string {
  const ctx = options.canvas.getContext("2d");
  const width = options.canvas.width;
  const height = options.canvas.height;
  if (!ctx) return options.canvas.toDataURL("image/png");

  ctx.clearRect(0, 0, width, height);
  const { visual, barGap, halfTip, centers } = layoutStepRail(width, height);
  const cy = height / 2;
  const bridge = getImage(C1.bridge, options.onReady);
  if (bridge) {
    const overlap = visual * 0.035;
    const barHeight = height * 0.09;
    for (let index = 0; index < centers.length - 1; index += 1) {
      const x = centers[index] + halfTip - overlap;
      const w = barGap + overlap * 2;
      if (w <= 1) continue;
      ctx.drawImage(bridge, x, cy - barHeight / 2, w, barHeight);
    }
  }

  options.states.forEach((state, index) => {
    const plate = getImage(STEP_SRC[state], options.onReady);
    const size = Math.round(visual / TIP_RATIO[state]);
    const x = centers[index] - size / 2;
    const y = cy - size / 2;
    if (plate) ctx.drawImage(plate, x, y, size, size);
    ctx.fillStyle = "#f4fbff";
    ctx.font = `700 ${Math.round(visual * 0.34)}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), centers[index], cy + 1);
  });

  return options.canvas.toDataURL("image/png");
}

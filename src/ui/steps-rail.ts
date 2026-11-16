import { applyHoverWash, C1, getImage } from "../challenges/true-false/question-art";

const hoverDiamondCanvas = typeof document === "undefined"
  ? undefined
  : document.createElement("canvas");

type StepTone = "idle" | "current" | "done" | "miss";

// Opaque left-right tip span as a fraction of each PNG. Current art has
// extra padding, so it must be drawn larger to match the other diamonds.
const TIP_RATIO: Record<StepTone, number> = {
  idle: 910 / 962,
  current: 914 / 1280,
  done: 912 / 962,
  miss: 910 / 962,
};

const STEP_COUNT = 5;

const GAP_RATIO = 0.38;
const DRAW_SIZE_RATIO = 1 / Math.min(...Object.values(TIP_RATIO));

export function layoutStepRail(width: number, height: number, count = STEP_COUNT): {
  visual: number;
  barGap: number;
  pitch: number;
  halfTip: number;
  centers: number[];
} {
  const n = Math.max(1, count);
  const pad = Math.max(6, Math.round(height * 0.05));
  const maxFromHeight = height * 0.70;
  const span = Math.max(1, width - pad * 2);
  const maxFromWidth = n <= 1
    ? span / DRAW_SIZE_RATIO
    : span / ((n - 1) * (1 + GAP_RATIO) + DRAW_SIZE_RATIO);
  const visual = Math.round(Math.max(18, Math.min(maxFromHeight, maxFromWidth)));
  const barGap = visual * GAP_RATIO;
  const pitch = visual + barGap;
  const origin = (width - (n - 1) * pitch) / 2;
  return {
    visual,
    barGap,
    pitch,
    halfTip: visual / 2,
    centers: Array.from(
      { length: n },
      (_, index) => origin + index * pitch
    ),
  };
}

export function hitStepIndex(u: number, v = 0.5, count = STEP_COUNT): number | null {
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const width = 780;
  const height = 130;
  const { centers, halfTip } = layoutStepRail(width, height, count);
  const x = u * width;
  for (let index = 0; index < count; index += 1) {
    if (Math.abs(x - centers[index]) <= halfTip) return index;
  }
  return null;
}

export function paintStepsRail(options: {
  canvas: HTMLCanvasElement;
  states: StepTone[];
  art?: typeof C1;
  hoveredIndex?: number;
  onReady?: () => void;
}): string {
  const ctx = options.canvas.getContext("2d");
  const width = options.canvas.width;
  const height = options.canvas.height;
  if (!ctx) return options.canvas.toDataURL("image/png");
  const art = options.art ?? C1;
  const stepSrc: Record<StepTone, string> = {
    idle: art.idle,
    current: art.current,
    done: art.done,
    miss: art.miss,
  };

  ctx.clearRect(0, 0, width, height);
  const { visual, barGap, halfTip, centers } = layoutStepRail(width, height, options.states.length);
  const cy = height / 2;
  const bridge = getImage(art.bridge, options.onReady);
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
    const plate = getImage(stepSrc[state], options.onReady);
    const size = Math.round(visual / TIP_RATIO[state]);
    const x = centers[index] - size / 2;
    const y = cy - size / 2;
    if (plate) {
      if (index === options.hoveredIndex && hoverDiamondCanvas) {
        hoverDiamondCanvas.width = size;
        hoverDiamondCanvas.height = size;
        const hoverCtx = hoverDiamondCanvas.getContext("2d");
        if (hoverCtx) {
          hoverCtx.clearRect(0, 0, size, size);
          hoverCtx.drawImage(plate, 0, 0, size, size);
          applyHoverWash(hoverCtx, size, size);
          ctx.drawImage(hoverDiamondCanvas, x, y, size, size);
        } else {
          ctx.drawImage(plate, x, y, size, size);
        }
      } else {
        ctx.drawImage(plate, x, y, size, size);
      }
    }
    ctx.fillStyle = "#f4fbff";
    ctx.font = `700 ${Math.round(visual * 0.34)}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), centers[index], cy + 1);
  });

  return options.canvas.toDataURL("image/png");
}

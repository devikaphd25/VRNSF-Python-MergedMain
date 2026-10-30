export const SCORE_SERIF = "Georgia, 'Times New Roman', Times, serif";

export function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [text];
}

export function paintSerifBlock(options: {
  canvas: HTMLCanvasElement;
  text: string;
  color: string;
  fontSize: number;
  italic?: boolean;
}): string {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) return options.canvas.toDataURL("image/png");
  const width = options.canvas.width;
  const height = options.canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = options.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Reserve padding and shrink wrapped text until every line fits the image.
  // Fixed-size question images otherwise clip longer prompts at the top/bottom.
  const maxWidth = Math.max(1, width - 48);
  const maxHeight = Math.max(1, height - 32);
  let fontSize = options.fontSize;
  let lines: string[];
  let lineHeight: number;
  do {
    ctx.font = `${options.italic ? "italic " : ""}500 ${fontSize}px ${SCORE_SERIF}`;
    lines = wrapCanvasLines(ctx, options.text, maxWidth);
    lineHeight = fontSize * 1.28;
    if (lines.length * lineHeight <= maxHeight &&
        lines.every(line => ctx.measureText(line).width <= maxWidth)) break;
    fontSize -= 1;
  } while (fontSize >= 1);
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, startY + index * lineHeight);
  });
  return options.canvas.toDataURL("image/png");
}

export function paintSerifDigit(canvas: HTMLCanvasElement, digit: string): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f4efe4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${Math.round(canvas.height * 0.7)}px ${SCORE_SERIF}`;
  ctx.fillText(digit, canvas.width / 2, canvas.height / 2 + 3);
  return canvas.toDataURL("image/png");
}

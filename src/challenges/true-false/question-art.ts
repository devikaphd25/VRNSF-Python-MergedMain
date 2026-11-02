const C1 = {
  board: "/textures/challenge1/UI_Background.png",
  title: "/textures/challenge1/Title_for_assignment.png",
  clock: "/textures/challenge1/Clock_Background.png",
  idle: "/textures/challenge1/Unanswered_Question.png",
  current: "/textures/challenge1/Current_Question.png",
  done: "/textures/challenge1/Answered_Question.png",
  miss: "/textures/challenge1/IncorrectUI.png",
  correct: "/textures/challenge1/CorrectUI.png",
  bridge: "/textures/challenge1/Bridge_between_the_question_numbers.png",
  light: "/textures/challenge1/LightUIButton.png",
  dark: "/textures/challenge1/DarkUIButton.png",
  yes: "/textures/challenge1/True.png",
  no: "/textures/challenge1/False.png",
};

const PLAYTEST_STUDENT = {
  board: "/textures/playtest_student/UI_Background.png",
  title: "/textures/playtest_student/Title_for_assignment.png",
  clock: "/textures/playtest_student/Clock_Background.png",
  idle: "/textures/playtest_student/Unanswered_Question.png",
  current: "/textures/playtest_student/Current_Question.png",
  done: "/textures/playtest_student/Answered_Question.png",
  miss: "/textures/playtest_student/IncorrectUI.png",
  correct: "/textures/playtest_student/CorrectUI.png",
  bridge: "/textures/playtest_student/Bridge_between_the_question_numbers.png",
  light: "/textures/playtest_student/LightUIButton.png",
  dark: "/textures/playtest_student/DarkUIButton.png",
  submit: "/textures/playtest_student/Submit_Button.png",
  yes: "/textures/playtest_student/True.png",
  no: "/textures/playtest_student/False.png",
};

const PLAYTEST_INSTRUCTOR = {
  board: "/textures/playtest_instructor/UIBackground.png",
  title: "/textures/playtest_instructor/Title_for_Dashboard.png",
  clock: "/textures/playtest_instructor/Clock_Background.png",
  question: "/textures/playtest_instructor/QuestionBackground.png",
  stop: "/textures/playtest_instructor/StopButton.png",
  close: "/textures/playtest_instructor/XCloseButton.png",
};

const C1I = {
  board: "/textures/challenge1_instructor/UIBackground.png",
  title: "/textures/challenge1_instructor/Title_for_Dashboard.png",
  clock: "/textures/challenge1_instructor/Clock_Background.png",
  question: "/textures/challenge1_instructor/QuestionBackground.png",
  stop: "/textures/challenge1_instructor/StopButton.png",
  close: "/textures/challenge1_instructor/XCloseButton.png",
};

const imageCache = new Map<string, HTMLImageElement>();

function getImage(src: string, onReady?: () => void): HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached?.complete && cached.naturalWidth > 0) return cached;
  if (cached) {
    if (onReady) cached.addEventListener("load", () => onReady(), { once: true });
    return null;
  }
  const image = new Image();
  image.onload = () => onReady?.();
  image.src = src;
  imageCache.set(src, image);
  return null;
}

export function preloadArtPack(sources: string[], onReady: () => void): void {
  let pending = sources.length;
  sources.forEach(src => {
    const existing = imageCache.get(src);
    if (existing?.complete) {
      pending -= 1;
      if (pending <= 0) onReady();
      return;
    }
    const image = existing ?? new Image();
    image.onload = () => {
      pending -= 1;
      if (pending <= 0) onReady();
    };
    if (!existing) {
      image.src = src;
      imageCache.set(src, image);
    }
  });
  if (pending <= 0) onReady();
}

export function preloadChallenge1Art(onReady: () => void): void {
  preloadArtPack(Object.values(C1), onReady);
}

export function preloadPlaytestStudentArt(onReady: () => void): void {
  preloadArtPack(Object.values(PLAYTEST_STUDENT), onReady);
}

export function preloadPlaytestInstructorArt(onReady: () => void): void {
  preloadArtPack(Object.values(PLAYTEST_INSTRUCTOR), onReady);
}

export function preloadChallenge1InstructorArt(onReady: () => void): void {
  const sources = Object.values(C1I);
  let pending = sources.length;
  sources.forEach(src => {
    const existing = imageCache.get(src);
    if (existing?.complete) {
      pending -= 1;
      if (pending <= 0) onReady();
      return;
    }
    const image = existing ?? new Image();
    image.onload = () => {
      pending -= 1;
      if (pending <= 0) onReady();
    };
    if (!existing) {
      image.src = src;
      imageCache.set(src, image);
    }
  });
  if (pending <= 0) onReady();
}

export function paintTitleBanner(options: {
  canvas: HTMLCanvasElement;
  text: string;
  src?: string;
  onReady?: () => void;
}): string {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) return options.canvas.toDataURL("image/png");
  const width = options.canvas.width;
  const height = options.canvas.height;
  ctx.clearRect(0, 0, width, height);
  const plate = getImage(options.src ?? C1.title, options.onReady);
  if (plate) ctx.drawImage(plate, 0, 0, width, height);
  ctx.fillStyle = "#dff8ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(height * 0.38)}px Inter, sans-serif`;
  ctx.fillText(options.text, width / 2, height / 2 + 2);
  return options.canvas.toDataURL("image/png");
}

export function paintHudPlate(options: {
  canvas: HTMLCanvasElement;
  src: string;
  text: string;
  color?: string;
  onReady?: () => void;
}): string {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) return options.canvas.toDataURL("image/png");
  const width = options.canvas.width;
  const height = options.canvas.height;
  ctx.clearRect(0, 0, width, height);
  const plate = getImage(options.src, options.onReady);
  if (plate) ctx.drawImage(plate, 0, 0, width, height);
  ctx.fillStyle = options.color ?? "#f4fbff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxWidth = width - 40;
  let fontSize = Math.round(height * 0.34);
  let lines = [options.text];
  while (fontSize >= 16) {
    ctx.font = `700 ${fontSize}px Inter, sans-serif`;
    const words = options.text.split(/\s+/).filter(Boolean);
    lines = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    if (lines.every(line => ctx.measureText(line).width <= maxWidth) &&
        lines.length * fontSize * 1.15 <= height - 16) break;
    fontSize -= 1;
  }
  const lineHeight = fontSize * 1.15;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, startY + index * lineHeight + 1);
  });
  return options.canvas.toDataURL("image/png");
}

export function paintReviewChip(options: {
  canvas: HTMLCanvasElement;
  digit: string;
  correct: boolean;
  correctSrc?: string;
  missSrc?: string;
  onReady?: () => void;
}): string {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) return options.canvas.toDataURL("image/png");
  const size = options.canvas.width;
  ctx.clearRect(0, 0, size, size);
  const plate = getImage(
    options.correct ? (options.correctSrc ?? C1.correct) : (options.missSrc ?? C1.miss),
    options.onReady
  );
  if (plate) ctx.drawImage(plate, 0, 0, size, size);
  ctx.fillStyle = "#f8fbff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(size * 0.42)}px Inter, sans-serif`;
  ctx.fillText(options.digit, size / 2, size / 2 + 2);
  return options.canvas.toDataURL("image/png");
}

export { C1, C1I, PLAYTEST_STUDENT, PLAYTEST_INSTRUCTOR, getImage };

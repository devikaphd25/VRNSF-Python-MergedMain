export function capitalizeFlowchartLabel(text: string): string {
  return String(text ?? "").replace(/(^|[/\s-])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

export const CSDP99_W1D1_CHALLENGE3_TITLE = "Challenge 3";

export const CSDP99_W1D1_CHALLENGE3_GUIDE = [
  "Match each flowchart element to its shape.",
];

const FLOWCHART_OPTIONS = ["Ellipse", "Diamond", "Rectangle", "Parallelogram"];

export const CSDP99_W1D1_CHALLENGE3_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = [
  {
    prompt: "Start/End",
    instructorLabel: "Start/End",
    options: FLOWCHART_OPTIONS,
    correctIndex: 0,
  },
  {
    prompt: "Input",
    instructorLabel: "Input",
    options: FLOWCHART_OPTIONS,
    correctIndex: 3,
  },
  {
    prompt: "Process",
    instructorLabel: "Process",
    options: FLOWCHART_OPTIONS,
    correctIndex: 2,
  },
  {
    prompt: "Output",
    instructorLabel: "Output",
    options: FLOWCHART_OPTIONS,
    correctIndex: 3,
  },
  {
    prompt: "Decision",
    instructorLabel: "Decision",
    options: FLOWCHART_OPTIONS,
    correctIndex: 1,
  },
];

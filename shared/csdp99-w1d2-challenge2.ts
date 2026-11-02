export const CSDP99_W1D2_CHALLENGE2_TITLE = "Challenge 2";

const INDENT = "    ";

export const CSDP99_W1D2_CHALLENGE2_CODE_Q1 = [
  "while n < 5:",
  `${INDENT}print(n)`,
  `${INDENT}n += 1`,
];

export const CSDP99_W1D2_CHALLENGE2_CODE_Q2 = [
  "n = 0",
  "while n < 5:",
  `${INDENT}print(n)`,
];

export const CSDP99_W1D2_CHALLENGE2_CODE_Q3 = [
  "n = 0",
  "while True:",
  `${INDENT}print(n)`,
  `${INDENT}n += 1`,
];

export const CSDP99_W1D2_CHALLENGE2_CODE_SHARED = [
  "n = 3",
  "while n > 0:",
  `${INDENT}print(n)`,
  `${INDENT}n -= 1`,
  "print(\"Liftoff!\")",
];

export function csdp99W1d2Challenge2Code(questionIndex: number): string[] {
  if (questionIndex <= 0) return CSDP99_W1D2_CHALLENGE2_CODE_Q1;
  if (questionIndex === 1) return CSDP99_W1D2_CHALLENGE2_CODE_Q2;
  if (questionIndex === 2) return CSDP99_W1D2_CHALLENGE2_CODE_Q3;
  return CSDP99_W1D2_CHALLENGE2_CODE_SHARED;
}

const MISSING_OPTIONS = [
  "Missing Initialization",
  "Missing Comparison",
  "Missing Update",
  "No error",
];

export const CSDP99_W1D2_CHALLENGE2_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = [
  {
    prompt: "What is missing in this loop, causing Python to raise a NameError?",
    instructorLabel: "Missing causing NameError",
    options: MISSING_OPTIONS,
    correctIndex: 0,
  },
  {
    prompt: "What is missing in this loop, causing it to run infinitely and print 0 repeatedly?",
    instructorLabel: "Infinite print of 0",
    options: MISSING_OPTIONS,
    correctIndex: 2,
  },
  {
    prompt: "What is missing in this loop, causing the loop condition to never become false?",
    instructorLabel: "Condition never false",
    options: MISSING_OPTIONS,
    correctIndex: 1,
  },
  {
    prompt: "How many iterations (times the loop body runs) does the loop execute?",
    instructorLabel: "How many iterations",
    options: ["2", "3", "4", "1"],
    correctIndex: 1,
  },
  {
    prompt: "What is the first number printed by the loop?",
    instructorLabel: "First number printed",
    options: ["0", "2", "3", "1"],
    correctIndex: 2,
  },
  {
    prompt: "What is the last number printed by the loop before it exits?",
    instructorLabel: "Last number printed",
    options: ["0", "1", "2", "3"],
    correctIndex: 1,
  },
  {
    prompt: "What is the final value of variable n after the loop finishes?",
    instructorLabel: "Final value of n",
    options: ["-1", "0", "1", "3"],
    correctIndex: 1,
  },
];

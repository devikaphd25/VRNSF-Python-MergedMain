export const CSDP99_W1D2_CHALLENGE3_TITLE = "Challenge 3";

const INDENT = "    ";

export const CSDP99_W1D2_CHALLENGE3_CODE_LINES = [
  "number = 5",
  "factorial = 1",
  "count = 1",
  "while count <= number:",
  `${INDENT}factorial *= count`,
  `${INDENT}count += 1`,
];

const ACTION_OPTIONS = [
  "Initialization",
  "Comparison",
  "Update",
  "None",
];

export const CSDP99_W1D2_CHALLENGE3_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = [
  {
    prompt: "What action label describes the line count = 1 in the factorial loop?",
    instructorLabel: "count = 1 action label",
    options: ACTION_OPTIONS,
    correctIndex: 0,
  },
  {
    prompt: "What action label describes the line while count <= number: in the factorial loop?",
    instructorLabel: "while count <= number",
    options: ACTION_OPTIONS,
    correctIndex: 1,
  },
  {
    prompt: "What action label describes the line count += 1 in the factorial loop?",
    instructorLabel: "count += 1 action label",
    options: ACTION_OPTIONS,
    correctIndex: 2,
  },
  {
    prompt: "How many iterations (times the loop body runs) does the loop execute?",
    instructorLabel: "How many iterations",
    options: ["4", "5", "6", "0"],
    correctIndex: 1,
  },
  {
    prompt: "What is the value of count when the loop ends?",
    instructorLabel: "count when loop ends",
    options: ["1", "5", "6", "0"],
    correctIndex: 2,
  },
];

export const CSDP99_W1D2_CHALLENGE3_EXTRA_CREDIT: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
}> = [
  {
    prompt: "What is the final value of factorial after the loop completes?",
    instructorLabel: "Final factorial value",
    options: ["24", "120", "720", "0"],
    correctIndex: 1,
  },
  {
    prompt: "What is the initial value of the factorial variable?",
    instructorLabel: "Initial factorial",
    options: ["0", "1", "5", "120"],
    correctIndex: 1,
  },
  {
    prompt: "What is another way to write the assignment line factorial *= count?",
    instructorLabel: "factorial *= count",
    options: [
      "factorial = factorial * count",
      "factorial = factorial + count",
      "count = factorial * count",
      "factorial = count",
    ],
    correctIndex: 0,
  },
];

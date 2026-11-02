export const CSDP120_W13D2_CHALLENGE1_TITLE = "Challenge 1";

export const CSDP120_W13D2_CODE_LINES = ["s = 'code'"];

export const CSDP120_W13D2_STATEMENTS = [
  "s[0] = 'C'",
  "s = 'Code'",
  "print(s[0])",
  "s = s + '!'",
  "len(s) = 5",
];

const OK_ERROR = ["OK", "Error"];

export const CSDP120_W13D2_CHALLENGE1_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  statement: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = CSDP120_W13D2_STATEMENTS.map((statement, index) => ({
  prompt: "Does this statement execute successfully (OK) or result in an Error?",
  instructorLabel: statement,
  statement,
  options: OK_ERROR,
  correctIndex: [1, 0, 0, 0, 1][index],
}));

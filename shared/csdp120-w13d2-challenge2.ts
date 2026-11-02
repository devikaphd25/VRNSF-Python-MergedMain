export const CSDP120_W13D2_CHALLENGE2_TITLE = "Challenge 2";

export const CSDP120_W13D2_C2_CODE_LINES = ["s = 'Go Hawks!'"];

export const CSDP120_W13D2_C2_EXPRESSIONS = [
  "'H' in s",
  "'h' in s",
  "'Go' in s",
  "'go' in s",
  "'x' not in s",
  "' ' in s",
  "'hawks' in s.lower()",
];

const TRUE_FALSE = ["True", "False"];

export const CSDP120_W13D2_CHALLENGE2_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  expression: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = CSDP120_W13D2_C2_EXPRESSIONS.map((expression, index) => ({
  prompt: "Does this expression evaluate to True or False?",
  instructorLabel: expression,
  expression,
  options: TRUE_FALSE,
  correctIndex: [0, 1, 0, 1, 0, 0, 0][index],
}));

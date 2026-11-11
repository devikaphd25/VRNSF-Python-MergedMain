/** Drop-box categories and grab items used by the Challenge 2 activity. */
export type Challenge2Category =
  | "input"
  | "output"
  | "both"
  | "storage"
  | "initialization"
  | "comparison"
  | "update"
  | "print1"
  | "print2"
  | "print3"
  | "finalN";

export const CHALLENGE_2_CATEGORIES: readonly Challenge2Category[] = [
  "input",
  "output",
  "both",
  "storage",
  "initialization",
  "comparison",
  "update",
  "print1",
  "print2",
  "print3",
  "finalN",
];

export function isChallenge2Category(value: string): value is Challenge2Category {
  return (CHALLENGE_2_CATEGORIES as readonly string[]).includes(value);
}

export type Challenge2Item = {
  id: string;
  name: string;
  part?: 1 | 2;
  instructorLabel?: string;
  displayText?: string;
  codeLines?: readonly string[];
  imagePath?: string;
  modelPath?: string;
  modelRotationY?: number;
  category: Challenge2Category;
  feedback: string;
};

export const CHALLENGE_2_TITLE = "Challenge 2";

export const CHALLENGE_2_PROMPT =
  "Match each code snippet to the correct missing component of a while loop.";

export const CHALLENGE_2_PART2_PROMPT =
  "Given the countdown loop, drag the correct numbers into their matching execution order slots.";

const INDENT = "    ";

export const CHALLENGE_2_PART2_CODE_LINES = [
  "n = 3",
  "while n > 0:",
  `${INDENT}print(n)`,
  `${INDENT}n -= 1`,
  "print(\"Liftoff!\")",
];

export const CHALLENGE_2_PART1_ITEMS: readonly Challenge2Item[] = [
  {
    id: "snippet-a",
    name: "A",
    part: 1,
    instructorLabel: "A missing initialization",
    codeLines: [
      "while n < 5:",
      `${INDENT}print(n)`,
      `${INDENT}n += 1`,
    ],
    category: "initialization",
    feedback: "This loop uses n before giving it a starting value.",
  },
  {
    id: "snippet-b",
    name: "B",
    part: 1,
    instructorLabel: "B missing update",
    codeLines: [
      "n = 0",
      "while n < 5:",
      `${INDENT}print(n)`,
    ],
    category: "update",
    feedback: "This loop never changes n, so it cannot move forward.",
  },
  {
    id: "snippet-c",
    name: "C",
    part: 1,
    instructorLabel: "C missing comparison",
    codeLines: [
      "n = 0",
      "while True:",
      `${INDENT}print(n)`,
      `${INDENT}n += 1`,
    ],
    category: "comparison",
    feedback: "This loop never checks a condition that can become false.",
  },
];

export const CHALLENGE_2_PART2_ITEMS: readonly Challenge2Item[] = [
  {
    id: "trace-3",
    name: "3",
    part: 2,
    displayText: "3",
    instructorLabel: "1st Print",
    category: "print1",
    feedback: "The first print shows n while it is still 3.",
  },
  {
    id: "trace-2",
    name: "2",
    part: 2,
    displayText: "2",
    instructorLabel: "2nd Print",
    category: "print2",
    feedback: "The second print shows n after it has become 2.",
  },
  {
    id: "trace-1",
    name: "1",
    part: 2,
    displayText: "1",
    instructorLabel: "3rd Print",
    category: "print3",
    feedback: "The third print shows n after it has become 1.",
  },
  {
    id: "trace-0",
    name: "0",
    part: 2,
    displayText: "0",
    instructorLabel: "Final value of n",
    category: "finalN",
    feedback: "After the loop, n has been decreased to 0.",
  },
];

export const CHALLENGE_2_ITEMS: readonly Challenge2Item[] = [
  ...CHALLENGE_2_PART1_ITEMS,
  ...CHALLENGE_2_PART2_ITEMS,
];

/** Puzzle definition for the Python Jigsaw activity inside the ocean. */

export interface OceanJigsawLine {
  id: string;
  text: string;
  correctIndent: number;
  correctSlot: number;
}

export const OCEAN_PUZZLE_LINES: OceanJigsawLine[] = [
  { id: "line1",  text: 'adult_tickets = int(input("Adult tickets: "))',     correctIndent: 0, correctSlot: 0 },
  { id: "line2",  text: 'child_tickets = int(input("Child tickets: "))',     correctIndent: 0, correctSlot: 1 },
  { id: "line3",  text: "ADULT_PRICE = 11.50",                                correctIndent: 0, correctSlot: 2 },
  { id: "line4",  text: "CHILD_PRICE = 8.25",                                 correctIndent: 0, correctSlot: 3 },
  { id: "line5",  text: "adult_subtotal = adult_tickets * ADULT_PRICE",       correctIndent: 0, correctSlot: 4 },
  { id: "line6",  text: "child_subtotal = child_tickets * CHILD_PRICE",       correctIndent: 0, correctSlot: 5 },
  { id: "line7",  text: "total = adult_subtotal + child_subtotal",            correctIndent: 0, correctSlot: 6 },
  { id: "line8",  text: 'print(f"Adults: ${adult_subtotal:.2f}")',             correctIndent: 0, correctSlot: 7 },
  { id: "line9",  text: 'print(f"Children: ${child_subtotal:.2f}")',          correctIndent: 0, correctSlot: 8 },
  { id: "line10", text: 'print(f"Total: ${total:.2f}")',                      correctIndent: 0, correctSlot: 9 },
];

export const OCEAN_EXPECTED_OUTPUT =
  "Adult tickets: 2\nChild tickets: 3\nAdults: $23.00\nChildren: $24.75\nTotal: $47.75";

/** Fixed shuffle so the puzzle starts in the same scrambled order every time. */
export const OCEAN_SHUFFLED_ORDER = [7, 2, 9, 4, 0, 6, 3, 8, 1, 5];

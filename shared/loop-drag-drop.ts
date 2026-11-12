/** Protocol/layout identifiers only. Lesson text and grading keys live in Supabase. */
export type LoopDropCategory = 'initialization' | 'comparison' | 'update' | 'print1' | 'print2' | 'print3' | 'finalN';
export const LOOP_DROP_CATEGORIES: readonly LoopDropCategory[] = ['initialization', 'comparison', 'update', 'print1', 'print2', 'print3', 'finalN'];
export type LoopDragItem = {
  id: string; name: string; part: 1 | 2; instructorLabel?: string;
  displayText?: string; codeLines?: string[]; imagePath?: string; modelPath?: string; modelRotationY?: number;
};
export type LoopDragRound = {
  part: 1 | 2; prompt: string; instructions: string; codeLines?: string[];
  boxes: Array<{ category: LoopDropCategory; label: string }>;
};

import type { QuickChallengeQuestion } from '../types.js';

/** Grade only against the server's Supabase snapshot, including exact multi-selection. */
export function gradeChallengeAnswer(question: QuickChallengeQuestion, selection: number) {
  if (question.correctIndices?.length) {
    const selected = question.options.map((_, index) => index).filter(index => ((selection >> index) & 1) === 1);
    const placementCorrect = question.correctIndices.filter(index => selected.includes(index)).length;
    return { correct: placementCorrect === question.correctIndices.length && selected.length === question.correctIndices.length, placementCorrect };
  }
  return { correct: selection === question.correctIndex, placementCorrect: undefined as number | undefined };
}

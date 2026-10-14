/** One puzzle snapshot used by the live monitor and the final return report. */
export function puzzleProgress(placed: number, total: number, wrong: number, startedAt: number, now: number, solved: boolean) {
  return {
    status: solved ? "completed" as const : "working" as const,
    score: solved ? 100 : 0,
    completedCards: solved ? total : Math.min(total, Math.max(0, placed)),
    totalCards: total,
    correctAnswers: solved ? 1 : 0,
    wrongAnswers: wrong,
    accuracy: solved ? 100 / (1 + wrong) : 0,
    durationSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)),
  };
}

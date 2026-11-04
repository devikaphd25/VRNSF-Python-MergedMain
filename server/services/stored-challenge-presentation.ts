/** Preserve table-owned choices/answers while attaching independently stored code panels. */
export function applyStoredChallengePresentations(rows: any[], stored: any, activityId: number): any[] {
  if (stored?.version !== 1 || stored.activityId !== activityId || !Array.isArray(stored.questions)) {
    throw Error('Supabase challenge panel data does not match this activity.');
  }
  const panels = new Map<number, any>();
  for (const item of stored.questions) {
    if (!Number.isSafeInteger(item.questionId) || panels.has(item.questionId) || !item.presentation) {
      throw Error('Invalid or duplicate Supabase challenge panel question.');
    }
    panels.set(item.questionId, item.presentation);
  }
  return rows.map(row => {
    if (row.options?.presentation) return row;
    const presentation = panels.get(Number(row.id));
    if (!presentation) throw Error(`Missing Supabase code panel for question ${row.id}.`);
    return { ...row, options: {
      choices: Array.isArray(row.options) ? row.options : row.options?.choices,
      presentation: { ...presentation, prompt: row.question_text },
    } };
  });
}

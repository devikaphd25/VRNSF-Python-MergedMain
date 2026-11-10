import type { ChallengePresentation } from '../../shared/challenge-presentation.js';
import type { QuickChallengeQuestion } from '../types.js';

/** Accept legacy option arrays and rich curriculum content from the same JSONB column. */
export function databaseChallengeQuestions(rows: any[], requirePresentation = false): QuickChallengeQuestion[] {
  if (!rows?.length) throw Error('Challenge questions are missing. Add them in Supabase.');
  return rows.map(row => {
    const rich = !Array.isArray(row.options) && row.options && typeof row.options === 'object';
    const options = rich ? row.options.choices : row.options;
    const presentation: ChallengePresentation | undefined = rich ? row.options.presentation : undefined;
    const answer = row.correct_answer;
    const multi = answer?.choice_indices;
    const validIndex = (index: unknown) => Number.isInteger(index) && Number(index) >= 0 && Number(index) < options.length;
    if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1 ||
        row.question_type !== 'multiple_choice' && row.question_type !== 'true_false' ||
        typeof row.question_text !== 'string' || !row.question_text.trim() ||
        !Array.isArray(options) || options.length < 2 || options.length > 5 ||
        options.some(option => typeof option !== 'string' || !option.trim()) ||
        (multi !== undefined ? !Array.isArray(multi) || !multi.length ||
          new Set(multi).size !== multi.length || !multi.every(validIndex) : !validIndex(answer?.choice_index))) {
      throw Error(`Invalid Supabase question ${row.id ?? ''}: check options and correct_answer.`);
    }
    if ((requirePresentation && !presentation) || (presentation && (
      typeof presentation.prompt !== 'string' || !presentation.prompt.trim() ||
      ['codeLines', 'guide'].some(key => (presentation as any)[key] !== undefined &&
        (!Array.isArray((presentation as any)[key]) || (presentation as any)[key].some((line: unknown) => typeof line !== 'string'))) ||
      ['footer', 'statement', 'instructorLabel'].some(key => (presentation as any)[key] !== undefined && typeof (presentation as any)[key] !== 'string')
    ))) throw Error(`Missing or invalid presentation in Supabase question ${row.id}.`);
    return {
      id: String(row.id), prompt: presentation?.prompt ?? row.question_text,
      ...(rich && row.options.extra_credit === true ? { extraCredit: true } : {}),
      options: [...options], correctIndex: multi ? -1 : answer.choice_index,
      ...(multi ? { correctIndices: [...multi] } : {}),
      ...(presentation ? { presentation, instructorLabel: presentation.instructorLabel } : {}),
    };
  });
}

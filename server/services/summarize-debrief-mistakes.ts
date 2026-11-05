import type { DebriefMistakes } from '../../shared/debrief-mistakes.js';

type Question = { id: number; question_order: number; question_text: string; options: any };
type Result = { participant_id: number; attempt_number: number; started_at: string; challenge_responses: Array<{ question_id: number; student_answer: any; is_correct: boolean | null }> };

/** Retain distinct mistakes from every saved attempt, including the first. */
export function summarizeDebriefMistakes(activity: { id: number; title: string }, questions: Question[], results: Result[]): DebriefMistakes {
  const latest = new Map<number, Result>();
  for (const result of results) {
    const old = latest.get(result.participant_id);
    if (!old || result.attempt_number > old.attempt_number ||
      (result.attempt_number === old.attempt_number && result.started_at > old.started_at)) latest.set(result.participant_id, result);
  }
  return { activityId: activity.id, title: activity.title, studentCount: latest.size,
    questions: [...questions].sort((a, b) => a.question_order - b.question_order).map(question => {
      const counts = new Map<string, Set<number>>();
      const options = Array.isArray(question.options) ? question.options : question.options?.choices;
      for (const result of results) {
        const response = result.challenge_responses.find(row => row.question_id === question.id);
        if (!response || response.is_correct !== false || response.student_answer == null) continue;
        const answer = response.student_answer;
        let label: string;
        if (Array.isArray(answer.choice_indices)) {
          label = [...new Set<number>(answer.choice_indices)].sort((a,b) => a-b)
            .map(index => options?.[index] ?? `Option ${index + 1}`).join(' + ') || 'No options selected';
        } else if (Number.isInteger(answer.choice_index)) label = answer.value ?? options?.[answer.choice_index] ?? `Option ${answer.choice_index + 1}`;
        else label = answer.category ?? (typeof answer === 'string' ? answer : JSON.stringify(answer));
        if (!counts.has(label)) counts.set(label, new Set());
        counts.get(label)!.add(result.participant_id);
      }
      return { questionNumber: question.question_order, question: question.question_text,
        answers: [...counts].map(([answer, students]) => ({ answer, studentCount: students.size })).sort((a,b) => a.answer.localeCompare(b.answer)) };
    }) };
}

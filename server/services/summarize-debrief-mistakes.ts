import type { DebriefMistakes } from '../../shared/debrief-mistakes.js';

type Question = { id: number; question_order: number; question_text: string; options: any };
type Result = { participant_id: number; attempt_number: number; started_at: string; challenge_responses: Array<{ question_id: number; student_answer: any; is_correct: boolean | null }> };

/** First graded response per student/question, scoped to the session by the repository.
 * Later main/bonus snapshots and retakes must not inflate initial difficulty. */
export function summarizeDebriefMistakes(activity: { id: number; title: string }, questions: Question[], results: Result[]): DebriefMistakes {
  const ordered = [...results].sort((a, b) => a.attempt_number - b.attempt_number || a.started_at.localeCompare(b.started_at));
  const respondents = new Set(results.filter(result => result.challenge_responses.some(response =>
    response.student_answer != null && typeof response.is_correct === 'boolean')).map(result => result.participant_id));
  return { activityId: activity.id, title: activity.title, studentCount: respondents.size,
    questions: [...questions].sort((a, b) => a.question_order - b.question_order).map(question => {
      const counts = new Map<string, Set<number>>();
      const incorrectStudents = new Set<number>();
      const options = Array.isArray(question.options) ? question.options : question.options?.choices;
      const answeredStudents = new Set<number>();
      for (const result of ordered) {
        const response = result.challenge_responses.find(row => row.question_id === question.id);
        if (!response || typeof response.is_correct !== 'boolean' || response.student_answer == null || answeredStudents.has(result.participant_id)) continue;
        answeredStudents.add(result.participant_id);
        const answer = response.student_answer;
        // Drag/drop saves the final placement plus earlier wrong drops. A
        // later correct placement must not erase that student's initial error.
        const firstWrongDrop = Array.isArray(answer?.wrong_attempts)
          ? answer.wrong_attempts.find((entry: unknown) => Array.isArray(entry) &&
              typeof entry[0] === 'string' && Number(entry[1]) > 0)?.[0]
          : undefined;
        if (response.is_correct && !firstWrongDrop) continue;
        incorrectStudents.add(result.participant_id);
        let label: string;
        if (firstWrongDrop) {
          label = question.options?.round?.boxes?.find((box: any) => box.category === firstWrongDrop)?.label ?? firstWrongDrop;
        } else if (Array.isArray(answer.choice_indices)) {
          label = [...new Set<number>(answer.choice_indices)].sort((a,b) => a-b)
            .map(index => options?.[index] ?? `Option ${index + 1}`).join(' + ') || 'No options selected';
        } else if (Number.isInteger(answer.choice_index)) label = answer.value ?? options?.[answer.choice_index] ?? `Option ${answer.choice_index + 1}`;
        else label = answer.category ?? (typeof answer === 'string' ? answer : JSON.stringify(answer));
        if (!counts.has(label)) counts.set(label, new Set());
        counts.get(label)!.add(result.participant_id);
      }
      return { questionNumber: question.question_order, question: question.question_text,
        shortLabel: question.options?.presentation?.instructorLabel || question.question_text,
        answeredStudentCount: answeredStudents.size,
        incorrectStudentCount: incorrectStudents.size,
        answers: [...counts].map(([answer, students]) => ({ answer, studentCount: students.size })).sort((a,b) => a.answer.localeCompare(b.answer)) };
    }) };
}

export interface DebriefMistakes {
  activityId: number;
  title: string;
  studentCount: number;
  questions: Array<{
    questionNumber: number;
    question: string;
    answers: Array<{ answer: string; studentCount: number }>;
  }>;
}

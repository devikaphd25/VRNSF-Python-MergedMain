export interface DebriefMistakes {
  activityId: number;
  title: string;
  studentCount: number;
  questions: Array<{
    questionNumber: number;
    question: string;
    shortLabel: string;
    answeredStudentCount: number;
    incorrectStudentCount: number;
    answers: Array<{ answer: string; studentCount: number }>;
  }>;
}

/** Lesson content supplied by Supabase, shared by the server and student UI. */
export interface ChallengePresentation {
  prompt: string;
  codeLines?: string[];
  guide?: string[];
  footer?: string;
  statement?: string;
  instructorLabel?: string;
}

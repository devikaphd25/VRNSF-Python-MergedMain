import { supabaseAdmin as db } from '../database/supabase-client.js';
import { summarizeDebriefMistakes } from '../services/summarize-debrief-mistakes.js';
async function value<T>(query: PromiseLike<{data: T; error: any}>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function loadSavedChallengeMistakes(sessionId: number, activity: { id: number; title: string }) {
  const participants = await value(db.from('participants').select('id').eq('session_id', sessionId));
  const questions = await value(db.from('challenge_questions').select('id,question_order,question_text,options').eq('activity_id', activity.id).order('question_order'));
  const results = participants.length ? await value(db.from('challenge_results')
    .select('participant_id,attempt_number,started_at,challenge_responses(question_id,student_answer,is_correct)')
    .eq('activity_id', activity.id).in('participant_id', participants.map(row => row.id))
    .in('status', ['completed', 'stopped'])) : [];
  return summarizeDebriefMistakes(activity, questions.filter(question => !question.options?.archived), results);
}

/** Match the selected debrief to the preceding challenge in its own course day. */
export async function loadDebriefMistakes(sessionId: number, activity: { day_id: number; week_id: number; activity_order: number }) {
  const challenge = await value(db.from('activities').select('id,title').eq('day_id', activity.day_id)
    .eq('week_id', activity.week_id).eq('activity_type', 'challenge').lt('activity_order', activity.activity_order)
    .order('activity_order', { ascending: false }).limit(1).maybeSingle());
  return challenge ? loadSavedChallengeMistakes(sessionId, challenge) : null;
}

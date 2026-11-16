import { supabaseAdmin as db } from '../database/supabase-client.js';
import { databaseChallengeQuestions } from '../services/database-challenge-questions.js';
import { applyStoredChallengePresentations } from '../services/stored-challenge-presentation.js';

/** Questions/answers are table rows; optional lesson panels are private Supabase JSON. */
export async function loadDatabaseChallengeQuestions(activity: { id: number; file_path?: string | null }, curriculum: boolean) {
  const { data, error } = await db.from('challenge_questions').select('*')
    .eq('activity_id', activity.id).order('question_order');
  if (error) throw error;
  let rows = data ?? [];
  if (curriculum && rows.some(row => !row.options?.presentation) && activity.file_path) {
    if (!activity.file_path.startsWith('supabase://')) throw Error('Challenge panel data must use a Supabase Storage path.');
    const path = activity.file_path.slice(11), split = path.indexOf('/');
    if (split < 1) throw Error('Invalid challenge panel Storage path.');
    const { data: file, error: downloadError } = await db.storage.from(path.slice(0, split)).download(path.slice(split + 1));
    if (downloadError || !file) throw Error('Could not load challenge code panels from Supabase.');
    if (file.size > 512 * 1024) throw Error('Challenge panel data is too large.');
    rows = applyStoredChallengePresentations(rows, JSON.parse(await file.text()), activity.id);
  }
  return databaseChallengeQuestions(rows, curriculum);
}

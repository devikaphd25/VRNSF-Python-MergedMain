/** Shared attempt allocation for challenge/game summary tables.
 * started_at is the server launch timestamp, so retries reuse the same attempt.
 * All writes for a participant/activity run through one queue in this server.
 */
import { supabaseAdmin as db } from './supabase-admin.service.js';
const queues = new Map<string, Promise<unknown>>();
export function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const job = (queues.get(key) ?? Promise.resolve()).catch(() => { }).then(work);
    queues.set(key, job);
    void job.finally(() => { if (queues.get(key) === job)
        queues.delete(key); }).catch(() => { });
    return job;
}
export async function ensureResult(kind: 'challenge' | 'game', participantId: number, activityId: number, startedAt: number) {
    const table = `${kind}_results`, stamp = new Date(startedAt).toISOString();
    const { data: existing, error } = await db.from(table).select('*').eq('participant_id', participantId).eq('activity_id', activityId).eq('started_at', stamp).maybeSingle();
    if (error)
        throw error;
    if (existing)
        return existing;
    const { data: last, error: le } = await db.from(table).select('attempt_number').eq('participant_id', participantId).eq('activity_id', activityId).order('attempt_number', { ascending: false }).limit(1).maybeSingle();
    if (le)
        throw le;
    const { data, error: ie } = await db.from(table).insert({ participant_id: participantId, activity_id: activityId, attempt_number: (last?.attempt_number ?? 0) + 1, started_at: stamp, status: 'in_progress' }).select('*').single();
    if (ie)
        throw ie;
    return data;
}
export async function writeChallengeAttempt(input: {
    participantId: number;
    activityId: number;
    startedAt: number;
    finishedAt: number;
    completed: boolean;
    score: number;
    answers: Array<{
        question_id: number;
        student_answer: unknown;
        is_correct: boolean | null;
    }>;
}) {
    return serial(`challenge:${input.participantId}:${input.activityId}`, async () => {
        const result = await ensureResult('challenge', input.participantId, input.activityId, input.startedAt);
        if (result.status === 'completed' && !input.completed)
            return;
        if (input.answers.length) {
            const { error } = await db.from('challenge_responses').upsert(input.answers.map(a => ({ ...a, challenge_result_id: result.id })), { onConflict: 'challenge_result_id,question_id' });
            if (error)
                throw error;
        }
        const { error } = await db.from('challenge_results').update({ score: input.score, status: input.completed ? 'completed' : 'stopped', finished_at: new Date(input.finishedAt).toISOString() }).eq('id', result.id);
        if (error)
            throw error;
    });
}

import { supabaseAdmin as db } from './supabase-admin.service.js';
import { ensureResult, serial } from './results.repository.js';
import type { GameResultInput } from '../types.js';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
type Run = {
    participantId: number;
    activityId: number;
    startedAt: number;
    roomId: string;
};
const runs = new Map<number, Run>();
export function bindGameRun(userId: number, run: Run) { runs.set(userId, run); }
export async function recordGameResponse(userId: number, itemKey: string, answer: unknown, correct: boolean | null) {
    const run = runs.get(userId);
    if (!run)
        throw Error('No game attempt assigned to this student');
    return serial(`game:${run.participantId}:${run.activityId}`, async () => {
        const result = await ensureResult('game', run.participantId, run.activityId, run.startedAt);
        if (result.status !== 'in_progress')
            return;
        const { error } = await db.from('game_responses').insert({ game_result_id: result.id, item_key: itemKey, student_answer: answer, is_correct: correct });
        if (error)
            throw error;
    });
}
export async function saveAppGameResult(input: GameResultInput): Promise<void> {
    const run = runs.get(input.userId);
    if (!run)
        throw Error('No game attempt assigned to this student');
    const snapshot = { ...run, input };
    return serial(`game:${run.participantId}:${run.activityId}`, async () => {
        await mkdir('data/pending-game-results', { recursive: true });
        const file = `data/pending-game-results/${run.participantId}-${run.activityId}-${run.startedAt}.json`;
        await writeFile(file, JSON.stringify(snapshot));
        const result = await ensureResult('game', run.participantId, run.activityId, run.startedAt);
        if (result.status === 'completed') {
            await unlink(file);
            return;
        }
        // A named summary response preserves the monitor's detailed metrics without
        // adding game-specific columns to the common results table.
        const { data: summary, error: se } = await db.from('game_responses').select('id').eq('game_result_id', result.id).eq('item_key', '__summary__').limit(1).maybeSingle();
        if (se)
            throw se;
        const payload = { game_result_id: result.id, item_key: '__summary__', student_answer: input, is_correct: null };
        const { error: re } = await (summary ? db.from('game_responses').update(payload).eq('id', summary.id) : db.from('game_responses').insert(payload));
        if (re)
            throw re;
        const { error } = await db.from('game_results').update({ score: input.score ?? 0, status: input.status === 'completed' ? 'completed' : 'stopped', finished_at: new Date().toISOString() }).eq('id', result.id);
        if (error)
            throw error;
        await unlink(file);
    });
}
export async function getRecentAppGameResults(limit = 50, completedAfter?: string | null): Promise<Record<string, unknown>[]> {
    let query = db.from('game_results').select('*,participants(student_id,seat_name,users(full_name)),activities(title),game_responses(item_key,student_answer)').not('finished_at', 'is', null);
    if (completedAfter)
        query = query.gte('finished_at', completedAfter);
    const { data, error } = await query.order('finished_at', { ascending: false }).limit(limit);
    if (error)
        throw error;
    const latest = new Map();
    for (const row of data ?? []) {
        const p: any = row.participants;
        const userId = p.student_id;
        if (latest.has(userId))
            continue;
        const metrics = row.game_responses.find((r: any) => r.item_key === '__summary__')?.student_answer ?? {};
        latest.set(userId, { ...metrics, id: row.id, userId, name: p.users.full_name, seat: p.seat_name, gameName: (row.activities as any)?.title, score: row.score, status: row.status, completedAt: row.finished_at });
    }
    return [...latest.values()];
}

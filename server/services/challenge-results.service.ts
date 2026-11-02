import type { QuickChallenge, Challenge2Session } from '../types.js';
import { serial } from "../utils/serial-work-queue.js";
import { writeChallengeAttempt } from '../repositories/activity-results.repository.js';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
/** Keep a recoverable snapshot until all responses and summary rows are saved. */
async function persist(id: string, attempts: Parameters<typeof writeChallengeAttempt>[0][]) {
    return serial(`snapshot:${id}`, async () => {
        await mkdir('data/pending-challenge-results', { recursive: true });
        const file = `data/pending-challenge-results/${encodeURIComponent(id)}.json`;
        await writeFile(file, JSON.stringify({ version: 2, attempts }));
        for (const attempt of attempts)
            await writeChallengeAttempt(attempt);
        await unlink(file);
    });
}
export function saveChallengeResponses(challenge: QuickChallenge, reason: string) {
    if (!challenge.activityId || !challenge.questions?.every(q => q.id))
        return Promise.reject(Error('Missing database challenge/question identity'));
    const attempts = [];
    for (const [socketId, participantId] of challenge.responseParticipants ?? []) {
        const progress = challenge.studentProgress.get(socketId);
        if (reason === 'completed' && !progress?.completed)
            continue;
        const answers = challenge.questions.map((q, i) => {
            const answer = progress?.answers.find(a => a.questionIndex === i);
            const selectedIndices = q.correctIndices
                ? q.options.map((_, index) => index).filter(index => answer ? ((answer.selectedIndex >> index) & 1) === 1 : false)
                : [];
            return {
                question_id: Number(q.id),
                student_answer: answer
                    ? q.correctIndices
                        ? { choice_indices: selectedIndices }
                        : { choice_index: answer.selectedIndex, value: q.options[answer.selectedIndex] }
                    : null,
                is_correct: answer
                    ? q.correctIndices
                        ? Boolean(answer.correct)
                        : answer.selectedIndex === q.correctIndex
                    : null
            };
        });
        attempts.push({ participantId: Number(participantId), activityId: challenge.activityId, startedAt: progress?.attemptStartedAt ?? challenge.startedAt,
            finishedAt: progress?.finishedAt ?? Date.now(), completed: !!progress?.completed, score: answers.filter(a => a.is_correct).length, answers });
    }
    return persist(challenge.id, attempts);
}
export function saveDragDropResponses(session: Challenge2Session, onlyCompleted = false) {
    const attempts = [];
    for (const [socketId, participantId] of session.participants) {
        const progress = session.progress.get(socketId);
        if (onlyCompleted && !progress?.completedAt)
            continue;
        const answers = session.questions.map(q => {
            const itemId = q.options.item.id;
            const done = progress?.completedItemIds.has(itemId);
            const wrong = [...(progress?.wrongSelections.get(itemId)?.entries() ?? [])];
            const category = done ? q.correct_answer.category : wrong.at(-1)?.[0];
            return { question_id: q.id, student_answer: category ? { category, wrong_attempts: wrong } : null, is_correct: category ? !!done : null };
        });
        attempts.push({ participantId: Number(participantId), activityId: session.activityId, startedAt: session.startedAt,
            finishedAt: progress?.completedAt ?? Date.now(), completed: !!progress?.completedAt, score: answers.filter(a => a.is_correct).length, answers });
    }
    return persist(session.id, attempts);
}

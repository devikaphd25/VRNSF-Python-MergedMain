/** Numeric class session IDs replace the old rooms/RPC system. */
import { serial } from "../utils/serial-work-queue.js";
import { supabaseAdmin as db } from '../database/supabase-client.js';
import { selectedCourseDay, courseByAccessCode } from '../repositories/course-content.repository.js';
import { upsertDeviceAppUser, getAppUserById } from '../repositories/users.repository.js';
import { firstAvailableClassroomSeat } from '../../shared/classroom-seats.js';
import { classroomStudentName } from '../../shared/classroom-student-name.js';
// One Node server coordinates seat assignment, including concurrent joins.
let joinQueue: Promise<unknown> = Promise.resolve();
const openedSessions = new Set<number>();
// The classroom event layer supports one live class on this Node server.
// Refuse a second simultaneous class rather than mixing its students/content.
export async function activeServerSession() {
    if (openedSessions.size === 0) return null;
    const { data, error } = await db.from('class_sessions').select('*')
        .in('id', [...openedSessions]).is('ended_at', null).order('id', { ascending: false })
        .limit(1).maybeSingle();
    if (error) throw error;
    return data;
}

export async function createSession(instructorId: number, accessCode: unknown, weekId: unknown, dayId: unknown) {
    if (getAppUserById(instructorId)?.role !== 'instructor') {
        throw new Error('Instructor required');
    }
    const course = await courseByAccessCode(accessCode);
    const { week, day } = await selectedCourseDay(course.id, weekId, dayId);
    return serial('create-classroom', async () => {
        const active = await activeServerSession();
        const reply = (id: number) => ({room_id: String(id), courseCode: course.course_code,
            courseTitle: course.title, weekNumber: week.week_number, weekTitle: week.title, dayNumber: day.day_number, dayTitle: day.title});
        if (active) {
            if (active.week_id === week.id && active.day_id === day.id && active.instructor_id === instructorId) return reply(active.id);
            throw new Error('End the current class before opening another course on this server.');
        }
        // A server restart cannot restore live timers. End stale sessions for
        // this instructor before creating the new class; keep their results.
        const { error: closeError } = await db.from('class_sessions')
            .update({ ended_at: new Date().toISOString(), active_activity_id: null })
            .eq('instructor_id', instructorId).is('ended_at', null);
        if (closeError) throw closeError;
        const { data, error } = await db.from('class_sessions')
            .insert({ week_id: week.id, day_id: day.id, instructor_id: instructorId }).select('id').single();
        if (error) throw error;
        openedSessions.add(data.id);
        return reply(data.id);
    });
}

export function joinSession(deviceId: string, name?: string) {
    const job = joinQueue.catch(() => { }).then(async () => {
        const session = await activeServerSession();
        if (!session) return null;
        const user = await upsertDeviceAppUser({ deviceId, displayName: name || 'Student', role: 'student', seat: null });
        const { data: participants, error: pe } = await db.from('participants').select('*').eq('session_id', session.id);
        if (pe)
            throw pe;
        let participant = participants?.find(p => p.student_id === user.id);
        if (!participant) {
            const seat = firstAvailableClassroomSeat((participants ?? []).map(p => p.seat_name));
            if (!seat)
                throw Error('This classroom has no available seats.');
            const { data, error } = await db.from('participants').insert({ session_id: session.id, student_id: user.id, seat_name: seat }).select('*').single();
            if (error)
                throw error;
            participant = data;
        }
        const displayName = classroomStudentName(user.fullName, participant.id, [...(participants ?? []), participant]);
        if (user.fullName !== displayName) {
            const { error } = await db.from('users').update({ full_name: displayName }).eq('id', user.id);
            if (error) throw error;
            user.fullName = displayName;
        }
        user.seat = participant.seat_name;
        return { room_id: String(session.id), participant_id: String(participant.id), current_slide: 0, display_name: user.fullName, seat: participant.seat_name };
    });
    joinQueue = job;
    return job;
}

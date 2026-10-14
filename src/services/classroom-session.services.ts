/** Browser calls the Node API. Supabase secrets and SQL stay on the server. */
import { ClassroomSessionError } from '../errors/classroom-session.errors';
export type ClassroomJoinSessionType = {
    room_id: string;
    participant_id: string;
    current_slide: number;
    display_name: string;
    seat: string;
};
async function post(path: string, body: unknown) {
    const response = await fetch(`/api/class-sessions${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok)
        throw new ClassroomSessionError(result.message || 'Could not connect to the classroom');
    return result;
}
export const ClassroomSessionService = {
    create(instructorId: number, accessCode: string): Promise<{
        room_id: string;
    }> { return post('', { instructorId, accessCode }); },
    joinLatest(deviceId: string, name?: string): Promise<ClassroomJoinSessionType | null> { return post('/join', { deviceId, name }); },
};

/** Each tab keeps its own class, even when testing several students locally. */
export function instructorContentUrl(): string {
    const session = JSON.parse(sessionStorage.getItem('vrClassroomSession') ?? '{}');
    if (!session.roomId) throw new ClassroomSessionError('Create or join a class first.');
    return `/api/instructor-content?sessionId=${encodeURIComponent(session.roomId)}`;
}

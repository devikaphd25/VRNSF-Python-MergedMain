// ========================================================
// SHARED SERVER STATE
// ========================================================

/*
 * Classroom students are currently indexed by their
 * classroom Socket.IO socket ID.
 *
 * We will improve this later, but for now we keep the
 * existing structure so nothing else breaks.
 */
export const students = {};

/*
 * Lab sessions are indexed by permanent database user ID.
 */
export const labSessions = {};

/*
 * Stores students who are moving from the lab back to
 * the classroom.
 */
export const returningStudents = {};

/*
 * Cross-application connection records.
 *
 * This is indexed by the permanent SQLite user ID.
 *
 * Example:
 *
 * connectedUsers[12] = {
 *   userId: 12,
 *   username: "Tina",
 *   classroomSocketId: null,
 *   labSocketId: "abc123",
 *   location: "python_lab"
 * };
 */
export const connectedUsers = {};
/**
 * Small Socket.IO broadcasting helper.
 * Goal: publish the current in-memory student list to every connected client.
 * Data source: server/state/classroom-state.ts through student.service.ts.
 */
import { getStudentList } from "./connected-students.service.js";
import type { Server } from "socket.io";

export function broadcastStudentList(io: Server): void {
  io.emit("studentList", getStudentList());
}

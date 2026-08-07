import { getStudentList } from "./student.service.js";
import type { Server } from "socket.io";

export function broadcastStudentList(io: Server): void {
  io.emit("studentList", getStudentList());
}

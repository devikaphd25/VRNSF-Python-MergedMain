import { getStudentList } from "./student.service.js";

export function broadcastStudentList(io) {
  io.emit("studentList", getStudentList());
}
import { students } from "../state/store.js";
import type { ClassroomStudent } from "../types.js";

export function getStudentList(): ClassroomStudent[] {
  return Object.values(students);
}

export function findStudent(studentId: string): ClassroomStudent | null {
  return students[studentId] || null;
}

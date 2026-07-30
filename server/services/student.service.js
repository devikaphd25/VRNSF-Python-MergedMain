import { students } from "../state/store.js";

export function getStudentList() {
  return Object.values(students);
}

export function findStudent(studentId) {
  return students[studentId] || null;
}
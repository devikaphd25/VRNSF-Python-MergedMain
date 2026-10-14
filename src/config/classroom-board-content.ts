/**
 * Text shown on the classroom board while the projector is idle.
 * Course and week labels are filled from the active class's database content.
 */
export const CLASSROOM_BOARD_CONTENT = {
  courseName: "UMES Classroom",
  weekLabel: "",
  studentsLabel: "Students online",
  instructorLabel: "Instructor",
};

export function setClassroomBoardCourse(content: {
  courseCode: string;
  weekNumber: number;
  weekTitle: string;
}): void {
  CLASSROOM_BOARD_CONTENT.courseName = content.courseCode;
  CLASSROOM_BOARD_CONTENT.weekLabel = content.weekTitle || `Week ${content.weekNumber}`;
  window.dispatchEvent(new Event("classroom-course-changed"));
}

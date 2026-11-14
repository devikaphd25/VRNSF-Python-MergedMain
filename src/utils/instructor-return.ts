/**
 * Instructor "Stop Game" reaches integrated puzzle scenes through these server
 * events. Every puzzle scene must listen for all of them, otherwise a student
 * stays trapped in the scene after the instructor ends the activity.
 */
import { socket } from "../network/socket";

export function connectInstructorReturn(
  returnToClassroom: (reason?: string) => void
): void {
  const returnFromPuzzle = (reason?: string): void => {
    returnToClassroom(reason ?? "instructor_return");
  };

  socket.on("returnToClassroom", data => {
    returnFromPuzzle(data?.returnReason);
  });

  socket.on("modeChanged", data => {
    if (data?.mode === "Classroom Mode") {
      returnFromPuzzle("instructor_return");
    }
  });

  socket.on("returnAllToClassroomNow", data => {
    returnFromPuzzle(data?.returnReason);
  });

  socket.on("allStudentsReturnedToClass", () => {
    returnFromPuzzle("instructor_return");
  });
}

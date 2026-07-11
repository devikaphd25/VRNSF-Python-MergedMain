import { renderStudentTable } from "./student-table";
import { socket } from "../../network/socket";

socket.on("studentList", (students) => {
  renderStudentTable(students);
});
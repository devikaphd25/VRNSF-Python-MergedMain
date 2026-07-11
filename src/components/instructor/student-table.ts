export function renderStudentTable(students: any[]) {
  const tbody = document.querySelector("#students tbody");

  if (!tbody) return;

  tbody.innerHTML = "";

  students.forEach((student) => {
    tbody.innerHTML += `
      <tr>
        <td>${student.seat}</td>
        <td>${student.id.substring(0, 6)}</td>
        <td>${student.mode}</td>
      </tr>
    `;
  });
}
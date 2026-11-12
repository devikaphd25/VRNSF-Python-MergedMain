/** Generic headset names are numbered within this session, never inherited
 * from a previous class. Participant IDs keep the number stable on reconnect. */
export function classroomStudentName(name: string, participantId: number, participants: Array<{ id: number }>): string {
  if (!/^student\s*\d*$/i.test(name.trim())) return name;
  const ids = [...new Set(participants.map(participant => Number(participant.id)))].sort((a, b) => a - b);
  const index = ids.indexOf(Number(participantId));
  if (index < 0) throw new Error('Student participant is missing from this session.');
  return `Student ${index + 1}`;
}

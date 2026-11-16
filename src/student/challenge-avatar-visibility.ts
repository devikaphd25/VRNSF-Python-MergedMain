/** Keep classmates hidden for the whole challenge, including retries/results. */
export function bindChallengeAvatarVisibility(
  socket: { on: (event: string, handler: (data?: any) => void) => unknown },
  state: Record<string, any>,
  refresh: () => void,
): void {
  let active: { kind: 'quick' | 'devices'; id?: string } | undefined;
  const apply = () => {
    state.isStudentChallengeActive = !state.isInstructor && Boolean(active);
    refresh();
  };
  const start = (kind: 'quick' | 'devices', data: any) => {
    if (state.isInstructor) return;
    active = { kind, id: data?.id }; apply();
  };
  const end = (kind: 'quick' | 'devices', id?: string) => {
    if (!active || active.kind !== kind || (id && active.id && id !== active.id)) return;
    active = undefined; apply();
  };
  const reset = () => { active = undefined; apply(); };
  socket.on('quickChallengeStarted', data => start('quick', data));
  socket.on('quickChallengeEnded', data => end('quick', data?.quizId));
  socket.on('challenge2Started', data => start('devices', data));
  socket.on('challenge2Ended', data => end('devices', data?.id ?? data?.challengeId));
  socket.on('modeChanged', data => {
    const mode = typeof data === 'string' ? data : data?.mode;
    if (['Classroom Mode', 'Presentation Mode', 'Lab Mode', 'Game Mode', 'Display Room'].includes(mode)) reset();
  });
  socket.on('classEnded', reset);
  socket.on('disconnect', reset);
}

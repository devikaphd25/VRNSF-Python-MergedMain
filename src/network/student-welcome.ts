import { socket } from './socket';

// Audio is local to this student. Server sends this only after seating is ready.
let player: HTMLAudioElement | undefined;
let pending = false;
let welcomeKey: string | undefined;
let starting = false;
let initialReplay: string | undefined;
function stop(markHandled = false) {
  if (markHandled && welcomeKey) sessionStorage.setItem(welcomeKey, 'played');
  pending = false;
  if (player) { player.pause(); player.currentTime = 0; }
  player = undefined;
  welcomeKey = undefined;
  starting = false;
}
async function play() {
  if (!pending || !player || starting) return;
  const current = player;
  const key = welcomeKey;
  starting = true;
  try {
    await current.play();
    if (player !== current) { current.pause(); return; }
    pending = false;
    if (key) sessionStorage.setItem(key, 'played');
  } catch {
    // Autoplay may be blocked until a browser or WebXR user gesture.
  } finally {
    if (player === current) starting = false;
  }
}
window.addEventListener('welcome-audio-gesture', () => void play());
window.addEventListener('pointerdown', () => void play());
window.addEventListener('keydown', () => void play());
socket.on('studentWelcome', (data: { roomId: string; userId: string; activityEvent?: string }) => {
  const key = `umes-welcome:${data.roomId}:${data.userId}`;
  if (sessionStorage.getItem(key)) return;
  if (welcomeKey === key && player) return;
  stop();
  welcomeKey = key;
  initialReplay = data.activityEvent;
  player = new Audio(data.activityEvent ? '/audio/umes-late-welcome.mp3' : '/audio/umes-week1-welcome.mp3');
  player.volume = 0.8;
  pending = true;
  void play();
});
for (const event of ['displayRoomOpened', 'quickChallengeStarted', 'challenge2Started', 'gameChanged', 'launchPythonPuzzle', 'presentationContentChanged']) {
  socket.on(event, () => {
    // The initial activity replay is expected for a late join. Let its short
    // greeting finish; any later activity change interrupts the welcome.
    if (initialReplay === event) { initialReplay = undefined; return; }
    initialReplay = undefined;
    stop(true);
  });
}
socket.on('disconnect', () => stop());
socket.on('classEnded', () => stop(true));

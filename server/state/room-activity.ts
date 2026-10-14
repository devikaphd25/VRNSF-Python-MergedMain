/** The latest instructor-selected activity, isolated by classroom. */
export type RoomActivity = {
  event: "displayRoomOpened" | "presentationContentChanged" | "gameChanged" | "launchPythonPuzzle" | "quickChallengeStarted" | "challenge2Started";
  payload: Record<string, any>;
  expiresAt?: number;
  playback?: { command: string; currentTime: number; sentAt: number };
};
export class RoomActivityStore {
  private activities = new Map<string, RoomActivity>();
  set(roomId: string, activity: RoomActivity): void {
    if (roomId) this.activities.set(roomId, activity);
  }
  get(roomId: string, now = Date.now()): RoomActivity | undefined {
    const activity = this.activities.get(roomId);
    if (activity?.expiresAt !== undefined && activity.expiresAt <= now) {
      this.activities.delete(roomId);
      return undefined;
    }
    return activity;
  }
  clear(roomId: string, activityId?: string): void {
    if (activityId && this.activities.get(roomId)?.payload.id !== activityId) return;
    this.activities.delete(roomId);
  }
}

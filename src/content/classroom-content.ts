/** Activity data returned by the server for the selected course, week and day. */
export type ActivityType = "presentation" | "challenge" | "briefing" | "game" | "display_room";

export interface ClassroomActivity {
  activityId: number;
  activityOrder: number;
  activityType: ActivityType;
  activityKey: string | null;
  title: string;
  description: string;
  assetPath: string | null;
}

export interface ClassroomContent {
  courseCode: string;
  courseTitle: string;
  weekId: number;
  weekNumber: number;
  weekTitle: string;
  dayId: number;
  dayNumber: number;
  dayTitle: string;
  activities: ClassroomActivity[];
  videos: ClassroomActivity[];
}

/** Count only the supplied day; no local lesson list or shared mutable state. */
export function summarizeActivities(activities: readonly ClassroomActivity[]) {
  return {
    videos: activities.filter(activity => activity.activityType === "presentation").length,
    challenges: activities.filter(activity => activity.activityType === "challenge").length,
    games: activities.filter(activity => activity.activityType === "game").length,
    debriefs: activities.filter(activity => activity.activityType === "briefing").length,
  };
}

/** The queue is already sorted by activity order; advance within that sequence. */
export function findNextChallengeIndex(activities: readonly ClassroomActivity[], activeId?: number): number {
  const activeIndex = activities.findIndex(activity => activity.activityId === activeId);
  return activities.findIndex((activity, index) => index > activeIndex && activity.activityType === "challenge");
}

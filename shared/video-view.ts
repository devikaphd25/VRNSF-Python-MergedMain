export type VideoView = 'classroom' | 'black_theater';

/** Selected per video in Supabase activities.activity_key. */
export function videoViewForActivity(activity: { activity_type?: string; activity_key?: string | null }): VideoView {
  return activity.activity_type === 'video' && activity.activity_key === 'video_black_theater' ? 'black_theater' : 'classroom';
}

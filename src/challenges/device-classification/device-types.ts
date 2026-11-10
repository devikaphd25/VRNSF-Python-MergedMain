/** Shapes of device data supplied by the classroom server from Supabase. */
export type Challenge2Category = "input" | "output" | "both" | "storage";

export type Challenge2Item = {
  id: string;
  name: string;
  imagePath?: string;
  modelPath?: string;
  modelRotationY?: number;
  category: Challenge2Category;
  feedback: string;
};

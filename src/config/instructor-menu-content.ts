/**
 * Instructor menu content model and lesson-page loader.
 * Goal: translate Supabase activities rows into three-button lesson pages
 * (presentation, challenge, briefing) shown by instructor-menu.system.ts.
 */
export type InstructorTaskAction = "presentation" | "challenge" | "briefing";

export type InstructorTaskContent = {
  activityId?: number;
  sourceActivityId?: number;
  unavailableReason?: string;
  buttonId: string;
  typeId: string;
  titleId: string;
  descriptionId: string;
  type: string;
  title: string;
  description: string;
  action: InstructorTaskAction;
  assetPath?: string | null;
};

export type InstructorLessonContent = {
  pageId: string;
  labelId: string;
  label: string;
  tasks: InstructorTaskContent[];
};

// Menu copy lives here instead of inside the behavior system. Later this
// array can be replaced by rows returned from Supabase without changing the
// dashboard pagination or button handlers.
export const INSTRUCTOR_LESSONS: InstructorLessonContent[] = [
  {
    pageId: "lesson-page-1",
    labelId: "lesson-1-label",
    label: "LESSON 1 - LITERAL COMPUTERS AND THE FIVE COMPUTER PARTS",
    tasks: [
      {
        buttonId: "presentation-mode-button",
        typeId: "lesson-1-task-1-type",
        titleId: "lesson-1-task-1-title",
        descriptionId: "lesson-1-task-1-description",
        type: "VIDEO",
        title: "Literal Computers and the Five Computer Parts",
        description: "Present CPU, RAM, storage, input, and output",
        action: "presentation"
      },
      {
        buttonId: "quick-challenge-button",
        typeId: "lesson-1-task-2-type",
        titleId: "lesson-1-task-2-title",
        descriptionId: "lesson-1-task-2-description",
        type: "CHALLENGE",
        title: "Five Parts Challenge",
        description: "Identify the job of each computer component",
        action: "challenge"
      },
      {
        buttonId: "class-mode-button",
        typeId: "lesson-1-task-3-type",
        titleId: "lesson-1-task-3-title",
        descriptionId: "lesson-1-task-3-description",
        type: "BRIEFING",
        title: "Five Parts Debrief",
        description: "Review the five-part computer model",
        action: "briefing",
        assetPath: "/images/briefings/week-1/five-parts-of-every-computer-debrief.png"
      }
    ]
  },
  {
    pageId: "lesson-page-2",
    labelId: "lesson-2-label",
    label: "LESSON 2 - LOADING AND CLASSIFICATION",
    tasks: [
      {
        buttonId: "task-lesson2-video",
        typeId: "lesson-2-task-1-type",
        titleId: "lesson-2-task-1-title",
        descriptionId: "lesson-2-task-1-description",
        type: "PRESENTATION",
        title: "Loading and Classification",
        description: "Present storage, RAM, CPU, hardware, and software",
        action: "presentation"
      },
      {
        buttonId: "task-lesson2-challenge",
        typeId: "lesson-2-task-2-type",
        titleId: "lesson-2-task-2-title",
        descriptionId: "lesson-2-task-2-description",
        type: "CHALLENGE",
        title: "Loading and Classification Challenge",
        description: "Check how programs load and components are classified",
        action: "challenge"
      },
      {
        buttonId: "task-lesson2-briefing",
        typeId: "lesson-2-task-3-type",
        titleId: "lesson-2-task-3-title",
        descriptionId: "lesson-2-task-3-description",
        type: "DEBRIEF",
        title: "Loading and Classification Debrief",
        description: "Review program loading, hardware, and software",
        action: "briefing",
        assetPath: "/images/briefings/week-1/loading-and-classification-debrief.png"
      }
    ]
  }
];

/** Local mapping: Five Parts series in slot 1, original single-question quiz in slot 3. */
function moveCurrentChallengeToThirdSlot(): void {
  const first = INSTRUCTOR_LESSONS[0]?.tasks.find(task => task.action === "challenge");
  const third = INSTRUCTOR_LESSONS[2]?.tasks.find(task => task.action === "challenge");
  if (!first || !third) return;
  third.sourceActivityId = first.activityId;
  third.title = "Challenge 3 — Computer Parts Quiz";
  third.description = "Identify the job of each computer component";
  first.title = "Challenge 1 — Computer Parts: True or False";
  first.description = "Answer five True/False questions about computer components";
  const second = INSTRUCTOR_LESSONS[1]?.tasks.find(task => task.action === "challenge");
  if (second) {
    second.title = "Challenge 2 — Devices In & Out";
    second.description = "Sort devices into input, output, both, or storage";
  }
  delete first.unavailableReason;
}

INSTRUCTOR_LESSONS.push({
  pageId: "lesson-page-3", labelId: "lesson-3-label",
  label: "LESSON 3 - LANGUAGE LADDER AND TRANSLATORS",
  tasks: [
    { buttonId: "task-lesson3-video", typeId: "lesson-3-task-1-type", titleId: "lesson-3-task-1-title", descriptionId: "lesson-3-task-1-description", type: "PRESENTATION", title: "Language Ladder and Translators", description: "Review programming languages and translators", action: "presentation" },
    { buttonId: "task-lesson3-challenge", typeId: "lesson-3-task-2-type", titleId: "lesson-3-task-2-title", descriptionId: "lesson-3-task-2-description", type: "CHALLENGE", title: "Five Parts Challenge", description: "Identify the job of each computer component", action: "challenge" },
    { buttonId: "task-lesson3-briefing", typeId: "lesson-3-task-3-type", titleId: "lesson-3-task-3-title", descriptionId: "lesson-3-task-3-description", type: "DEBRIEF", title: "Language Ladder Debrief", description: "Review programming languages and translators", action: "briefing", assetPath: "/images/briefings/week-1/language-ladder-and-translators-debrief.png" }
  ]
});
moveCurrentChallengeToThirdSlot();

// Option 2 loads its videos separately. Preserve local challenges/debriefs before
// the presentation system replaces the legacy shared lesson array from Supabase.
export const OPTION2_LOCAL_LESSONS: InstructorLessonContent[] = INSTRUCTOR_LESSONS.map(
  lesson => ({ ...lesson, tasks: lesson.tasks.map(task => ({ ...task })) })
);

export type InstructorContentResponse = {
  weekNumber: number;
  weekTitle: string;
  activities?: Array<NonNullable<InstructorContentResponse["lessons"]>[number]["activities"][number]>;
  lessons?: Array<{
    lessonNumber: number;
    title: string;
    activities: Array<{
      activityId: number;
      activityType: InstructorTaskAction | "game";
      title: string;
      description: string;
      assetPath?: string | null;
      environmentPath?: string | null;
      durationSeconds?: number | null;
    }>;
  }>;
};

export function replaceInstructorLessons(content: InstructorContentResponse): void {
  const groups=['presentation','challenge','briefing'].map(type=>(content.activities??[]).filter(a=>a.activityType===type));
  const pages=Array.from({length:Math.max(0,...groups.map(g=>g.length))},(_,i)=>({
    pageId:`lesson-page-${i+1}`,labelId:`lesson-${i+1}-label`,label:content.weekTitle,
    tasks:groups.flatMap((group,j)=>group[i]?[{
      activityId:group[i].activityId,buttonId:i===0?['presentation-mode-button','quick-challenge-button','class-mode-button'][j]:`task-lesson${i+1}-${['video','challenge','briefing'][j]}`,
      typeId:`lesson-${i+1}-task-${j+1}-type`,titleId:`lesson-${i+1}-task-${j+1}-title`,descriptionId:`lesson-${i+1}-task-${j+1}-description`,
      type:group[i].activityType.toUpperCase(),title:group[i].title,description:group[i].description??'',
      action:group[i].activityType as InstructorTaskAction,assetPath:group[i].assetPath,
    }]:[])
  }));
  INSTRUCTOR_LESSONS.splice(0,INSTRUCTOR_LESSONS.length,...pages);
}

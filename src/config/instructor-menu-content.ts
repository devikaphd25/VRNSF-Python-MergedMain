export type InstructorTaskAction = "presentation" | "challenge" | "briefing";

export type InstructorTaskContent = {
  activityId?: number;
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
    label: "LESSON 1 - PYTHON BASICS",
    tasks: [
      {
        buttonId: "presentation-mode-button",
        typeId: "lesson-1-task-1-type",
        titleId: "lesson-1-task-1-title",
        descriptionId: "lesson-1-task-1-description",
        type: "VIDEO",
        title: "Watch Python Introduction",
        description: "Play the lesson video for all students",
        action: "presentation"
      },
      {
        buttonId: "quick-challenge-button",
        typeId: "lesson-1-task-2-type",
        titleId: "lesson-1-task-2-title",
        descriptionId: "lesson-1-task-2-description",
        type: "CHALLENGE",
        title: "Python Basics Challenge",
        description: "Start a short interactive class challenge",
        action: "challenge"
      },
      {
        buttonId: "class-mode-button",
        typeId: "lesson-1-task-3-type",
        titleId: "lesson-1-task-3-title",
        descriptionId: "lesson-1-task-3-description",
        type: "BRIEFING",
        title: "Review and Briefing",
        description: "Return to class and discuss the results",
        action: "briefing"
      }
    ]
  },
  {
    pageId: "lesson-page-2",
    labelId: "lesson-2-label",
    label: "LESSON 2 - VARIABLES",
    tasks: [
      {
        buttonId: "task-lesson2-video",
        typeId: "lesson-2-task-1-type",
        titleId: "lesson-2-task-1-title",
        descriptionId: "lesson-2-task-1-description",
        type: "VIDEO",
        title: "Variables and Data Types",
        description: "Present the next instructional video",
        action: "presentation"
      },
      {
        buttonId: "task-lesson2-challenge",
        typeId: "lesson-2-task-2-type",
        titleId: "lesson-2-task-2-title",
        descriptionId: "lesson-2-task-2-description",
        type: "CHALLENGE",
        title: "Variable Builder",
        description: "Test variables with an interactive activity",
        action: "challenge"
      },
      {
        buttonId: "task-lesson2-briefing",
        typeId: "lesson-2-task-3-type",
        titleId: "lesson-2-task-3-title",
        descriptionId: "lesson-2-task-3-description",
        type: "BRIEFING",
        title: "Variables Review",
        description: "Discuss answers with the class",
        action: "briefing"
      }
    ]
  }
];

export type InstructorContentResponse = {
  weekNumber: number;
  weekTitle: string;
  lessons: Array<{
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
  const lessons = content.lessons.map((lesson, lessonIndex) => {
    const tasks = lesson.activities
      .filter(activity => activity.activityType !== "game")
      .slice(0, 3)
      .map((activity, taskIndex) => ({
        activityId: activity.activityId,
        buttonId:
          lessonIndex === 0
            ? ["presentation-mode-button", "quick-challenge-button", "class-mode-button"][taskIndex]
            : `task-lesson${lessonIndex + 1}-${activity.activityType}`,
        typeId: `lesson-${lessonIndex + 1}-task-${taskIndex + 1}-type`,
        titleId: `lesson-${lessonIndex + 1}-task-${taskIndex + 1}-title`,
        descriptionId: `lesson-${lessonIndex + 1}-task-${taskIndex + 1}-description`,
        type: activity.activityType.toUpperCase(),
        title: activity.title,
        description: activity.description,
        action: activity.activityType as InstructorTaskAction,
        assetPath: activity.assetPath
      }));

    return {
      pageId: `lesson-page-${lessonIndex + 1}`,
      labelId: `lesson-${lessonIndex + 1}-label`,
      label: `LESSON ${lesson.lessonNumber} - ${lesson.title.toUpperCase()}`,
      tasks
    };
  });

  if (lessons.length > 0) INSTRUCTOR_LESSONS.splice(0, INSTRUCTOR_LESSONS.length, ...lessons);
}

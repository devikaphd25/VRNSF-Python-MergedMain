import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  UIKit,
  UIKitDocument
} from "@iwsdk/core";

import {
  socket
} from "../network/socket";
import {
  INSTRUCTOR_LESSONS,
  InstructorTaskAction
} from "../config/instructor-menu-content";

type InstructorMode =
  | "Classroom Mode"
  | "Presentation Mode"
  | "Lab Mode"
  | "Quick Challenge";

interface DashboardStudent {
  id: string;
  userId?: number;
  name?: string;
  seat?: string;
  mode?: string;
  isDemo?: boolean;
  isDisconnected?: boolean;
  score?: number;
  accuracy?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  durationSeconds?: number;
  labReturnReason?: string;
  completedExercises?: number;
  totalExercises?: number;
  labStatus?: string;
  location?: string;
  inLab?: boolean;
  savedResult?: boolean;
  completedAt?: string;
}

interface QuizMonitorStudent {
  studentId: string;
  name: string;
  seat?: string;
  selectedIndex?: number | null;
  selectedOption?: string | null;
  correct?: boolean;
  answered?: boolean;
}

interface InstructorQuizPayload {
  id: string;
  question: string;
  options: string[];
  students?: QuizMonitorStudent[];
}

export class InstructorDashboardSystem extends createSystem({
  saveOverlay: {
    required: [
      PanelUI,
      PanelDocument
    ],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-save-report.json"
      )
    ]
  },
  dashboard: {
    required: [
      PanelUI,
      PanelDocument
    ],

    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-menu.json"
      )
    ]
  },

  menuButton: {
    required: [
      PanelUI,
      PanelDocument
    ],

    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-menu-button.json"
      )
    ]
  },

  labMonitor: {
    required: [
      PanelUI,
      PanelDocument
    ],

    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-lab-monitor.json"
      )
    ]
  },

  labMonitorButton: {
    required: [
      PanelUI,
      PanelDocument
    ],

    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-lab-monitor-button.json"
      )
    ]
  },

  mistakesPanel: {
    required: [
      PanelUI,
      PanelDocument
    ],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-mistakes.json"
      )
    ]
  },

  quizMonitor: {
    required: [PanelUI, PanelDocument],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-quiz-monitor.json"
      )
    ]
  }
}) {
  private dashboardDocument?: UIKitDocument;
  private labMonitorDocument?: UIKitDocument;
  private mistakesDocument?: UIKitDocument;
  private saveOverlayDocument?: UIKitDocument;
  private saveOverlayEntity?: any;
  private saveOverlayTimer?: number;
  private isEndingClass = false;
  private quizMonitorDocument?: UIKitDocument;
  private activeQuiz?: InstructorQuizPayload;
  private quizStudents: QuizMonitorStudent[] = [];

  private currentMode: InstructorMode =
    "Classroom Mode";

  private onlineStudents = 0;
  private latestStudents: DashboardStudent[] = [];
  private savedLabStudents: DashboardStudent[] = [];
  private hasLabResults = false;
  private hasObservedActiveLabStudent = false;
  private activeLessonPage = 0;

  // ======================================================
  // INITIALIZATION
  // ======================================================

  init(): void {
    console.log(
      "[InstructorDashboard] System started"
    );

    this.connectSocketEvents();

    this.queries.saveOverlay.subscribe(
      "qualify",
      entity => {
        this.saveOverlayEntity = entity;
        this.saveOverlayDocument =
          PanelDocument.data.document[
            entity.index
          ] as UIKitDocument;
      }
    );

    this.queries.menuButton.subscribe(
      "qualify",
      entity => {
        this.connectSmallMenuButton(
          entity.index
        );
      }
    );

    this.queries.dashboard.subscribe(
      "qualify",
      entity => {
        this.connectDashboard(
          entity.index
        );
      }
    );

    this.queries.labMonitor.subscribe(
      "qualify",
      entity => {
        this.connectLabMonitor(
          entity.index
        );
      }
    );

    this.queries.labMonitorButton.subscribe(
      "qualify",
      entity => {
        this.connectLabMonitorButton(
          entity.index
        );
      }
    );

    this.queries.mistakesPanel.subscribe(
      "qualify",
      entity => {
        this.connectMistakesPanel(
          entity.index
        );
      }
    );

    this.queries.quizMonitor.subscribe(
      "qualify",
      entity => this.connectQuizMonitor(entity.index)
    );

    socket.on(
      "labReportSaved",
      data => {
        this.showSaveOverlayResult(
          Boolean(data?.success),
          data?.success
            ? "Report saved successfully"
            : `Save failed: ${data?.message ?? "Unknown error"}`
        );

        const status =
          this.labMonitorDocument
            ?.getElementById(
              "lab-monitor-save-status"
            ) as UIKit.Text;

        status?.setProperties({
          text:
            data?.success
              ? `Saved in lab/${data.fileName}`
              : `Save failed: ${data?.message ?? "Unknown error"}`
        });

        this.syncDocument(
          this.labMonitorDocument
        );
      }
    );

    socket.on(
      "labMistakesReport",
      data => {
        this.renderMistakesReport(data);
      }
    );
  }

  // ======================================================
  // SOCKET EVENTS
  // ======================================================

  private connectSocketEvents(): void {
    socket.on(
      "studentList",
      (
        students: DashboardStudent[]
      ) => {
        this.latestStudents = students;
        this.updateStudentCount(
          students
        );
        this.updateLabMonitor();
      }
    );

    socket.on(
      "allStudentsModeChanged",
      data => {
        if (!data?.mode) {
          return;
        }

        this.setCurrentMode(
          data.mode
        );
      }
    );

    socket.on(
      "allStudentsReturnedToClass",
      () => {
        this.setCurrentMode(
          "Classroom Mode"
        );

        if (this.hasLabResults) {
          this.setLabMonitorVisible(false);
          this.setLabMonitorAvailable(true);
        }
      }
    );

    socket.on(
      "studentLabCompleted",
      () => {
        this.hasLabResults = true;
        this.hasObservedActiveLabStudent = true;
        // Keep the launcher hidden while the student is still in the game.
        // It becomes available after studentReturnedFromLab (or return-all).
        this.setLabMonitorAvailable(false);
      }
    );

    socket.on(
      "studentReturnedFromLab",
      () => {
        this.hasLabResults = true;
        this.hasObservedActiveLabStudent = true;
        this.setLabMonitorAvailable(true);
        socket.emit("requestStudentList");
      }
    );

    socket.on(
      "savedLabResults",
      (data: { results?: any[]; error?: string }) => {
        this.savedLabStudents = (data?.results ?? []).map(result => ({
          id: `saved-${result.id}`,
          userId: Number(result.userId),
          name: result.name,
          seat: result.seat,
          score: Number(result.score) || 0,
          durationSeconds: Number(result.durationSeconds) || 0,
          labStatus: result.status,
          completedExercises: result.status === "completed" ? 12 : 0,
          totalExercises: 12,
          isDisconnected: true,
          savedResult: true,
          completedAt: result.completedAt,
        }));
        this.hasLabResults = this.savedLabStudents.length > 0 || this.hasLabResults;
        // Historical rows populate the report but must not reveal the icon at
        // startup. The current session's return event controls visibility.
        this.setLabMonitorAvailable(false);
        this.updateLabMonitor();
      }
    );

    socket.on(
      "quickChallengeStartedForInstructor",
      (data: InstructorQuizPayload) => {
        this.activeQuiz = data;
        this.quizStudents = (data.students ?? []).map(student => ({
          ...student,
          answered: false,
          selectedIndex: null,
          selectedOption: null
        }));
        this.renderQuizMonitor();
        this.setQuizMonitorVisible(true);
      }
    );

    socket.on(
      "quickChallengeStudentAnswered",
      data => {
        if (!this.activeQuiz || data?.quizId !== this.activeQuiz.id) return;
        const student = this.quizStudents.find(
          item => item.studentId === data.studentId
        );
        if (!student) return;

        student.answered = true;
        student.selectedIndex = data.selectedIndex ?? null;
        student.selectedOption = data.selectedOption ?? null;
        student.correct = Boolean(data.correct);
        this.renderQuizMonitor();
      }
    );

    socket.on(
      "quickChallengeEnded",
      () => {
        this.setCurrentMode("Classroom Mode");
        this.showStatusMessage("Quick challenge finished");
        this.renderQuizMonitor(true);
      }
    );
  }

  // ======================================================
  // SMALL FLOATING MENU BUTTON
  // ======================================================

  private connectSmallMenuButton(
    entityIndex: number
  ): void {
    const document =
      PanelDocument.data.document[
        entityIndex
      ] as UIKitDocument;

    if (!document) {
      console.error(
        "[InstructorDashboard] Small menu document not found"
      );

      return;
    }

    const openButton =
      document.getElementById(
        "instructor-menu-open-button"
      );

    if (!openButton) {
      console.error(
        "[InstructorDashboard] Open button not found"
      );

      return;
    }

    openButton.addEventListener(
      "click",
      () => {
        this.setDashboardVisible(
          true
        );
      }
    );

    console.log(
      "[InstructorDashboard] Small menu button connected"
    );
  }

  // ======================================================
  // MAIN DASHBOARD
  // ======================================================

  private connectDashboard(
    entityIndex: number
  ): void {
    const document =
      PanelDocument.data.document[
        entityIndex
      ] as UIKitDocument;

    if (!document) {
      console.error(
        "[InstructorDashboard] Dashboard document not found"
      );

      return;
    }

    this.dashboardDocument =
      document;

    this.applyConfiguredMenuContent();
    this.connectCloseButton();
    this.connectModeButtons();
    this.connectExtendedMenuButtons();
    this.connectTaskScrollControls();
    this.connectEndClassControls();
    this.updateModeDisplay();
    this.updateOnlineCountDisplay();

    socket.emit(
      "requestStudentList"
    );

    console.log(
      "[InstructorDashboard] Dashboard connected"
    );
  }

  // ======================================================
  // CLOSE BUTTON
  // ======================================================

  private connectCloseButton(): void {
    const closeButton =
      this.dashboardDocument
        ?.getElementById(
          "dashboard-close-button"
        );

    if (closeButton && this.dashboardDocument) {
      this.bindSpatialButton(
        this.dashboardDocument,
        "dashboard-close-button",
      () => {
        this.setDashboardVisible(
          false
        );
      }
      );
    }
  }

  private connectEndClassControls(): void {
    const document = this.dashboardDocument;
    if (!document) return;

    const endButton = document.getElementById("end-class-button");
    const confirmRow = document.getElementById("end-class-confirm-row");

    const showConfirmation = (visible: boolean): void => {
      if (!endButton || !confirmRow) return;
      if (visible) {
        endButton.classList.add("is-hidden");
        confirmRow.classList.remove("is-hidden");
        this.showStatusMessage("Confirm that you want to end the class");
      } else {
        endButton.classList.remove("is-hidden");
        confirmRow.classList.add("is-hidden");
        this.showStatusMessage("Class remains active");
      }
      this.syncDocument(document);
    };

    this.bindSpatialButton(document, "end-class-button", () => {
      if (!this.isEndingClass) showConfirmation(true);
    });

    this.bindSpatialButton(document, "end-class-cancel-button", () => {
      if (!this.isEndingClass) showConfirmation(false);
    });

    this.bindSpatialButton(document, "end-class-confirm-button", () => {
      if (this.isEndingClass) return;
      this.isEndingClass = true;
      this.showStatusMessage("Ending class for everyone...");

      socket.emit(
        "endClass",
        {},
        (response?: { success?: boolean; message?: string }) => {
          if (response?.success) return;
          this.isEndingClass = false;
          this.showStatusMessage(
            response?.message ?? "Could not end the class. Please try again."
          );
          showConfirmation(false);
        }
      );
    });
  }

  private connectLabMonitor(
    entityIndex: number
  ): void {
    const document =
      PanelDocument.data.document[
        entityIndex
      ] as UIKitDocument;

    if (!document) {
      return;
    }

    this.labMonitorDocument = document;

    this.bindSpatialButton(
      document,
      "lab-monitor-close-button",
      () => {
        this.setLabMonitorVisible(false);
      }
    );

    this.bindSpatialButton(
      document,
      "lab-monitor-save-button",
      () => {
          this.showSaveOverlaySaving();
          const status =
            document.getElementById(
              "lab-monitor-save-status"
            ) as UIKit.Text;

          status?.setProperties({
            text: "Saving CSV..."
          });
          this.syncDocument(document);
          socket.emit("saveLabReport");
      }
    );

    this.bindSpatialButton(
      document,
      "lab-monitor-mistakes-button",
      () => {
          const setter =
            (window as any)
              .setInstructorMistakesOpen;
          setter?.(true);
          socket.emit(
            "requestLabMistakes"
          );
      }
    );

    this.updateLabMonitor();
    socket.emit("requestSavedLabResults");
  }

  private connectQuizMonitor(entityIndex: number): void {
    const document = PanelDocument.data.document[
      entityIndex
    ] as UIKitDocument;
    if (!document) return;

    this.quizMonitorDocument = document;
    this.bindSpatialButton(
      document,
      "quiz-monitor-close",
      () => this.setQuizMonitorVisible(false)
    );
    this.renderQuizMonitor();
  }

  private renderQuizMonitor(finished = false): void {
    const document = this.quizMonitorDocument;
    if (!document) return;

    const question = document.getElementById(
      "quiz-monitor-question"
    ) as UIKit.Text;
    const summary = document.getElementById(
      "quiz-monitor-summary"
    ) as UIKit.Text;
    const footer = document.getElementById(
      "quiz-monitor-footer"
    ) as UIKit.Text;
    const answeredCount = this.quizStudents.filter(
      student => student.answered
    ).length;

    question?.setProperties({
      text: this.activeQuiz?.question ?? "Waiting for question"
    });
    summary?.setProperties({
      text: `${answeredCount} of ${this.quizStudents.length} students answered`
    });
    footer?.setProperties({
      text: finished
        ? "Challenge finished. Final responses are shown."
        : "The list updates as students submit."
    });

    for (let row = 1; row <= 10; row += 1) {
      const student = this.quizStudents[row - 1];
      const rowElement = document.getElementById(`quiz-monitor-row-${row}`);
      const name = document.getElementById(
        `quiz-monitor-name-${row}`
      ) as UIKit.Text;
      const answer = document.getElementById(
        `quiz-monitor-answer-${row}`
      ) as UIKit.Text;
      const result = document.getElementById(
        `quiz-monitor-result-${row}`
      ) as UIKit.Text;

      if (!student) {
        rowElement?.classList.add("quiz-row-hidden");
        continue;
      }

      rowElement?.classList.remove("quiz-row-hidden");
      result?.classList.remove("quiz-result-correct", "quiz-result-wrong");
      name?.setProperties({
        text: `${student.name}${student.seat ? `  ${student.seat}` : ""}`
      });

      if (!student.answered) {
        answer?.setProperties({ text: "Waiting for answer" });
        result?.setProperties({ text: "UNANSWERED" });
        continue;
      }

      const optionPrefix =
        student.selectedIndex === null || student.selectedIndex === undefined
          ? ""
          : `${String.fromCharCode(65 + student.selectedIndex)}. `;
      answer?.setProperties({
        text: student.selectedOption
          ? `${optionPrefix}${student.selectedOption}`
          : "No answer"
      });
      result?.setProperties({
        text: student.correct ? "CORRECT" : "WRONG"
      });
      result?.classList.add(
        student.correct ? "quiz-result-correct" : "quiz-result-wrong"
      );
    }

    this.syncDocument(document);
  }

  private bindSpatialButton(
    document: UIKitDocument,
    elementId: string,
    handler: () => void
  ): void {
    const button =
      document.getElementById(elementId);

    if (!button) {
      console.error(
        `[InstructorDashboard] Spatial button not found: ${elementId}`
      );
      return;
    }

    let lastActivation = 0;
    const activate = (): void => {
      const now = performance.now();
      if (now - lastActivation < 250) {
        return;
      }
      lastActivation = now;
      handler();
    };

    button.addEventListener("pointerdown", activate);
    button.addEventListener("click", activate);
  }

  private setSaveOverlayText(
    id: string,
    text: string
  ): void {
    const element =
      this.saveOverlayDocument
        ?.getElementById(id) as UIKit.Text;

    element?.setProperties({ text });
  }

  private showSaveOverlaySaving(): void {
    if (this.saveOverlayTimer) {
      window.clearTimeout(
        this.saveOverlayTimer
      );
    }

    this.setSaveOverlayText(
      "save-report-title",
      "Preparing Lab Report"
    );
    this.setSaveOverlayText(
      "save-report-message",
      "Collecting student results and mistakes"
    );
    this.setSaveOverlayText(
      "save-report-status",
      "Saving CSV files. Please wait..."
    );

    if (this.saveOverlayEntity?.object3D) {
      this.saveOverlayEntity.object3D.visible = true;
      this.saveOverlayEntity.object3D.updateMatrixWorld(true);
    }

    this.syncDocument(
      this.saveOverlayDocument
    );
  }

  private showSaveOverlayResult(
    success: boolean,
    message: string
  ): void {
    this.setSaveOverlayText(
      "save-report-title",
      success
        ? "Report Saved"
        : "Report Not Saved"
    );
    this.setSaveOverlayText(
      "save-report-message",
      message
    );
    this.setSaveOverlayText(
      "save-report-status",
      success
        ? "The CSV files are ready in the lab folder."
        : "Please try saving again."
    );

    if (this.saveOverlayEntity?.object3D) {
      this.saveOverlayEntity.object3D.visible = true;
      this.saveOverlayEntity.object3D.updateMatrixWorld(true);
    }

    this.syncDocument(
      this.saveOverlayDocument
    );

    this.saveOverlayTimer =
      window.setTimeout(() => {
        if (this.saveOverlayEntity?.object3D) {
          this.saveOverlayEntity.object3D.visible = false;
          this.saveOverlayEntity.object3D.updateMatrixWorld(true);
        }
      }, success ? 2200 : 3500);
  }

  private connectLabMonitorButton(
    entityIndex: number
  ): void {
    const document =
      PanelDocument.data.document[
        entityIndex
      ] as UIKitDocument;

    document
      ?.getElementById(
        "lab-results-open-button"
      )
      ?.addEventListener(
        "click",
        (event: any) => {
          event?.stopPropagation?.();
          socket.emit("requestSavedLabResults");
          this.setLabMonitorVisible(true);
        }
      );
  }

  private connectMistakesPanel(
    entityIndex: number
  ): void {
    this.mistakesDocument =
      PanelDocument.data.document[
        entityIndex
      ] as UIKitDocument;

    if (this.mistakesDocument) {
      this.bindSpatialButton(
        this.mistakesDocument,
        "mistakes-close-button",
        () => {
          const setter =
            (window as any)
              .setInstructorMistakesOpen;
          setter?.(false);
        }
      );
    }
  }

  private renderMistakesReport(
    data: any
  ): void {
    if (!this.mistakesDocument) {
      return;
    }

    const mistakes =
      Array.isArray(data?.mistakes)
        ? data.mistakes.slice(0, 5)
        : [];

    const summary =
      this.mistakesDocument
        .getElementById(
          "mistakes-summary"
        ) as UIKit.Text;

    summary?.setProperties({
      text:
        data?.totalMistakes > 0
          ? `${data.totalMistakes} incorrect attempts across the class`
          : "No mistakes reported"
    });

    for (let index = 0; index < 5; index += 1) {
      const item = mistakes[index];
      const row = index + 1;
      const set = (
        id: string,
        text: string
      ) => {
        const element =
          this.mistakesDocument
            ?.getElementById(
              `${id}-${row}`
            ) as UIKit.Text;
        element?.setProperties({ text });
      };

      set(
        "mistake-question",
        item?.question ?? "—"
      );
      set(
        "mistake-answer",
        item
          ? `Correct: ${item.correctType}`
          : "—"
      );
      set(
        "mistake-count",
        item
          ? `${item.count} mistakes`
          : "—"
      );
      set(
        "mistake-students",
        item
          ? item.students.join(", ")
          : "—"
      );
    }

    this.syncDocument(
      this.mistakesDocument
    );
  }

  update(): void {
    if (
      !(window as any)
        .isInstructorLabMonitorAvailable ||
      (window as any)
        .isInstructorLabMonitorOpen
    ) {
      return;
    }

    const leftController =
      this.input?.xr?.gamepads?.left;

    if (
      leftController?.getButtonDown(
        "x-button"
      )
    ) {
      this.setLabMonitorVisible(true);
    }
  }

  // ======================================================
  // MODE BUTTONS
  // ======================================================

  private connectModeButtons(): void {
    this.connectButton(
      "class-mode-button",
      () => {
        this.activateClassMode();
      }
    );

    this.connectButton(
      "presentation-mode-button",
      () => {
        this.activatePresentationMode();
      }
    );

    this.connectButton(
      "lab-mode-button",
      () => {
        this.activateLabMode();
      }
    );

    this.connectButton(
      "quick-challenge-button",
      () => {
        this.activateQuickChallenge();
      }
    );
  }

  private connectExtendedMenuButtons(): void {
    INSTRUCTOR_LESSONS.slice(1).flatMap(lesson => lesson.tasks).forEach(task =>
      this.connectButton(task.buttonId, () => this.activateConfiguredTask(task.action))
    );
    this.connectButton(
      "game-space-quiz-button",
      () => this.activateTrueFalseChallenge()
    );
  }

  private connectTaskScrollControls(): void {
    this.connectButton("task-scroll-up", () => this.scrollTaskList(-260));
    this.connectButton("task-scroll-down", () => this.scrollTaskList(260));
  }

  private scrollTaskList(delta: number): void {
    const pageIds = INSTRUCTOR_LESSONS.map(lesson => lesson.pageId);
    const direction = delta < 0 ? -1 : 1;
    this.activeLessonPage = Math.max(
      0,
      Math.min(pageIds.length - 1, this.activeLessonPage + direction)
    );

    pageIds.forEach((id, index) => {
      const page = this.dashboardDocument?.getElementById(id);
      if (index === this.activeLessonPage) {
        page?.classList.remove("lesson-page-hidden");
      } else {
        page?.classList.add("lesson-page-hidden");
      }
    });

    this.showStatusMessage(`Lesson ${this.activeLessonPage + 1} tasks`);
    this.sync();
  }

  private activateConfiguredTask(action: InstructorTaskAction): void {
    if (action === "presentation") this.activatePresentationMode();
    if (action === "challenge") this.activateQuickChallenge();
    if (action === "briefing") this.activateClassMode();
  }

  private applyConfiguredMenuContent(): void {
    const setText = (id: string, value: string): void => {
      const element = this.dashboardDocument?.getElementById(id) as UIKit.Text;
      if (element) element.textContent = value;
    };

    INSTRUCTOR_LESSONS.forEach(lesson => {
      setText(lesson.labelId, lesson.label);
      lesson.tasks.forEach(task => {
        setText(task.typeId, task.type);
        setText(task.titleId, task.title);
        setText(task.descriptionId, task.description);
      });
    });
  }

  private connectButton(
    elementId: string,
    handler: () => void
  ): void {
    const button =
      this.dashboardDocument
        ?.getElementById(
          elementId
        );

    if (!button) {
      console.error(
        `[InstructorDashboard] Button not found: ${elementId}`
      );

      return;
    }

    this.bindSpatialButton(
      this.dashboardDocument!,
      elementId,
      handler
    );

    console.log(
      `[InstructorDashboard] Connected: ${elementId}`
    );
  }

  // ======================================================
  // CLASS MODE
  // ======================================================

  private activateClassMode(): void {
    console.log(
      "[InstructorDashboard] Activating Classroom Mode"
    );

    const returningStudentsFromLab =
      this.currentMode === "Lab Mode" ||
      Boolean(
        (window as any)
          .isInstructorLabMonitorAvailable
      );

    socket.emit(
      "instructorReturnAllToClass"
    );

    (window as any)
      .presentationSystem
      ?.exitPresentationMode?.();

    this.setCurrentMode(
      "Classroom Mode"
    );

    this.showStatusMessage(
      "Students returned to the classroom"
    );

    this.setDashboardVisible(false);

    if (returningStudentsFromLab) {
      /*
       * Preserve the final lab report when the instructor ends
       * the activity. Incoming studentList updates replace each
       * working row with its returned/completed final values.
       * Keep the report closed so its floating launcher appears
       * on the instructor's left controller.
       */
      this.setLabMonitorAvailable(true);
      this.setLabMonitorVisible(false);
    } else {
      this.setLabMonitorVisible(false);
      this.setLabMonitorAvailable(false);
    }
  }

  // ======================================================
  // PRESENTATION MODE
  // ======================================================

  private activatePresentationMode(): void {
    console.log(
      "[InstructorDashboard] Activating Presentation Mode"
    );

    socket.emit(
      "instructorSendAllToDestination",
      {
        destination:
          "Presentation"
      }
    );

    (window as any)
      .presentationSystem
      ?.enterPresentationMode?.();

    this.setCurrentMode(
      "Presentation Mode"
    );

    this.showStatusMessage(
      "Presentation mode started"
    );

    this.setDashboardVisible(false);
    this.setLabMonitorVisible(false);
    this.setLabMonitorAvailable(false);
  }

  // ======================================================
  // LAB MODE
  // ======================================================

  private activateLabMode(): void {
    console.log(
      "[InstructorDashboard] Activating Lab Mode"
    );

    /*
     * Your server currently uses "Game 1"
     * for the Python lab.
     */
    socket.emit(
      "instructorSendAllToDestination",
      {
        destination:
          "Game 1"
      }
    );

    this.setCurrentMode(
      "Lab Mode"
    );
    this.hasLabResults = false;
    this.hasObservedActiveLabStudent = false;

    this.showStatusMessage(
      "Students sent to the lab"
    );

    this.setDashboardVisible(false);
    this.setLabMonitorAvailable(false);
    this.setLabMonitorVisible(false);
  }

  // ======================================================
  // QUICK CHALLENGE
  // ======================================================

  private activateQuickChallenge(): void {
    console.log(
      "[InstructorDashboard] Starting Quick Challenge"
    );

    socket.emit(
      "instructorQuickChallenge",
      {
        durationSeconds: 60
      }
    );

    this.setCurrentMode(
      "Quick Challenge"
    );

    this.showStatusMessage(
      "Quick challenge started"
    );

    this.setDashboardVisible(false);
    this.setLabMonitorVisible(false);
    this.setLabMonitorAvailable(false);
  }

  private activateTrueFalseChallenge(): void {
    console.log("[InstructorDashboard] Starting True/False game");

    socket.emit("instructorQuickChallenge", {
      durationSeconds: 60,
      challengeType: "true-false"
    });

    this.setCurrentMode("Quick Challenge");
    this.showStatusMessage("True or False game started");
    this.setDashboardVisible(false);
    this.setLabMonitorVisible(false);
    this.setLabMonitorAvailable(false);
  }

  // ======================================================
  // STUDENT COUNT
  // ======================================================

  private updateStudentCount(
    students: DashboardStudent[]
  ): void {
    const onlineStudents =
      students.filter(
        student =>
          !student.isDemo &&
          !student.isDisconnected &&
          student.seat &&
          student.seat !==
            "Not selected"
      );

    this.onlineStudents =
      onlineStudents.length;

    this.updateOnlineCountDisplay();
    this.updateLabProgressDisplay();
    this.finishLabMonitorWhenEveryoneReturned();
  }

  private finishLabMonitorWhenEveryoneReturned(): void {
    if (
      this.currentMode !== "Lab Mode" ||
      !(window as any).isInstructorLabMonitorAvailable ||
      this.latestStudents.length === 0
    ) {
      return;
    }

    const hasActiveLabStudent =
      this.latestStudents.some(student =>
        !student.isDemo &&
        (
          student.inLab === true ||
          student.location === "python_lab" ||
          student.mode === "Game Mode" ||
          student.labStatus === "working"
        )
      );

    if (hasActiveLabStudent) {
      this.hasObservedActiveLabStudent = true;
      return;
    }

    /*
     * Ignore the initial student-list snapshots that can arrive
     * before the server has marked any student as being in the lab.
     * Otherwise the monitor closes immediately and the instructor
     * is incorrectly returned to Classroom Mode.
     */
    if (!this.hasObservedActiveLabStudent) {
      return;
    }

    /*
     * Everyone has finished or returned. Close the live panel,
     * but preserve the final report and its left-controller
     * launcher so the instructor can reopen it at any time.
     */
    this.setLabMonitorVisible(false);
    this.setLabMonitorAvailable(true);
    this.setCurrentMode("Classroom Mode");
  }

  private updateOnlineCountDisplay(): void {
    if (!this.dashboardDocument) {
      return;
    }

    const countText =
      this.dashboardDocument
        .getElementById(
          "online-student-count"
        ) as UIKit.Text;

    const countLabel =
      this.dashboardDocument
        .getElementById(
          "online-student-label"
        ) as UIKit.Text;

    countText?.setProperties({
      text:
        `${this.onlineStudents}`
    });

    countLabel?.setProperties({
      text:
        this.onlineStudents === 1
          ? "Student Online"
          : "Students Online"
    });

    this.sync();
  }

  private updateLabProgressDisplay(): void {
    if (!this.dashboardDocument) {
      return;
    }

    const progressText =
      this.dashboardDocument
        .getElementById(
          "lab-progress-text"
        ) as UIKit.Text;

    if (!progressText) {
      return;
    }

    const studentsByUser = new Map<number | string, DashboardStudent>();

    for (const student of this.savedLabStudents) {
      studentsByUser.set(student.userId ?? student.id, student);
    }

    // Prefer current live data for connected students. If a student logs out,
    // their saved Supabase result remains available in savedLabStudents.
    for (const student of this.latestStudents) {
      studentsByUser.set(student.userId ?? student.id, student);
    }

    const students =
      [...studentsByUser.values()]
        .filter(student =>
          !student.isDemo &&
          student.seat &&
          student.seat !== "Not selected"
        )
        .sort((a, b) =>
          String(a.seat).localeCompare(
            String(b.seat)
          )
        );

    const lines =
      students.map(student => {
        const completed =
          student.completedExercises ?? 0;

        const total =
          student.totalExercises ?? 12;

        const score =
          student.score ?? 0;

        const status =
          student.labStatus === "completed"
            ? "Finished"
            : student.mode === "Game Mode"
              ? "Working"
              : completed > 0
                ? "Returned"
                : "Classroom";

        return `${student.name ?? "Student"}: ${completed}/${total}  Score ${score}  ${status}`;
      });

    progressText.setProperties({
      text:
        lines.length > 0
          ? lines.join("\n")
          : "No student lab results yet"
    });

    this.sync();
  }

  private updateLabMonitor(): void {
    if (!this.labMonitorDocument) {
      return;
    }

    const studentsByUser = new Map<number | string, DashboardStudent>();
    for (const student of this.savedLabStudents) {
      studentsByUser.set(student.userId ?? student.id, student);
    }
    for (const student of this.latestStudents) {
      studentsByUser.set(student.userId ?? student.id, student);
    }

    const students =
      [...studentsByUser.values()]
        .filter(student =>
          !student.isDemo &&
          student.seat &&
          student.seat !== "Not selected"
        )
        .sort((a, b) =>
          String(a.seat).localeCompare(
            String(b.seat)
          )
        )
        .slice(0, 5);

    for (let index = 0; index < 5; index += 1) {
      const student = students[index];
      const row = index + 1;
      const rowElement =
        this.labMonitorDocument
          .getElementById(
            `lab-row-${row}`
          );

      if (student) {
        rowElement?.classList.remove(
          "student-row-hidden"
        );
      } else {
        rowElement?.classList.add(
          "student-row-hidden"
        );
      }

      const name =
        this.labMonitorDocument
          .getElementById(
            `lab-name-${row}`
          ) as UIKit.Text;

      const question =
        this.labMonitorDocument
          .getElementById(
            `lab-question-${row}`
          ) as UIKit.Text;

      const score =
        this.labMonitorDocument
          .getElementById(
            `lab-score-${row}`
          ) as UIKit.Text;

      const correct =
        this.labMonitorDocument
          .getElementById(
            `lab-correct-${row}`
          ) as UIKit.Text;

      const mistakes =
        this.labMonitorDocument
          .getElementById(
            `lab-wrong-${row}`
          ) as UIKit.Text;

      const time =
        this.labMonitorDocument
          .getElementById(
            `lab-time-${row}`
          ) as UIKit.Text;

      const status =
        this.labMonitorDocument
          .getElementById(
            `lab-status-${row}`
          ) as UIKit.Text;

      if (!student) {
        name?.setProperties({ text: "—" });
        question?.setProperties({ text: "—" });
        correct?.setProperties({ text: "OK 0" });
        mistakes?.setProperties({ text: "X 0" });
        score?.setProperties({ text: "—" });
        time?.setProperties({ text: "—" });
        status?.setProperties({ text: "Waiting" });
        continue;
      }

      const completed =
        student.completedExercises ?? 0;

      const total =
        student.totalExercises ?? 12;

      const currentQuestion =
        student.labStatus === "completed"
          ? total
          : Math.min(
              completed + 1,
              total
            );

      const statusLabel =
        student.labStatus === "completed"
            ? "Finished"
          : student.labStatus === "returned" ||
                student.labStatus === "instructor_return"
              ? "Returned by instructor"
            : student.isDisconnected
              ? "Offline"
            : student.mode === "Game Mode"
              ? "Working"
              : completed > 0
                ? "Returned"
                : "Waiting";

      name?.setProperties({
        text:
          `${student.name ?? "Student"}  ${student.seat ?? ""}`
      });

      question?.setProperties({
        text:
          `${currentQuestion} / ${total}`
      });

      score?.setProperties({
        text:
          `${student.score ?? 0}`
      });

      correct?.setProperties({
        text:
          `OK ${student.correctAnswers ?? 0}`
      });

      mistakes?.setProperties({
        text:
          `X ${student.wrongAnswers ?? 0}`
      });

      const duration =
        Math.max(
          0,
          student.durationSeconds ?? 0
        );
      const minutes =
        Math.floor(duration / 60);
      const seconds =
        duration % 60;

      time?.setProperties({
        text:
          `${minutes}:${String(seconds).padStart(2, "0")}`
      });

      status?.setProperties({
        text:
          statusLabel
      });
    }

    this.syncDocument(
      this.labMonitorDocument
    );
  }

  // ======================================================
  // CURRENT MODE
  // ======================================================

  private setCurrentMode(
    mode: InstructorMode
  ): void {
    this.currentMode =
      mode;

    this.updateModeDisplay();
    this.updateActiveButton();
  }

  private updateModeDisplay(): void {
    if (!this.dashboardDocument) {
      return;
    }

    const modeText =
      this.dashboardDocument
        .getElementById(
          "current-mode-text"
        ) as UIKit.Text;

    modeText?.setProperties({
      text:
        this.currentMode
    });

    this.sync();
  }

  private updateActiveButton(): void {
    if (!this.dashboardDocument) {
      return;
    }

    const buttonIds = [
      "class-mode-button",
      "presentation-mode-button",
      "lab-mode-button",
      "quick-challenge-button"
    ];

    buttonIds.forEach(
      buttonId => {
        const button =
          this.dashboardDocument
            ?.getElementById(
              buttonId
            );

        button?.classList.remove(
          "mode-button-active"
        );
      }
    );

    let activeButtonId =
      "class-mode-button";

    if (
      this.currentMode ===
      "Presentation Mode"
    ) {
      activeButtonId =
        "presentation-mode-button";
    } else if (
      this.currentMode ===
      "Lab Mode"
    ) {
      activeButtonId =
        "lab-mode-button";
    } else if (
      this.currentMode ===
      "Quick Challenge"
    ) {
      activeButtonId =
        "quick-challenge-button";
    }

    this.dashboardDocument
      .getElementById(
        activeButtonId
      )
      ?.classList.add(
        "mode-button-active"
      );

    this.sync();
  }

  // ======================================================
  // STATUS MESSAGE
  // ======================================================

  private showStatusMessage(
    message: string
  ): void {
    if (!this.dashboardDocument) {
      return;
    }

    const statusText =
      this.dashboardDocument
        .getElementById(
          "dashboard-status-text"
        ) as UIKit.Text;

    statusText?.setProperties({
      text: message
    });

    this.sync();

    setTimeout(
      () => {
        statusText?.setProperties({
          text:
            "Select a classroom activity"
        });

        this.sync();
      },
      3000
    );
  }

  // ======================================================
  // DASHBOARD VISIBILITY
  // ======================================================

  private setDashboardVisible(
    visible: boolean
  ): void {
    const setter =
      (window as any)
        .setInstructorDashboardOpen;

    if (
      typeof setter ===
      "function"
    ) {
      setter(
        visible
      );
    }
  }

  private setLabMonitorVisible(
    visible: boolean
  ): void {
    const setter =
      (window as any)
        .setInstructorLabMonitorOpen;

    if (typeof setter === "function") {
      setter(visible);
    }
  }

  private setQuizMonitorVisible(visible: boolean): void {
    const setter = (window as any).setInstructorQuizMonitorOpen;
    if (typeof setter === "function") setter(visible);
  }

  private setLabMonitorAvailable(
    available: boolean
  ): void {
    const setter =
      (window as any)
        .setInstructorLabMonitorAvailable;

    if (typeof setter === "function") {
      setter(available);
    }
  }

  // ======================================================
  // UI UPDATE
  // ======================================================

  private sync(): void {
    const document =
      this.dashboardDocument as any;

    if (
      typeof document
        ?.requestUpdate ===
      "function"
    ) {
      document.requestUpdate();
    }

    if (
      typeof document
        ?.update ===
      "function"
    ) {
      document.update();
    }
  }

  private syncDocument(
    document: any
  ): void {
    document?.requestUpdate?.();
    document?.update?.();
  }
}

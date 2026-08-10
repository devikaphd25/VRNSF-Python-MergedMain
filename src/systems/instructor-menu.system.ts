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
  replaceInstructorLessons,
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
  responseTimeSeconds?: number;
}

interface InstructorQuizPayload {
  id: string;
  question: string;
  options: string[];
  durationSeconds: number;
  startedAt: number;
  students?: QuizMonitorStudent[];
}

type InstructorResultType = "game" | "quick-challenge";

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
  private quizCountdownTimer?: number;
  private quizMonitorPage = 0;
  private readonly quizMonitorPageSize = 10;
  private quizMonitorFinished = false;
  private resultsButtonDocument?: UIKitDocument;
  private latestResultType: InstructorResultType = "game";

  private currentMode: InstructorMode =
    "Classroom Mode";
  private lastPresentationActivationAt = 0;

  private onlineStudents = 0;
  private latestStudents: DashboardStudent[] = [];
  private savedLabStudents: DashboardStudent[] = [];
  private hasLabResults = false;
  private hasObservedActiveLabStudent = false;
  private labResultsFinalized = false;
  private openLabMonitorAfterSavedResults = false;
  private activeLessonPage = 0;
  private labActivityStartedAt: number | null = null;
  private labActivityTimer?: number;
  private labActivityFinalElapsedSeconds = 0;
  private lastLabMonitorTraceSignature = "";
  private labMonitorPage = 0;
  private readonly labMonitorPageSize = 5;

  // ======================================================
  // INITIALIZATION
  // ======================================================

  init(): void {
    console.log(
      "[InstructorDashboard] System started"
    );

    this.connectSocketEvents();
    (window as any).advancePresentationToChallenge = () => {
      const challenge = INSTRUCTOR_LESSONS[this.activeLessonPage]?.tasks.find(
        task => task.action === "challenge"
      );
      (window as any).presentationSystem?.exitPresentationMode?.();
      socket.emit("instructorReturnAllToClass");
      window.setTimeout(() => this.activateQuickChallenge(challenge?.activityId), 250);
    };

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

        if (this.hasLabResults || this.hasObservedActiveLabStudent) {
          this.labResultsFinalized = true;
          this.setLatestResultType("game");
          this.hasLabResults = true;
          // The server emits this event only after all Stop Game result writes
          // have settled. Reload those authoritative rows before repainting.
          socket.emit("requestSavedLabResults");
          // Stop Game keeps the final report visible. At this point the
          // server has awaited all result writes, so the displayed rows are
          // the persisted snapshots rather than unfinished live rows.
          this.setLabMonitorVisible(true);
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
        this.setLatestResultType("game");
        this.hasLabResults = true;
        this.hasObservedActiveLabStudent = true;
        this.setLabMonitorAvailable(true);
        socket.emit("requestStudentList");
        socket.emit("requestSavedLabResults");
      }
    );

    // The server sends this only after Supabase has accepted the final row.
    // Refreshing here prevents an instructor-returned student's frozen time
    // from being replaced by a stale live value such as 0:00.
    socket.on(
      "labResultPersisted",
      (result: any) => {
        console.log("[LabTrace][Client] persisted event received", {
          userId: result?.userId,
          seat: result?.seat,
          durationSeconds: result?.durationSeconds,
          status: result?.status,
        });
        if (result?.userId) {
          const persistedStudent: DashboardStudent = {
            id: `persisted-${result.userId}`,
            userId: Number(result.userId),
            name: result.name ?? `Student ${result.userId}`,
            seat: result.seat ?? "Not selected",
            score: Number(result.score) || 0,
            durationSeconds: Number(result.durationSeconds) || 0,
            correctAnswers: Number(result.correctAnswers) || 0,
            wrongAnswers: Number(result.wrongAnswers) || 0,
            accuracy: Number(result.accuracy) || 0,
            labStatus: result.status ?? "instructor_return",
            completedExercises: Number(result.completedExercises) || 0,
            totalExercises: Number(result.totalExercises) || 12,
            isDisconnected: result.status === "disconnected",
            savedResult: true,
          };

          this.savedLabStudents = [
            persistedStudent,
            ...this.savedLabStudents.filter(student =>
              (persistedStudent.seat !== "Not selected" && student.seat)
                ? student.seat !== persistedStudent.seat
                : Number(student.userId) !== persistedStudent.userId
            ),
          ];
          this.hasLabResults = true;
          this.updateLabMonitor();
        }

        // Reconcile with the authoritative database row after applying the
        // final snapshot immediately to the visible monitor.
        socket.emit("requestSavedLabResults");
      }
    );

    socket.on(
      "savedLabResults",
      (data: { results?: any[]; error?: string }) => {
        console.log("[LabTrace][Client] Supabase rows received", {
          error: data?.error,
          rows: (data?.results ?? []).map(result => ({
            userId: result.userId,
            seat: result.seat,
            durationSeconds: result.durationSeconds,
            status: result.status,
            completedAt: result.completedAt,
          })),
        });
        this.savedLabStudents = (data?.results ?? []).map(result => ({
          id: `saved-${result.id}`,
          userId: Number(result.userId),
          name: result.name,
          seat: result.seat,
          score: Number(result.score) || 0,
          durationSeconds: Number(result.durationSeconds) || 0,
          correctAnswers: Number(result.correctAnswers) || 0,
          wrongAnswers: Number(result.wrongAnswers) || 0,
          accuracy: Number(result.accuracy) || 0,
          labStatus: result.status,
          completedExercises: Number(result.completedExercises) || 0,
          totalExercises: Number(result.totalExercises) || 12,
          isDisconnected: result.status === "disconnected",
          savedResult: true,
          completedAt: result.completedAt,
        }));
        this.hasLabResults = this.savedLabStudents.length > 0 || this.hasLabResults;
        // Historical rows populate the report without revealing the launcher
        // at startup. Once this session has run a lab, saved-result refreshes
        // must keep the floating Results button available.
        this.setLabMonitorAvailable(this.hasObservedActiveLabStudent);
        this.updateLabMonitor();
        if (this.openLabMonitorAfterSavedResults) {
          this.openLabMonitorAfterSavedResults = false;
          this.setLabMonitorVisible(true);
        }
      }
    );

    socket.on(
      "quickChallengeStartedForInstructor",
      (data: InstructorQuizPayload) => {
        this.activeQuiz = data;
        this.quizMonitorPage = 0;
        this.quizMonitorFinished = false;
        this.quizStudents = (data.students ?? []).map(student => ({
          ...student,
          answered: false,
          selectedIndex: null,
          selectedOption: null
        }));
        this.startQuizCountdown();
        this.renderQuizMonitor();
        this.setQuizMonitorVisible(true);
      }
    );

    socket.on(
      "quickChallengeStudentAnswered",
      data => {
        if (!this.activeQuiz || data?.quizId !== this.activeQuiz.id) return;
        if (data.selectedIndex === null || data.selectedIndex === undefined) {
          return;
        }
        const student = this.quizStudents.find(
          item => item.studentId === data.studentId
        );
        if (!student) return;

        student.answered = true;
        student.selectedIndex = data.selectedIndex ?? null;
        student.selectedOption = data.selectedOption ?? null;
        student.correct = Boolean(data.correct);
        const serverResponseTime = Number(data.responseTimeSeconds);
        const fallbackResponseTime = Math.max(
          0.1,
          (Date.now() - this.activeQuiz.startedAt) / 1000
        );
        student.responseTimeSeconds =
          Number.isFinite(serverResponseTime) && serverResponseTime > 0
            ? serverResponseTime
            : fallbackResponseTime;
        console.log("[Quick Challenge] Student response time", {
          student: student.name,
          seconds: student.responseTimeSeconds,
          source:
            Number.isFinite(serverResponseTime) && serverResponseTime > 0
              ? "server"
              : "instructor fallback",
        });
        this.renderQuizMonitor();
      }
    );

    socket.on(
      "quickChallengeEnded",
      () => {
        this.stopQuizCountdown();
        this.quizMonitorFinished = true;
        this.setCurrentMode("Classroom Mode");
        this.showStatusMessage("Quick challenge finished");
        this.renderQuizMonitor(true);
        this.setLatestResultType("quick-challenge");
        this.setLabMonitorAvailable(true);
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
    void this.loadInstructorMenuContent();
    this.connectCloseButton();
    this.connectModeButtons();
    this.connectExtendedMenuButtons();
    this.connectTaskScrollControls();
    this.connectEndClassControls();
    this.updateModeDisplay();
    this.updateOnlineCountDisplay();
    this.updateLabActivityControl();

    socket.emit(
      "requestStudentList"
    );

    console.log(
      "[InstructorDashboard] Dashboard connected"
    );
  }

  private async loadInstructorMenuContent(): Promise<void> {
    try {
      const response = await fetch("/api/instructor-content");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      replaceInstructorLessons(await response.json());
      this.activeLessonPage = Math.min(
        this.activeLessonPage,
        Math.max(0, INSTRUCTOR_LESSONS.length - 1)
      );
      this.renderLessonPage();
      console.log(
        `[InstructorDashboard] Loaded ${INSTRUCTOR_LESSONS.length} lessons from Supabase`
      );
    } catch (error) {
      console.error(
        "[InstructorDashboard] Supabase content unavailable; using local fallback",
        error
      );
    }
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
        this.addClass(endButton, "is-hidden");
        this.removeClass(confirmRow, "is-hidden");
        this.showStatusMessage("Confirm that you want to end the class");
      } else {
        this.removeClass(endButton, "is-hidden");
        this.addClass(confirmRow, "is-hidden");
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
      this.stopLabActivityTimer();
      this.setLabMonitorVisible(false);
      this.setLabMonitorAvailable(false);
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
      "lab-monitor-stop-button",
      () => {
        this.activateClassMode();
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

    this.bindSpatialButton(document, "lab-monitor-up-button", () => {
      this.labMonitorPage = Math.max(0, this.labMonitorPage - 1);
      this.updateLabMonitor();
    });

    this.bindSpatialButton(document, "lab-monitor-down-button", () => {
      const totalPages = Math.max(
        1,
        Math.ceil(this.getRankedLabStudents().length / this.labMonitorPageSize)
      );
      this.labMonitorPage = Math.min(totalPages - 1, this.labMonitorPage + 1);
      this.updateLabMonitor();
    });

    this.updateLabMonitor();
    this.updateLabActivityControl();
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
      () => {
        this.setQuizMonitorVisible(false);
        this.setLatestResultType("quick-challenge");
        this.setLabMonitorAvailable(true);
      }
    );
    this.bindSpatialButton(document, "quiz-monitor-stop", () => {
      if (!this.activeQuiz || this.quizMonitorFinished) return;
      socket.emit("stopQuickChallenge", { quizId: this.activeQuiz.id });
      this.showStatusMessage("Stopping quick challenge...");
    });
    this.bindSpatialButton(document, "quiz-monitor-up", () => {
      this.quizMonitorPage = Math.max(0, this.quizMonitorPage - 1);
      this.renderQuizMonitor();
    });
    this.bindSpatialButton(document, "quiz-monitor-down", () => {
      const totalPages = Math.max(
        1,
        Math.ceil(this.quizStudents.length / this.quizMonitorPageSize)
      );
      this.quizMonitorPage = Math.min(totalPages - 1, this.quizMonitorPage + 1);
      this.renderQuizMonitor();
    });
    this.renderQuizMonitor();
  }

  private renderQuizMonitor(finished = this.quizMonitorFinished): void {
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
    const timer = document.getElementById(
      "quiz-monitor-timer"
    ) as UIKit.Text;
    const pageLabel = document.getElementById(
      "quiz-monitor-page"
    ) as UIKit.Text;
    const answeredCount = this.quizStudents.filter(
      student => student.answered
    ).length;
    const rankedStudents = [...this.quizStudents].sort((left, right) => {
      const leftGroup = !left.answered ? 2 : left.correct ? 0 : 1;
      const rightGroup = !right.answered ? 2 : right.correct ? 0 : 1;
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      if (left.answered && right.answered) {
        return (left.responseTimeSeconds ?? Number.MAX_SAFE_INTEGER) -
          (right.responseTimeSeconds ?? Number.MAX_SAFE_INTEGER);
      }
      return 0;
    });
    const winnerId = rankedStudents.find(
      student => student.answered && student.correct
    )?.studentId;
    const correctRankByStudent = new Map(
      rankedStudents
        .filter(student => student.answered && student.correct)
        .map((student, index) => [student.studentId, index + 1])
    );
    const totalPages = Math.max(
      1,
      Math.ceil(rankedStudents.length / this.quizMonitorPageSize)
    );
    this.quizMonitorPage = Math.min(this.quizMonitorPage, totalPages - 1);
    const pageStart = this.quizMonitorPage * this.quizMonitorPageSize;
    const pageStudents = rankedStudents.slice(
      pageStart,
      pageStart + this.quizMonitorPageSize
    );

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
    timer?.setProperties({
      text: finished ? "00:00" : this.getQuizCountdownText()
    });
    pageLabel?.setProperties({
      text: `PAGE ${this.quizMonitorPage + 1} / ${totalPages}`
    });

    for (let row = 1; row <= 10; row += 1) {
      const student = pageStudents[row - 1];
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
      const responseTime = document.getElementById(
        `quiz-monitor-time-${row}`
      ) as UIKit.Text;
      const rank = document.getElementById(
        `quiz-monitor-rank-${row}`
      ) as UIKit.Text;

      if (!student) {
        this.addClass(rowElement, "quiz-row-hidden");
        continue;
      }

      this.removeClass(rowElement, "quiz-row-hidden");
      this.removeClass(result, "quiz-result-correct", "quiz-result-wrong");
      const correctRank = correctRankByStudent.get(student.studentId);
      rank?.setProperties({
        // Wrong and unanswered submissions do not receive a placement.
        // Therefore stopping a challenge with no correct answers shows no
        // rank for every student.
        text: correctRank ? this.formatOrdinal(correctRank) : "—"
      });
      name?.setProperties({
        text: `${student.name}${student.seat ? `  ${student.seat}` : ""}`
      });

      if (!student.answered) {
        answer?.setProperties({ text: "Waiting for answer" });
        responseTime?.setProperties({ text: "—" });
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
      responseTime?.setProperties({
        text: `${(student.responseTimeSeconds ?? 0).toFixed(1)}s`
      });
      result?.setProperties({
        text:
          student.studentId === winnerId
            ? "WINNER"
            : student.correct
              ? "CORRECT"
              : "WRONG"
      });
      this.addClass(
        result,
        student.correct ? "quiz-result-correct" : "quiz-result-wrong"
      );
    }

    this.syncDocument(document);
  }

  private formatOrdinal(value: number): string {
    const remainder100 = value % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
    switch (value % 10) {
      case 1: return `${value}st`;
      case 2: return `${value}nd`;
      case 3: return `${value}rd`;
      default: return `${value}th`;
    }
  }

  private startQuizCountdown(): void {
    this.stopQuizCountdown();
    this.updateQuizCountdown();
    this.quizCountdownTimer = window.setInterval(
      () => this.updateQuizCountdown(),
      250
    );
  }

  private stopQuizCountdown(): void {
    if (this.quizCountdownTimer !== undefined) {
      window.clearInterval(this.quizCountdownTimer);
      this.quizCountdownTimer = undefined;
    }
  }

  private updateQuizCountdown(): void {
    const timer = this.quizMonitorDocument?.getElementById(
      "quiz-monitor-timer"
    ) as UIKit.Text;
    timer?.setProperties({ text: this.getQuizCountdownText() });
    this.syncDocument(this.quizMonitorDocument);
  }

  private getQuizCountdownText(): string {
    if (!this.activeQuiz) return "00:00";
    const elapsed = Math.floor((Date.now() - this.activeQuiz.startedAt) / 1000);
    const remaining = Math.max(0, this.activeQuiz.durationSeconds - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
    const activate = (event?: any): void => {
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
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

    this.resultsButtonDocument = document;
    this.updateResultsButtonLabel();

    document
      ?.getElementById(
        "lab-results-open-button"
      )
      ?.addEventListener(
        "click",
        (event: any) => {
          event?.stopPropagation?.();
          if (this.latestResultType === "quick-challenge") {
            this.setLabMonitorAvailable(false);
            this.renderQuizMonitor(true);
            this.setQuizMonitorVisible(true);
            return;
          }

          if (this.currentMode === "Lab Mode") {
            // During an active game, the live socket rows are authoritative.
            this.setLabMonitorVisible(true);
            return;
          }

          // After Stop Game, never reveal cached live rows. Wait for the
          // authoritative Supabase response, then open the monitor.
          this.labResultsFinalized = true;
          this.openLabMonitorAfterSavedResults = true;
          this.setLabMonitorVisible(false);
          socket.emit("requestSavedLabResults");
        }
      );
  }

  private setLatestResultType(type: InstructorResultType): void {
    this.latestResultType = type;
    this.updateResultsButtonLabel();
  }

  private updateResultsButtonLabel(): void {
    const icon = this.resultsButtonDocument?.getElementById(
      "activity-results-icon"
    ) as UIKit.Text | undefined;
    const label = this.resultsButtonDocument?.getElementById(
      "activity-results-label"
    ) as UIKit.Text | undefined;

    if (icon) {
      icon.setProperties({
        text: this.latestResultType === "game" ? "GAME" : "QUICK"
      });
    }
    if (label) {
      label.setProperties({
        text:
          this.latestResultType === "game"
            ? "RESULTS"
            : "CHALLENGE RESULTS"
      });
    }
    this.syncDocument(this.resultsButtonDocument);
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
        this.activateConfiguredTask("briefing");
      }
    );

    this.connectButton(
      "presentation-mode-button",
      () => {
        this.activateConfiguredTask("presentation");
      }
    );

    this.connectButton(
      "lab-mode-button",
      () => {
        this.toggleLabActivity();
      }
    );

    this.connectButton(
      "quick-challenge-button",
      () => {
        this.activateConfiguredTask("challenge");
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
    this.connectButton("task-scroll-up", () => this.changeLessonPage(-1));
    this.connectButton("task-scroll-down", () => this.changeLessonPage(1));
    this.renderLessonPage();
  }

  private changeLessonPage(direction: -1 | 1): void {
    const pageIds = INSTRUCTOR_LESSONS.map(lesson => lesson.pageId);
    const nextPage = Math.max(
      0,
      Math.min(pageIds.length - 1, this.activeLessonPage + direction)
    );

    if (nextPage === this.activeLessonPage) {
      this.showStatusMessage(
        direction < 0
          ? "Already at Lesson 1"
          : `Already at Lesson ${pageIds.length}`
      );
      this.updateLessonScrollButtons(pageIds.length);
      this.sync();
      return;
    }

    this.activeLessonPage = nextPage;
    this.renderLessonPage();
    this.showStatusMessage(`Lesson ${this.activeLessonPage + 1} tasks`);
  }

  private renderLessonPage(): void {
    const pageIds = INSTRUCTOR_LESSONS.map(lesson => lesson.pageId);

    pageIds.forEach((id, index) => {
      const page = this.dashboardDocument?.getElementById(id);
      // Keep one stable UIKit tree. Re-showing a page after display:none can
      // leave its text nodes and pointer targets unrendered in a WebXR panel.
      if (index === 0) {
        this.removeClass(page, "lesson-page-hidden");
      } else {
        this.addClass(page, "lesson-page-hidden");
      }
    });

    this.applyActiveLessonContent();
    this.updateLessonScrollButtons(pageIds.length);
    this.sync();
  }

  private applyActiveLessonContent(): void {
    const lesson = INSTRUCTOR_LESSONS[this.activeLessonPage];
    if (!lesson) return;

    const setText = (id: string, value: string): void => {
      const element = this.dashboardDocument?.getElementById(id) as UIKit.Text;
      if (!element) return;
      element.setProperties({ text: value });
      // UIKit's current Text declaration omits textContent, but assigning it
      // keeps text visible after a WebXR panel refresh.
      (element as any).textContent = value;
    };

    setText("lesson-1-label", lesson.label);
    lesson.tasks.forEach((task, index) => {
      const visibleTask = index + 1;
      setText(`lesson-1-task-${visibleTask}-type`, task.type);
      setText(`lesson-1-task-${visibleTask}-title`, task.title);
      setText(`lesson-1-task-${visibleTask}-description`, task.description);
    });
  }

  private updateLessonScrollButtons(pageCount: number): void {
    const upButton = this.dashboardDocument?.getElementById("task-scroll-up");
    const downButton = this.dashboardDocument?.getElementById("task-scroll-down");

    const setUnavailable = (button: any, unavailable: boolean): void => {
      if (!button) return;
      if (unavailable) this.addClass(button, "scroll-button-unavailable");
      else this.removeClass(button, "scroll-button-unavailable");
    };

    setUnavailable(upButton, this.activeLessonPage === 0);
    setUnavailable(downButton, this.activeLessonPage >= pageCount - 1);
  }

  private activateConfiguredTask(action: InstructorTaskAction): void {
    if (action === "presentation") {
      const video = INSTRUCTOR_LESSONS[this.activeLessonPage]?.tasks.find(
        task => task.action === "presentation"
      );
      this.activatePresentationMode(video?.assetPath ?? undefined);
    }
    if (action === "challenge") {
      const challenge = INSTRUCTOR_LESSONS[this.activeLessonPage]?.tasks.find(
        task => task.action === "challenge"
      );
      this.activateQuickChallenge(challenge?.activityId);
    }
    if (action === "briefing") {
      const briefing = INSTRUCTOR_LESSONS[this.activeLessonPage]?.tasks.find(
        task => task.action === "briefing"
      );
      this.activateBriefingMode(briefing?.assetPath ?? undefined);
    }
  }

  private applyConfiguredMenuContent(): void {
    const setText = (id: string, value: string): void => {
      const element = this.dashboardDocument?.getElementById(id) as UIKit.Text;
      if (!element) return;
      element.setProperties({ text: value });
      (element as any).textContent = value;
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
      this.hasLabResults = true;
      this.hasObservedActiveLabStudent = true;
      /*
       * Preserve the final lab report when the instructor ends
       * the activity. Incoming studentList updates replace each
       * working row with its returned/completed final values.
       * Keep the report open while Stop Game returns students and persists
       * their final snapshots. The floating launcher remains available after
       * the instructor closes the report manually.
       */
      this.setLabMonitorAvailable(true);
      this.setLabMonitorVisible(true);
    } else {
      this.setLabMonitorVisible(false);
      this.setLabMonitorAvailable(false);
    }
  }

  // ======================================================
  // PRESENTATION MODE
  // ======================================================

  private activatePresentationMode(assetPath?: string): void {
    // UIKit can deliver the same physical selection as both pointerdown and
    // click. Ignore the duplicate so entering the room never also presses
    // Play on the controls that have just appeared.
    const activationTime = performance.now();
    if (activationTime - this.lastPresentationActivationAt < 1800) return;
    this.lastPresentationActivationAt = activationTime;

    console.log(
      "[InstructorDashboard] Activating Presentation Mode"
    );

    if (this.currentMode === "Presentation Mode") {
      const playing = (window as any).presentationSystem?.toggleVideoPlayback?.();
      socket.emit("instructorVideoPlayback", {
        command: playing ? "play" : "pause",
        currentTime:
          (window as any).presentationSystem?.getVideoCurrentTime?.() ?? 0
      });
      this.showStatusMessage(playing ? "Video playing" : "Video paused");
      this.setDashboardVisible(false);
      return;
    }

    socket.emit(
      "instructorSendAllToDestination",
      {
        destination:
          "Presentation",
        assetPath,
        mediaType: "video"
      }
    );

    (window as any)
      .presentationSystem
      ?.enterVideoPresentation?.(assetPath);

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

  private activateBriefingMode(assetPath?: string): void {
    const activationTime = performance.now();
    if (activationTime - this.lastPresentationActivationAt < 1800) return;
    this.lastPresentationActivationAt = activationTime;

    socket.emit("instructorSendAllToDestination", {
      destination: "Presentation",
      assetPath,
      mediaType: "image"
    });

    (window as any).presentationSystem?.enterImagePresentation?.(assetPath);
    this.setCurrentMode("Presentation Mode");
    this.showStatusMessage("Briefing image opened");
    this.setDashboardVisible(false);
    this.setLabMonitorVisible(false);
    this.setLabMonitorAvailable(false);
  }

  // ======================================================
  // LAB MODE
  // ======================================================

  private toggleLabActivity(): void {
    if (this.currentMode === "Lab Mode" || this.labActivityStartedAt !== null) {
      this.activateClassMode();
      return;
    }

    this.activateLabMode();
  }

  private activateLabMode(): void {
    if (this.isEndingClass) return;

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
    // A new launch is a new result set. Do not merge rows from an earlier
    // Variable Sorting run while the current students are still working.
    this.savedLabStudents = [];
    this.setLatestResultType("game");
    this.hasLabResults = false;
    this.hasObservedActiveLabStudent = false;
    this.labResultsFinalized = false;

    this.showStatusMessage(
      "Students sent to the lab"
    );

    this.setDashboardVisible(false);
    this.setLabMonitorAvailable(false);
    socket.emit("requestStudentList");
    this.updateLabMonitor();
    this.setLabMonitorVisible(true);
  }

  // ======================================================
  // QUICK CHALLENGE
  // ======================================================

  private activateQuickChallenge(activityId?: number): void {
    console.log(
      "[InstructorDashboard] Starting Quick Challenge"
    );

    socket.emit(
      "instructorQuickChallenge",
      {
        durationSeconds: 60,
        activityId
      }
    );

    this.setCurrentMode(
      "Quick Challenge"
    );
    this.setLatestResultType("quick-challenge");

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
    this.setLatestResultType("quick-challenge");
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
    this.labResultsFinalized = true;
    socket.emit("requestSavedLabResults");
    this.updateLabMonitor();
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
      studentsByUser.set(student.seat ?? student.userId ?? student.id, student);
    }

    // Live progress is authoritative only while the student is actively in the
    // game. After return/completion, keep the final Supabase snapshot.
    for (const student of this.latestStudents) {
      const key = student.seat ?? student.userId ?? student.id;
      const saved = studentsByUser.get(key);
      const activelyWorking =
        student.mode === "Game Mode" &&
        student.labStatus !== "completed" &&
        student.labStatus !== "returned" &&
        student.labStatus !== "instructor_return";
      if (!saved || activelyWorking || !saved.savedResult) {
        studentsByUser.set(key, student);
      }
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

    const rankedStudents = this.getRankedLabStudents();
    const totalPages = Math.max(
      1,
      Math.ceil(rankedStudents.length / this.labMonitorPageSize)
    );
    this.labMonitorPage = Math.min(this.labMonitorPage, totalPages - 1);
    const pageStart = this.labMonitorPage * this.labMonitorPageSize;
    const students = rankedStudents.slice(
      pageStart,
      pageStart + this.labMonitorPageSize
    );
    const pageLabel = this.labMonitorDocument.getElementById(
      "lab-monitor-page-label"
    ) as UIKit.Text;
    pageLabel?.setProperties({
      text: `PAGE ${this.labMonitorPage + 1} / ${totalPages}`
    });

    const traceRows = students.map(student => ({
      source: student.savedResult ? "saved" : "live",
      userId: student.userId,
      seat: student.seat,
      mode: student.mode,
      durationSeconds: this.getLabStudentDuration(student),
      accuracy: this.getLabStudentAccuracy(student),
      status: student.labStatus,
    }));
    const traceSignature = JSON.stringify(traceRows);
    if (traceSignature !== this.lastLabMonitorTraceSignature) {
      this.lastLabMonitorTraceSignature = traceSignature;
      console.log("[LabTrace][Client] monitor ranking", traceRows);
    }

    /* UIKit can retain old text when a hidden row is shown again. */
    const setText = (element: UIKit.Text | undefined, value: string): void => {
      if (!element) {
        return;
      }
      element.setProperties({ text: value });
    };

    for (let index = 0; index < this.labMonitorPageSize; index += 1) {
      const student = students[index];
      const globalIndex = pageStart + index;
      const row = index + 1;
      const rowElement =
        this.labMonitorDocument
          .getElementById(
            `lab-row-${row}`
          );

      if (student) {
        if (rowElement?.classList.contains("student-row-hidden")) {
          this.removeClass(rowElement, "student-row-hidden");
        }
      } else {
        if (rowElement && !rowElement.classList.contains("student-row-hidden")) {
          this.addClass(rowElement, "student-row-hidden");
        }
      }

      const name =
        this.labMonitorDocument
          .getElementById(
            `lab-name-${row}`
          ) as UIKit.Text;

      const rank =
        this.labMonitorDocument
          .getElementById(
            `lab-rank-${row}`
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

      const accuracy =
        this.labMonitorDocument
          .getElementById(
            `lab-accuracy-${row}`
          ) as UIKit.Text;

      const status =
        this.labMonitorDocument
          .getElementById(
            `lab-status-${row}`
          ) as UIKit.Text;

      if (!student) {
        setText(rank, "—");
        setText(name, "-");
        setText(question, "-");
        setText(correct, "OK 0");
        setText(mistakes, "X 0");
        setText(score, "-");
        setText(accuracy, "-");
        setText(time, "-");
        setText(status, "Waiting");
        continue;
      }

      const completed =
        student.completedExercises ?? 0;

      const total =
        student.totalExercises ?? 12;

      const currentQuestion =
        this.labResultsFinalized && !this.hasLabParticipation(student)
          ? 0
          : student.labStatus === "completed"
          ? total
          : Math.min(
              completed + 1,
              total
            );

      const statusLabel =
        this.labResultsFinalized && !this.hasLabParticipation(student)
          ? "No Progress"
          : student.labStatus === "completed"
            ? "Finished"
            : student.labStatus === "returned" ||
              student.labStatus === "instructor_return"
              ? "Returned"
            : student.isDisconnected
              ? "Offline"
            : student.mode === "Game Mode"
              ? "Working"
              : completed > 0
                ? "Returned"
                : "Waiting";

      setText(name, `${student.name ?? "Student"}  ${student.seat ?? ""}`);
      setText(
        rank,
        this.labResultsFinalized && this.hasLabParticipation(student)
          ? this.formatOrdinal(globalIndex + 1)
          : "—"
      );
      setText(question, `${currentQuestion} / ${total}`);
      setText(score, `${student.score ?? 0}`);
      setText(correct, `OK ${student.correctAnswers ?? 0}`);
      setText(mistakes, `X ${student.wrongAnswers ?? 0}`);
      setText(accuracy, `${this.getLabStudentAccuracy(student).toFixed(0)}%`);

      const duration = this.getLabStudentDuration(student);
      const minutes =
        Math.floor(duration / 60);
      const seconds =
        duration % 60;

      setText(time, `${minutes}:${String(seconds).padStart(2, "0")}`);
      setText(status, statusLabel);

      console.log("[LabTrace][Client] rendered row", {
        row,
        userId: student.userId,
        seat: student.seat,
        source: student.savedResult ? "saved" : "live",
        durationSeconds: duration,
        renderedTime: `${minutes}:${String(seconds).padStart(2, "0")}`,
        status: statusLabel,
      });
    }

    this.syncDocument(
      this.labMonitorDocument
    );
  }

  private getRankedLabStudents(): DashboardStudent[] {
    const studentsByUser = new Map<number | string, DashboardStudent>();
    for (const student of this.savedLabStudents) {
      studentsByUser.set(student.seat ?? student.userId ?? student.id, student);
    }
    for (const student of this.latestStudents) {
      const key = student.seat ?? student.userId ?? student.id;
      const saved = studentsByUser.get(key);
      const activelyWorking =
        student.mode === "Game Mode" &&
        student.labStatus !== "completed" &&
        student.labStatus !== "returned" &&
        student.labStatus !== "instructor_return";
      if (!saved || activelyWorking || !saved.savedResult) {
        studentsByUser.set(key, student);
      }
    }

    const students = [...studentsByUser.values()]
      .filter(student =>
        !student.isDemo &&
        student.seat &&
        student.seat !== "Not selected"
      );

    if (!this.labResultsFinalized) {
      return students.sort((a, b) =>
        String(a.seat).localeCompare(String(b.seat), undefined, {
          numeric: true,
        })
      );
    }

    return students.sort((a, b) => {
        const participationDifference =
          Number(this.hasLabParticipation(b)) - Number(this.hasLabParticipation(a));
        if (participationDifference !== 0) return participationDifference;

        // Final placement policy:
        // 1. More correct answers
        // 2. Higher accuracy
        // 3. More completed exercises
        // 4. Fewer wrong answers
        // 5. Faster completion time
        const correctDifference =
          (b.correctAnswers ?? 0) - (a.correctAnswers ?? 0);
        if (correctDifference !== 0) return correctDifference;
        const accuracyDifference =
          this.getLabStudentAccuracy(b) - this.getLabStudentAccuracy(a);
        if (accuracyDifference !== 0) return accuracyDifference;
        const progressDifference =
          (b.completedExercises ?? 0) - (a.completedExercises ?? 0);
        if (progressDifference !== 0) return progressDifference;
        const wrongDifference =
          (a.wrongAnswers ?? 0) - (b.wrongAnswers ?? 0);
        if (wrongDifference !== 0) return wrongDifference;
        const timeDifference =
          this.getLabStudentDuration(a) - this.getLabStudentDuration(b);
        if (timeDifference !== 0) return timeDifference;
        return String(a.seat).localeCompare(String(b.seat));
      });
  }

  private hasLabParticipation(student: DashboardStudent): boolean {
    // Opening the lab places the student on card 1, so the monitor displays
    // 1/12 before any work has been submitted. A return/completion status by
    // itself must not award a placement. Rank only students with recorded
    // activity.
    return (student.completedExercises ?? 0) > 0 ||
      (student.correctAnswers ?? 0) > 0 ||
      (student.wrongAnswers ?? 0) > 0;
  }

  private getLabStudentAccuracy(student: DashboardStudent): number {
    const stored = Number(student.accuracy);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    const correct = student.correctAnswers ?? 0;
    const wrong = student.wrongAnswers ?? 0;
    const attempts = correct + wrong;
    return attempts > 0 ? (correct / attempts) * 100 : 0;
  }

  private getLabStudentDuration(student: DashboardStudent): number {
    const sharedActivityDuration =
      this.labActivityStartedAt !== null &&
      student.mode === "Game Mode" &&
      student.labStatus !== "completed" &&
      student.labStatus !== "returned" &&
      student.labStatus !== "instructor_return"
        ? Math.max(
            0,
            Math.floor((Date.now() - this.labActivityStartedAt) / 1000)
          )
        : 0;
    return Math.max(0, student.durationSeconds ?? 0, sharedActivityDuration);
  }

  // ======================================================
  // CURRENT MODE
  // ======================================================

  private setCurrentMode(
    mode: InstructorMode
  ): void {
    // The multiplayer server calls the Python lab "Game Mode", while the
    // instructor UI calls it "Lab Mode". Treat both as the same activity.
    const normalizedMode =
      (mode as string) === "Game Mode"
        ? "Lab Mode"
        : mode;

    this.currentMode =
      normalizedMode;

    if (normalizedMode === "Lab Mode") {
      this.startLabActivityTimer();
    } else {
      this.stopLabActivityTimer();
    }

    this.updateModeDisplay();
    this.updateActiveButton();
  }

  private startLabActivityTimer(): void {
    if (this.labActivityStartedAt !== null) {
      this.updateLabActivityControl();
      return;
    }

    this.labActivityFinalElapsedSeconds = 0;
    this.labMonitorPage = 0;
    this.labActivityStartedAt = Date.now();
    this.updateLabActivityControl();
    this.labActivityTimer = window.setInterval(
      () => {
        this.updateLabActivityControl();
        this.updateLabMonitor();
      },
      1000
    );
  }

  private stopLabActivityTimer(): void {
    if (this.labActivityStartedAt !== null) {
      this.labActivityFinalElapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - this.labActivityStartedAt) / 1000)
      );
    }

    if (this.labActivityTimer !== undefined) {
      window.clearInterval(this.labActivityTimer);
      this.labActivityTimer = undefined;
    }

    this.labActivityStartedAt = null;
    this.updateLabActivityControl();
  }

  private updateLabActivityControl(): void {
    if (!this.dashboardDocument) return;

    const active = this.labActivityStartedAt !== null;
    const elapsedSeconds = active
      ? Math.max(0, Math.floor((Date.now() - this.labActivityStartedAt!) / 1000))
      : this.labActivityFinalElapsedSeconds;
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    const elapsed = hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    const setText = (id: string, value: string): void => {
      const element = this.dashboardDocument?.getElementById(id) as UIKit.Text;
      if (!element) return;
      element.setProperties({ text: value });
      (element as any).textContent = value;
    };

    setText("lab-game-code", active ? `LIVE  ${elapsed}` : "GAME 01");
    setText("lab-game-name", active ? "Return from Game" : "Variable Sorting");
    setText(
      "lab-game-description",
      active
        ? "Return all students to the classroom"
        : "Sort Python values into the correct data-type bins"
    );

    const button = this.dashboardDocument.getElementById("lab-mode-button");
    if (active) this.addClass(button, "game-card-active");
    else this.removeClass(button, "game-card-active");

    this.syncDocument(this.dashboardDocument);

    const monitorTimer = this.labMonitorDocument?.getElementById(
      "lab-monitor-timer"
    ) as UIKit.Text;
    monitorTimer?.setProperties({ text: elapsed });
    if (monitorTimer) (monitorTimer as any).textContent = elapsed;
    this.syncDocument(this.labMonitorDocument);
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

        this.removeClass(button, "mode-button-active");
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

    this.addClass(
      this.dashboardDocument.getElementById(activeButtonId),
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

  /** UIKit's classList throws when add/remove is called redundantly. */
  private addClass(element: any, ...classNames: string[]): void {
    if (!element?.classList) return;
    for (const className of classNames) {
      if (!element.classList.contains(className)) {
        element.classList.add(className);
      }
    }
  }

  private removeClass(element: any, ...classNames: string[]): void {
    if (!element?.classList) return;
    for (const className of classNames) {
      if (element.classList.contains(className)) {
        element.classList.remove(className);
      }
    }
  }

  private syncDocument(
    document: any
  ): void {
    document?.requestUpdate?.();
    document?.update?.();
  }
}

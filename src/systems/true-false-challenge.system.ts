import { TRUE_FALSE_MAX_ATTEMPTS } from "../../shared/true-false-settings";
import { TRUE_FALSE_CHALLENGE_TYPE } from "../../shared/challenge-types";
import { STUDENT_RESULT_AUTO_CLOSE_MS } from "../config/student-result-settings";
/**
 * Student Quick Challenge UI and interaction system.
 * Goal: receive the selected lesson question, collect one answer by mouse/ray,
 * submit it through Socket.IO, show correctness/time, and return on instructor
 * stop. The instructor monitor is handled by instructor-dashboard.system.ts.
 */
import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  RayInteractable,
  UIKit,
  type UIKitDocument,
} from "@iwsdk/core";
import { Matrix4, Quaternion, Raycaster, Vector2, Vector3 } from "three";

import { socket } from "../network/socket-client";
import { maintainChallengeSeatClearance } from '../ui/challenge-seat-clearance';
import { applyStudentQuizSceneDepth, attachHologramFrame } from "../ui/hologram-frame";
import { paintChallenge1Countdown } from "../ui/countdown-ring";
import { hitStepIndex, paintStepsRail } from "../ui/steps-rail";
import {
  C1,
  paintHudPlate,
  paintReviewChip,
  paintTitleBanner,
  preloadChallenge1Art,
} from "../challenges/true-false/question-art";
import { paintSerifBlock, SCORE_SERIF, wrapCanvasLines } from "../ui/serif-type";
import { StudentRocketRig } from "../challenges/true-false/student-rocket";
import { TrueFalseSounds } from "../challenges/true-false/sound-effects";



// Optional review notes match the exact prompt, so reordered database questions stay correct.
const REVIEW_NOTES: Record<string, string> = {
  "RAM keeps its contents when the power is off.": "RAM is volatile memory: its contents are lost when power is turned off.",
  "The CPU is the fastest component in the system.": "The CPU executes instructions and performs calculations at high speed.",
  "A program runs directly from the hard drive.": "Program instructions are loaded into RAM for execution by the CPU.",
  "An SSD is an example of secondary storage.": "An SSD keeps data even when power is off, making it secondary storage.",
  "'Loading...' means copying storage -> RAM.": "Loading transfers program data from storage into RAM for use.",
};



interface QuickChallengeQuestion {
  question: string;
  options: string[];
  explanation?: string;
}

interface QuickChallengePayload {
  id: string;
  question: string;
  options: string[];
  durationSeconds: number;
  startedAt: number;
  challengeType?: string;
  totalQuestions?: number;
  questions?: QuickChallengeQuestion[];
}

interface QuickChallengeResult {
  quizId: string;
  correct?: boolean;
  correctIndex?: number;
  selectedIndex?: number | null;
  responseTimeSeconds?: number;
  message?: string;
  questionIndex?: number;
  hasNext?: boolean;
  nextQuestionIndex?: number | null;
  correctCount?: number;
  answeredCount?: number;
  totalQuestions?: number;
  completed?: boolean;
  attemptCount?: number;
  retriesRemaining?: number;
  results?: Array<{
    questionIndex: number;
    selectedIndex: number;
    correctIndex: number;
    correct: boolean;
  }>;
}

interface QuickChallengeEndedPayload {
  quizId?: string;
  winnerStudentId?: string | null;
  winnerName?: string | null;
  winnerTimeSeconds?: number | null;
  stoppedByInstructor?: boolean;
}

export class TrueFalseChallengeSystem extends createSystem({
  panel: {
    required: [PanelUI, PanelDocument],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/quick-challenge.json"
      )
    ]
  }
}) {
  private document?: UIKitDocument;
  private challenge?: QuickChallengePayload;
  private questions: QuickChallengeQuestion[] = [];
  private questionIndex = 0;
  private selections: Array<number | null> = [];
  private reviewResults: Array<{
    selectedIndex: number;
    correctIndex: number;
    correct: boolean;
  }> | null = null;
  private correctCount = 0;
  private showingResult = false;
  private resultAutoCloseTimer?: number;
  private selectedIndex: number | null = null;
  private timer?: number;
  private submitted = false;
  private retryPending = false;
  private attemptStartedAt?: number;
  private challengeClosed = false;
  private timeExpired = false;
  private buttonsConnected = false;
  private lastDesktopActivation = 0;
  private lastNavAt = 0;
  private fivePartsAttempts = 0;
  private responseTimeSeconds = 0;
  private timerFaceCanvas?: HTMLCanvasElement;
  private stepsRailCanvas?: HTMLCanvasElement;
  private scoreHeroCanvas?: HTMLCanvasElement;
  private questionFaceCanvas?: HTMLCanvasElement;
  private explainFaceCanvas?: HTMLCanvasElement;
  private reviewGlyphCanvas?: HTMLCanvasElement;
  private titleBannerCanvas?: HTMLCanvasElement;
  private hudPlateCanvas?: HTMLCanvasElement;
  private sounds = new TrueFalseSounds();
  private studentRocket = new StudentRocketRig(() => this.sounds.launch(), () => this.sounds.stop());
  private hoveredDesktopAction = "";
  private hoveringRocketLaunch = false;
  private lastRocketFrameAt = 0;
  private desktopRocketDragging = false;
  private xrRocketDragging = false;
  private lastXrTriggerDown = false;
  private disabledRayTargets: Array<{
    entity: any;
    wasVisible: boolean;
    pointerEvents: any;
    hadRayInteractable: boolean;
  }> = [];

  init(): void {
    window.addEventListener("pointerdown", this.sounds.unlock, true);
    this.queries.panel.subscribe(
      "qualify",
      entity => {
        this.connectPanelWhenReady(
          entity.index
        );
      }
    );

    socket.on("quickChallengeStarted", this.startChallenge);
    socket.on("quickChallengeResult", this.showResult);
    socket.on("quickChallengeEnded", this.endChallenge);
    preloadChallenge1Art(() => {
      this.updateStepLights();
      this.updateTimer();
      if (this.challenge) {
        this.refreshTitleBanner(
          this.isFivePartsChallenge() ? "STUDENT CHALLENGE 1" : "QUICK CHALLENGE"
        );
      }
    });

    // UIKit's spatial buttons are used by controller rays. Some desktop
    // browsers, however, do not forward canvas mouse events to a panel that
    // was constructed while hidden. This listener only supplies the missing
    // desktop hit test and is deliberately disabled during an XR session.
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handleDesktopPointer,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.handleDesktopRocketMove,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointerup",
      this.handleDesktopRocketUp,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointercancel",
      this.handleDesktopRocketUp,
      true
    );
  }

  private handleDesktopPointer = (event: PointerEvent): void => {
    if (
      this.renderer.xr.isPresenting ||
      !(window as any).isQuickChallengeOpen ||
      event.button !== 0
    ) {
      return;
    }

    const panel = (window as any).quickChallengeEntity?.object3D;
    if (!panel?.visible) return;

    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, this.camera);

    if (this.isFivePartsChallenge()) {
      const rocketHit = raycaster.intersectObject(this.studentRocket.root, true)[0];
      if (rocketHit) {
        if (this.studentRocket.beginDrag(raycaster)) {
          this.sounds.click();
          this.desktopRocketDragging = true;
          this.renderer.domElement.setPointerCapture?.(event.pointerId);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const { action, actionName } = this.getPanelAction(raycaster) ?? {};

    if (!action) return;

    const now = performance.now();
    if (now - this.lastDesktopActivation < 220) return;
    this.lastDesktopActivation = now;

    event.preventDefault();
    event.stopPropagation();
    action();
    this.sounds.click();
    console.log(`[Quick Challenge] Desktop mouse activated ${actionName}.`);
  };

  // Share hit regions between desktop clicks and hover feedback.
  private getPanelAction(raycaster: Raycaster): { action: () => void; actionName: string } | undefined {
    const panel = (window as any).quickChallengeEntity?.object3D;
    if (!panel?.visible) return;
    panel.updateMatrixWorld(true);
    const inversePanelMatrix = new Matrix4().copy(panel.matrixWorld).invert();
    const localRay = raycaster.ray.clone().applyMatrix4(inversePanelMatrix);
    if (Math.abs(localRay.direction.z) < 0.00001) return;

    const distance = -localRay.origin.z / localRay.direction.z;
    if (distance < 0) return;
    const localHit = localRay.at(distance, localRay.origin.clone());

    // PanelUI is configured with maxWidth 2.42 and maxHeight 1.62 in
    // index.ts so the clock can sit outside the board on the right.
    const panelWidth = 2.42;
    const panelHeight = 1.62;
    const x = (localHit.x + panelWidth / 2) / panelWidth;
    const y = (panelHeight / 2 - localHit.y) / panelHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    let action: (() => void) | undefined;
    let actionName = "";

    if (this.isFivePartsChallenge()) {
      const stepIndex = this.hitDiamondIndex(x, y);
      if (stepIndex !== null) {
        action = () => this.goToQuestion(stepIndex);
        actionName = `step-${stepIndex}`;
      } else if (this.isSummaryView() && y >= 0.80) {
        action = this.retryQuiz;
        actionName = "retry";
      } else if (!this.submitted && !this.showingResult && x < 0.84 && y >= 0.48 && y < 0.78) {
        const index = x < 0.42 ? 0 : 1;
        action = () => this.selectAnswer(index);
        actionName = `answer-${index}`;
      }
    } else if (this.showingResult) {
      if (y >= 0.70 && y <= 0.95) {
        action = this.closeResult;
        actionName = "close";
      }
    } else if (y >= 0.30 && y < 0.49) {
      const index = x < 0.5 ? 0 : 1;
      action = () => this.selectAnswer(index);
      actionName = `answer-${index}`;
    } else if (y >= 0.49 && y < 0.69) {
      const index = x < 0.5 ? 2 : 3;
      action = () => this.selectAnswer(index);
      actionName = `answer-${index}`;
    } else if (y >= 0.69 && y <= 0.94) {
      action = this.submitAnswer;
      actionName = "submit";
    }

    return action ? { action, actionName } : undefined;
  }

  private connectPanelWhenReady(
    entityIndex: number,
    attempt = 0
  ): void {
    const document =
      PanelDocument.data.document[
        entityIndex
      ] as UIKitDocument | undefined;

    if (!document) {
      if (attempt < 180) {
        requestAnimationFrame(() => {
          this.connectPanelWhenReady(
            entityIndex,
            attempt + 1
          );
        });
      } else {
        console.error(
          "[Quick Challenge] Panel document did not become ready."
        );
      }
      return;
    }

    this.document = document;

    if (this.buttonsConnected) {
      return;
    }

    const requiredButtonIds = [
      "quiz-answer-0",
      "quiz-answer-1",
      "quiz-answer-2",
      "quiz-answer-3",
      "quiz-submit",
      "quiz-prev",
      "quiz-next",
      "quiz-result-close",
      "quiz-result-reset",
      "quiz-review-q-0",
      "quiz-review-q-1",
      "quiz-review-q-2",
      "quiz-review-q-3",
      "quiz-review-q-4",
      "quiz-step-0",
      "quiz-step-1",
      "quiz-step-2",
      "quiz-step-3",
      "quiz-step-4",
    ];
    const missingButton = requiredButtonIds.some(
      id => !this.document?.getElementById(id)
    );

    if (missingButton) {
      if (attempt < 180) {
        requestAnimationFrame(() => {
          this.connectPanelWhenReady(entityIndex, attempt + 1);
        });
      } else {
        console.error("[Quick Challenge] Interactive buttons did not become ready.");
      }
      return;
    }

    this.buttonsConnected = true;
    if (this.challenge) this.renderCurrentView();

    for (let index = 0; index < 4; index += 1) {
      this.bindSpatialButton(
        `quiz-answer-${index}`,
        () => this.selectAnswer(index)
      );
    }

    this.bindSpatialButton(
      "quiz-submit",
      this.submitAnswer
    );
    this.bindSpatialButton(
      "quiz-prev",
      this.goPrevious,
      ["pointerdown", "click"]
    );
    this.bindSpatialButton(
      "quiz-next",
      this.goNext,
      ["pointerdown", "click"]
    );
    this.bindSpatialButton(
      "quiz-result-close",
      this.closeResult
    );
    this.bindSpatialButton(
      "quiz-result-reset",
      this.retryQuiz
    );
    for (let index = 0; index < 5; index += 1) {
      this.bindSpatialButton(
        `quiz-review-q-${index}`,
        () => this.jumpToQuestion(index),
        ["pointerdown"]
      );
      this.bindSpatialButton(
        `quiz-step-${index}`,
        () => this.goToQuestion(index),
        ["pointerdown", "click"]
      );
    }

    console.log(
      "[Quick Challenge] Mouse and spatial-ray buttons connected."
    );
  }

  private bindSpatialButton(
    elementId: string,
    handler: () => void,
    eventNames: Array<"pointerdown" | "click"> = ["pointerdown", "click"]
  ): void {
    const element =
      this.document?.getElementById(elementId);

    if (!element) {
      return;
    }

    let lastActivation = 0;
    const activate = (event?: any): void => {
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      const now = performance.now();

      if (now - lastActivation < 220) {
        return;
      }

      lastActivation = now;
      handler();
      this.sounds.click();
    };

    eventNames.forEach(eventName => {
      element.addEventListener(eventName, activate);
    });
    element.addEventListener("pointerenter", () => {
      if ((window as any).isQuickChallengeOpen) this.sounds.hover();
    });
  }

  private startChallenge = (
    payload: QuickChallengePayload
  ): void => {
    if (!payload || payload.challengeType !== TRUE_FALSE_CHALLENGE_TYPE || !Array.isArray(payload.options)) {
      return;
    }

    window.clearTimeout(this.resultAutoCloseTimer);
    this.challenge = payload;
    this.attemptStartedAt = undefined;
    this.retryPending = false;
    this.questions =
      Array.isArray(payload.questions) && payload.questions.length > 0
        ? payload.questions.map((question) => ({
            ...question,
            explanation:
              question.explanation || REVIEW_NOTES[question.question] || "",
          }))
        : [{ question: payload.question, options: payload.options }];
    this.questionIndex = 0;
    this.selections = this.questions.map(() => null);
    this.reviewResults = null;
    this.correctCount = 0;
    this.selectedIndex = null;
    this.submitted = false;
    this.fivePartsAttempts = 0;
    this.challengeClosed = false;
    this.timeExpired = false;
    this.responseTimeSeconds = 0;
    this.studentRocket.resetAll();
    this.renderCurrentView();
    this.setVisible(true);
    this.startTimer();
    this.sync();
    this.syncStudentRocket();
  };

  private isFivePartsChallenge(): boolean {
    return this.challenge?.challengeType === TRUE_FALSE_CHALLENGE_TYPE && this.questions.length > 0;
  }

  private isSummaryView(): boolean {
    return (
      this.isFivePartsChallenge() &&
      Boolean(this.reviewResults) &&
      this.questionIndex >= this.questions.length
    );
  }

  private renderCurrentView(): void {
    if (this.isFivePartsChallenge() && this.isSummaryView()) {
      this.renderSummaryView();
      return;
    }
    this.renderCurrentQuestion();
  }

  private renderCurrentQuestion(): void {
    const payload = this.challenge;
    const current = this.questions[this.questionIndex];
    if (!payload || !current) return;

    this.selectedIndex = this.selections[this.questionIndex] ?? null;
    this.setResultMode(false);
    this.setText("quiz-question", current.question);
    this.updateQuestionFace(current.question);
    this.updateProgressLabel();
    this.updateNavButtons();
    this.updateSubmitButton();
    this.updateToolbarLayout();

    const twoOptionLayout = current.options.length <= 2;
    for (let index = 0; index < 4; index += 1) {
      const option = current.options[index];
      const answer = this.document?.getElementById(`quiz-answer-${index}`);
      const icon = this.document?.getElementById(`quiz-answer-icon-${index}`) as any;
      const label = this.document?.getElementById(`quiz-answer-label-${index}`) as any;

      if (option === undefined) {
        this.addClass(answer, "answer-hidden");
        this.removeClass(answer, "answer-tile-large");
        this.addClass(icon, "answer-hidden");
        this.addClass(this.document?.getElementById(`quiz-answer-face-${index}`), "answer-hidden");
        this.removeClass(icon, "answer-icon-large");
        this.removeClass(label, "answer-label-large");
        this.setText(`quiz-answer-label-${index}`, "");
      } else {
        this.removeClass(answer, "answer-hidden");
        if (twoOptionLayout) this.addClass(answer, "answer-tile-large");
        else this.removeClass(answer, "answer-tile-large");
        const useLetterPrefix = current.options.length > 2;
        this.setText(
          `quiz-answer-label-${index}`,
          useLetterPrefix
            ? `${String.fromCharCode(65 + index)}. ${option}`
            : option.toUpperCase()
        );
        const face = this.document?.getElementById(`quiz-answer-face-${index}`);
        if (twoOptionLayout) {
          const isTrue = option.trim().toLowerCase() === "true";
          this.addClass(icon, "answer-hidden");
          this.addClass(label, "answer-hidden");
          if (face) {
            this.removeClass(face, "answer-hidden");
            (face as any)?.setProperties?.({
              src: isTrue
                ? "/textures/challenge1/True.png"
                : "/textures/challenge1/False.png",
            });
          }
        } else {
          this.addClass(face, "answer-hidden");
          this.addClass(icon, "answer-hidden");
          this.removeClass(label, "answer-hidden");
          this.removeClass(icon, "answer-icon-large");
          this.removeClass(label, "answer-label-large");
          label?.setProperties?.({ fontSize: 2.6 });
        }
      }
    }

    const secondAnswerRow = this.document?.getElementById(
      "quiz-answer-row-2"
    );
    if (current.options.length <= 2) {
      this.addClass(secondAnswerRow, "answer-hidden");
    } else {
      this.removeClass(secondAnswerRow, "answer-hidden");
    }

    this.setFeedback("");
    const instruction = this.document?.getElementById(
      "quiz-instruction"
    ) as UIKit.Text | undefined;
    if (this.isFivePartsChallenge() || (current.options.length <= 2)) {
      this.addClass(instruction, "answer-hidden");
      this.setText("quiz-instruction", "");
    } else if (!(this.submitted && this.isFivePartsChallenge())) {
      this.removeClass(instruction, "answer-hidden");
      this.setText("quiz-instruction", "Select one answer");
      instruction?.setProperties({ color: "#cbb79a" });
    }
    this.updateSelection();
    this.updateExplanation();
    this.sync();
  }

  private renderSummaryView(): void {
    const total = this.questions.length;
    this.setResultMode(true);
    this.updateProgressLabel();
    this.updateNavButtons();
    this.updateSubmitButton();
    this.updateToolbarLayout();
    this.updateExplanation();
    this.setText("quiz-result-status", "SCORE");
    this.setText("quiz-result-answer", `${this.correctCount}/${total}`);
    this.addClass(this.document?.getElementById("quiz-result-status"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-result-answer"), "answer-hidden");
    this.removeClass(this.document?.getElementById("quiz-score-hero"), "answer-hidden");
    this.paintScoreHero(this.correctCount, total);
    this.setText("quiz-result-time", "");
    this.setText("quiz-result-winner", "");
    this.setText("quiz-result-hint", "tap to review");
    this.removeClass(this.document?.getElementById("quiz-result-hint"), "answer-hidden");
    if (this.canRetryFiveParts()) {
      this.removeClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
      this.paintHudFace("quiz-reset-face", C1.light, "RETRY QUIZ");
    } else {
      this.addClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
    }
    this.addClass(this.document?.getElementById("quiz-steps"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-timer-ring"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-kicker"), "answer-hidden");
    this.refreshTitleBanner("STUDENT CHALLENGE 1");
    this.setText("quiz-progress", "");
    const card = this.document?.getElementById("quiz-result-card");
    const status = this.document?.getElementById("quiz-result-status");
    const time = this.document?.getElementById("quiz-result-time");
    const reviewRow = this.document?.getElementById("quiz-review-questions");
    this.removeClass(card, "quiz-result-correct", "quiz-result-wrong");
    this.removeClass(status, "quiz-result-correct", "quiz-result-wrong");
    this.addClass(card, "quiz-result-correct");
    this.addClass(status, "quiz-result-correct");
    this.addClass(time, "answer-hidden");
    this.removeClass(reviewRow, "answer-hidden");
    this.updateReviewQuestionButtons();
    this.sync();
  }

  private paintScoreHero(correct: number, total: number): void {
    if (!this.scoreHeroCanvas) {
      this.scoreHeroCanvas = document.createElement("canvas");
    }
    this.scoreHeroCanvas.width = 820;
    this.scoreHeroCanvas.height = 330;
    const canvas = this.scoreHeroCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4fbff";
    ctx.font = `500 72px ${SCORE_SERIF}`;
    ctx.fillText(`Score: ${correct}/${total}`, canvas.width / 2, 70);
    const message =
      correct === total
        ? "All parts unlocked — drag them onto your rocket, then launch."
        : correct > 0
          ? "Correct answers unlocked parts. Drag them onto the rocket, or retry to unlock more."
          : "No parts unlocked. Retry the quiz to try again.";
    ctx.fillStyle = correct > 0 ? "#c5f2fa" : "#9ec0cc";
    ctx.font = `italic 500 38px ${SCORE_SERIF}`;
    const lines = wrapCanvasLines(ctx, message, canvas.width - 64);
    const lineHeight = 50;
    const startY = 200 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });
    const hero = this.document?.getElementById("quiz-score-hero") as any;
    hero?.setProperties?.({ src: canvas.toDataURL("image/png") });
  }

  private jumpToQuestion(index: number): void {
    if (!this.reviewResults || index < 0 || index >= this.questions.length) {
      return;
    }
    this.questionIndex = index;
    this.renderCurrentView();
  }

  private goToQuestion(index: number): void {
    if (!this.isFivePartsChallenge() || this.isSummaryView()) return;
    if (index < 0 || index >= this.questions.length) return;
    if (index === this.questionIndex) return;
    if (!this.beginNav()) return;
    this.questionIndex = index;
    this.renderCurrentView();
  }

  private hitDiamondIndex(x: number, y: number): number | null {
    if (!this.isFivePartsChallenge() || this.isSummaryView()) return null;
    const panelWidth = 128;
    const panelHeight = 90;
    const railX = 9;
    const railY = 13.3;
    const railWidth = 90;
    const railHeight = 13;
    const px = x * panelWidth;
    const py = y * panelHeight;
    if (
      px < railX ||
      px > railX + railWidth ||
      py < railY ||
      py > railY + railHeight
    ) {
      return null;
    }
    return hitStepIndex((px - railX) / railWidth, (py - railY) / railHeight);
  }

  private updateReviewQuestionButtons(): void {
    if (!this.reviewGlyphCanvas) {
      this.reviewGlyphCanvas = document.createElement("canvas");
      this.reviewGlyphCanvas.width = 128;
      this.reviewGlyphCanvas.height = 128;
    }
    for (let index = 0; index < 5; index += 1) {
      const button = this.document?.getElementById(`quiz-review-q-${index}`);
      const glyph = this.document?.getElementById(`quiz-review-glyph-${index}`) as any;
      const review = this.reviewResults?.[index];
      this.removeClass(button, "answer-correct", "answer-wrong");
      if (!review) {
        this.addClass(button, "answer-hidden");
        continue;
      }
      this.removeClass(button, "answer-hidden");
      this.addClass(button, review.correct ? "answer-correct" : "answer-wrong");
      glyph?.setProperties?.({
        src: paintReviewChip({
          canvas: this.reviewGlyphCanvas,
          digit: String(index + 1),
          correct: review.correct,
          onReady: () => this.updateReviewQuestionButtons(),
        }),
      });
    }
  }

  private updateQuestionFace(question: string): void {
    const face = this.document?.getElementById("quiz-question-face") as any;
    const text = this.document?.getElementById("quiz-question");
    if (!this.isFivePartsChallenge()) {
      this.addClass(face, "answer-hidden");
      this.removeClass(text, "answer-hidden");
      return;
    }
    if (!this.questionFaceCanvas) {
      this.questionFaceCanvas = document.createElement("canvas");
      this.questionFaceCanvas.width = 960;
      this.questionFaceCanvas.height = 240;
    }
    this.removeClass(face, "answer-hidden");
    this.addClass(text, "answer-hidden");
    this.setText("quiz-question", "");
    face?.setProperties?.({
      src: paintSerifBlock({
        canvas: this.questionFaceCanvas,
        text: question,
        color: "#d9f7ff",
        fontSize: 58,
      }),
    });
  }

  private updateExplanation(): void {
    const explanation = this.document?.getElementById(
      "quiz-explanation"
    ) as UIKit.Text | undefined;
    const instruction = this.document?.getElementById(
      "quiz-instruction"
    ) as UIKit.Text | undefined;
    const text =
      this.questions[this.questionIndex]?.explanation || "";
    const visible =
      this.isFivePartsChallenge() &&
      this.submitted &&
      !this.isSummaryView() &&
      Boolean(text);

    explanation?.setProperties({ text: "" });
    this.addClass(explanation, "answer-hidden");
    this.removeClass(instruction, "quiz-explain-italic");
    const explainFace = this.document?.getElementById("quiz-explain-face") as any;
    if (!visible) {
      this.addClass(explainFace, "answer-hidden");
      if (this.isSummaryView()) {
        instruction?.setProperties({ text: "", color: "#cbb79a" });
      }
      return;
    }
    if (this.isFivePartsChallenge()) {
      instruction?.setProperties({ text: "", color: "#cbb79a" });
      if (!this.explainFaceCanvas) {
        this.explainFaceCanvas = document.createElement("canvas");
        this.explainFaceCanvas.width = 960;
        this.explainFaceCanvas.height = 200;
      }
      this.removeClass(explainFace, "answer-hidden");
      explainFace?.setProperties?.({
        src: paintSerifBlock({
          canvas: this.explainFaceCanvas,
          text,
          color: "#e8c36a",
          fontSize: 48,
          italic: true,
        }),
      });
      return;
    }
    this.addClass(explainFace, "answer-hidden");
    instruction?.setProperties({
      text,
      color: "#e8c36a",
    });
    this.addClass(instruction, "quiz-explain-italic");
  }

  private updateToolbarLayout(): void {
    const toolbar = this.document?.getElementById("quiz-toolbar") as any;
    this.removeClass(toolbar, "quiz-toolbar-review");
    toolbar?.setProperties?.({ justifyContent: "space-between" });
  }

  private updateProgressLabel(): void {
    const kicker = this.document?.getElementById("quiz-kicker");
    const progress = this.document?.getElementById("quiz-progress");
    const prev = this.document?.getElementById("quiz-prev");
    const next = this.document?.getElementById("quiz-next");
    const timerRing = this.document?.getElementById("quiz-timer-ring");
    if (this.isFivePartsChallenge()) {
      this.removeClass(prev, "answer-hidden");
      this.removeClass(next, "answer-hidden");
      this.removeClass(progress, "answer-hidden");
      if (this.isSummaryView()) {
        this.addClass(kicker, "answer-hidden");
        this.addClass(timerRing, "answer-hidden");
        this.addClass(this.document?.getElementById("quiz-header"), "answer-hidden");
        this.refreshTitleBanner("STUDENT CHALLENGE 1");
        this.setText("quiz-progress", "");
      } else {
        this.removeClass(kicker, "answer-hidden");
        this.removeClass(timerRing, "answer-hidden");
        this.removeClass(this.document?.getElementById("quiz-header"), "answer-hidden");
        this.setText("quiz-kicker", "Student Challenge 1");
        this.refreshTitleBanner("STUDENT CHALLENGE 1");
        this.setText("quiz-progress", "");
      }
    } else {
      this.addClass(prev, "answer-hidden");
      this.addClass(next, "answer-hidden");
      this.addClass(kicker, "answer-hidden");
      this.addClass(progress, "answer-hidden");
      this.removeClass(timerRing, "answer-hidden");
      this.removeClass(this.document?.getElementById("quiz-header"), "answer-hidden");
      this.refreshTitleBanner("QUICK CHALLENGE");
      this.setText("quiz-progress", "");
    }
    this.updateStepLights();
  }

  private updateStepLights(): void {
    const row = this.document?.getElementById("quiz-steps");
    if (!this.isFivePartsChallenge()) {
      this.addClass(row, "answer-hidden");
      return;
    }
    this.removeClass(row, "answer-hidden");
    const states: Array<"idle" | "current" | "done" | "miss"> = [];
    for (let index = 0; index < 5; index += 1) {
      if (index === this.questionIndex && !this.isSummaryView()) {
        states.push("current");
      } else if (this.selections[index] !== null || this.reviewResults?.[index]) {
        states.push("done");
      } else {
        states.push("idle");
      }
    }
    if (!this.stepsRailCanvas) {
      this.stepsRailCanvas = document.createElement("canvas");
      this.stepsRailCanvas.width = 780;
      this.stepsRailCanvas.height = 130;
    }
    const rail = this.document?.getElementById("quiz-steps-rail") as any;
    rail?.setProperties?.({
      src: paintStepsRail({
        canvas: this.stepsRailCanvas,
        states,
        onReady: () => this.updateStepLights(),
      }),
    });
    this.sync();
  }

  private allQuestionsAnswered(): boolean {
    return (
      this.selections.length === this.questions.length &&
      this.selections.every(selection => selection !== null)
    );
  }

  private refreshTitleBanner(text: string): void {
    if (!this.titleBannerCanvas) {
      this.titleBannerCanvas = document.createElement("canvas");
      this.titleBannerCanvas.width = 1024;
      this.titleBannerCanvas.height = 160;
    }
    const banner = this.document?.getElementById("quiz-title-banner") as any;
    banner?.setProperties?.({
      src: paintTitleBanner({
        canvas: this.titleBannerCanvas,
        text,
        onReady: () => this.refreshTitleBanner(text),
      }),
    });
  }

  private updateSubmitButton(): void {
    const submit = this.document?.getElementById("quiz-submit");
    const face = this.document?.getElementById("quiz-submit-face");
    const label = this.document?.getElementById("quiz-submit-label") as any;
    if (this.isFivePartsChallenge()) {
      this.removeClass(submit, "submit-full");
      if (this.submitted) {
        this.removeClass(submit, "answer-hidden");
        this.addClass(face, "answer-hidden");
        this.addClass(label, "answer-hidden");
        return;
      }
      this.removeClass(submit, "answer-hidden");
      if (!this.allQuestionsAnswered()) {
        this.addClass(submit, "submit-disabled");
        this.removeClass(submit, "submit-ready");
        this.addClass(face, "answer-hidden");
        this.removeClass(label, "answer-hidden");
        label?.setProperties?.({ text: "SUBMIT ONLY IF ALL ANSWERED." });
      } else {
        this.removeClass(submit, "submit-disabled");
        this.addClass(submit, "submit-ready");
        this.removeClass(face, "answer-hidden");
        this.addClass(label, "answer-hidden");
        this.paintHudFace("quiz-submit-face", C1.light, "SUBMIT");
      }
      return;
    }

    this.removeClass(submit, "answer-hidden", "submit-disabled", "submit-ready");
    this.addClass(submit, "submit-full");
    this.removeClass(face, "answer-hidden");
    this.addClass(label, "answer-hidden");
    this.paintHudFace("quiz-submit-face", C1.light, "SUBMIT");
  }

  private paintHudFace(id: string, src: string, text: string, color?: string): void {
    if (!this.hudPlateCanvas) {
      this.hudPlateCanvas = document.createElement("canvas");
      this.hudPlateCanvas.width = 512;
      this.hudPlateCanvas.height = 128;
    }
    const face = this.document?.getElementById(id) as any;
    face?.setProperties?.({
      src: paintHudPlate({
        canvas: this.hudPlateCanvas,
        src,
        text,
        color,
        onReady: () => this.paintHudFace(id, src, text, color),
      }),
    });
  }

  private updateNavButtons(): void {
    const prev = this.document?.getElementById("quiz-prev");
    const next = this.document?.getElementById("quiz-next");
    const maxIndex = this.reviewResults
      ? this.questions.length
      : Math.max(0, this.questions.length - 1);
    if (this.questionIndex <= 0) this.addClass(prev, "nav-disabled");
    else this.removeClass(prev, "nav-disabled");
    if (this.questionIndex >= maxIndex) this.addClass(next, "nav-disabled");
    else this.removeClass(next, "nav-disabled");
  }

  private goPrevious = (): void => {
    if (!this.isFivePartsChallenge() || this.questionIndex <= 0) return;
    if (!this.beginNav()) return;
    this.questionIndex -= 1;
    this.renderCurrentView();
  };

  private goNext = (): void => {
    if (!this.isFivePartsChallenge()) return;
    const maxIndex = this.reviewResults
      ? this.questions.length
      : Math.max(0, this.questions.length - 1);
    if (this.questionIndex >= maxIndex) return;
    if (!this.beginNav()) return;
    this.questionIndex += 1;
    this.renderCurrentView();
  };

  private beginNav(): boolean {
    const now = performance.now();
    if (now - this.lastNavAt < 200) return false;
    this.lastNavAt = now;
    return true;
  };

  private canRetryFiveParts(): boolean {
    return (
      this.isFivePartsChallenge() &&
      !this.challengeClosed &&
      !this.timeExpired &&
      this.fivePartsAttempts < TRUE_FALSE_MAX_ATTEMPTS
    );
  }

  private retryQuiz = (): void => {
    if (!this.challenge || !this.submitted || this.challengeClosed || this.timeExpired || this.retryPending || !this.canRetryFiveParts()) return;
    const quizId = this.challenge.id;
    this.retryPending = true;
    this.setFeedback("Saving your attempt...");
    socket.timeout(15000).emit("quickChallengeRetry", { quizId }, (error: Error | null, reply: any) => {
      this.retryPending = false;
      if (this.challenge?.id !== quizId || this.challengeClosed) return;
      if (error || !reply?.success) {
        this.setFeedback(reply?.message ?? "Retry was not confirmed. Please try again.");
        return;
      }
      this.attemptStartedAt = reply.attemptStartedAt;
      window.clearTimeout(this.resultAutoCloseTimer);
      this.submitted = false;
      this.reviewResults = null;
      this.correctCount = 0;
      this.questionIndex = 0;
      this.selectedIndex = null;
      this.selections = this.questions.map(() => null);
      this.studentRocket.resetAll();
      this.setResultMode(false);
      this.addClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
      this.renderCurrentView();
      this.startTimer();
      this.syncStudentRocket();
    });
  };

  private selectAnswer(index: number): void {
    if (!this.challenge || this.submitted || this.challengeClosed) {
      return;
    }
    if (this.timeExpired && !this.isFivePartsChallenge()) {
      return;
    }

    this.selectedIndex = index;
    if (this.isFivePartsChallenge()) {
      this.selections[this.questionIndex] = index;
      socket.emit("quickChallengeDraft", { quizId: this.challenge.id, attemptStartedAt: this.attemptStartedAt, answers: this.selections });
    }
    this.setFeedback("");
    this.updateSelection();
    this.updateSubmitButton();
    this.updateStepLights();
  }

  private scheduleResultAutoClose(): void {
    window.clearTimeout(this.resultAutoCloseTimer);
    this.resultAutoCloseTimer = window.setTimeout(
      () => this.setVisible(false), STUDENT_RESULT_AUTO_CLOSE_MS
    );
  }

  private closeResult = (): void => {
    if (this.timeExpired) {
      this.setVisible(false);
      return;
    }
    if (this.challenge && !this.submitted) return;
    this.setVisible(false);
  };

  private submitAnswer = (): void => {
    if (!this.challenge || this.submitted || this.challengeClosed) {
      return;
    }
    if (this.timeExpired && !this.isFivePartsChallenge()) {
      return;
    }

    if (this.isFivePartsChallenge()) {
      if (!this.allQuestionsAnswered()) {
        this.setFeedback("Answer every question before submitting.");
        return;
      }
      this.submitted = true;
      this.responseTimeSeconds = Math.max(
        0,
        (Date.now() - this.challenge.startedAt) / 1000
      );
      this.stopTimer();
      this.setFeedback("Answer submitted...");
      socket.emit("quickChallengeAnswer", {
        quizId: this.challenge.id,
        attemptStartedAt: this.attemptStartedAt, answers: this.selections,
      });
      return;
    }

    if (this.selectedIndex === null) {
      this.setFeedback("Please select one answer first.");
      return;
    }

    this.submitted = true;
    this.responseTimeSeconds = Math.max(
      0,
      (Date.now() - this.challenge.startedAt) / 1000
    );
    this.stopTimer();
    this.setFeedback("Answer submitted...");

    socket.emit("quickChallengeAnswer", {
      quizId: this.challenge.id,
      selectedIndex: this.selectedIndex,
      questionIndex: this.questionIndex,
    });
  };

  private showResult = (
    result: QuickChallengeResult
  ): void => {
    if (!this.challenge || result.quizId !== this.challenge.id) {
      return;
    }

    this.submitted = true;
    // Keep the rocket available until the class activity ends or the student closes it.
    this.stopTimer();
    if (Number.isFinite(result.responseTimeSeconds)) {
      this.responseTimeSeconds = Number(result.responseTimeSeconds);
    }
    if (Number.isInteger(result.correctCount)) {
      this.correctCount = Number(result.correctCount);
    }

    if (this.isFivePartsChallenge()) {
      if (Number.isInteger(result.attemptCount)) {
        this.fivePartsAttempts = Number(result.attemptCount);
      } else {
        this.fivePartsAttempts += 1;
      }
      this.reviewResults = Array.isArray(result.results)
        ? result.results.map(item => ({
            selectedIndex: item.selectedIndex,
            correctIndex: item.correctIndex,
            correct: item.correct,
          }))
        : this.selections.map(selectedIndex => ({
            selectedIndex: selectedIndex ?? 0,
            correctIndex: 0,
            correct: false,
          }));
      this.questionIndex = this.questions.length;
      this.renderSummaryView();
      this.studentRocket.setUnlocks(
        this.reviewResults.map(item => Boolean(item.correct))
      );
      this.syncStudentRocket();
      return;
    }

    this.showResultCard(result);
  };

  private endChallenge = (
    payload: QuickChallengeEndedPayload = {}
  ): void => {
    if (
      payload.quizId &&
      this.challenge &&
      payload.quizId !== this.challenge.id
    ) {
      return;
    }

    if (!this.challenge) return;
    this.stopTimer();
    this.challengeClosed = true;
    this.scheduleResultAutoClose();
    if (payload.stoppedByInstructor) {
      this.challenge = undefined;
      this.setResultMode(false);
      this.setVisible(false);
      return;
    }

    if (this.submitted) {
      this.addClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
      return;
    }

    this.scheduleResultAutoClose();
    this.setText("quiz-result-status", "TIME'S UP");
    this.setText("quiz-result-answer", "");
    this.addClass(this.document?.getElementById("quiz-score-hero"), "answer-hidden");
    this.removeClass(this.document?.getElementById("quiz-result-status"), "answer-hidden");
    this.removeClass(this.document?.getElementById("quiz-result-answer"), "answer-hidden");
    this.setText("quiz-result-time", "Time taken: —");
    this.setText("quiz-result-winner", "");
    const card = this.document?.getElementById("quiz-result-card");
    const status = this.document?.getElementById("quiz-result-status");
    this.removeClass(card, "quiz-result-correct", "quiz-result-wrong");
    this.removeClass(status, "quiz-result-correct", "quiz-result-wrong");
    this.addClass(card, "quiz-result-wrong");
    this.addClass(status, "quiz-result-wrong");
    this.setCloseButtonLabel("Return to class");
    this.setResultMode(true);
    this.addClass(this.document?.getElementById("quiz-prev"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-next"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-review-questions"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-result-hint"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-steps"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-explanation"), "answer-hidden");
    this.removeClass(this.document?.getElementById("quiz-result-time"), "answer-hidden");
    this.setVisible(true);
    this.challenge = undefined;
  };

  private startTimer(): void {
    this.stopTimer();
    this.updateTimer();
    this.timer = window.setInterval(
      () => this.updateTimer(),
      250
    );
  }

  private getRemainingSeconds(): number {
    if (!this.challenge) return 0;
    const elapsedSeconds = Math.floor(
      (Date.now() - this.challenge.startedAt) / 1000
    );
    return Math.max(0, this.challenge.durationSeconds - elapsedSeconds);
  }

  private updateTimerProgressRing(remaining: number): void {
    if (!this.challenge) return;
    if (!this.timerFaceCanvas) {
      this.timerFaceCanvas = document.createElement("canvas");
      this.timerFaceCanvas.width = 256;
      this.timerFaceCanvas.height = 256;
    }
    const elapsed = Math.max(0, (Date.now() - this.challenge.startedAt) / 1000);
    const remainingExact = Math.max(
      0,
      this.challenge.durationSeconds - elapsed
    );
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const src = paintChallenge1Countdown({
      canvas: this.timerFaceCanvas,
      remainingSeconds: remainingExact,
      durationSeconds: this.challenge.durationSeconds,
      clockText: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
      caption: "TIME REMAINING",
      onReady: () => this.updateTimer(),
    });
    const face = this.document?.getElementById("quiz-timer-progress") as any;
    face?.setProperties?.({ src });
    this.sync();
  }

  private updateTimer(): void {
    if (!this.challenge) {
      return;
    }

    const remaining = this.getRemainingSeconds();
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    this.setText(
      "quiz-timer",
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    );
    this.updateTimerProgressRing(remaining);
    const timerRing = this.document?.getElementById("quiz-timer-ring");
    if (remaining <= 60) this.addClass(timerRing, "quiz-timer-urgent");
    else this.removeClass(timerRing, "quiz-timer-urgent");

    if (remaining === 0) {
      this.stopTimer();
      this.timeExpired = true;
      if (!this.submitted && !this.isFivePartsChallenge()) {
        this.setFeedback(
          "Time is up.",
          "feedback-incorrect"
        );
      }
    }
  }

  private updateSelection(): void {
    const review = this.reviewResults?.[this.questionIndex];
    for (let index = 0; index < 4; index += 1) {
      const button =
        this.document?.getElementById(
          `quiz-answer-${index}`
        );

      this.removeClass(
        button,
        "answer-selected",
        "answer-correct",
        "answer-wrong",
        "answer-dimmed"
      );

      if (this.submitted && this.isFivePartsChallenge() && review) {
        if (index === review.selectedIndex) {
          this.addClass(button, "answer-selected");
        } else if ((this.questions[this.questionIndex]?.options.length ?? 0) <= 2) {
          this.addClass(button, "answer-dimmed");
        }
        continue;
      }

      if (index === this.selectedIndex) {
        this.addClass(button, "answer-selected");
      } else if (this.selectedIndex !== null && this.questions[this.questionIndex]?.options.length <= 2) {
        this.addClass(button, "answer-dimmed");
      }
    }

    this.sync();
  }

  private showResultCard(result: QuickChallengeResult): void {
    const selectedIndex = result.selectedIndex ?? this.selectedIndex;
    const selectedOption =
      selectedIndex === null || selectedIndex === undefined
        ? "No answer"
        : (this.questions[this.questionIndex]?.options.length ?? 0) <= 2
          ? (this.questions[this.questionIndex]?.options[selectedIndex] ?? "")
          : `${String.fromCharCode(65 + selectedIndex)}. ${
              this.questions[this.questionIndex]?.options[selectedIndex] ?? ""
            }`;
    const status = result.correct ? "CORRECT" : "WRONG";

    this.setText("quiz-result-status", status);
    this.setText("quiz-result-answer", `Your answer: ${selectedOption}`);
    this.addClass(this.document?.getElementById("quiz-score-hero"), "answer-hidden");
    this.removeClass(this.document?.getElementById("quiz-result-status"), "answer-hidden");
    this.removeClass(this.document?.getElementById("quiz-result-answer"), "answer-hidden");
    (this.document?.getElementById("quiz-result-status") as UIKit.Text | undefined)?.setProperties({
      fontSize: 4.4,
      fontFamily: "inter",
    });
    (this.document?.getElementById("quiz-result-answer") as UIKit.Text | undefined)?.setProperties({
      fontSize: 2.4,
      color: "#cbd5e1",
      fontFamily: "inter",
    });
    this.setText(
      "quiz-result-time",
      `Time taken: ${this.responseTimeSeconds.toFixed(1)} seconds`
    );
    this.setText("quiz-result-winner", "");
    this.setCloseButtonLabel("Return to class");
    this.addClass(this.document?.getElementById("quiz-result-hint"), "answer-hidden");

    const card = this.document?.getElementById("quiz-result-card");
    const statusElement = this.document?.getElementById("quiz-result-status");
    this.removeClass(card, "quiz-result-correct", "quiz-result-wrong");
    this.removeClass(statusElement, "quiz-result-correct", "quiz-result-wrong");
    this.addClass(
      card,
      result.correct ? "quiz-result-correct" : "quiz-result-wrong"
    );
    this.addClass(
      statusElement,
      result.correct ? "quiz-result-correct" : "quiz-result-wrong"
    );
    this.addClass(this.document?.getElementById("quiz-review-questions"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
    this.removeClass(this.document?.getElementById("quiz-result-time"), "answer-hidden");
    this.setResultMode(true);
  }

  private setCloseButtonLabel(text: string): void {
    this.paintHudFace("quiz-close-face", C1.dark, text.toUpperCase());
  }

  private setResultMode(showResult: boolean): void {
    const contentIds = [
      "quiz-question",
      "quiz-question-face",
      "quiz-answer-row-1",
      "quiz-answer-row-2",
      "quiz-instruction",
      "quiz-explain-face",
      "quiz-explanation",
      "quiz-feedback",
    ];

    contentIds.forEach(id => {
      const element = this.document?.getElementById(id);
      if (showResult) this.addClass(element, "quiz-content-hidden");
      else this.removeClass(element, "quiz-content-hidden");
    });

    const resultCard = this.document?.getElementById("quiz-result-card");
    const close = this.document?.getElementById("quiz-result-close");
    const reset = this.document?.getElementById("quiz-result-reset");
    const toolbar = this.document?.getElementById("quiz-toolbar");
    const actions = this.document?.getElementById("quiz-result-actions");
    if (showResult) {
      this.removeClass(resultCard, "quiz-result-hidden");
      this.addClass(toolbar, "answer-hidden");
      this.removeClass(actions, "answer-hidden");
      if (this.isFivePartsChallenge()) {
        this.addClass(close, "quiz-result-hidden");
        this.removeClass(reset, "quiz-result-hidden");
      } else {
        this.removeClass(close, "quiz-result-hidden");
        this.addClass(reset, "quiz-result-hidden");
      }
    } else {
      this.addClass(resultCard, "quiz-result-hidden");
      this.addClass(close, "quiz-result-hidden");
      this.addClass(reset, "quiz-result-hidden");
      this.removeClass(toolbar, "answer-hidden");
      this.addClass(actions, "answer-hidden");
    }
    this.showingResult = showResult;
    this.sync();
  }

  private setFeedback(
    text: string,
    className?: string
  ): void {
    const element =
      this.document?.getElementById("quiz-feedback");

    this.removeClass(
      element,
      "feedback-correct",
      "feedback-incorrect"
    );

    if (className) {
      this.addClass(element, className);
    }
    if (text) this.removeClass(element, "answer-hidden", "quiz-content-hidden");
    else this.addClass(element, "answer-hidden");

    this.setText("quiz-feedback", text);
  }

  private setText(id: string, text: string): void {
    const element =
      this.document?.getElementById(id) as UIKit.Text;

    element?.setProperties({ text });
    this.sync();
  }

  private addClass(element: any, ...classNames: string[]): void {
    if (!element?.classList) return;
    classNames.forEach(className => {
      if (!element.classList.contains(className)) {
        element.classList.add(className);
      }
    });
  }

  private removeClass(element: any, ...classNames: string[]): void {
    if (!element?.classList) return;
    classNames.forEach(className => {
      if (element.classList.contains(className)) {
        element.classList.remove(className);
      }
    });
  }

  private setVisible(visible: boolean): void {
    if (!visible) window.clearTimeout(this.resultAutoCloseTimer);
    const entity = (window as any).quickChallengeEntity;

    this.setOtherStudentUiDisabled(visible);

    if (entity?.object3D) {
      attachHologramFrame(entity.object3D);
      if (visible && !entity.object3D.visible) {
        const viewer = this.renderer.xr.isPresenting
          ? this.renderer.xr.getCamera() : this.camera;
        const eye = new Vector3();
        const orientation = new Quaternion();
        if (this.renderer.xr.isPresenting) {
          this.camera.parent?.updateWorldMatrix(true, false);
          this.renderer.xr.updateCamera(this.camera);
          viewer.matrixWorld.decompose(eye, orientation, new Vector3());
        } else {
          viewer.getWorldPosition(eye);
          viewer.getWorldQuaternion(orientation);
        }
        const direction = new Vector3(0, 0, -1).applyQuaternion(orientation);
        // Match the main dashboard: use only the viewing direction around
        // the vertical axis. Looking up/down or tilting the head must not
        // tilt the panel or move it above/below eye level when it opens.
        direction.y = 0;
        if (direction.lengthSq() < 0.0001) direction.set(0, 0, -1);
        direction.normalize();
        orientation.setFromAxisAngle(
          new Vector3(0, 1, 0), Math.atan2(-direction.x, -direction.z)
        );
        // Fit the quiz plus its rocket/rack inside the browser viewport. XR
        // uses a comfortable fixed distance, independent of desktop aspect.
        const camera = this.camera as any;
        const verticalFov = ((camera.getEffectiveFOV?.() ?? camera.fov ?? 50) * Math.PI) / 180;
        const aspect = Math.max(0.4, camera.aspect ?? 1.5);
        const desktopDistance = Math.max(2.4,
          1.1 * 2.1 / (2 * Math.tan(verticalFov / 2)),
          1.1 * 4.1 / (2 * Math.tan(verticalFov / 2) * aspect));
        const distance = this.renderer.xr.isPresenting ? 2.4 : desktopDistance;
        entity.object3D.position.copy(eye).addScaledVector(direction, distance);
        entity.object3D.quaternion.copy(orientation);
        if (this.isFivePartsChallenge()) {
          const left = new Vector3(-0.7, 0, 0).applyQuaternion(entity.object3D.quaternion);
          entity.object3D.position.add(left);
        }
      }
      entity.object3D.visible = visible;
      entity.object3D.pointerEvents = visible ? "auto" : "none";
      entity.object3D.pointerEventsOrder = 50000;
      entity.object3D.traverse((object: any) => {
        object.pointerEvents = visible ? "auto" : "none";
        object.pointerEventsOrder = 50000;
      });
      entity.object3D.updateMatrixWorld(true);

      if (visible) {
        this.bringQuizPanelForward();
        // The panel is initially created while hidden. Requalifying it after
        // UIKit has built the button meshes refreshes IWSDK's mouse/ray hit
        // targets and BVHs for both desktop and headset input.
        entity.removeComponent(RayInteractable);
        entity.addComponent(RayInteractable);
        requestAnimationFrame(() => {
          entity.object3D?.updateMatrixWorld(true);
          this.bringQuizPanelForward();
        });
      }
    }

    (window as any).isQuickChallengeOpen = visible;
    this.syncStudentRocket();

    window.dispatchEvent(
      new CustomEvent(
        "quickChallengeVisibilityChanged",
        {
          detail: { visible }
        }
      )
    );
  }

  private setOtherStudentUiDisabled(disabled: boolean): void {
    if (disabled) {
      if (this.disabledRayTargets.length > 0) return;

      const names = [
        "menuEntity",
        "panelEntity",
        "hintEntity",
        "raiseHandEntity",
        "studentBoardViewButtonEntity",
        "notificationEntity",
        "transitionEntity",
        "studentResultEntity",
      ];

      names.forEach(name => {
        const target = (window as any)[name];
        const object = target?.object3D;
        if (!target || !object || target === (window as any).quickChallengeEntity) {
          return;
        }

        const hadRayInteractable = Boolean(
          target.hasComponent?.(RayInteractable)
        );
        this.disabledRayTargets.push({
          entity: target,
          wasVisible: object.visible,
          pointerEvents: object.pointerEvents,
          hadRayInteractable,
        });
        object.visible = false;
        object.pointerEvents = "none";
        object.traverse((child: any) => {
          child.pointerEvents = "none";
        });
        if (hadRayInteractable) {
          target.removeComponent(RayInteractable);
        }
      });
      return;
    }

    this.disabledRayTargets.forEach(record => {
      const object = record.entity?.object3D;
      if (!object) return;
      object.visible = record.wasVisible;
      object.pointerEvents = record.pointerEvents ?? "auto";
      object.traverse((child: any) => {
        child.pointerEvents = record.pointerEvents ?? "auto";
      });
      if (
        record.hadRayInteractable &&
        !record.entity.hasComponent?.(RayInteractable)
      ) {
        record.entity.addComponent?.(RayInteractable);
      }
    });
    this.disabledRayTargets = [];
  }

  private handleDesktopRocketMove = (event: PointerEvent): void => {
    if (this.renderer.xr.isPresenting || !(window as any).isQuickChallengeOpen) {
      this.hoveredDesktopAction = "";
      return;
    }
    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    if (!this.desktopRocketDragging) {
      const target = this.studentRocket.hitLaunch(raycaster)
        ? "launch" : this.getPanelAction(raycaster)?.actionName ?? "";
      if (target && target !== this.hoveredDesktopAction) this.sounds.hover();
      this.hoveredDesktopAction = target;
      return;
    }
    this.studentRocket.updateDrag(raycaster);
    event.preventDefault();
    event.stopPropagation();
  };

  private handleDesktopRocketUp = (event: PointerEvent): void => {
    if (!this.desktopRocketDragging) return;
    this.desktopRocketDragging = false;
    if (this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    }
    this.studentRocket.endDrag();
    event.preventDefault();
    event.stopPropagation();
  };

  private syncStudentRocket(): void {
    const panel = (window as any).quickChallengeEntity?.object3D;
    const show = Boolean(panel?.visible) && this.isFivePartsChallenge();
    if (!show || !panel) {
      this.studentRocket.setVisible(false);
      return;
    }
    this.studentRocket.attach(panel, new Vector3(1.52, -0.58, 0.05));
    this.studentRocket.setVisible(true);
    if (this.reviewResults) {
      this.studentRocket.setUnlocks(this.reviewResults.map(item => Boolean(item.correct)));
    }
    this.studentRocket.refreshPointerEvents();
  }

  private pollRocketXrInput(): void {
    if (
      !this.renderer.xr.isPresenting ||
      !(window as any).isQuickChallengeOpen ||
      !this.isFivePartsChallenge()
    ) {
      this.xrRocketDragging = false;
      this.lastXrTriggerDown = false;
      this.hoveringRocketLaunch = false;
      return;
    }
    const session = this.renderer.xr.getSession();
    const rightInput = session
      ? [...session.inputSources].find(source => source.handedness === "right")
      : undefined;
    const triggerHeld = Boolean(rightInput?.gamepad?.buttons?.[0]?.pressed);
    const raycaster = this.getXrRaycaster();
    if (!raycaster) return;
    const hoveringLaunch = this.studentRocket.hitLaunch(raycaster);
    if (hoveringLaunch && !this.hoveringRocketLaunch) this.sounds.hover();
    this.hoveringRocketLaunch = hoveringLaunch;
    if (triggerHeld && !this.lastXrTriggerDown) {
      this.xrRocketDragging = this.studentRocket.beginDrag(raycaster);
      if (this.xrRocketDragging) this.sounds.click();
    } else if (this.xrRocketDragging && triggerHeld) {
      this.studentRocket.updateDrag(raycaster);
    } else if (this.xrRocketDragging && !triggerHeld) {
      this.studentRocket.endDrag();
      this.xrRocketDragging = false;
    }
    this.lastXrTriggerDown = triggerHeld;
  }

  private getXrRaycaster(): Raycaster | null {
    const raySpace = (this.world as any).player?.raySpaces?.right;
    if (!raySpace) return null;
    raySpace.updateWorldMatrix(true, true);
    const origin = new Vector3();
    const direction = new Vector3(0, 0, -1);
    const rotation = new Quaternion();
    raySpace.getWorldPosition(origin);
    raySpace.getWorldQuaternion(rotation);
    direction.applyQuaternion(rotation).normalize();
    return new Raycaster(origin, direction);
  }

  update(): void {
    const now = performance.now();
    const delta = this.lastRocketFrameAt
      ? Math.min(0.05, (now - this.lastRocketFrameAt) / 1000)
      : 1 / 60;
    this.lastRocketFrameAt = now;
    this.studentRocket.update(delta);
    this.pollRocketXrInput();
    if ((window as any).isQuickChallengeOpen) {
      this.bringQuizPanelForward();
    }
  }

  private bringQuizPanelForward(): void {
    const panel = (window as any).quickChallengeEntity?.object3D;
    if (!panel?.visible) return;
    if (this.renderer.xr.isPresenting) maintainChallengeSeatClearance(panel, this.world.scene, this.renderer.xr.getCamera(), this.document);
    applyStudentQuizSceneDepth(panel);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private sync(): void {
    const document = this.document as any;
    document?.requestUpdate?.();
    document?.update?.();
  }

  destroy(): void {
    window.removeEventListener("pointerdown", this.sounds.unlock, true);
    this.sounds.dispose();
    window.clearTimeout(this.resultAutoCloseTimer);
    this.stopTimer();
    this.setOtherStudentUiDisabled(false);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.handleDesktopPointer,
      true
    );
    this.renderer.domElement.removeEventListener(
      "pointermove",
      this.handleDesktopRocketMove,
      true
    );
    this.renderer.domElement.removeEventListener(
      "pointerup",
      this.handleDesktopRocketUp,
      true
    );
    this.renderer.domElement.removeEventListener(
      "pointercancel",
      this.handleDesktopRocketUp,
      true
    );
    socket.off("quickChallengeStarted", this.startChallenge);
    socket.off("quickChallengeResult", this.showResult);
    socket.off("quickChallengeEnded", this.endChallenge);
  }
}

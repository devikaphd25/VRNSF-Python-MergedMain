import { TRUE_FALSE_MAX_ATTEMPTS } from "../../shared/true-false-settings";
import { LOOP_SORT_CHALLENGE_TYPE, FLOWCHART_SHAPE_CHALLENGE_TYPE, WHILE_TRACE_CHALLENGE_TYPE, WHILE_PARTS_CHALLENGE_TYPE, WHILE_FACTORIAL_CHALLENGE_TYPE, STRING_OK_ERROR_CHALLENGE_TYPE, STRING_IN_CHALLENGE_TYPE, STRING_CLEAN_CHALLENGE_TYPE, isCurriculumChallenge } from "../../shared/challenge-types";
import { STUDENT_RESULT_AUTO_CLOSE_MS } from "../config/student-result-settings";
import type { ChallengePresentation } from "../../shared/challenge-presentation";
/**
 * Database-driven curriculum challenges: code panels, choices and card placement.
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
import { Matrix4, Object3D, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from "three";

import { socket } from "../network/socket-client";
import { setPanelRayInteraction } from "../ui/panel-ray-interaction";
import { frameDesktopPanel, getPanelLayoutBounds } from "../ui/desktop-panel-framing";
import { applyStudentQuizSceneDepth, attachHologramFrame } from "../ui/hologram-frame";
import { paintChallenge1Countdown } from "../ui/countdown-ring";
import { hitStepIndex, paintStepsRail } from "../ui/steps-rail";
import {
  PLAYTEST_STUDENT as C1,
  paintHudPlate,
  paintReviewChip,
  paintTitleBanner,
  preloadArtPack,
  preloadPlaytestStudentArt,
} from "../challenges/true-false/question-art";
import { paintSerifBlock, SCORE_SERIF, wrapCanvasLines } from "../ui/serif-type";
import { TrueFalseSounds } from "../challenges/true-false/sound-effects";



interface QuickChallengeQuestion {
  presentation?: ChallengePresentation;
  question: string;
  options: string[];
  explanation?: string;
  questionType?: string;
}

interface QuickChallengePayload {
  title?: string;
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

export class CurriculumChallengeSystem extends createSystem({
  panel: {
    required: [PanelUI, PanelDocument],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/curriculum-challenge.json"
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
  private hudPlateCanvases = new Map<string, HTMLCanvasElement>();
  private sounds = new TrueFalseSounds();
  private hoveredDesktopAction = "";
  private codeFaceCanvas?: HTMLCanvasElement;
  private dndFaceCanvas?: HTMLCanvasElement;
  private dndDragIndex: number | null = null;
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
    preloadPlaytestStudentArt(() => {
      this.updateStepLights();
      this.updateTimer();
      this.paintLeftPanel();
      if (this.challenge) {
        this.refreshTitleBanner(this.challengeTitle());
        this.updateSelection();
      }
    });
    preloadArtPack([C1.yes, C1.no], () => {
      if (this.usesTrueFalseArt()) this.updateSelection();
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
      !(window as any).isCodePatternChallengeOpen ||
      event.button !== 0
    ) {
      return;
    }

    const panel = (window as any).codePatternChallengeEntity?.object3D;
    if (!panel?.visible) return;

    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, this.camera);

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
    const panel = (window as any).codePatternChallengeEntity?.object3D;
    if (!panel?.visible) return;
    panel.updateMatrixWorld(true);
    const inversePanelMatrix = new Matrix4().copy(panel.matrixWorld).invert();
    const localRay = raycaster.ray.clone().applyMatrix4(inversePanelMatrix);
    if (Math.abs(localRay.direction.z) < 0.00001) return;

    const distance = -localRay.origin.z / localRay.direction.z;
    if (distance < 0) return;
    const localHit = localRay.at(distance, localRay.origin.clone());

    const panelWidth = this.studentPanelLayout().meters;
    const panelHeight = 1.62;
    const x = (localHit.x + panelWidth / 2) / panelWidth;
    const y = (panelHeight / 2 - localHit.y) / panelHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    let action: (() => void) | undefined;
    let actionName = "";

    const answerIndex = this.hitAnswerIndex(raycaster);
    if (answerIndex !== null && !this.submitted && !this.showingResult) {
      return { action: () => this.selectAnswer(answerIndex), actionName: `answer-${answerIndex}` };
    }
    if (this.hitUiElement(raycaster, "quiz-submit") && !this.submitted && !this.showingResult) {
      return { action: this.submitAnswer, actionName: "submit" };
    }
    if (this.hitUiElement(raycaster, "quiz-prev")) {
      return { action: this.goPrevious, actionName: "prev" };
    }
    if (this.hitUiElement(raycaster, "quiz-next")) {
      return { action: this.goNext, actionName: "next" };
    }
    if (this.hitUiElement(raycaster, "quiz-result-reset") && this.isSummaryView()) {
      return { action: this.retryQuiz, actionName: "retry" };
    }

    if (this.isFivePartsChallenge()) {
      const stepIndex = this.hitDiamondIndex(x, y);
      if (stepIndex !== null) {
        action = () => this.goToQuestion(stepIndex);
        actionName = `step-${stepIndex}`;
      } else if (this.isSummaryView() && y >= 0.80) {
        action = this.retryQuiz;
        actionName = "retry";
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

  private uiObject(element: any): Object3D | undefined {
    if (!element) return;
    if (element.isObject3D) return element as Object3D;
    if (element.object?.isObject3D) return element.object as Object3D;
    if (element.object3D?.isObject3D) return element.object3D as Object3D;
    if (element.group?.isObject3D) return element.group as Object3D;
    return undefined;
  }

  private hitUiElement(raycaster: Raycaster, elementId: string): boolean {
    const element = this.document?.getElementById(elementId) as any;
    if (!element || element.classList?.contains("answer-hidden") || element.classList?.contains("quiz-content-hidden")) {
      return false;
    }
    const object = this.uiObject(element);
    if (!object) return false;
    object.updateWorldMatrix?.(true, true);
    return raycaster.intersectObject(object, true).length > 0;
  }

  private hitAnswerIndex(raycaster: Raycaster): number | null {
    const optionCount = this.questions[this.questionIndex]?.options.length ?? 0;
    for (let index = 0; index < optionCount; index += 1) {
      if (this.hitUiElement(raycaster, `quiz-answer-${index}`)) return index;
    }
    return null;
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
      "quiz-answer-4",
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
      "quiz-review-q-5",
      "quiz-review-q-6",
      "quiz-step-0",
      "quiz-step-1",
      "quiz-step-2",
      "quiz-step-3",
      "quiz-step-4",
      "quiz-step-5",
      "quiz-step-6",
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

    for (let index = 0; index < 5; index += 1) {
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
    for (let index = 0; index < 7; index += 1) {
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
      if ((window as any).isCodePatternChallengeOpen) this.sounds.hover();
    });
  }

  private startChallenge = (
    payload: QuickChallengePayload
  ): void => {
    if (!payload || !isCurriculumChallenge(payload.challengeType) || !Array.isArray(payload.options)) {
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
            explanation: "",
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
    this.layoutStudentShell();
    this.paintLeftPanel();
    this.renderCurrentView();
    this.setVisible(true);
    this.startTimer();
    this.sync();
  };

  private isFivePartsChallenge(): boolean {
    return isCurriculumChallenge(this.challenge?.challengeType) && this.questions.length > 0;
  }

  private isSingleBoardChallenge(): boolean {
    return this.challenge?.challengeType === FLOWCHART_SHAPE_CHALLENGE_TYPE;
  }

  private isWideCodePanel(): boolean {
    return this.challenge?.challengeType === WHILE_TRACE_CHALLENGE_TYPE;
  }

  private studentPanelLayout(): { meters: number; uikitWidth: number; railX: number } {
    if (this.isSingleBoardChallenge()) return { meters: 2.42, uikitWidth: 128, railX: 9 };
    if (this.isWideCodePanel()) return { meters: 4.46, uikitWidth: 248, railX: 130.4 };
    return { meters: 4.25, uikitWidth: 236, railX: 118.4 };
  }

  private challengeTitle(): string {
    return (this.challenge?.title ?? "Challenge").toUpperCase();
  }

  private challengeKicker(): string {
    return this.challenge?.title ?? "Challenge";
  }

  private leftPanelGuide(): string[] | null {
    return this.questions[this.questionIndex]?.presentation?.guide ?? null;
  }

  private isMultiSelectQuestion(index = this.questionIndex): boolean {
    const question = this.questions[index];
    return question?.questionType === "multi_select";
  }

  private isChoiceSelected(
    index: number,
    maskOrIndex: number | null,
    questionIndex = this.questionIndex
  ): boolean {
    if (maskOrIndex === null) return false;
    if (this.isMultiSelectQuestion(questionIndex)) return ((maskOrIndex >> index) & 1) === 1;
    return maskOrIndex === index;
  }

  /** Single-select stores an index; multi-select stores a bitmask. Review uses the graded value. */
  private selectedChoiceValue(): number | null {
    return this.reviewResults?.[this.questionIndex]?.selectedIndex ?? this.selectedIndex;
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
    this.layoutStudentShell();
    this.paintLeftPanel();

    this.addClass(this.document?.getElementById("quiz-dnd-face"), "answer-hidden");

    for (let index = 0; index < 5; index += 1) {
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
        const tfArt = this.usesTrueFalseArt();
        if (tfArt) {
          this.addClass(answer, "answer-tile-large");
          this.addClass(answer, "answer-button-tf");
        } else {
          this.removeClass(answer, "answer-tile-large");
          this.removeClass(answer, "answer-button-tf");
        }
        const useLetterPrefix =
          current.options.length > 2 ||
          this.challenge?.challengeType === STRING_OK_ERROR_CHALLENGE_TYPE;
        this.setText(
          `quiz-answer-label-${index}`,
          useLetterPrefix
            ? `${String.fromCharCode(65 + index)}. ${option}`
            : option
        );
        this.addClass(icon, "answer-hidden");
        this.addClass(label, "answer-hidden");
        this.removeClass(icon, "answer-icon-large");
        this.removeClass(label, "answer-label-large");
        const face = this.document?.getElementById(`quiz-answer-face-${index}`);
        if (tfArt) {
          this.addClass(face, "answer-face-pair");
          this.addClass(face, "answer-face-tf");
        } else {
          this.removeClass(face, "answer-face-pair");
          this.removeClass(face, "answer-face-tf");
        }
        this.paintChoiceFace(index);
      }
    }

    const secondAnswerRow = this.document?.getElementById("quiz-answer-row-2");
    const thirdAnswerRow = this.document?.getElementById("quiz-answer-row-3");
    if (current.options.length <= 2) this.addClass(secondAnswerRow, "answer-hidden");
    else this.removeClass(secondAnswerRow, "answer-hidden");
    if (current.options.length > 4) this.removeClass(thirdAnswerRow, "answer-hidden");
    else this.addClass(thirdAnswerRow, "answer-hidden");
    this.removeClass(this.document?.getElementById("quiz-answer-row-1"), "answer-hidden");

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
    this.addClass(this.document?.getElementById("quiz-dnd-face"), "answer-hidden");
    if (this.canRetryFiveParts()) {
      this.removeClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
      this.paintHudFace("quiz-reset-face", C1.light, "Retry");
    } else {
      this.addClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
    }
    this.addClass(this.document?.getElementById("quiz-steps"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-timer-ring"), "answer-hidden");
    this.addClass(this.document?.getElementById("quiz-kicker"), "answer-hidden");
    this.refreshTitleBanner(this.challengeTitle());
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
    this.scoreHeroCanvas.height = 240;
    const canvas = this.scoreHeroCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4fbff";
    ctx.font = `700 120px ${SCORE_SERIF}`;
    ctx.fillText(`Score: ${correct}/${total}`, canvas.width / 2, canvas.height / 2);
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
    const layout = this.studentPanelLayout();
    const panelWidth = layout.uikitWidth;
    const panelHeight = 90;
    const railX = layout.railX;
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
    return hitStepIndex((px - railX) / railWidth, (py - railY) / railHeight, this.questions.length);
  }

  private updateReviewQuestionButtons(): void {
    if (!this.reviewGlyphCanvas) {
      this.reviewGlyphCanvas = document.createElement("canvas");
      this.reviewGlyphCanvas.width = 128;
      this.reviewGlyphCanvas.height = 128;
    }
    for (let index = 0; index < 7; index += 1) {
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
          correctSrc: C1.correct,
          missSrc: C1.miss,
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
      this.questionFaceCanvas.width = 980;
      this.questionFaceCanvas.height = 320;
    }
    this.removeClass(face, "answer-hidden");
    this.addClass(text, "answer-hidden");
    this.setText("quiz-question", "");
    const guide = this.leftPanelGuide()?.[0];
    if (this.isSingleBoardChallenge() && guide) {
      this.addClass(face, "quiz-question-face-tall");
      face?.setProperties?.({ src: this.paintPromptWithGuide(guide, question) });
      return;
    }
    this.removeClass(face, "quiz-question-face-tall");
    face?.setProperties?.({
      src: paintSerifBlock({
        canvas: this.questionFaceCanvas,
        text: question,
        color: "#d9f7ff",
        fontSize: 78,
      }),
    });
  }

  private paintPromptWithGuide(guide: string, question: string): string {
    if (!this.questionFaceCanvas) {
      this.questionFaceCanvas = document.createElement("canvas");
    }
    this.questionFaceCanvas.width = 980;
    this.questionFaceCanvas.height = 440;
    const canvas = this.questionFaceCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas.toDataURL("image/png");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#d9f7ff";
    ctx.font = `600 64px ${SCORE_SERIF}`;
    const guideLines = wrapCanvasLines(ctx, guide, 920);
    let y = 8;
    guideLines.forEach(line => {
      ctx.fillText(line, canvas.width / 2, y);
      y += 76;
    });
    y += 36;
    ctx.fillStyle = "#f4fbff";
    ctx.font = `600 78px ${SCORE_SERIF}`;
    wrapCanvasLines(ctx, question, 920).forEach(line => {
      ctx.fillText(line, canvas.width / 2, y);
      y += 90;
    });
    return canvas.toDataURL("image/png");
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
    const visible = false;

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
        this.refreshTitleBanner(this.challengeTitle());
        this.setText("quiz-progress", "");
      } else {
        this.removeClass(kicker, "answer-hidden");
        this.removeClass(timerRing, "answer-hidden");
        this.removeClass(this.document?.getElementById("quiz-header"), "answer-hidden");
        this.setText("quiz-kicker", this.challengeKicker());
        this.refreshTitleBanner(this.challengeTitle());
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
    for (let index = 0; index < this.questions.length; index += 1) {
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
        art: C1,
        onReady: () => this.updateStepLights(),
      }),
    });
    for (let index = 0; index < 7; index += 1) {
      const hit = this.document?.getElementById(`quiz-step-${index}`);
      if (index < this.questions.length) this.removeClass(hit, "answer-hidden");
      else this.addClass(hit, "answer-hidden");
    }
    this.sync();
  }

  private allQuestionsAnswered(): boolean {
    return (
      this.selections.length === this.questions.length &&
      this.selections.every((selection, index) => {
        if (selection === null) return false;
        if (this.isMultiSelectQuestion(index)) return this.bitCount(selection) >= 1;
        return true;
      })
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
        src: C1.title,
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
      this.removeClass(submit, "answer-hidden", "submit-ready", "submit-full");
      this.removeClass(face, "answer-hidden");
      this.addClass(label, "answer-hidden");
      (face as any)?.setProperties?.({ src: C1.submit });
      if (!this.allQuestionsAnswered()) this.addClass(submit, "submit-disabled");
      else this.removeClass(submit, "submit-disabled");
      return;
    }

    this.removeClass(submit, "answer-hidden", "submit-disabled", "submit-ready");
    this.addClass(submit, "submit-full");
    this.removeClass(face, "answer-hidden");
    this.addClass(label, "answer-hidden");
    (face as any)?.setProperties?.({ src: C1.submit });
  }

  private paintHudFace(id: string, src: string, text: string, color?: string): void {
    let canvas = this.hudPlateCanvases.get(id);
    if (!canvas) {
      canvas = document.createElement("canvas");
      this.hudPlateCanvases.set(id, canvas);
    }
    canvas.width = 512;
    canvas.height = 128;
    const face = this.document?.getElementById(id) as any;
    face?.setProperties?.({
      src: paintHudPlate({
        canvas,
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
      this.setResultMode(false);
      this.addClass(this.document?.getElementById("quiz-result-reset"), "quiz-result-hidden");
      this.renderCurrentView();
      this.startTimer();
    });
  };

  private selectAnswer(index: number): void {
    if (!this.challenge || this.submitted || this.challengeClosed) {
      return;
    }
    if (this.timeExpired && !this.isFivePartsChallenge()) {
      return;
    }
    if (this.isMultiSelectQuestion()) {
      this.togglePlacementCard(index);
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
    const selected = this.selectedChoiceValue();
    const tfArt = this.usesTrueFalseArt();
    for (let index = 0; index < 5; index += 1) {
      const button = this.document?.getElementById(`quiz-answer-${index}`) as any;
      const face = this.document?.getElementById(`quiz-answer-face-${index}`) as any;
      this.removeClass(button, "answer-selected", "answer-correct", "answer-wrong", "answer-dimmed");
      let dimmed = false;
      if (tfArt && this.submitted && review) {
        if (index === review.selectedIndex) this.addClass(button, "answer-selected");
        else if (index < 2) {
          this.addClass(button, "answer-dimmed");
          dimmed = true;
        }
      } else if (this.isChoiceSelected(index, selected)) {
        this.addClass(button, "answer-selected");
      } else if (tfArt && selected !== null && index < 2) {
        this.addClass(button, "answer-dimmed");
        dimmed = true;
      }
      this.paintChoiceFace(index);
      button?.setProperties?.({ opacity: dimmed ? 0.45 : 1 });
      face?.setProperties?.({ opacity: dimmed ? 0.45 : 1 });
    }
    this.sync();
  }

  private usesTrueFalseArt(): boolean {
    return this.challenge?.challengeType === STRING_IN_CHALLENGE_TYPE;
  }

  private paintTrueFalseFace(index: number, option: string): void {
    const isTrue = option.trim().toLowerCase() === "true";
    const button = this.document?.getElementById(`quiz-answer-${index}`) as any;
    const face = this.document?.getElementById(`quiz-answer-face-${index}`) as any;
    button?.setProperties?.({ width: 36, height: 21 });
    this.removeClass(face, "answer-hidden");
    face?.setProperties?.({
      src: isTrue ? C1.yes : C1.no,
      width: 36,
      height: 21,
      keepAspectRatio: true,
    });
  }

  private paintChoiceFace(index: number): void {
    const current = this.questions[this.questionIndex];
    const option = current?.options[index];
    const face = this.document?.getElementById(`quiz-answer-face-${index}`);
    if (!option || !face) return;
    this.removeClass(face, "answer-hidden");
    if (this.usesTrueFalseArt()) {
      this.paintTrueFalseFace(index, option);
      return;
    }
    const button = this.document?.getElementById(`quiz-answer-${index}`) as any;
    button?.setProperties?.({ width: "50%", height: 9.4 });
    (face as any)?.setProperties?.({
      width: 42,
      height: 9.4,
      keepAspectRatio: true,
    });
    const useLetterPrefix =
      (current.options.length ?? 0) > 2 ||
      this.challenge?.challengeType === STRING_OK_ERROR_CHALLENGE_TYPE;
    const caption = useLetterPrefix
      ? `${String.fromCharCode(65 + index)}. ${option}`
      : option;
    const selected = this.isChoiceSelected(index, this.selectedChoiceValue());
    this.paintHudFace(
      `quiz-answer-face-${index}`,
      selected ? C1.dark : C1.light,
      caption
    );
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
      "quiz-answer-row-3",
      "quiz-instruction",
      "quiz-explain-face",
      "quiz-explanation",
      "quiz-feedback",
      "quiz-dnd-face",
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
    const entity = (window as any).codePatternChallengeEntity;

    this.setOtherStudentUiDisabled(visible);

    if (entity?.object3D) {
      attachHologramFrame(entity.object3D);
      if (visible && !entity.object3D.visible && this.renderer.xr.isPresenting) {
        const viewer = this.renderer.xr.getCamera();
        const eye = new Vector3();
        const orientation = new Quaternion();
        this.camera.parent?.updateWorldMatrix(true, false);
        this.renderer.xr.updateCamera(this.camera);
        viewer.matrixWorld.decompose(eye, orientation, new Vector3());
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
        const distance = 2.4;
        entity.object3D.position.copy(eye).addScaledVector(direction, distance);
        entity.object3D.quaternion.copy(orientation);
        if (this.isFivePartsChallenge() && !this.isSingleBoardChallenge()) {
          const left = new Vector3(-0.35, 0, 0).applyQuaternion(entity.object3D.quaternion);
          entity.object3D.position.add(left);
        }
      }
      entity.object3D.visible = visible;
      setPanelRayInteraction(entity.object3D, visible, 50000);
      entity.object3D.updateMatrixWorld(true);

      if (visible) {
        this.positionDesktopPanel();
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

    (window as any).isCodePatternChallengeOpen = visible;

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
        if (!target || !object || target === (window as any).codePatternChallengeEntity) {
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
    if (this.renderer.xr.isPresenting || !(window as any).isCodePatternChallengeOpen) {
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
    if (this.dndDragIndex === null) {
      const target = this.getPanelAction(raycaster)?.actionName ?? "";
      if (target && target !== this.hoveredDesktopAction) this.sounds.hover();
      this.hoveredDesktopAction = target;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  private handleDesktopRocketUp = (event: PointerEvent): void => {
    if (this.dndDragIndex === null) return;
    const cardIndex = this.dndDragIndex;
    this.dndDragIndex = null;
    if (this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    }
    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const dropOnBoard = this.hitDndBoard(raycaster);
    if (dropOnBoard) this.setPlacementCard(cardIndex, true);
    else this.togglePlacementCard(cardIndex);
    event.preventDefault();
    event.stopPropagation();
  };

  private bitCount(value: number): number {
    let count = 0;
    let remaining = value >>> 0;
    while (remaining) {
      remaining &= remaining - 1;
      count += 1;
    }
    return count;
  }

  private currentPlacementMask(): number {
    return this.selections[this.questionIndex] ?? 0;
  }

  private setPlacementCard(index: number, onBoard: boolean): void {
    if (!this.challenge || this.submitted || !this.isMultiSelectQuestion()) return;
    const bit = 1 << index;
    let next = this.currentPlacementMask();
    if (onBoard) next |= bit;
    else next &= ~bit;
    if (this.bitCount(next) > 5) return;
    this.selections[this.questionIndex] = next;
    this.selectedIndex = next;
    socket.emit("quickChallengeDraft", {
      quizId: this.challenge.id,
      attemptStartedAt: this.attemptStartedAt,
      answers: this.selections,
    });
    this.updateSelection();
    this.updateSubmitButton();
    this.updateStepLights();
  }

  private togglePlacementCard(index: number): void {
    const onBoard = (this.currentPlacementMask() & (1 << index)) !== 0;
    this.setPlacementCard(index, !onBoard);
  }

  private layoutStudentShell(): void {
    const single = this.isSingleBoardChallenge();
    const wideCode = this.isWideCodePanel();
    const root = this.document?.getElementById("quiz-shell");
    const codeColumn = this.document?.getElementById("code-column");
    const codeBoard = this.document?.getElementById("code-board");
    const codeBoardArt = this.document?.getElementById("code-board-art");
    const codeBoardContent = this.document?.getElementById("code-board-content");
    const codeFace = this.document?.getElementById("code-face");
    const main = this.document?.getElementById("quiz-main");
    const row1 = this.document?.getElementById("quiz-answer-row-1");
    const row2 = this.document?.getElementById("quiz-answer-row-2");
    if (single) {
      this.addClass(root, "quiz-shell-single");
      this.addClass(codeColumn, "answer-hidden");
      this.addClass(main, "quiz-main-tight");
      this.addClass(row1, "answer-row-up");
      this.removeClass(row2, "answer-row-up");
    } else {
      this.removeClass(root, "quiz-shell-single");
      this.removeClass(codeColumn, "answer-hidden");
      this.removeClass(main, "quiz-main-tight");
      this.removeClass(row1, "answer-row-up");
      this.removeClass(row2, "answer-row-up");
    }
    if (wideCode) {
      this.addClass(root, "quiz-shell-wide-code");
      this.addClass(codeColumn, "code-column-wide");
      this.addClass(codeBoard, "quiz-board-wide");
      this.addClass(codeBoardArt, "quiz-board-art-wide");
      this.addClass(codeBoardContent, "quiz-board-content-wide");
      this.addClass(codeFace, "quiz-board-art-wide");
    } else {
      this.removeClass(root, "quiz-shell-wide-code");
      this.removeClass(codeColumn, "code-column-wide");
      this.removeClass(codeBoard, "quiz-board-wide");
      this.removeClass(codeBoardArt, "quiz-board-art-wide");
      this.removeClass(codeBoardContent, "quiz-board-content-wide");
      this.removeClass(codeFace, "quiz-board-art-wide");
    }
    this.sizeLeftBoard(wideCode);
    const entity = (window as any).codePatternChallengeEntity;
    if (entity?.index !== undefined) {
      PanelUI.data.maxWidth[entity.index] = this.studentPanelLayout().meters;
    }
    this.sync();
  }

  private sizeLeftBoard(wide: boolean): void {
    const width = wide ? 120 : 108;
    const boardProps = { width, height: 80 };
    const imageProps = {
      width,
      height: 80,
      objectFit: "fill" as const,
      keepAspectRatio: !wide,
    };
    (this.document?.getElementById("code-column") as any)?.setProperties?.({ width });
    (this.document?.getElementById("code-board") as any)?.setProperties?.(boardProps);
    (this.document?.getElementById("code-board-art") as any)?.setProperties?.(imageProps);
    (this.document?.getElementById("code-board-content") as any)?.setProperties?.({
      width,
      height: 80,
      marginTop: -80,
    });
    (this.document?.getElementById("code-face") as any)?.setProperties?.(imageProps);
    (this.document?.getElementById("quiz-shell") as any)?.setProperties?.({
      width: this.studentPanelLayout().uikitWidth,
    });
  }

  private paintLeftPanel(): void {
    if (this.isSingleBoardChallenge()) return;
    const guide = this.leftPanelGuide();
    if (guide) {
      this.paintGuidePanel(guide);
      return;
    }
    this.paintCodePanel();
  }

  private paintGuidePanel(lines: string[]): void {
    if (!this.codeFaceCanvas) {
      this.codeFaceCanvas = document.createElement("canvas");
      this.codeFaceCanvas.width = 920;
      this.codeFaceCanvas.height = 720;
    }
    const canvas = this.codeFaceCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let y = 24;
    lines.forEach((line, index) => {
      if (!line) {
        y += 28;
        return;
      }
      const heading = index === 0;
      ctx.font = heading ? `700 40px ${SCORE_SERIF}` : `500 36px ${SCORE_SERIF}`;
      ctx.fillStyle = heading ? "#f4fbff" : "#d9f7ff";
      const wrapped = wrapCanvasLines(ctx, line, 820);
      wrapped.forEach(part => {
        ctx.fillText(part, 48, y);
        y += heading ? 56 : 50;
      });
    });
    const face = this.document?.getElementById("code-face") as any;
    face?.setProperties?.({ src: canvas.toDataURL("image/png") });
  }

  private paintCodePanel(): void {
    if (!this.codeFaceCanvas) {
      this.codeFaceCanvas = document.createElement("canvas");
      this.codeFaceCanvas.width = 920;
      this.codeFaceCanvas.height = 720;
    }
    const canvas = this.codeFaceCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const whileTrace = this.challenge?.challengeType === WHILE_TRACE_CHALLENGE_TYPE;
    const whileParts = this.challenge?.challengeType === WHILE_PARTS_CHALLENGE_TYPE;
    const whileFactorial = this.challenge?.challengeType === WHILE_FACTORIAL_CHALLENGE_TYPE;
    const stringOkError = this.challenge?.challengeType === STRING_OK_ERROR_CHALLENGE_TYPE;
    const stringIn = this.challenge?.challengeType === STRING_IN_CHALLENGE_TYPE;
    const stringClean = this.challenge?.challengeType === STRING_CLEAN_CHALLENGE_TYPE;
    const presentation = this.questions[this.questionIndex]?.presentation;
    const lines = presentation?.codeLines ?? [];
    const mono = whileTrace || whileParts || whileFactorial || stringOkError || stringIn || stringClean;
    canvas.width = whileTrace ? 1180 : 920;
    canvas.height = 720;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#d9f7ff";
    ctx.font = `600 42px ${SCORE_SERIF}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Given the code:", 48, 4);
    const lineGap = whileTrace || stringClean ? 72 : whileParts || whileFactorial ? 78 : 88;
    lines.forEach((line, index) => {
      const y = 64 + index * lineGap;
      ctx.font = mono
        ? `500 ${whileTrace || stringClean ? 28 : 32}px Consolas, 'Courier New', monospace`
        : `500 36px ${SCORE_SERIF}`;
      ctx.fillStyle = "#9ad8ea";
      ctx.fillText(String(index + 1), 48, y);
      ctx.fillStyle = "#f4fbff";
      ctx.fillText(line, 110, y);
    });
    if (whileTrace) {
      const footerY = 64 + lines.length * lineGap + 12;
      ctx.font = `600 34px ${SCORE_SERIF}`;
      ctx.fillStyle = "#d9f7ff";
      wrapCanvasLines(ctx, presentation?.footer ?? "", canvas.width - 100).forEach((part, index) => {
        ctx.fillText(part, 48, footerY + index * 42);
      });
    }
    if (stringOkError || stringIn) {
      const footerY = 64 + lines.length * lineGap + 28;
      ctx.font = `600 42px ${SCORE_SERIF}`;
      ctx.fillStyle = "#d9f7ff";
      ctx.fillText(stringIn ? "Given the expression:" : "Given the statement:", 48, footerY);
      ctx.font = `500 32px Consolas, 'Courier New', monospace`;
      ctx.fillStyle = "#f4fbff";
      ctx.fillText(
        presentation?.statement ?? "",
        48,
        footerY + 56,
      );
    }
    const face = this.document?.getElementById("code-face") as any;
    face?.setProperties?.({
      src: canvas.toDataURL("image/png"),
      width: whileTrace ? 120 : 108,
      height: 80,
      objectFit: "fill",
      keepAspectRatio: !whileTrace,
    });
  }

  private dndCardRects(): Array<{ x: number; y: number; w: number; h: number; index: number; onBoard: boolean }> {
    const cardW = 280;
    const cardH = 78;
    const mask = this.currentPlacementMask();
    const board = (this.questions[this.questionIndex]?.options ?? [])
      .map((_, index) => ({ index, onBoard: (mask & (1 << index)) !== 0 }));
    const onBoard = board.filter(item => item.onBoard);
    const inPool = board.filter(item => !item.onBoard);
    const rects: Array<{ x: number; y: number; w: number; h: number; index: number; onBoard: boolean }> = [];
    onBoard.forEach((item, slot) => {
      rects.push({
        index: item.index,
        onBoard: true,
        x: 40 + slot * (cardW + 16),
        y: 18,
        w: cardW,
        h: cardH,
      });
    });
    inPool.forEach((item, slot) => {
      const col = slot % 3;
      const row = Math.floor(slot / 3);
      rects.push({
        index: item.index,
        onBoard: false,
        x: 40 + col * (cardW + 16),
        y: 150 + row * (cardH + 12),
        w: cardW,
        h: cardH,
      });
    });
    return rects;
  }

  private paintDndBoard(): void {
    if (!this.dndFaceCanvas) {
      this.dndFaceCanvas = document.createElement("canvas");
      this.dndFaceCanvas.width = 920;
      this.dndFaceCanvas.height = 360;
    }
    const canvas = this.dndFaceCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(12, 32, 54, 0.55)";
    ctx.fillRect(24, 8, 872, 112);
    ctx.strokeStyle = "rgba(154, 216, 234, 0.45)";
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 8, 872, 112);
    ctx.fillStyle = "#9ad8ea";
    ctx.font = "600 22px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("BOARD", 36, 28);
    const options = this.questions[this.questionIndex]?.options ?? [];
    this.dndCardRects().forEach(rect => {
      ctx.fillStyle = rect.onBoard ? "#2b6cb0" : "#1d4f7c";
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 16);
      } else {
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
      }
      ctx.fill();
      ctx.fillStyle = "#f4fbff";
      ctx.font = "600 22px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrapCanvasLines(ctx, options[rect.index] ?? "", rect.w - 20);
      lines.forEach((line, index) => {
        ctx.fillText(line, rect.x + rect.w / 2, rect.y + rect.h / 2 + (index - (lines.length - 1) / 2) * 24);
      });
    });
    const face = this.document?.getElementById("quiz-dnd-face") as any;
    face?.setProperties?.({ src: canvas.toDataURL("image/png") });
  }

  private hitDndUv(raycaster: Raycaster): { u: number; v: number } | null {
    const panel = (window as any).codePatternChallengeEntity?.object3D;
    if (!panel?.visible || !this.isMultiSelectQuestion() || this.submitted) return null;
    panel.updateMatrixWorld(true);
    const inversePanelMatrix = new Matrix4().copy(panel.matrixWorld).invert();
    const localRay = raycaster.ray.clone().applyMatrix4(inversePanelMatrix);
    if (Math.abs(localRay.direction.z) < 0.00001) return null;
    const distance = -localRay.origin.z / localRay.direction.z;
    if (distance < 0) return null;
    const localHit = localRay.at(distance, localRay.origin.clone());
    const layout = this.studentPanelLayout();
    const panelWidth = layout.meters;
    const panelHeight = 1.62;
    const x = (localHit.x + panelWidth / 2) / panelWidth;
    const y = (panelHeight / 2 - localHit.y) / panelHeight;
    const px = x * layout.uikitWidth;
    const py = y * 90;
    const left = 117.4;
    const top = 32;
    const width = 92;
    const height = 32;
    if (px < left || px > left + width || py < top || py > top + height) return null;
    return { u: (px - left) / width, v: (py - top) / height };
  }

  private hitDndCard(raycaster: Raycaster): number | null {
    const uv = this.hitDndUv(raycaster);
    if (!uv) return null;
    const x = uv.u * 920;
    const y = uv.v * 360;
    const hit = this.dndCardRects().find(rect =>
      x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
    );
    return hit?.index ?? null;
  }

  private hitDndBoard(raycaster: Raycaster): boolean {
    const uv = this.hitDndUv(raycaster);
    if (!uv) return false;
    return uv.v * 360 <= 120;
  }

  update(): void {
    if ((window as any).isCodePatternChallengeOpen) {
      this.positionDesktopPanel();
      this.bringQuizPanelForward();
      // Multi-select uses the option buttons; the old card board is unused.
    }
  }

  private positionDesktopPanel(): void {
    if (this.renderer.xr.isPresenting || !(this.camera instanceof PerspectiveCamera)) return;
    const panel = (window as any).codePatternChallengeEntity?.object3D;
    if (!panel?.visible) return;
    const bounds = getPanelLayoutBounds(panel, this.document);
    if (bounds) frameDesktopPanel(panel, this.camera, bounds);
  }

  private pollDndXrInput(): void {
    if (!this.renderer.xr.isPresenting || this.submitted || !this.isMultiSelectQuestion()) {
      this.lastXrTriggerDown = false;
      return;
    }
    const session = this.renderer.xr.getSession();
    const rightInput = session
      ? [...session.inputSources].find(source => source.handedness === "right")
      : undefined;
    const triggerHeld = Boolean(rightInput?.gamepad?.buttons?.[0]?.pressed);
    if (triggerHeld && !this.lastXrTriggerDown) {
      const raySpace = (this.world as any).player?.raySpaces?.right;
      if (raySpace) {
        raySpace.updateWorldMatrix(true, true);
        const origin = new Vector3();
        const direction = new Vector3(0, 0, -1);
        const rotation = new Quaternion();
        raySpace.getWorldPosition(origin);
        raySpace.getWorldQuaternion(rotation);
        direction.applyQuaternion(rotation).normalize();
        const cardIndex = this.hitDndCard(new Raycaster(origin, direction));
        if (cardIndex !== null) this.togglePlacementCard(cardIndex);
      }
    }
    this.lastXrTriggerDown = triggerHeld;
  }

  private bringQuizPanelForward(): void {
    const panel = (window as any).codePatternChallengeEntity?.object3D;
    if (!panel?.visible) return;
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

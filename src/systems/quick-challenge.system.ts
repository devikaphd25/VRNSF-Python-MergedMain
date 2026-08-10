import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  RayInteractable,
  UIKit,
  type UIKitDocument,
} from "@iwsdk/core";
import { Matrix4, Raycaster, Vector2 } from "three";

import { socket } from "../network/socket";

interface QuickChallengePayload {
  id: string;
  question: string;
  options: string[];
  durationSeconds: number;
  startedAt: number;
}

interface QuickChallengeResult {
  quizId: string;
  correct: boolean;
  correctIndex: number;
  selectedIndex: number | null;
  responseTimeSeconds?: number;
  message: string;
}

interface QuickChallengeEndedPayload {
  quizId?: string;
  winnerStudentId?: string | null;
  winnerName?: string | null;
  winnerTimeSeconds?: number | null;
  stoppedByInstructor?: boolean;
}

export class QuickChallengeSystem extends createSystem({
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
  private selectedIndex: number | null = null;
  private timer?: number;
  private submitted = false;
  private buttonsConnected = false;
  private lastDesktopActivation = 0;
  private responseTimeSeconds = 0;
  private disabledRayTargets: Array<{
    entity: any;
    wasVisible: boolean;
    pointerEvents: any;
    hadRayInteractable: boolean;
  }> = [];

  init(): void {
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

    // UIKit's spatial buttons are used by controller rays. Some desktop
    // browsers, however, do not forward canvas mouse events to a panel that
    // was constructed while hidden. This listener only supplies the missing
    // desktop hit test and is deliberately disabled during an XR session.
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handleDesktopPointer,
      true
    );
  }

  private handleDesktopPointer = (event: PointerEvent): void => {
    if (
      this.renderer.xr.isPresenting ||
      !(window as any).isQuickChallengeOpen ||
      !this.challenge ||
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

    panel.updateMatrixWorld(true);
    const inversePanelMatrix = new Matrix4().copy(panel.matrixWorld).invert();
    const localRay = raycaster.ray.clone().applyMatrix4(inversePanelMatrix);
    if (Math.abs(localRay.direction.z) < 0.00001) return;

    const distance = -localRay.origin.z / localRay.direction.z;
    if (distance < 0) return;
    const localHit = localRay.at(distance, localRay.origin.clone());

    // PanelUI is configured with maxWidth 1.75 and maxHeight 1.35 in
    // index.ts. Converting the ray hit in panel-local space is stable even
    // when the browser is resized or the panel is camera-attached.
    const x = (localHit.x + 0.875) / 1.75;
    const y = (0.675 - localHit.y) / 1.35;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    let action: (() => void) | undefined;
    let actionName = "";

    // These regions match the fixed two-column layout in
    // quick-challenge.uikitml. Keeping the fallback on the canvas avoids an
    // HTML overlay that would interfere with controller rays in a headset.
    if (y >= 0.30 && y < 0.49) {
      const index = x < 0.5 ? 0 : 1;
      action = () => this.selectAnswer(index);
      actionName = `answer-${index}`;
    } else if (y >= 0.49 && y < 0.69) {
      const index = x < 0.5 ? 2 : 3;
      action = () => this.selectAnswer(index);
      actionName = `answer-${index}`;
    } else if (y >= 0.69 && y <= 0.94) {
      if (x < 0.70) {
        action = this.submitAnswer;
        actionName = "submit";
      } else {
        action = this.clearSelection;
        actionName = "clear";
      }
    }

    if (!action) return;

    const now = performance.now();
    if (now - this.lastDesktopActivation < 220) return;
    this.lastDesktopActivation = now;

    event.preventDefault();
    event.stopPropagation();
    action();
    console.log(`[Quick Challenge] Desktop mouse activated ${actionName}.`);
  };

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
      "quiz-clear",
      "quiz-result-close",
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
      "quiz-clear",
      this.clearSelection
    );
    this.bindSpatialButton(
      "quiz-result-close",
      this.closeResult
    );

    console.log(
      "[Quick Challenge] Mouse and spatial-ray buttons connected."
    );
  }

  private bindSpatialButton(
    elementId: string,
    handler: () => void
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
    };

    element.addEventListener("pointerdown", activate);
    element.addEventListener("pointerup", activate);
    element.addEventListener("click", activate);
  }

  private startChallenge = (
    payload: QuickChallengePayload
  ): void => {
    if (!payload || !Array.isArray(payload.options)) {
      return;
    }

    this.challenge = payload;
    this.selectedIndex = null;
    this.submitted = false;
    this.responseTimeSeconds = 0;
    this.setResultMode(false);
    this.setText("quiz-question", payload.question);

    for (let index = 0; index < 4; index += 1) {
      const option = payload.options[index];
      const answer = this.document?.getElementById(`quiz-answer-${index}`);

      if (option === undefined) {
        this.addClass(answer, "answer-hidden");
        this.setText(`quiz-answer-${index}`, "");
      } else {
        this.removeClass(answer, "answer-hidden");
        const prefix = String.fromCharCode(65 + index);
        this.setText(`quiz-answer-${index}`, `${prefix}. ${option}`);
      }
    }

    const secondAnswerRow = this.document?.getElementById(
      "quiz-answer-row-2"
    );
    if (payload.options.length <= 2) {
      this.addClass(secondAnswerRow, "answer-hidden");
    } else {
      this.removeClass(secondAnswerRow, "answer-hidden");
    }

    this.setFeedback("");
    this.updateSelection();
    this.setVisible(true);
    this.startTimer();
    this.sync();
  };

  private selectAnswer(index: number): void {
    if (!this.challenge || this.submitted) {
      return;
    }

    this.selectedIndex = index;
    this.setFeedback("");
    this.updateSelection();
  }

  private clearSelection = (): void => {
    if (this.submitted) {
      return;
    }

    this.selectedIndex = null;
    this.setFeedback("");
    this.updateSelection();
  };

  private closeResult = (): void => {
    if (this.challenge && !this.submitted) return;
    this.setVisible(false);
  };

  private submitAnswer = (): void => {
    if (!this.challenge || this.submitted) {
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
    });
  };

  private showResult = (
    result: QuickChallengeResult
  ): void => {
    if (!this.challenge || result.quizId !== this.challenge.id) {
      return;
    }

    this.submitted = true;
    this.stopTimer();
    if (Number.isFinite(result.responseTimeSeconds)) {
      this.responseTimeSeconds = Number(result.responseTimeSeconds);
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

    this.stopTimer();
    if (payload.stoppedByInstructor) {
      this.challenge = undefined;
      this.setResultMode(false);
      this.setVisible(false);
      return;
    }
    const winnerTime = Number(payload.winnerTimeSeconds);
    const winnerMessage = payload.winnerName
      ? `Winner: ${payload.winnerName}${
          Number.isFinite(winnerTime)
            ? ` — ${winnerTime.toFixed(1)} seconds`
            : ""
        }`
      : "No winner — no correct answer was submitted";

    if (!this.submitted) {
      this.setText("quiz-result-status", "TIME'S UP");
      this.setText("quiz-result-answer", "Your answer: No answer");
      this.setText("quiz-result-time", "Time taken: —");
      const card = this.document?.getElementById("quiz-result-card");
      const status = this.document?.getElementById("quiz-result-status");
      this.removeClass(card, "quiz-result-correct", "quiz-result-wrong");
      this.removeClass(status, "quiz-result-correct", "quiz-result-wrong");
      this.addClass(card, "quiz-result-wrong");
      this.addClass(status, "quiz-result-wrong");
    }

    this.setText("quiz-result-winner", winnerMessage);
    this.setResultMode(true);
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

  private updateTimer(): void {
    if (!this.challenge) {
      return;
    }

    const elapsedSeconds = Math.floor(
      (Date.now() - this.challenge.startedAt) / 1000
    );
    const remaining = Math.max(
      0,
      this.challenge.durationSeconds - elapsedSeconds
    );
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    this.setText(
      "quiz-timer",
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    );

    if (remaining === 0 && !this.submitted) {
      this.submitted = true;
      this.stopTimer();
      this.setFeedback(
        "Time is up.",
        "feedback-incorrect"
      );

      // No event is sent for a timeout. The instructor monitor therefore
      // keeps this student classified as UNANSWERED instead of WRONG.
    }
  }

  private updateSelection(): void {
    for (let index = 0; index < 4; index += 1) {
      const button =
        this.document?.getElementById(
          `quiz-answer-${index}`
        );

      this.removeClass(button, "answer-selected");

      if (index === this.selectedIndex) {
        this.addClass(button, "answer-selected");
      }
    }

    this.sync();
  }

  private showResultCard(result: QuickChallengeResult): void {
    const selectedIndex = result.selectedIndex;
    const selectedOption =
      selectedIndex === null
        ? "No answer"
        : `${String.fromCharCode(65 + selectedIndex)}. ${
            this.challenge?.options[selectedIndex] ?? ""
          }`;
    const status = result.correct ? "CORRECT" : "WRONG";

    this.setText("quiz-result-status", status);
    this.setText("quiz-result-answer", `Your answer: ${selectedOption}`);
    this.setText(
      "quiz-result-time",
      `Time taken: ${this.responseTimeSeconds.toFixed(1)} seconds`
    );
    this.setText("quiz-result-winner", "Waiting for the final ranking...");

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
    this.setResultMode(true);
  }

  private setResultMode(showResult: boolean): void {
    const contentIds = [
      "quiz-question",
      "quiz-answer-row-1",
      "quiz-answer-row-2",
      "quiz-instruction",
      "quiz-actions",
      "quiz-feedback",
    ];

    contentIds.forEach(id => {
      const element = this.document?.getElementById(id);
      if (showResult) this.addClass(element, "quiz-content-hidden");
      else this.removeClass(element, "quiz-content-hidden");
    });

    const resultCard = this.document?.getElementById("quiz-result-card");
    if (showResult) this.removeClass(resultCard, "quiz-result-hidden");
    else this.addClass(resultCard, "quiz-result-hidden");
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
    const entity = (window as any).quickChallengeEntity;

    this.setOtherStudentUiDisabled(visible);

    if (entity?.object3D) {
      entity.object3D.visible = visible;
      entity.object3D.pointerEvents = visible ? "auto" : "none";
      entity.object3D.pointerEventsOrder = 50000;
      entity.object3D.traverse((object: any) => {
        object.pointerEvents = visible ? "auto" : "none";
        object.pointerEventsOrder = 50000;
      });
      entity.object3D.updateMatrixWorld(true);

      if (visible) {
        // The panel is initially created while hidden. Requalifying it after
        // UIKit has built the button meshes refreshes IWSDK's mouse/ray hit
        // targets and BVHs for both desktop and headset input.
        entity.removeComponent(RayInteractable);
        entity.addComponent(RayInteractable);
        requestAnimationFrame(() => {
          entity.object3D?.updateMatrixWorld(true);
        });
      }
    }

    (window as any).isQuickChallengeOpen = visible;

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
    this.stopTimer();
    this.setOtherStudentUiDisabled(false);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.handleDesktopPointer,
      true
    );
    socket.off("quickChallengeStarted", this.startChallenge);
    socket.off("quickChallengeResult", this.showResult);
    socket.off("quickChallengeEnded", this.endChallenge);
  }
}

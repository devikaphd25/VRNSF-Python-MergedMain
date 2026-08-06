import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  UIKit,
  type UIKitDocument,
} from "@iwsdk/core";

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
  message: string;
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
    const activate = (): void => {
      const now = performance.now();

      if (now - lastActivation < 220) {
        return;
      }

      lastActivation = now;
      handler();
    };

    element.addEventListener("pointerdown", activate);
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
    this.setText("quiz-question", payload.question);

    for (let index = 0; index < 4; index += 1) {
      const option = payload.options[index];
      const answer = this.document?.getElementById(`quiz-answer-${index}`);

      if (option === undefined) {
        answer?.classList.add("answer-hidden");
        this.setText(`quiz-answer-${index}`, "");
      } else {
        answer?.classList.remove("answer-hidden");
        const prefix = String.fromCharCode(65 + index);
        this.setText(`quiz-answer-${index}`, `${prefix}. ${option}`);
      }
    }

    const secondAnswerRow = this.document?.getElementById(
      "quiz-answer-row-2"
    );
    if (payload.options.length <= 2) {
      secondAnswerRow?.classList.add("answer-hidden");
    } else {
      secondAnswerRow?.classList.remove("answer-hidden");
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

  private submitAnswer = (): void => {
    if (!this.challenge || this.submitted) {
      return;
    }

    if (this.selectedIndex === null) {
      this.setFeedback("Please select one answer first.");
      return;
    }

    this.submitted = true;
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
    this.setFeedback(
      result.message,
      result.correct
        ? "feedback-correct"
        : "feedback-incorrect"
    );

    window.setTimeout(() => {
      this.setVisible(false);
    }, 3500);
  };

  private endChallenge = (
    payload: { quizId?: string } = {}
  ): void => {
    if (
      payload.quizId &&
      this.challenge &&
      payload.quizId !== this.challenge.id
    ) {
      return;
    }

    this.stopTimer();
    this.setVisible(false);
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

      socket.emit("quickChallengeAnswer", {
        quizId: this.challenge.id,
        selectedIndex: null,
      });
    }
  }

  private updateSelection(): void {
    for (let index = 0; index < 4; index += 1) {
      const button =
        this.document?.getElementById(
          `quiz-answer-${index}`
        );

      button?.classList.remove("answer-selected");

      if (index === this.selectedIndex) {
        button?.classList.add("answer-selected");
      }
    }

    this.sync();
  }

  private setFeedback(
    text: string,
    className?: string
  ): void {
    const element =
      this.document?.getElementById("quiz-feedback");

    element?.classList.remove(
      "feedback-correct",
      "feedback-incorrect"
    );

    if (className) {
      element?.classList.add(className);
    }

    this.setText("quiz-feedback", text);
  }

  private setText(id: string, text: string): void {
    const element =
      this.document?.getElementById(id) as UIKit.Text;

    element?.setProperties({ text });
    this.sync();
  }

  private setVisible(visible: boolean): void {
    const entity = (window as any).quickChallengeEntity;

    if (entity?.object3D) {
      entity.object3D.visible = visible;
      entity.object3D.updateMatrixWorld(true);
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
    socket.off("quickChallengeStarted", this.startChallenge);
    socket.off("quickChallengeResult", this.showResult);
    socket.off("quickChallengeEnded", this.endChallenge);
  }
}

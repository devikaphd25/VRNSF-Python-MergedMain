import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  RayInteractable,
  UIKit,
  type UIKitDocument,
} from "@iwsdk/core";

export class StudentResultSystem extends createSystem({
  resultPanel: {
    required: [PanelUI, PanelDocument],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/student-result-panel.json"
      )
    ]
  }
}) {
  private document?: UIKitDocument;
  private lastCloseActivation = 0;
  private connectedCloseButton?: object;

  init(): void {
    this.queries.resultPanel.subscribe(
      "qualify",
      entity => {
        this.document =
          PanelDocument.data.document[
            entity.index
          ] as UIKitDocument;

        this.connectCloseButton();
      }
    );

    window.addEventListener(
      "studentLabResult",
      this.onResult as EventListener
    );
  }

  private onResult = (
    event: CustomEvent
  ): void => {
    const result = event.detail ?? {};

    /* Reconnect after UIKit has rebuilt a previously hidden panel. */
    this.connectCloseButton();

    this.setText(
      "student-result-status",
      result.status === "completed"
        ? "Lesson completed — welcome back!"
        : "Returned by instructor — progress saved"
    );
    this.setText(
      "student-result-score",
      String(result.score ?? 0)
    );
    this.setText(
      "student-result-correct",
      String(result.correctAnswers ?? 0)
    );
    this.setText(
      "student-result-mistakes",
      String(result.wrongAnswers ?? 0)
    );
    this.setText(
      "student-result-accuracy",
      `${result.accuracy ?? 0}%`
    );
    this.setText(
      "student-result-time",
      `${result.durationSeconds ?? 0} sec`
    );

    this.setVisible(true);
    this.sync();
    window.setTimeout(() => this.connectCloseButton(), 0);
  };

  private connectCloseButton(): void {
    const closeButton = this.document
      ?.getElementById("student-result-close");

    if (!closeButton || closeButton === this.connectedCloseButton) {
      return;
    }

    this.connectedCloseButton = closeButton;
    closeButton.addEventListener("pointerdown", this.activateClose);
    closeButton.addEventListener("click", this.activateClose);
  }

  private setText(
    id: string,
    text: string
  ): void {
    const element =
      this.document
        ?.getElementById(id) as UIKit.Text;

    element?.setProperties({ text });
  }

  private setVisible(visible: boolean): void {
    (window as any).isStudentResultOpen = visible;

    const entity =
      (window as any).studentResultEntity;

    if (entity?.object3D) {
      entity.object3D.visible = visible;
      entity.object3D.pointerEvents = visible ? "auto" : "none";
      entity.object3D.pointerEventsOrder = 70000;
      entity.object3D.traverse((object: any) => {
        object.pointerEvents = visible ? "auto" : "none";
        object.pointerEventsOrder = 70000;
      });
      entity.object3D.updateMatrixWorld(true);

      if (visible) {
        // This panel is constructed while hidden. Refresh the IWSDK
        // interaction component after UIKit has created the X-button meshes,
        // otherwise both canvas mouse input and controller rays can miss it.
        entity.removeComponent(RayInteractable);
        entity.addComponent(RayInteractable);
        requestAnimationFrame(() => {
          entity.object3D?.updateMatrixWorld(true);
          this.connectCloseButton();
          this.sync();
        });
      }
    }
  }

  private closeResult = (): void => {
    this.setVisible(false);
    (window as any)
      .resetStudentRaiseHandAfterResult?.();
  };

  private activateClose = (event?: any): void => {
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const now = performance.now();
    if (now - this.lastCloseActivation < 220) {
      return;
    }

    this.lastCloseActivation = now;
    this.closeResult();
  };

  private sync(): void {
    const document = this.document as any;
    document?.requestUpdate?.();
    document?.update?.();
  }

  destroy(): void {
    window.removeEventListener(
      "studentLabResult",
      this.onResult as EventListener
    );
  }
}

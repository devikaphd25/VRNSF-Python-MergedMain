import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
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

  init(): void {
    this.queries.resultPanel.subscribe(
      "qualify",
      entity => {
        this.document =
          PanelDocument.data.document[
            entity.index
          ] as UIKitDocument;

        this.document
          ?.getElementById(
            "student-result-close"
          )
          ?.addEventListener(
            "click",
            this.closeResult
          );
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
  };

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
      entity.object3D.updateMatrixWorld(true);
    }
  }

  private closeResult = (): void => {
    this.setVisible(false);
    (window as any)
      .resetStudentRaiseHandAfterResult?.();
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

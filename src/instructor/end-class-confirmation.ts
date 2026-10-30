import type { UIKitDocument } from "@iwsdk/core";

/** Show a modal confirmation without leaving task/navigation targets underneath it. */
export function setEndClassConfirmationVisible(document: UIKitDocument, visible: boolean): void {
  const confirmation = document.getElementById("end-class-confirm-row");
  if (!confirmation) return;
  if (confirmation.classList.contains("is-hidden")) confirmation.classList.remove("is-hidden");
  confirmation.setProperties({ display: visible ? "flex" : "none" });
  for (const child of document.rootElement.children) {
    if (child === confirmation || !("classList" in child)) continue;
    const element = child as typeof confirmation;
    const hidden = element.classList.contains("confirmation-obscured");
    if (visible && !hidden) element.classList.add("confirmation-obscured");
    if (!visible && hidden) element.classList.remove("confirmation-obscured");
  }
}

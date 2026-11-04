import type { Object3D } from "three";

/** Keep active overlays reachable while preserving hidden and decorative child rules. */
export function setPanelRayInteraction(panel: Object3D, interactive: boolean, priority = 80000): void {
  // pointerEvents=none alone does not stop descendants with their own auto rule.
  // Gate traversal on the entity wrapper, outside UIKit's reactive properties.
  panel.intersectChildren = interactive;
  panel.pointerEvents = interactive ? "auto" : "none";
  if (!interactive) return;

  panel.traverse(object => {
    object.pointerEventsOrder = priority;
    // UIKit writes Object3D.pointerEventsOrder again after layout changes.
    // Set its public property too, so switching task views retains the priority.
    const component = object as Object3D & {
      setProperties?: (properties: { pointerEventsOrder: number }) => void;
    };
    component.setProperties?.({ pointerEventsOrder: priority });
    // Preserve pointerEvents=none on glyph/instance meshes and hidden UI rows.
  });
}

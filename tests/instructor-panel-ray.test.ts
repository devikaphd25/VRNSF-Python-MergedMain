import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setMaxListeners } from "node:events";
import vm from "node:vm";
import ts from "typescript";
import { parse, interpret } from "@pmndrs/uikitml";
import { Container } from "@pmndrs/uikit";
import { Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from "three";
import { RayIntersector } from "@pmndrs/pointer-events/dist/intersections/ray.js";
import { intersectPointerEventTargets } from "@pmndrs/pointer-events/dist/intersections/utils.js";
import { setInstructorPanelRayInteraction } from "../src/instructor/panel-ray-interaction.ts";
import { DashboardControllerRays } from "../src/instructor/dashboard-controller-rays.ts";
import { setEndClassConfirmationVisible } from "../src/instructor/end-class-confirmation.ts";
import { InstructorControllerVisuals } from "../src/instructor/controller-overlay-visuals.ts";

// UIKit uses many subscriptions per component while laying out a document.
setMaxListeners(0);
// UIKit updates the browser cursor during hover; the layout test has no DOM.
(globalThis as any).document = { body: { style: { cursor: "" } } };

function dashboardEndClassControls(document: any, rays: DashboardControllerRays, ended: () => void) {
  // Run the production event bindings and end-class handler, without a WebGL world.
  const source = ts.createSourceFile("dashboard.ts", readFileSync("src/systems/instructor-dashboard.system.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration)!;
  const methods = declaration.members.filter(member =>
    ["bindSpatialButton", "connectEndClassControls"].includes(member.name?.getText(source) ?? "")
  ).map(member => member.getText(source)).join("\n");
  const context = vm.createContext({ performance, console, setEndClassConfirmationVisible,
    socket: { emit: (name: string) => { if (name === "endClass") ended(); } } });
  vm.runInContext(ts.transpile(`class Controls { ${methods} }; globalThis.Controls = Controls;`,
    { target: ts.ScriptTarget.ES2022 }), context);
  const controls = new context.Controls();
  Object.assign(controls, { dashboardDocument: document, dashboardRays: rays,
    renderer: { xr: { isPresenting: true } }, playDashboardSound() {}, showStatusMessage() {},
    syncDocument() {}, stopLabActivityTimer() {}, setLabMonitorVisible() {}, setLabMonitorAvailable() {},
  });
  controls.connectEndClassControls();
}

function hit(scene: Scene, x: number, y: number): Object3D {
  const space = new Object3D();
  space.position.set(x, y, 2);
  space.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  const intersector = new RayIntersector({ current: space }, {});
  intersector.startIntersection();
  intersectPointerEventTargets("pointer", scene, [{
    id: 1, type: "ray", state: {}, intersector, options: {},
  }] as any);
  return intersector.finalizeIntersection(scene).object;
}

function target(parent: Object3D, x: number, y: number, z = 0): Mesh {
  const mesh = new Mesh(new PlaneGeometry(0.3, 0.16), new MeshBasicMaterial());
  mesh.position.set(x, y, z);
  mesh.pointerEvents = "auto";
  parent.add(mesh);
  return mesh;
}

test("rays reach dashboard corners, tasks, navigation and confirmation above classroom targets", () => {
  const scene = new Scene();
  const dashboard = new Group();
  scene.add(dashboard);
  const positions = [[-0.8, 0.6], [0.8, 0.6], [0, 0], [-0.6, -0.6], [0.6, -0.6]];
  const buttons = positions.map(([x, y]) => target(dashboard, x, y));
  for (const [x, y] of positions) {
    const obstruction = target(scene, x, y, 0.4);
    obstruction.pointerEventsOrder = 65000;
  }
  const decoration = target(dashboard, 0, 0, 0.2);
  decoration.pointerEvents = "none";
  setInstructorPanelRayInteraction(dashboard, true);
  positions.forEach(([x, y], index) => assert.equal(hit(scene, x, y), buttons[index]));
  assert.equal(decoration.pointerEvents, "none");
});

test("hidden panels cannot intercept rays through descendants with explicit auto rules", () => {
  const scene = new Scene();
  const active = new Group();
  const hidden = new Group();
  scene.add(active, hidden);
  const button = target(active, 0, 0);
  target(hidden, 0, 0, 0.3);
  setInstructorPanelRayInteraction(active, true);
  setInstructorPanelRayInteraction(hidden, true);
  setInstructorPanelRayInteraction(hidden, false);
  assert.equal(hit(scene, 0, 0), button);
  setInstructorPanelRayInteraction(hidden, true);
  assert.notEqual(hit(scene, 0, 0), button);
});

test("UIKit preserves ray priority and hidden-row rules after a compact/all-tasks layout change", async () => {
  const scene = new Scene();
  const wrapper = new Group();
  const root = new Container({ width: 800, height: 440 });
  const button = new Container({ width: 220, height: 70, pointerEvents: "auto" });
  root.add(button);
  wrapper.add(root);
  scene.add(wrapper);
  await new Promise(resolve => setTimeout(resolve, 20));
  root.update(16);
  setInstructorPanelRayInteraction(wrapper, true);
  root.setProperties({ width: 1040, height: 870 });
  button.setProperties({ display: "none" });
  root.update(16);
  assert.equal(root.pointerEventsOrder, 80000);
  assert.equal(button.pointerEventsOrder, 80000);
  assert.equal(button.pointerEvents, "none");
  button.setProperties({ display: "flex" });
  // Yoga can take multiple frames when the whole suite runs concurrently.
  for (let frame = 0; frame < 30 && button.pointerEvents !== "auto"; frame++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    root.update(16);
  }
  assert.equal(button.pointerEvents, "auto");
  assert.equal(button.pointerEventsOrder, 80000);
  root.dispose();
});

for (const compact of [true, false]) {
  test(`end-class confirmation has two full-sized ray targets in ${compact ? "current" : "all"} tasks`, async () => {
    const parsed = parse(readFileSync("ui/instructor-menu-option2.uikitml", "utf8"));
    // Preserve the real layout/classes, replacing font/image rendering for Node.
    function layoutOnly(element: any): any {
      if (typeof element === "string") return null;
      return { ...element, type: "container", children: (element.children ?? []).map(layoutOnly).filter(Boolean) };
    }
    parsed.element = layoutOnly(parsed.element);
    const root = interpret(parsed)!;
    const scene = new Scene();
    const wrapper = new Group();
    wrapper.add(root);
    scene.add(wrapper);
    const elements = new Map<string, any>();
    root.traverse(object => { if (object.userData.id) elements.set(object.userData.id, object); });
    if (compact) root.classList.add("dashboard-compact");
    const confirmation = elements.get("end-class-confirm-row");
    confirmation.classList.remove("is-hidden");
    setInstructorPanelRayInteraction(wrapper, true);
    for (let frame = 0; frame < 4; frame++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      root.update(16);
    }
    for (const id of ["end-class-confirm-button", "end-class-cancel-button"]) {
      const button = elements.get(id);
      assert.deepEqual(button.size.value, [220, 70], `${id} must have a usable hit area`);
      const position = button.globalMatrix.value.elements;
      assert.equal(hit(scene, position[12], position[13]), button, `${id} must receive the ray`);
    }
    confirmation.classList.add("is-hidden");
    root.update(16);
    assert.equal(confirmation.pointerEvents, "none");
    root.dispose();
  });
}

test("dedicated controller rays reach distant menu buttons and ignore unrelated scene targets", () => {
  const scene = new Scene();
  const panel = new Group();
  panel.position.z = -2.2;
  scene.add(panel);
  const button = target(panel, 0, 0);
  const obstruction = target(scene, 0, 0, -0.5);
  obstruction.pointerEventsOrder = 999999;
  const space = new Object3D();
  const rays = new DashboardControllerRays(scene, new PerspectiveCamera());
  let activations = 0;
  button.addEventListener("pointerdown", () => activations++);
  const frame = (pressed: boolean) => rays.update(panel, [{ hand: "right", space, pressed }]);
  // The trigger opening the menu must not also launch its first activity.
  frame(true);
  frame(true);
  assert.equal(activations, 0);
  frame(false);
  frame(true);
  frame(true);
  assert.equal(activations, 1);
  const beam = scene.getObjectByName("InstructorDashboardRay-right") as any;
  assert.ok(Math.abs(beam.geometry.getAttribute("position").getZ(1) + 2.2) < 0.001);
  assert.equal(beam.material.depthTest, false);
  assert.equal(beam.material.transparent, true, "ray must render in the same pass as the menu");
  assert.ok(beam.parent.renderOrder > 10000, "ray group must sort after the menu group");
  rays.update(null, []);
  assert.equal(beam.visible, false);
  rays.dispose();
});

for (const compact of [true, false]) {
  test(`controller End Class opens a modal, cancels, then confirms in ${compact ? "current" : "all"} tasks`, async () => {
    const parsed = parse(readFileSync("ui/instructor-menu-option2.uikitml", "utf8"));
    function layoutOnly(element: any): any {
      if (typeof element === "string") return null;
      return { ...element, type: "container", children: (element.children ?? []).map(layoutOnly).filter(Boolean) };
    }
    parsed.element = layoutOnly(parsed.element);
    const root = interpret(parsed)!;
    const scene = new Scene();
    const panel = new Group();
    panel.position.z = -2.2;
    panel.scale.setScalar(0.3);
    panel.add(root);
    scene.add(panel);
    const elements = new Map<string, any>();
    root.traverse(object => { if (object.userData.id) elements.set(object.userData.id, object); });
    if (compact) {
      root.classList.add("dashboard-compact");
      elements.get("dashboard-main-content").classList.add("queue-compact");
      elements.get("task-navigation").classList.add("is-hidden");
      elements.get("option2-task-list").classList.add("list-compact");
      elements.get("queue-task-0").classList.add("card-compact");
      elements.get("dashboard-status-area").classList.add("is-hidden");
      for (let slot = 1; slot < 6; slot++) elements.get(`queue-row-${slot}`).classList.add("is-hidden");
    } else {
      elements.get("current-task-navigation").classList.add("is-hidden");
    }
    const document = { rootElement: root, getElementById: (id: string) => elements.get(id) } as any;
    const modal = elements.get("end-class-confirm-row");
    let confirmed = 0;
    setInstructorPanelRayInteraction(panel, true);
    const space = new Object3D();
    const rays = new DashboardControllerRays(scene, new PerspectiveCamera());
    dashboardEndClassControls(document, rays, () => confirmed++);
    async function settle() {
      for (let i = 0; i < 3; i++) { await new Promise(resolve => setTimeout(resolve, 20)); root.update(16); }
    }
    async function press(id: string, hand: "left" | "right") {
      const button = elements.get(id);
      button.updateWorldMatrix(true, false);
      const position = new Vector3().setFromMatrixPosition(button.matrixWorld);
      space.position.set(position.x, position.y, 0);
      for (const pressed of [false, true, false]) rays.update(panel, [{ hand, space, pressed }]);
      await settle();
    }
    await settle();
    for (const id of compact ? ["option2-home", "current-task-previous", "current-task-next"]
      : ["option2-home", "task-scroll-up", "task-scroll-down"]) {
      const button = elements.get(id);
      button.updateWorldMatrix(true, false);
      const position = new Vector3().setFromMatrixPosition(button.matrixWorld);
      space.position.set(position.x, position.y, 0);
      rays.update(panel, [{ hand: "right", space, pressed: false }]);
      await settle();
      const expected = id.startsWith("task-scroll") ? "rgba(8, 145, 178, 0.7)" : "#0c5475";
      assert.equal(button.properties.value.backgroundColor, expected, `${id} must show hover feedback`);
      let selections = 0;
      button.addEventListener("pointerdown", () => selections++);
      await press(id, "right");
      assert.equal(selections, 1, `${id} must receive one trigger selection`);
    }
    await press("end-class-button", "right");
    assert.equal(modal.isVisible.value, true, "End Class must actually open the confirmation");
    assert.equal(elements.get("end-class-button").isVisible.value, false, "underlying buttons must be hidden");
    assert.equal(confirmed, 0, "opening the confirmation must not end the session");
    await press("end-class-cancel-button", "left");
    assert.equal(modal.isVisible.value, false);
    assert.equal(elements.get("end-class-button").isVisible.value, true);
    await press("end-class-button", "right");
    await press("end-class-confirm-button", "left");
    assert.equal(confirmed, 1);
    rays.dispose();
    root.dispose();
  });
}

test("controller models render over the menu and regain their original materials on close", () => {
  const model = new Group();
  const nested = new Group();
  const material = new MeshBasicMaterial();
  const mesh = new Mesh(new PlaneGeometry(0.1, 0.1), material);
  model.add(nested);
  nested.add(mesh);
  const visuals = new InstructorControllerVisuals();
  visuals.update([model]);
  assert.equal(material.transparent, true, "opaque controllers would render before the transparent menu");
  assert.equal(material.depthTest, false);
  for (const object of [model, nested, mesh]) assert.ok(object.renderOrder > 10000);
  visuals.update([]);
  assert.equal(material.transparent, false);
  assert.equal(material.depthTest, true);
  assert.equal(material.depthWrite, true);
  for (const object of [model, nested, mesh]) assert.equal(object.renderOrder, 0);
});

/**
 * VR login and classroom-entry system.
 * Goal: show Professor/Student controls, look up the course code on the server, register
 * a persistent device user, create/join the active room, and then hand the
 * authenticated identity to src/index.ts. Supports mouse and controller rays.
 */
import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  RayInteractable,
  UIKit,
  UIKitDocument,
  World,
} from "@iwsdk/core";
import {
  BackSide,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector3,
  type Camera,
} from "three";
import { ClassroomSessionService, type CourseOptions } from "../services/classroom-session.service";
import { getPersistentDeviceId } from "../services/device-identity.service";

export type VRLoginUser = {
  id: number;
  username: string;
  fullName?: string;
  role: "student" | "instructor";
  seat?: string | null;
  loginTime: string;
};

type LoginCompletion = {
  user: VRLoginUser;
  roomId: string;
  participantId?: string;
  currentSlide?: number;
};

let completeLogin: ((result: LoginCompletion) => void) | null = null;
let loginPanelEntity: ReturnType<Awaited<ReturnType<typeof World.create>>["createTransformEntity"]> | null = null;
let loginBackground: Mesh | null = null;
let loginBackgroundTexture: Texture | null = null;
let loginLogo: Mesh | null = null;
let loginLogoTexture: Texture | null = null;

export function hideVRLoginBackground(): void {
  if (loginBackground?.parent) loginBackground.parent.remove(loginBackground);
  loginBackground?.geometry.dispose();
  (loginBackground?.material as MeshBasicMaterial | undefined)?.dispose();
  loginBackgroundTexture?.dispose();
  loginBackground = null;
  loginBackgroundTexture = null;
}

export function disposeVRLoginResources(): void {
  hideVRLoginBackground();

  if (loginLogo?.parent) loginLogo.parent.remove(loginLogo);
  loginLogo?.geometry.dispose();
  (loginLogo?.material as MeshBasicMaterial | undefined)?.dispose();
  loginLogoTexture?.dispose();
  loginLogo = null;
  loginLogoTexture = null;

  const panelObject = loginPanelEntity?.object3D;
  if (panelObject) {
    if (panelObject.parent) panelObject.parent.remove(panelObject);
    const disposedTextures = new Set<Texture>();
    const disposedMaterials = new Set<any>();
    const disposedGeometries = new Set<any>();

    panelObject.traverse((object: any) => {
      if (object.geometry && !disposedGeometries.has(object.geometry)) {
        disposedGeometries.add(object.geometry);
        object.geometry.dispose?.();
      }

      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      materials.forEach((material: any) => {
        if (!material || disposedMaterials.has(material)) return;
        disposedMaterials.add(material);
        Object.values(material).forEach((value) => {
          if (value instanceof Texture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose();
          }
        });
        material.dispose?.();
      });
    });
    panelObject.clear();
  }

  // Remove the ECS components when supported by this IWSDK build so UIKit no
  // longer keeps the hidden login document or its render target in memory.
  try {
    (loginPanelEntity as any)?.removeComponent?.(RayInteractable);
    (loginPanelEntity as any)?.removeComponent?.(PanelUI);
  } catch (error) {
    console.warn("[Login] UIKit component cleanup was not available.", error);
  }
  loginPanelEntity = null;
}

function attachLoginLogoToPanel(): void {
  const panelObject = loginPanelEntity?.object3D;
  if (!panelObject || !loginLogo) {
    console.warn("[Login] Could not attach the UMES logo to the panel");
    return;
  }

  // Keep the logo in panel-local 3D space. UIKit containers manage their own
  // children and may clip custom Three.js meshes, while the panel entity still
  // makes the logo follow both the Professor and Student layouts.
  panelObject.add(loginLogo);
  loginLogo.position.set(-0.31, 0.565, 0.015);
  loginLogo.rotation.set(0, 0, 0);
  loginLogo.scale.set(1, 1, 1);
  loginLogo.visible = true;
  loginLogo.frustumCulled = false;
  panelObject.updateMatrixWorld(true);
  console.log("[Login] UMES logo attached to login panel");
}

function sizeLoginPanel(selection: boolean): void {
  if (!loginPanelEntity) return;
  // PanelUI compensates for object scale; use its actual size constraints.
  PanelUI.data.maxWidth[loginPanelEntity.index] = selection ? 0.95 : 1.16;
  PanelUI.data.maxHeight[loginPanelEntity.index] = selection ? 1.10 : 1.34;
  loginPanelEntity.object3D?.scale.setScalar(1);
}

function positionLoginLogo(role: "student" | "instructor"): void {
  if (!loginLogo) return;

  // The Student layout hides the PIN and keypad, making the panel much
  // shorter. Keep the logo aligned with the brand row in both layouts.
  loginLogo.position.set(
    -0.31,
    role === "student" ? 0.275 : 0.565,
    0.015
  );
  loginLogo.updateMatrixWorld(true);
}

function setClass(element: any, className: string, enabled: boolean): void {
  if (!element) return;
  if (enabled) element.classList.add(className);
  else while (element.classList.contains(className)) element.classList.remove(className);
}

async function createLocalDeviceUser(input: {
  deviceId: string;
  role: "student" | "instructor";
  displayName: string;
  seat: string | null;
}): Promise<VRLoginUser> {
  const response = await fetch("/api/device-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const result = await response.json();
  if (!response.ok || !result?.success || !result?.user) {
    throw new Error(result?.message || "Could not register this headset.");
  }

  return {
    id: Number(result.user.id),
    username: String(result.user.username),
    fullName: String(result.user.fullName || input.displayName),
    role: input.role,
    seat: result.user.seat ?? input.seat,
    loginTime: new Date().toISOString(),
  };
}

export class ClassroomLoginSystem extends createSystem({
  loginPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/panel.json")],
  },
}) {
  private waitTimer: ReturnType<typeof setInterval> | null = null;
  private boundDocuments = new WeakSet<UIKitDocument>();
  private enteredPin = "";
  private selectedRole: "instructor" | "student" = "instructor";
  private busy = false;
  private logoAnchor: any;
  private logoPosition = new Vector3();

  update(): void {
    if (!loginLogo?.parent || !this.logoAnchor?.getWorldPosition) return;
    this.logoAnchor.getWorldPosition(this.logoPosition);
    loginLogo.parent.worldToLocal(this.logoPosition);
    loginLogo.position.copy(this.logoPosition);
    loginLogo.position.z += 0.015;
  }

  init(): void {
    this.queries.loginPanel.subscribe("qualify", (entity) => {
      const document = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!document || this.boundDocuments.has(document)) return;
      this.boundDocuments.add(document);
      this.bind(document);
    });
  }

  destroy(): void {
    this.stopWaiting();
  }

  private stopWaiting(): void {
    if (this.waitTimer !== null) clearInterval(this.waitTimer);
    this.waitTimer = null;
  }

  private finish(result: LoginCompletion): void {
    this.stopWaiting();
    localStorage.setItem("vrUser", JSON.stringify(result.user));
    sessionStorage.setItem("vrClassroomSession", JSON.stringify({
      roomId: result.roomId,
      participantId: result.participantId ?? null,
      currentSlide: result.currentSlide ?? 0,
    }));
    if (loginPanelEntity?.object3D) loginPanelEntity.object3D.visible = false;
    // Remove the large campus panorama immediately. A normal browser RAF can
    // be suspended while Quest is presenting an XR session, which previously
    // left this sphere visible through openings in the classroom ceiling.
    hideVRLoginBackground();
    if (loginLogo?.parent) loginLogo.parent.remove(loginLogo);
    loginLogo?.geometry.dispose();
    (loginLogo?.material as MeshBasicMaterial | undefined)?.dispose();
    loginLogoTexture?.dispose();
    loginLogo = null;
    loginLogoTexture = null;
    completeLogin?.(result);
    completeLogin = null;
  }

  private bind(document: UIKitDocument): void {
    this.logoAnchor = document.getElementById("umes-logo-container");
    const professorButton = document.getElementById("role-professor")!;
    const studentButton = document.getElementById("role-student")!;
    const confirmButton = document.getElementById("confirm-btn")!;
    const title = document.getElementById("title-text") as UIKit.Text;
    const subtitle = document.getElementById("subtitle-text") as UIKit.Text;
    const pinRow = document.getElementById("pin-row")!;
    const pinLabel = document.getElementById("pin-label")!;
    const keypad = document.getElementById("keypad")!;

    const selectionPanel = document.getElementById("class-selection")!;
    const selectionBack = document.getElementById("selection-back")!;
    const roleToggle = document.getElementById("role-toggle")!;
    const helper = document.getElementById("helper-text") as UIKit.Text;
    let options: CourseOptions | null = null;
    let weekIndex = 0;
    let dayIndex = 0;

    const syncPanel = (): void => {
      const mutableDocument = document as UIKitDocument & {
        requestUpdate?: () => void;
        update?: () => void;
      };
      mutableDocument.requestUpdate?.();
      mutableDocument.update?.();
    };

    const setStatus = (message: string, error = false): void => {
      subtitle.setProperties({ text: message });
      setClass(subtitle, "subtitle-error", error);
      setClass(subtitle, "subtitle-success", !error && message.includes("joining"));
      syncPanel();
    };

    const refreshPin = (): void => {
      for (let index = 0; index < 6; index += 1) {
        const digit = document.getElementById(`pin-digit-${index}`) as UIKit.Text;
        const value = this.enteredPin[index] ?? "-";
        digit?.setProperties({ text: value });
        setClass(document.getElementById(`pin-slot-${index}`), "pin-slot-filled", index < this.enteredPin.length);
      }
      syncPanel();
    };

    const showProfessor = (): void => {
      if (this.busy) return;
      sizeLoginPanel(false);
      options = null;
      setClass(selectionPanel, "is-hidden", true);
      setClass(selectionBack, "is-hidden", true);
      setClass(confirmButton, "selection-action", false);
      setClass(roleToggle, "is-hidden", false);
      helper.setProperties({ text: "Students automatically join after you start the class" });
      this.stopWaiting();
      this.selectedRole = "instructor";
      this.enteredPin = "";
      refreshPin();
      setClass(professorButton, "role-segment-selected", true);
      setClass(studentButton, "role-segment-selected", false);
      [pinLabel, pinRow, keypad, confirmButton].forEach((item) => setClass(item, "is-hidden", false));
      title.setProperties({ text: "Create or Join a Classroom" });
      (pinLabel as UIKit.Text).setProperties({ text: "Enter the 6-digit course code" });
      (confirmButton as UIKit.Text).setProperties({ text: "Continue" });
      positionLoginLogo("instructor");
      setStatus("The course code selects your course");
    };

    const tryStudentJoin = async (): Promise<void> => {
      if (this.busy) return;
      this.busy = true;
      try {
        const deviceId = getPersistentDeviceId();
        const session = await ClassroomSessionService.joinLatest(deviceId);
        if (!session) {
          setStatus("Waiting for the instructor to start the classroom...");
          return;
        }

        setStatus(`${session.display_name} - ${session.seat} - joining...`);
        const user = await createLocalDeviceUser({
          deviceId,
          role: "student",
          displayName: session.display_name,
          seat: session.seat,
        });
        this.finish({
          user,
          roomId: session.room_id,
          participantId: session.participant_id,
          currentSlide: session.current_slide,
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not join classroom.", true);
      } finally {
        this.busy = false;
      }
    };

    const showStudent = (): void => {
      if (this.busy) return;
      sizeLoginPanel(false);
      options = null;
      setClass(selectionPanel, "is-hidden", true);
      setClass(selectionBack, "is-hidden", true);
      setClass(confirmButton, "selection-action", false);
      setClass(roleToggle, "is-hidden", false);
      helper.setProperties({ text: "You will join automatically when the instructor starts the class" });
      this.selectedRole = "student";
      this.enteredPin = "";
      refreshPin();
      setClass(studentButton, "role-segment-selected", true);
      setClass(professorButton, "role-segment-selected", false);
      [pinLabel, pinRow, keypad].forEach((item) => setClass(item, "is-hidden", true));
      setClass(confirmButton, "is-hidden", false);
      title.setProperties({ text: "Join a Classroom" });
      (confirmButton as UIKit.Text).setProperties({ text: "Join Latest Classroom" });
      positionLoginLogo("student");
      setStatus("Finding the latest active classroom...");
      this.stopWaiting();
      void tryStudentJoin();
      this.waitTimer = setInterval(() => {
        void tryStudentJoin();
      }, 2000);
    };

    const refreshSelection = (): void => {
      if (!options) return;
      const week = options.weeks[weekIndex];
      const day = week?.days[dayIndex];
      (document.getElementById("selected-course") as UIKit.Text).setProperties({ text: `${options.course.course_code} - ${options.course.title}` });
      (document.getElementById("selected-week") as UIKit.Text).setProperties({ text: week ? `Week ${week.week_number}` : "No weeks available" });
      (document.getElementById("selected-day") as UIKit.Text).setProperties({ text: day ? `Day ${day.day_number}` : "No days available" });
      setClass(confirmButton, "is-hidden", !day);
      setStatus(day ? "Ready to start. Students are waiting." : "Add course days before starting this class.");
      syncPanel();
    };
    const showSelection = (): void => {
      sizeLoginPanel(true);
      this.stopWaiting();
      [pinLabel, pinRow, keypad, roleToggle].forEach(item => setClass(item, "is-hidden", true));
      setClass(selectionPanel, "is-hidden", false);
      setClass(selectionBack, "is-hidden", false);
      setClass(confirmButton, "selection-action", true);
      title.setProperties({ text: "Choose Your Class" });
      (confirmButton as UIKit.Text).setProperties({ text: "Start Class" });
      helper.setProperties({ text: "Students join only after you press Start Class" });
      positionLoginLogo("instructor");
      refreshSelection();
    };
    for (const [id, change] of [["week-prev", -1], ["week-next", 1], ["day-prev", -1], ["day-next", 1]] as const) {
      document.getElementById(id)?.addEventListener("pointerdown", () => {
        if (this.busy || !options) return;
        if (id.startsWith("week")) {
          weekIndex = Math.max(0, Math.min(options.weeks.length - 1, weekIndex + change));
          dayIndex = 0;
        } else {
          dayIndex = Math.max(0, Math.min((options.weeks[weekIndex]?.days.length ?? 0) - 1, dayIndex + change));
        }
        refreshSelection();
      });
    }
    selectionBack.addEventListener("pointerdown", showProfessor);

    for (const digit of "0123456789") {
      document.getElementById(`key-${digit}`)?.addEventListener("pointerdown", () => {
        if (!this.busy && this.enteredPin.length < 6) {
          this.enteredPin += digit;
          refreshPin();
        }
      });
    }

    document.getElementById("key-backspace")?.addEventListener("pointerdown", () => {
      if (!this.busy) {
        this.enteredPin = this.enteredPin.slice(0, -1);
        refreshPin();
      }
    });

    professorButton.addEventListener("pointerdown", showProfessor);
    studentButton.addEventListener("pointerdown", showStudent);
    confirmButton.addEventListener("pointerdown", async () => {
      if (this.busy) return;
      if (this.selectedRole === "student") {
        await tryStudentJoin();
        return;
      }

      if (this.enteredPin.length !== 6) {
        setStatus("Enter all 6 digits", true);
        return;
      }

      this.busy = true;
      try {
        if (!options) {
          setStatus("Checking course code...");
          options = await ClassroomSessionService.options(this.enteredPin);
          weekIndex = 0;
          dayIndex = 0;
          showSelection();
          return;
        }
        const week = options.weeks[weekIndex];
        const day = week?.days[dayIndex];
        if (!week || !day) throw new Error("Select an available week and day.");
        setStatus("Starting classroom...");
        // Keep the local instructor identity separate from the student
        // identity. This is especially important when both roles are tested
        // in different tabs of the same browser, because those tabs share
        // localStorage and therefore share the base device UUID.
        const deviceId = `${getPersistentDeviceId()}:instructor`;
        const user = await createLocalDeviceUser({
          deviceId,
          role: "instructor",
          displayName: "Instructor",
          seat: null,
        });
        const session = await ClassroomSessionService.create(user.id, this.enteredPin, week.id, day.id);
        this.finish({ user, roomId: session.room_id });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not create classroom.", true);
      } finally {
        this.busy = false;
      }
    });

    showProfessor();
  }
}

export function showVRLoginPanel(
  world: Awaited<ReturnType<typeof World.create>>,
  camera: Camera,
): Promise<LoginCompletion> {
  return new Promise((resolve) => {
    completeLogin = resolve;
    loginBackgroundTexture = new TextureLoader().load("./images/umes-campus-360.png");
    loginBackgroundTexture.colorSpace = "srgb";
    loginBackground = new Mesh(
      new SphereGeometry(24, 64, 40),
      new MeshBasicMaterial({
        map: loginBackgroundTexture,
        side: BackSide,
        toneMapped: false,
      }),
    );
    loginBackground.name = "UMESLoginPanorama";
    loginBackground.rotation.y = Math.PI;
    loginBackground.renderOrder = -1000;
    world.scene.add(loginBackground);

    loginLogoTexture = new TextureLoader().load("./images/umes-logo-icon.png");
    loginLogo = new Mesh(
      new PlaneGeometry(0.1, 0.1),
      new MeshBasicMaterial({
        map: loginLogoTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    );
    loginLogo.name = "UMESLoginLogo";
    loginLogo.renderOrder = 2000;

    world.registerSystem(ClassroomLoginSystem, { priority: 0 });
    loginPanelEntity = world
      .createTransformEntity()
      .addComponent(PanelUI, { config: "./ui/panel.json", maxWidth: 1.16, maxHeight: 1.34 })
      .addComponent(RayInteractable);

    if (loginPanelEntity.object3D) {
      camera.add(loginPanelEntity.object3D);
      loginPanelEntity.object3D.position.set(0, -0.01, -1.6);
      loginPanelEntity.object3D.frustumCulled = false;
      attachLoginLogoToPanel();
    }

  });
}

import {
  createSystem,
  PanelUI,
  PanelDocument,
  UIKitDocument,
  UIKit,
  eq
} from "@iwsdk/core";

import { socket } from "../network/socket";

type Destination =
  | "Class"
  | "Presentation"
  | "Game 1";

interface DashboardStudent {
  id: string;
  name?: string;
  seat?: string;
  mode?: string;
  isDemo?: boolean;
}

export class InstructorDashboardSystem extends createSystem({
  dashboard: {
    required: [
      PanelUI,
      PanelDocument
    ],

    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-menu.json"
      )
    ]
  },

  menuButton: {
    required: [
      PanelUI,
      PanelDocument
    ],

    where: [
      eq(
        PanelUI,
        "config",
        "./ui/instructor-menu-button.json"
      )
    ]
  }
}) {
  private document?: UIKitDocument;

  private readonly maxRows = 3;

  private instructorMuted = true;

  private studentsByRow =
    new Map<number, DashboardStudent>();

  private selectedDestinationByRow =
    new Map<number, Destination>();

  private globalDestination: Destination =
    "Class";

  // ======================================================
  // RAY CONTROLLER STATE
  // ======================================================

  private isRayHovering = false;
  private hoveredElementId: string | null = null;

  // ======================================================
  // INITIALIZATION
  // ======================================================
  init(): void {
    console.log(
      "[InstructorDashboardSystem] Started."
    );

    socket.on(
      "studentList",
      (
        students: DashboardStudent[]
      ) => {
        this.updateOnlineStudents(
          students
        );
      }
    );

    // ======================================================
    // SMALL MENU BUTTON
    // ======================================================

    this.queries.menuButton.subscribe(
      "qualify",
      (entity) => {
        const buttonDocument =
          PanelDocument.data.document[
            entity.index
          ] as UIKitDocument;

        if (!buttonDocument) {
          console.error(
            "[Instructor Dashboard] Menu button document was not found."
          );

          return;
        }

        const openButton =
          buttonDocument.getElementById(
            "instructor-menu-open-button"
          );

        if (!openButton) {
          console.error(
            "[Instructor Dashboard] Open button was not found."
          );

          return;
        }

        openButton.addEventListener(
          "click",
          () => {
            console.log(
              "[Instructor Dashboard] Menu icon clicked."
            );

            this.openDashboard();
          }
        );

        console.log(
          "[Instructor Dashboard] Open button connected."
        );
      }
    );

    // ======================================================
    // LARGE DASHBOARD
    // ======================================================

    this.queries.dashboard.subscribe(
      "qualify",
      (entity) => {
        const document =
          PanelDocument.data.document[
            entity.index
          ] as UIKitDocument;

        if (!document) {
          console.error(
            "[InstructorDashboardSystem] Dashboard document was not found."
          );

          return;
        }

        this.document = document;

        console.log(
          "[InstructorDashboardSystem] Dashboard ready."
        );

        this.connectCloseButton();
        this.connectMicrophoneButton();
        this.connectGlobalControls();
        this.connectStudentRows();
        // Connect hover and ray feedback after all buttons exist
        this.setupRayInteraction();
        socket.emit(
          "requestStudentList"
        );
      }
    );
  }

  // ======================================================
  // DASHBOARD VISIBILITY HELPERS
  // ======================================================

  private isDashboardOpen(): boolean {
    return Boolean(
      (window as any)
        .isInstructorDashboardOpen
    );
  }

  private openDashboard(): void {
    const setDashboardOpen =
      (window as any)
        .setInstructorDashboardOpen;

    if (
      typeof setDashboardOpen ===
      "function"
    ) {
      setDashboardOpen(true);
    }
  }

  private closeDashboard(): void {
    const setDashboardOpen =
      (window as any)
        .setInstructorDashboardOpen;

    if (
      typeof setDashboardOpen ===
      "function"
    ) {
      setDashboardOpen(false);
    }
  }

  // ======================================================
  // RAY INTERACTION SETUP
  // ======================================================

  private setupRayInteraction(): void {
    if (!this.document) {
      return;
    }

    const interactiveElements = (this.document as any).querySelectorAll?.(
      "button, [onclick], [data-interactable]"
    ) || [];

    console.log(
      "[Instructor Dashboard] Found interactive elements:",
      interactiveElements.length
    );

    interactiveElements.forEach((element: any, index: number) => {
      console.log(
        `[Instructor Dashboard] Element ${index + 1}:`,
        element.id || "unnamed",
        element.tagName
      );

      element.addEventListener("pointerover", () => {
        this.isRayHovering = true;
        this.hoveredElementId = element.id || "unknown";
        
        element.style.transition = "all 0.2s ease";
        element.style.transform = "scale(1.05)";
        element.style.boxShadow = "0 0 25px rgba(96, 165, 250, 0.4)";
        element.style.borderColor = "rgba(96, 165, 250, 0.8)";
        
        console.log("[Ray] Hovering over:", this.hoveredElementId);
      });

      element.addEventListener("pointerout", () => {
        this.isRayHovering = false;
        this.hoveredElementId = null;
        
        element.style.transform = "scale(1)";
        element.style.boxShadow = "none";
        element.style.borderColor = "";
      });

      element.addEventListener("click", () => {
        if (this.isDashboardOpen()) {
          console.log("[Ray] Clicked:", element.id || "unknown element");
        }
      });
    });

    console.log(
      "[Instructor Dashboard] Ray interaction setup complete"
    );
  }

  // ======================================================
  // UI UPDATE
  // ======================================================

  private sync(): void {
    if (!this.document) {
      return;
    }

    const document =
      this.document as any;

    if (
      typeof document.requestUpdate ===
      "function"
    ) {
      document.requestUpdate();
    }

    if (
      typeof document.update ===
      "function"
    ) {
      document.update();
    }
  }

  private showElement(
    element: any
  ): void {
    if (!element) {
      return;
    }

    if (
      element.classList.contains(
        "student-hidden"
      )
    ) {
      element.classList.remove(
        "student-hidden"
      );
    }

    if (
      !element.classList.contains(
        "student-visible"
      )
    ) {
      element.classList.add(
        "student-visible"
      );
    }
  }

  private hideElement(
    element: any
  ): void {
    if (!element) {
      return;
    }

    if (
      element.classList.contains(
        "student-visible"
      )
    ) {
      element.classList.remove(
        "student-visible"
      );
    }

    if (
      !element.classList.contains(
        "student-hidden"
      )
    ) {
      element.classList.add(
        "student-hidden"
      );
    }
  }

  private openDropdown(
    element: any
  ): void {
    if (!element) {
      return;
    }

    if (
      element.classList.contains(
        "dropdown-hidden"
      )
    ) {
      element.classList.remove(
        "dropdown-hidden"
      );
    }

    if (
      !element.classList.contains(
        "dropdown-visible"
      )
    ) {
      element.classList.add(
        "dropdown-visible"
      );
    }

    this.sync();
  }

  private closeDropdown(
    element: any
  ): void {
    if (!element) {
      return;
    }

    if (
      element.classList.contains(
        "dropdown-visible"
      )
    ) {
      element.classList.remove(
        "dropdown-visible"
      );
    }

    if (
      !element.classList.contains(
        "dropdown-hidden"
      )
    ) {
      element.classList.add(
        "dropdown-hidden"
      );
    }

    this.sync();
  }

  private toggleDropdown(
    element: any
  ): void {
    if (!element) {
      return;
    }

    const isOpen =
      element.classList.contains(
        "dropdown-visible"
      );

    if (isOpen) {
      this.closeDropdown(
        element
      );
    } else {
      this.openDropdown(
        element
      );
    }
  }

  // ======================================================
  // ONLINE STUDENTS
  // ======================================================

  private updateOnlineStudents(
    students: DashboardStudent[]
  ): void {
    if (!this.document) {
      return;
    }

    const realStudents =
      students.filter(
        (student) =>
          !student.isDemo &&
          student.seat &&
          student.seat !==
            "Not selected"
      );

    const countText =
      this.document.getElementById(
        "online-student-count"
      ) as UIKit.Text;

    countText?.setProperties({
      text:
        `${realStudents.length} Online`
    });

    this.studentsByRow.clear();

    for (
      let rowNumber = 1;
      rowNumber <= this.maxRows;
      rowNumber++
    ) {
      const student =
        realStudents[
          rowNumber - 1
        ];

      const row =
        this.document.getElementById(
          `student-row-${rowNumber}`
        );

      const nameText =
        this.document.getElementById(
          `student-name-${rowNumber}`
        ) as UIKit.Text;

      const seatText =
        this.document.getElementById(
          `student-seat-${rowNumber}`
        ) as UIKit.Text;

      const statusText =
        this.document.getElementById(
          `student-status-${rowNumber}`
        ) as UIKit.Text;

      const destinationText =
        this.document.getElementById(
          `student-destination-text-${rowNumber}`
        ) as UIKit.Text;

      if (!student) {
        this.hideElement(
          row
        );

        continue;
      }

      this.showElement(
        row
      );

      this.studentsByRow.set(
        rowNumber,
        student
      );

      const selectedDestination =
        this.selectedDestinationByRow.get(
          rowNumber
        ) ?? "Class";

      this.selectedDestinationByRow.set(
        rowNumber,
        selectedDestination
      );

      nameText?.setProperties({
        text:
          student.name ||
          student.id.substring(
            0,
            6
          )
      });

      seatText?.setProperties({
        text:
          student.seat ||
          "No seat"
      });

      statusText?.setProperties({
        text: "Online"
      });

      destinationText?.setProperties({
        text:
          selectedDestination
      });
    }

    this.sync();
  }

  // ======================================================
  // CLOSE BUTTON
  // ======================================================

  private connectCloseButton(): void {
    if (!this.document) {
      return;
    }

    const closeButton =
      this.document.getElementById(
        "dashboard-close-button"
      );

    closeButton?.addEventListener(
      "click",
      () => {
        console.log(
          "[Instructor Dashboard] Close clicked."
        );

        this.closeDashboard();
      }
    );
  }

  // ======================================================
  // MICROPHONE
  // ======================================================

  private connectMicrophoneButton(): void {
    if (!this.document) {
      return;
    }

    const micButton =
      this.document.getElementById(
        "instructor-mic-button"
      );

    const micIcon =
      this.document.getElementById(
        "instructor-mic-icon"
      );

    console.log(
      "[InstructorDashboardSystem] Mic button found:",
      Boolean(micButton)
    );

    console.log(
      "[InstructorDashboardSystem] Mic icon found:",
      Boolean(micIcon)
    );

    if (
      !micButton ||
      !micIcon
    ) {
      console.error(
        "[InstructorDashboardSystem] Microphone elements were not found."
      );

      return;
    }

    micButton.addEventListener(
      "click",
      () => {
        this.instructorMuted =
          !this.instructorMuted;

        const nextImage =
          this.instructorMuted
            ? "./images/mic-off.webp"
            : "./images/mic-on.jpg";

        (micIcon as any).setProperties({
          src: nextImage
        });

        if (this.instructorMuted) {
          micButton.classList.remove(
            "mic-button-unmuted"
          );

          micButton.classList.add(
            "mic-button-muted"
          );
        } else {
          micButton.classList.remove(
            "mic-button-muted"
          );

          micButton.classList.add(
            "mic-button-unmuted"
          );
        }

        console.log(
          "[Instructor Dashboard] Microphone:",
          this.instructorMuted
            ? "Muted"
            : "Unmuted"
        );

        socket.emit(
          "instructorMicrophone",
          {
            muted:
              this.instructorMuted
          }
        );

        this.sync();
      }
    );
  }

  // ======================================================
  // GLOBAL CONTROLS
  // ======================================================

  private connectGlobalControls(): void {
    if (!this.document) {
      return;
    }

    const toggleButton = this.document.getElementById(
      "global-destination-toggle"
    );

    const options = this.document.getElementById(
      "global-destination-options"
    );

    const destinationText = this.document.getElementById(
      "global-destination-text"
    ) as UIKit.Text;

    console.log("[Instructor Dashboard] Global toggle button found:", !!toggleButton);
    console.log("[Instructor Dashboard] Global options found:", !!options);
    console.log("[Instructor Dashboard] Global destination text found:", !!destinationText);

    if (toggleButton) {
      toggleButton.addEventListener(
        "click",
        (event) => {
          console.log("[Instructor Dashboard] 🔥 Global toggle button CLICKED!");
          event.stopPropagation();
          
          if (options) {
            const isHidden = options.classList.contains("dropdown-hidden");
            console.log("[Instructor Dashboard] Dropdown is hidden:", isHidden);
            
            if (isHidden) {
              options.classList.remove("dropdown-hidden");
              options.classList.add("dropdown-visible");
              console.log("[Instructor Dashboard] Dropdown OPENED");
            } else {
              options.classList.remove("dropdown-visible");
              options.classList.add("dropdown-hidden");
              console.log("[Instructor Dashboard] Dropdown CLOSED");
            }
          }
        }
      );
    } else {
      console.error("[Instructor Dashboard] ❌ Global toggle button NOT FOUND!");
    }

    const choices: Array<{
      id: string;
      destination: Destination;
    }> = [
      {
        id: "global-class-option",
        destination: "Class"
      },
      {
        id: "global-presentation-option",
        destination: "Presentation"
      },
      {
        id: "global-game1-option",
        destination: "Game 1"
      }
    ];

    choices.forEach(({ id, destination }) => {
      const option = this.document?.getElementById(id);
      
      console.log(`[Instructor Dashboard] Option ${id} found:`, !!option);
      
      if (option) {
        option.addEventListener("click", (event) => {
          event.stopPropagation();
          
          console.log(`[Instructor Dashboard] 🔥 Option clicked: ${destination}`);
          
          this.globalDestination = destination;

          destinationText?.setProperties({
            text: destination
          });

          // Close dropdown
          if (options) {
            options.classList.remove("dropdown-visible");
            options.classList.add("dropdown-hidden");
          }

          console.log("[Instructor Dashboard] Global destination:", destination);

          this.sync();
        });
      }
    });

    // ======================================================
    // START ALL BUTTON
    // ======================================================

    const startAllButton = this.document.getElementById("start-all-button");

    startAllButton?.addEventListener(
      "click",
      (): void => {
        console.log(`[Instructor Dashboard] 🔥🔥🔥 START ALL CLICKED → ${this.globalDestination} 🔥🔥🔥`);
        this.sendAllStudentsToDestination(this.globalDestination);
      }
    );

    // ======================================================
    // RETURN ALL BUTTON
    // ======================================================

    const returnAllButton = this.document.getElementById("return-all-button");

    returnAllButton?.addEventListener(
      "click",
      (): void => {
        this.globalDestination = "Class";
        destinationText?.setProperties({
          text: "Class"
        });
        console.log("[Instructor Dashboard] Return All to Class.");
        this.returnAllStudentsToClass();
        this.sync();
      }
    );
  }

  // ======================================================
  // STUDENT ROWS
  // ======================================================

  private connectStudentRows(): void {
    if (!this.document) {
      return;
    }

    for (
      let rowNumber = 1;
      rowNumber <= this.maxRows;
      rowNumber++
    ) {
      this.connectStudentRow(
        rowNumber
      );
    }
  }

  private connectStudentRow(
    rowNumber: number
  ): void {
    if (!this.document) {
      return;
    }

    const toggle =
      this.document.getElementById(
        `student-destination-toggle-${rowNumber}`
      );

    const options =
      this.document.getElementById(
        `student-destination-options-${rowNumber}`
      );

    const destinationText =
      this.document.getElementById(
        `student-destination-text-${rowNumber}`
      ) as UIKit.Text;

    toggle?.addEventListener(
      "click",
      () => {
        this.toggleDropdown(
          options
        );
      }
    );

    const choices: Array<{
      suffix: string;
      destination: Destination;
    }> = [
      {
        suffix: "class",
        destination: "Class"
      },
      {
        suffix:
          "presentation",
        destination:
          "Presentation"
      },
      {
        suffix: "game1",
        destination: "Game 1"
      }
    ];

    choices.forEach(
      ({
        suffix,
        destination
      }) => {
        const option =
          this.document?.getElementById(
            `student-${suffix}-option-${rowNumber}`
          );

        option?.addEventListener(
          "click",
          () => {
            this.selectedDestinationByRow.set(
              rowNumber,
              destination
            );

            destinationText?.setProperties({
              text: destination
            });

            this.closeDropdown(
              options
            );

            console.log(
              `[Instructor Dashboard] Row ${rowNumber} destination: ${destination}`
            );

            this.sync();
          }
        );
      }
    );

    // ======================================================
    // STUDENT START BUTTON
    // ======================================================

    const startButton = this.document.getElementById(
      `student-start-button-${rowNumber}`
    );

    console.log(`[Instructor Dashboard] Start button ${rowNumber} found:`, !!startButton);

    if (startButton) {
      startButton.addEventListener(
        "click",
        (): void => {
          console.log(`[Instructor Dashboard] 🔥🔥🔥 START BUTTON ${rowNumber} CLICKED! 🔥🔥🔥`);

          const student = this.studentsByRow.get(rowNumber);

          if (!student) {
            console.warn(`[Instructor Dashboard] No online student in row ${rowNumber}.`);
            return;
          }

          const destination = this.selectedDestinationByRow.get(rowNumber) ?? "Class";

          console.log(`[Instructor Dashboard] Start ${student.name || student.id} → ${destination}`);
          
          // ✅ Send to destination (works for both Classroom and Game)
          this.sendStudentToDestination(student.id, destination);
        }
      );
    } else {
      console.error(`[Instructor Dashboard] ❌ Start button ${rowNumber} NOT FOUND!`);
    }
  }

  // ======================================================
  // ✅ SEND STUDENT TO DESTINATION (Unified)
  // ======================================================

  private sendStudentToDestination(studentId: string, destination: Destination): void {
    console.log(`[Instructor] 🎯 Sending student ${studentId} to ${destination}`);
    
    // Find the student
    const student = Array.from(this.studentsByRow.values()).find(s => s.id === studentId);
    
    if (!student) {
      this.showToast("Student not found", "error");
      return;
    }
    
    // ✅ Unified: Use instructorSendStudent for ALL destinations
    socket.emit("instructorSendStudent", {
      studentId: studentId,
      destination: destination
    });
    
    // Show appropriate feedback
    if (destination === "Game 1") {
      this.showToast(`${student.name || 'Student'} sent to Lab 🎮`, "success");
    } else {
      this.showToast(`${student.name || 'Student'} sent to ${destination}`, "success");
    }
  }

  // ======================================================
  // ✅ SEND ALL STUDENTS TO DESTINATION (Unified)
  // ======================================================

  private sendAllStudentsToDestination(destination: Destination): void {
    console.log(`[Instructor] 🚀 Sending ALL students to ${destination}`);
    
    // Get all real students
    const allStudents = Array.from(this.studentsByRow.values());
    
    if (allStudents.length === 0) {
      this.showToast("No students to send", "error");
      return;
    }
    
    // ✅ Unified: Use instructorSendAllToDestination
    socket.emit("instructorSendAllToDestination", {
      destination: destination
    });
    
    // Show appropriate feedback
    if (destination === "Game 1") {
      this.showToast(`All ${allStudents.length} students sent to Lab 🎮`, "success");
    } else {
      this.showToast(`All ${allStudents.length} students sent to ${destination}`, "success");
    }
  }

  // ======================================================
  // ✅ RETURN ALL STUDENTS TO CLASS (Unified)
  // ======================================================

  private returnAllStudentsToClass(): void {
    console.log("[Instructor] 🔄 Returning ALL students to Class");
    
    // ✅ Unified: Use instructorReturnAllToClass
    socket.emit("instructorReturnAllToClass");
    
    this.showToast("All students returned to Class mode", "success");
  }

  // ======================================================
  // TOAST NOTIFICATION
  // ======================================================

  private showToast(message: string, type: "success" | "error" | "info" = "info"): void {
    // Try to use the system toast if available
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = message;
      toast.className = `toast ${type} show`;
      setTimeout(() => {
        toast.className = "toast";
      }, 3000);
      return;
    }
    
    // Fallback: console log
    console.log(`[Toast] ${type}: ${message}`);
  }
}
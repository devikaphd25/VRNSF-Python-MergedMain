import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

// ========================================================
// DEMO STUDENTS & MAIN SERVER CODE
// ========================================================

const demoStudents = [
  {
    id: "demo-1",
    name: "Demo 1",
    seat: "Seat_R1_01",
    mode: "Classroom Mode",
    isDemo: true,
    handRaised: false,
    isMuted: false,
  },
  {
    id: "demo-2",
    name: "Demo 2",
    seat: "Seat_R1_02",
    mode: "Presentation Mode",
    isDemo: true,
    handRaised: false,
    isMuted: false,
  },
  {
    id: "demo-3",
    name: "Demo 3",
    seat: "Seat_R1_03",
    mode: "Classroom Mode",
    isDemo: true,
    handRaised: false,
    isMuted: false,
  },
];

const students = {};
const labSessions = {};

/*
 * Stores students who finished the lab and are waiting
 * to reconnect to the classroom with a new socket ID.
 */
const returningStudents = {};

// ✅ Lab Session Class
class LabSession {
  constructor(studentId, studentName, seat) {
    this.studentId = studentId;
    this.studentName = studentName;
    this.seat = seat;
    this.socketId = null;
    this.score = 0;
    this.streak = 0;
    this.wpm = 0;
    this.accuracy = 0;
    this.completedExercises = [];
    this.currentExercise = 0;
    this.gameState = { lessonState: "idle" };
    this.joinedAt = new Date();
  }

  completeExercise(exerciseId, data = {}) {
    if (!this.completedExercises.includes(exerciseId)) {
      this.completedExercises.push(exerciseId);
    }
    this.currentExercise = Math.max(this.currentExercise, exerciseId);
    this.score += data.score || 1;
    this.streak = data.streak || 0;
    this.wpm = data.wpm || 0;
    this.accuracy = data.accuracy || 0;
  }

  getNextExercise() {
    const nextId = this.currentExercise + 1;
    const exercises = [
      { id: 1, code: "print('Hello, World!')", title: "Basic Print", difficulty: "beginner" },
      { id: 2, code: "name = 'Python'", title: "Variables", difficulty: "beginner" },
      { id: 3, code: "age = 25", title: "Numbers", difficulty: "beginner" },
      { id: 4, code: "print(f'My name is {name}')", title: "f-strings", difficulty: "beginner" },
      { id: 5, code: "def greet(name): return f'Hello, {name}'", title: "Functions", difficulty: "intermediate" },
      { id: 6, code: "for i in range(5): print(i)", title: "Loops", difficulty: "intermediate" },
      { id: 7, code: "if x > 0: print('Positive')", title: "Conditionals", difficulty: "intermediate" },
      { id: 8, code: "class Student: def __init__(self, name): self.name = name", title: "Classes", difficulty: "advanced" },
      { id: 9, code: "import math; print(math.sqrt(16))", title: "Imports", difficulty: "advanced" },
      { id: 10, code: "lambda x: x * 2", title: "Lambda", difficulty: "advanced" },
    ];
    
    const exercise = exercises.find(e => e.id === nextId) || exercises[0];
    return {
      exerciseId: exercise.id,
      exerciseData: {
        title: exercise.title,
        code: exercise.code,
        difficulty: exercise.difficulty,
        description: `Type the following ${exercise.difficulty} code correctly.`,
      },
    };
  }

  getProgress() {
    return {
      completed: this.completedExercises.length,
      total: 10,
      score: this.score,
      streak: this.streak,
      accuracy: this.accuracy,
      wpm: this.wpm,
    };
  }
}

// ========================================================
// HELPER FUNCTIONS
// ========================================================

function getStudentList() {
  return [...demoStudents, ...Object.values(students)];
}

function broadcastStudentList() {
  io.emit("studentList", getStudentList());
}

function findStudent(studentId) {
  const demoStudent = demoStudents.find(
    (student) => student.id === studentId
  );

  if (demoStudent) {
    return {
      student: demoStudent,
      isDemo: true,
    };
  }

  const realStudent = students[studentId];

  if (realStudent) {
    return {
      student: realStudent,
      isDemo: false,
    };
  }

  return null;
}

function sendHandState(studentId, student, raised, fromInstructor = true) {
  const normalizedRaised = Boolean(raised);

  student.handRaised = normalizedRaised;

  const isRealStudent = Boolean(students[studentId]);
  const socketIsConnected = io.sockets.sockets.has(studentId);

  console.log("[Server] Sending hand state:", {
    studentId,
    studentName: student.name,
    raised: normalizedRaised,
    isRealStudent,
    socketIsConnected,
    fromInstructor,
    allSockets: Array.from(io.sockets.sockets.keys()),
  });

  if (isRealStudent && socketIsConnected) {
    io.to(studentId).emit("handToggled", {
      studentId,
      playerId: studentId,
      raised: normalizedRaised,
      fromInstructor,
    });

    console.log("[Server] handToggled sent directly to:", studentId);
  } else if (isRealStudent) {
    console.warn("[Server] Student exists, but socket is not connected:", studentId);
  }

  io.emit("raiseHandUpdated", {
    studentId,
    playerId: studentId,
    raised: normalizedRaised,
    name: student.name,
    seat: student.seat,
    isMuted: Boolean(student.isMuted),
    fromInstructor,
  });

  broadcastStudentList();

  console.log(`[Server] ${student.name} hand state changed to:`, normalizedRaised ? "raised" : "lowered");
}

function sendMuteState(studentId, student, isMuted) {
  student.isMuted = isMuted;

  if (students[studentId]) {
    io.to(studentId).emit("muteToggled", {
      studentId,
      playerId: studentId,
      isMuted,
    });
  }

  io.emit("muteUpdated", {
    studentId,
    playerId: studentId,
    isMuted,
    name: student.name,
    seat: student.seat,
  });

  broadcastStudentList();

  console.log(`[Server] ${student.name} mute state:`, isMuted ? "muted" : "unmuted");
}

// ========================================================
// ✅ SOCKET.IO CONNECTION HANDLER
// ========================================================

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  const studentName = socket.id.substring(0, 6);

  const existingStudentId = Object.keys(students).find((key) => {
    return students[key].name === studentName && key !== socket.id;
  });

  if (existingStudentId) {
    console.log(`[Server] Found existing student with same name: ${existingStudentId}, removing...`);
    delete students[existingStudentId];
  }

  const notSelectedStudents = Object.keys(students).filter((key) => {
    const student = students[key];
    return student.seat === "Not selected" && !student.isDemo;
  });

  notSelectedStudents.forEach((key) => {
    console.log(`Removing unseated student: ${key}`);
    delete students[key];
  });

  students[socket.id] = {
    id: socket.id,
    name: socket.id.substring(0, 6),
    seat: "Not selected",
    mode: "Classroom Mode",
    isDemo: false,
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    handRaised: false,
    isMuted: false,
  };

  socket.emit("currentPlayers", students);
  broadcastStudentList();

  // ========================================================
  // ✅ GAME CLIENT EVENTS
  // ========================================================

  // --- Game client ready ---
  socket.on("gameClientReady", (data) => {
    console.log(`[Server] 🎮 Game client ready: ${data.studentName} (${data.studentId})`);
    socket.isGameClient = true;
    socket.studentId = data.studentId;
    socket.studentName = data.studentName;
    socket.seat = data.seat;
    
    socket.emit("gameClientReadyAck", {
      status: "connected",
      studentId: data.studentId,
      studentName: data.studentName,
    });
  });

  // --- Student joins lab ---
  socket.on("studentJoinLab", (data) => {
    console.log(`[Server] 🧪 Student joining lab: ${data.studentName}`);
    
    const { studentId, studentName, seat } = data;
    
    let session = labSessions[studentId];
    if (!session) {
      session = new LabSession(studentId, studentName, seat);
      labSessions[studentId] = session;
      console.log(`[Server] 🆕 Created new lab for ${studentName}`);
    }
    session.socketId = socket.id;

    socket.emit("labEnvironment", {
      studentId,
      studentName,
      seat,
      isIndividual: true,
      message: `Welcome to your individual lab, ${studentName}!`,
      labState: {
        score: session.score,
        completedExercises: session.completedExercises.length,
        currentExercise: session.currentExercise,
      },
      gameState: session.gameState,
    });

    const exercise = session.getNextExercise();
    socket.emit("nextExercise", exercise);

    io.emit("studentInLabNotification", {
      studentId: studentId,
      studentName: studentName,
      labId: "python-type-lab",
      labName: "Python Type Lab",
    });

    console.log(`[Server] ✅ ${studentName} entered lab (Total: ${Object.keys(labSessions).length})`);
  });

  // --- Student completes exercise ---
  socket.on("typingExerciseComplete", (data) => {
    const studentId = Object.keys(labSessions).find(
      id => labSessions[id].socketId === socket.id
    );
    
    if (!studentId) {
      console.warn("[Server] ⚠️ Unknown student completed exercise");
      return;
    }

    const session = labSessions[studentId];
    session.completeExercise(data.exerciseId, {
      score: data.score || 1,
      streak: data.streak || 0,
      wpm: data.wpm || 0,
      accuracy: data.accuracy || 0,
    });

    const progress = session.getProgress();
    
    socket.emit("typingResult", {
      exerciseId: data.exerciseId,
      status: "completed",
      score: session.score,
      streak: session.streak,
      wpm: session.wpm,
      accuracy: session.accuracy,
      progress: progress,
      message: `Great job! Score: ${session.score}`,
    });

    console.log(`[Server] 📊 ${session.studentName} - Score: ${session.score}, Exercises: ${progress.completed}/10`);
  });

  // --- Student requests next exercise ---
  socket.on("requestNextExercise", (data) => {
    const studentId = Object.keys(labSessions).find(
      id => labSessions[id].socketId === socket.id
    );
    
    if (!studentId) {
      console.warn("[Server] ⚠️ Unknown student requested next exercise");
      return;
    }

    const session = labSessions[studentId];
    const currentId = data?.currentExerciseId || session.currentExercise;
    
    if (currentId >= 10) {
      socket.emit("labComplete", {
        message: "🎉 Congratulations! You've completed all exercises!",
        finalScore: session.score,
        finalStats: session.getProgress(),
      });
      return;
    }

    const exercise = session.getNextExercise();
    socket.emit("nextExercise", exercise);
    
    console.log(`[Server] 📚 ${session.studentName} requested next exercise: ${exercise.exerciseId}`);
  });

  // --- Student leaves lab ---
  socket.on("studentLeaveLab", (data) => {
  const studentId =
    data?.studentId ||
    Object.keys(labSessions).find(
      (id) =>
        labSessions[id].socketId === socket.id
    );

  if (!studentId) {
    console.warn(
      "[Server] studentLeaveLab received without student ID."
    );

    socket.emit("labLeaveError", {
      message: "Student session was not found."
    });

    return;
  }

  const session = labSessions[studentId];

  if (!session) {
    console.warn(
      `[Server] No lab session found for ${studentId}`
    );

    socket.emit("labLeaveError", {
      message: "Lab session was not found."
    });

    return;
  }

  const returnSeat =
    session.seat ||
    data?.seat ||
    "Not selected";

  const returnName =
    session.studentName ||
    data?.studentName ||
    "Student";

  console.log(
    `[Server] 📤 ${returnName} finished lab and will return to ${returnSeat}`
  );

  /*
   * Save the student's seat temporarily.
   * The classroom page will reconnect with a new socket ID.
   */
  returningStudents[studentId] = {
    previousStudentId: studentId,
    studentName: returnName,
    seat: returnSeat,
    mode: "Classroom Mode",
    labData: session.getProgress(),
    createdAt: Date.now()
  };

  /*
   * Remove any old classroom record. The old socket ID
   * must not continue owning the seat.
   */
  if (students[studentId]) {
    delete students[studentId];

    console.log(
      `[Server] Removed old classroom record: ${studentId}`
    );
  }

  io.emit("studentReturnedFromLab", {
    studentId,
    studentName: returnName,
    seat: returnSeat,
    labData: session.getProgress(),
    waitingForClassroomReconnect: true
  });

  /*
   * Tell the lab client that it can now navigate
   * back to the classroom frontend.
   */
  socket.emit("labLeft", {
    studentId,
    studentName: returnName,
    seat: returnSeat,
    autoSeat: true,
    message: "Return to the classroom."
  });

  delete labSessions[studentId];

  broadcastStudentList();

  console.log(
    `[Server] ✅ Return information saved for ${returnName}`
  );
});
  // --- Get lab students list ---
  socket.on("getLabStudents", () => {
    const studentsList = Object.keys(labSessions).map(id => {
      const session = labSessions[id];
      const progress = session.getProgress();
      return {
        studentId: id,
        studentName: session.studentName,
        seat: session.seat,
        score: session.score,
        completedExercises: progress.completed,
        totalExercises: 10,
        accuracy: progress.accuracy,
        joinedAt: session.joinedAt,
      };
    });
    
    socket.emit("labStudentsList", {
      students: studentsList,
      total: studentsList.length,
      labName: "Python Type Lab",
    });
  });
  
  // ========================================================
  // STUDENT REQUEST HANDLERS
  // ========================================================

  socket.on("requestStudentList", () => {
    socket.emit("studentList", getStudentList());
  });

  socket.on("requestJoinSeat", (seat) => {
    const student = students[socket.id];
    if (!student) return;

    const takenSeats = getStudentList()
      .map((currentStudent) => currentStudent.seat)
      .filter((currentSeat) => currentSeat && currentSeat !== "Not selected");

    if (takenSeats.includes(seat)) {
      socket.emit("seatRejected", {
        seat,
        message: "This seat is already taken.",
      });
      return;
    }

    const existingStudent = getStudentList().find((s) => s.seat === seat && s.id !== socket.id);
    if (existingStudent && !existingStudent.isDemo) {
      const oldSocketId = existingStudent.id;
      if (students[oldSocketId]) {
        delete students[oldSocketId];
        console.log(`Removed duplicate student ${oldSocketId} from seat ${seat}`);
      }
    }

    student.seat = seat;
    socket.emit("seatAccepted", seat);
    console.log(`${student.name} selected ${seat}`);
    broadcastStudentList();
  });
  // ========================================================
// RESTORE SEAT AFTER RETURNING FROM LAB
// ========================================================

socket.on("requestRestoreSeat", (data) => {
console.log("[Server] 🔄 requestRestoreSeat received:", data);

  const previousStudentId = data?.previousStudentId;
  const requestedSeat = data?.seat;
  const requestedName = data?.studentName;

  // ✅ Check returningStudents record first
  let returnRecord = null;
  if (previousStudentId && returningStudents[previousStudentId]) {
    returnRecord = returningStudents[previousStudentId];
    console.log(`[Server] Found returning student record:`, returnRecord);
  }

  // ✅ Determine final seat and name
  const finalSeat = returnRecord?.seat || requestedSeat;
  const finalName = returnRecord?.studentName || requestedName || socket.id.substring(0, 6);

  console.log(`[Server] Final seat: ${finalSeat}, Final name: ${finalName}`);

  // ✅ Validate seat
  if (!finalSeat || finalSeat === "Unknown seat" || finalSeat === "Not selected") {
    console.warn("[Server] No valid seat to restore");
    socket.emit("seatRestoreRejected", {
      message: "No valid previous seat was provided."
    });
    return;
  }

  // ✅ Check if demo student has the seat
  const demoOccupant = demoStudents.find(s => s.seat === finalSeat);
  if (demoOccupant) {
    console.warn(`[Server] Seat ${finalSeat} is taken by demo student`);
    socket.emit("seatRestoreRejected", {
      seat: finalSeat,
      message: "The previous seat is assigned to a demo student."
    });
    return;
  }

  // ✅ Remove any stale student holding this seat (except current socket)
  const staleStudentId = Object.keys(students).find((studentId) => {
    if (studentId === socket.id) return false;
    return students[studentId]?.seat === finalSeat;
  });

  if (staleStudentId) {
    const staleStudent = students[staleStudentId];
    const belongsToReturningStudent = staleStudentId === previousStudentId || staleStudent?.name === finalName;
    
    if (belongsToReturningStudent) {
      delete students[staleStudentId];
      console.log(`[Server] Removed stale seat owner ${staleStudentId}`);
    } else {
      console.warn(`[Server] Seat ${finalSeat} is taken by another student: ${staleStudent?.name}`);
      socket.emit("seatRestoreRejected", {
        seat: finalSeat,
        message: "Your previous seat is now occupied by another student."
      });
      return;
    }
  }

  // ✅ Remove any existing record for this socket
  if (students[socket.id]) {
    console.log(`[Server] Removing existing record for socket ${socket.id}`);
    delete students[socket.id];
  }

  // ✅ CREATE THE STUDENT RECORD WITH THE NEW SOCKET ID
  students[socket.id] = {
    id: socket.id,
    name: finalName,
    seat: finalSeat,
    mode: "Classroom Mode",
    isDemo: false,
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    handRaised: false,
    isMuted: false,
    inLab: false,
    isDisconnected: false,
  };

  console.log(`[Server] ✅ Created student record: ${finalName} at ${finalSeat} (${socket.id})`);

  // ✅ Clean up returningStudents
  if (previousStudentId && returningStudents[previousStudentId]) {
    delete returningStudents[previousStudentId];
    console.log(`[Server] Cleaned up returning student record for ${previousStudentId}`);
  }

  // ✅ Broadcast student list FIRST (so marker appears immediately)
  broadcastStudentList();
  console.log(`[Server] 📢 Broadcasted student list with ${finalName} at ${finalSeat}`);

  // ✅ Then emit seat accepted events
  socket.emit("seatAccepted", finalSeat);
  
  socket.emit("seatRestored", {
    studentId: socket.id,
    previousStudentId: previousStudentId,
    studentName: finalName,
    seat: finalSeat,
    mode: "Classroom Mode"
  });

  console.log(`[Server] ✅ ${finalName} restored to ${finalSeat} with socket ${socket.id}`);
});


  // ========================================================
  // INSTRUCTOR SENDS STUDENT TO MODE (Individual)
  // ========================================================

  socket.on("instructorSendStudent", ({ studentId, destination }) => {
    console.log(`[Server] 🎯 instructorSendStudent called`);
    console.log(`[Server] 🎯 Student ID: ${studentId}, Destination: ${destination}`);
    console.log(`[Server] 🎯 Sender socket: ${socket.id}`);

    const result = findStudent(studentId);

    if (!result) {
      console.log(`[Server] Student ${studentId} not found`);
      socket.emit("serverError", { message: "Student not found" });
      return;
    }

    const student = result.student;
    const isDemo = result.isDemo;

    let mode = "Classroom Mode";
    if (destination === "Presentation") {
      mode = "Presentation Mode";
    } else if (destination === "Game 1") {
      mode = "Game Mode";
    }

    student.mode = mode;

    console.log(`[Server] ${student.name} sent to ${destination} (${mode})`);

    broadcastStudentList();

    if (!isDemo && students[studentId]) {
      console.log(`[Server] 📤 Sending modeChanged to ${studentId}`);
      io.to(studentId).emit("modeChanged", {
        mode: mode,
        destination: destination,
        fromInstructor: true,
      });
    } else {
      console.log(`[Server] ⚠️ Not sending modeChanged (isDemo: ${isDemo}, exists: ${!!students[studentId]})`);
    }

    io.emit("studentModeChanged", {
      studentId: studentId,
      mode: mode,
      destination: destination,
      name: student.name,
      seat: student.seat,
    });
  });

  // ========================================================
  // ✅ INSTRUCTOR SENDS ALL STUDENTS TO DESTINATION
  // ========================================================

  socket.on("instructorSendAllToDestination", ({ destination }) => {
    console.log(`[Server] 🚀 =========================================`);
    console.log(`[Server] 🚀 instructorSendAllToDestination called`);
    console.log(`[Server] 🚀 Destination: ${destination}`);
    console.log(`[Server] 🚀 Socket ID: ${socket.id}`);
    
    let mode = "Classroom Mode";
    let isGame = false;
    let gameId = null;
    
    if (destination === "Presentation") {
      mode = "Presentation Mode";
    } else if (destination === "Game 1") {
      mode = "Game Mode";
      isGame = true;
      gameId = "game1";
    }
    
    console.log(`[Server] Mode: ${mode}, IsGame: ${isGame}, GameId: ${gameId}`);
    
    const realStudents = Object.values(students);
    console.log(`[Server] Found ${realStudents.length} real students to send`);
    
    realStudents.forEach((student, index) => {
      student.mode = mode;
      console.log(`[Server] [${index + 1}/${realStudents.length}] Updated ${student.name} to ${mode}`);
      
      // ✅ If sending to game, notify student directly
      if (isGame && gameId) {
        student.inLab = true;
        student.labGameId = gameId;
        console.log(`[Server] 🎮 Notifying ${student.name} (${student.id}) to enter ${gameId}`);
        
        // Notify student to enter the game
        io.to(student.id).emit("gameChanged", {
         gameId,
         mode,
         destination,

         studentId: student.id,
         studentName: student.name,
         seat: student.seat,

          message:
            `You were sent to ${gameId}`
        });
      }
    });
    
    demoStudents.forEach(student => {
      student.mode = mode;
    });
    
    broadcastStudentList();
    
    console.log(`[Server] 📢 Broadcasting modeChanged to ALL students`);
    io.emit("modeChanged", {
      mode: mode,
      destination: destination,
      fromInstructor: true,
    });
    
    io.emit("allStudentsModeChanged", {
      mode: mode,
      destination: destination,
      message: `All students sent to ${destination}`,
    });
    
    if (isGame) {
      io.emit("allStudentsSentToGame", {
        gameId: gameId,
        destination: destination,
        count: realStudents.length,
        message: `${realStudents.length} students sent to ${destination}`,
      });
    }
    
    console.log(`[Server] ✅ All ${realStudents.length} students processed for ${destination}`);
  });

  // ========================================================
  // INSTRUCTOR RETURNS ALL STUDENTS TO CLASS
  // ========================================================

  socket.on("instructorReturnAllToClass", () => {
    console.log("[Server] Instructor returning ALL students to Class");

    Object.values(students).forEach((student) => {
        // ✅ Keep student in list, just update mode
        student.mode = "Classroom Mode";
        student.inLab = false;
        
        io.to(student.id).emit("modeChanged", {
            mode: "Classroom Mode",
            destination: "Class",
            fromInstructor: true,
        });
    });

    // ✅ Also clean up any lab sessions
    Object.keys(labSessions).forEach((studentId) => {
        const session = labSessions[studentId];
        console.log(`[Server] 🧹 Cleaning up lab session for ${session.studentName}`);
        delete labSessions[studentId];
    });

    demoStudents.forEach((student) => {
        student.mode = "Classroom Mode";
    });

    // ✅ Broadcast updated student list (markers reappear)
    broadcastStudentList();

    io.emit("allStudentsReturnedToClass", {
        message: "All students returned to Class mode",
    });

    console.log("[Server] All students returned to Class mode");
});

  // ========================================================
  // STUDENT MODE CHANGE (from student side)
  // ========================================================

  socket.on("modeChanged", (mode) => {
    const student = students[socket.id];
    if (!student) return;
    student.mode = mode;
    console.log(`${student.name} changed mode to ${mode}`);
    broadcastStudentList();
  });

  // ========================================================
  // STUDENT RAISES HAND
  // ========================================================

  socket.on("raiseHand", (data) => {
    const student = students[socket.id];

    if (!student) {
      return;
    }

    const raised = Boolean(data?.raised);

    student.handRaised = raised;

    console.log(`${student.name} ${raised ? "raised" : "lowered"} their hand`);

    io.emit("raiseHandUpdated", {
      studentId: socket.id,
      playerId: socket.id,
      raised,
      name: student.name,
      seat: student.seat,
      isMuted: Boolean(student.isMuted),
      fromInstructor: false,
    });

    broadcastStudentList();
  });

  // ========================================================
  // INSTRUCTOR TOGGLE HAND
  // ========================================================

  socket.on("instructorToggleHand", ({ studentId, raised }) => {
    console.log("[Server] instructorToggleHand received:", {
      studentId,
      raised,
    });

    const result = findStudent(studentId);

    if (!result) {
      console.warn("[Server] Student not found:", studentId);
      return;
    }

    const student = result.student;

    const nextState = typeof raised === "boolean" ? raised : !student.handRaised;

    sendHandState(studentId, student, nextState, true);
  });

  // ========================================================
  // INSTRUCTOR TOGGLE MUTE
  // ========================================================

  socket.on("instructorToggleMute", ({ studentId }) => {
    console.log(`[Server] Instructor toggling mute for: ${studentId}`);

    let student = demoStudents.find((s) => s.id === studentId);
    let isDemo = true;

    if (!student) {
      student = students[studentId];
      isDemo = false;
    }

    if (!student) {
      console.log(`[Server] Student ${studentId} not found`);
      socket.emit("error", { message: "Student not found" });
      return;
    }

    student.isMuted = !student.isMuted;

    console.log(`[Server] ${student.name} ${student.isMuted ? "muted" : "unmuted"} by instructor`);

    broadcastStudentList();

    io.emit("muteUpdated", {
      playerId: studentId,
      isMuted: student.isMuted,
      name: student.name,
      seat: student.seat,
    });

    if (!isDemo && students[studentId]) {
      io.to(studentId).emit("muteToggled", {
        isMuted: student.isMuted,
      });
    }
  });

  // ========================================================
  // INSTRUCTOR UNMUTE AND LOWER HAND
  // ========================================================

  socket.on("instructorUnmuteAndLowerHand", ({ studentId }) => {
    console.log("[Server] instructorUnmuteAndLowerHand received:", studentId);

    const result = findStudent(studentId);

    if (!result) {
      console.warn("[Server] Cannot unmute/lower. Student not found:", studentId);
      return;
    }

    const student = result.student;

    sendMuteState(studentId, student, false);
    sendHandState(studentId, student, false, true);

    console.log(`[Server] Instructor unmuted and lowered hand for ${student.name}`);
  });

  // ========================================================
  // INSTRUCTOR LOWER HAND
  // ========================================================

  socket.on("instructorLowerHand", ({ studentId }) => {
    console.log("[Server] instructorLowerHand received:", studentId);

    const result = findStudent(studentId);

    if (!result) {
      console.warn("[Server] Cannot lower hand. Student not found:", studentId);
      return;
    }

    sendHandState(studentId, result.student, false, true);

    console.log(`[Server] Instructor lowered hand for ${result.student.name}`);
  });

  // ========================================================
  // PLAYER UPDATE
  // ========================================================

  socket.on("playerUpdate", (data) => {
    const student = students[socket.id];
    if (!student) return;
    if (!data?.position || !data?.rotation) return;

    student.position = data.position;
    student.rotation = data.rotation;

    socket.broadcast.emit("playerMoved", {
      id: socket.id,
      position: student.position,
      rotation: student.rotation,
      name: student.name,
      seat: student.seat,
      mode: student.mode,
      handRaised: student.handRaised,
    });
  });

  // ========================================================
  // DISCONNECT
  // ========================================================

  socket.on("disconnect", () => {
  const student = students[socket.id];
  console.log("Disconnected:", student?.name ?? socket.id);

  const labStudentId = Object.keys(labSessions).find(
    (id) => labSessions[id].socketId === socket.id
  );

  // ✅ Don't delete lab session on temporary disconnect
  if (labStudentId) {
    const session = labSessions[labStudentId];
    session.socketId = null;
    console.log(`[Server] Lab client disconnected temporarily: ${session.studentName}`);
    return; // Don't remove from students list
  }

  // ✅ Check if student is in lab - don't remove them
  const isInLab = student?.inLab === true;
  
  if (isInLab) {
    console.log(`[Server] 🧪 ${student?.name} is in lab, keeping in student list`);
    if (student) {
      student.isDisconnected = true;
    }
    broadcastStudentList();
    return;
  }

  // ✅ Only remove if not in lab and not returning
  if (students[socket.id]) {
    delete students[socket.id];
    io.emit("playerDisconnected", { id: socket.id });
    broadcastStudentList();
  }
});

});

// ========================================================
// START SERVER
// ========================================================

httpServer.listen(3001, () => {
  console.log("================================================");
  console.log("🎓 CLASSROOM + LAB SERVER RUNNING");
  console.log("================================================");
  console.log(`📍 http://localhost:3001`);
  console.log("📊 Classroom Mode: Active");
  console.log("🧪 Lab Mode: Active (Individual Labs)");
  console.log("👥 Demo Students: 3");
  console.log("================================================");
});
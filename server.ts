import express from "express";
import http from "http";
import fs from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import type { ClassroomSocket, ClassroomStudent, QuickChallenge } from "./server/types.js";

import {
  students,
  labSessions,
  returningStudents,
  connectedUsers,
} from "./server/state/store.js";

import {
  LabSession,
} from "./server/state/LabSession.js";
import {
  getStudentList,
  findStudent,
} from "./server/services/student.service.js";

import {
  broadcastStudentList,
} from "./server/services/broadcast.service.js";
import loginRoutes from "./server/routes/login.routes.js";
import { supabaseAdmin } from "./server/services/supabase-admin.service.js";
import {
  getAppUserById,
  getAppUserByUsername,
  getAppUserCount,
  getRecentAppGameResults,
  initializeAppDataRepository,
  saveAppGameResult,
  updateAppUserLocation,
} from "./server/services/app-data.repository.js";

await initializeAppDataRepository();
console.log({ total: getAppUserCount(), database: "Supabase" });

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const instructorRoomCloseTimers = new Map<string, NodeJS.Timeout>();
const INSTRUCTOR_DISCONNECT_GRACE_MS = 60_000;
const activeQuickChallenges = new Map<string, QuickChallenge>();

function cancelScheduledRoomClose(roomId: string): void {
  const timer = instructorRoomCloseTimers.get(roomId);
  if (timer) clearTimeout(timer);
  instructorRoomCloseTimers.delete(roomId);
}

function scheduleRoomClose(roomId: string): void {
  cancelScheduledRoomClose(roomId);
  const timer = setTimeout(async () => {
    instructorRoomCloseTimers.delete(roomId);

    const instructorReconnected = [...io.sockets.sockets.values()].some(
      activeSocket =>
        activeSocket.data.role === "instructor" &&
        activeSocket.data.roomId === roomId &&
        activeSocket.data.clientType === "classroom"
    );
    if (instructorReconnected) return;

    const { error } = await supabaseAdmin
      .from("rooms")
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq("id", roomId)
      .eq("is_active", true);

    if (error) {
      console.error(`[Room] Could not close ${roomId}:`, error.message);
      return;
    }
    console.log(`[Room] Closed ${roomId} after instructor disconnected.`);
  }, INSTRUCTOR_DISCONNECT_GRACE_MS);

  instructorRoomCloseTimers.set(roomId, timer);
  console.log(`[Room] Instructor disconnected; ${roomId} will close in 60 seconds.`);
}

// ========================================================
// SEAT ASSIGNMENT MAP - 10 Students
// ========================================================
function getUser(username: string | null | undefined) {
   if (!username) {
    return null;
  }

  return getAppUserByUsername(username);
}



function isInstructorSocket(socket: ClassroomSocket): boolean {
  const userId = Number(socket.data.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return false;
  }

  const user = getAppUserById(userId);

  return user?.role === "instructor";
}
// ========================================================
// HAND RAISE / MUTE HELPERS
// ========================================================

function sendHandState(studentId: string, student: ClassroomStudent, raised: boolean, fromInstructor = true): void {
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
  });

  if (isRealStudent && socketIsConnected) {
    io.to(studentId).emit("handToggled", {
      studentId,
      playerId: studentId,
      raised: normalizedRaised,
      fromInstructor,
    });
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

  broadcastStudentList(io);
  console.log(`[Server] ${student.name} hand state: ${normalizedRaised ? "raised" : "lowered"}`);
}

function sendMuteState(studentId: string, student: ClassroomStudent, isMuted: boolean): void {
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

  broadcastStudentList(io);
  console.log(`[Server] ${student.name} mute state: ${isMuted ? "muted" : "unmuted"}`);
}

// ========================================================
// SOCKET.IO CONNECTION HANDLER
// ========================================================
app.use(express.json());
app.use("/api", loginRoutes);
io.on("connection", (socket: ClassroomSocket) => {
  console.log("Connected:", socket.id);

  socket.on("instructorQuickChallenge", (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    if (!roomId || !isInstructorSocket(socket) || socket.data.clientType !== "classroom") {
      socket.emit("error", {
        message: "Only a registered classroom instructor can start a quick challenge.",
      });
      return;
    }

    const previous = activeQuickChallenges.get(roomId);
    if (previous?.timeout) clearTimeout(previous.timeout);

    const durationSeconds = Math.min(
      300,
      Math.max(15, Number(data.durationSeconds) || 60)
    );
    const isTrueFalse = data.challengeType === "true-false";
    const challenge = {
      id: `quick-${roomId}-${Date.now()}`,
      roomId,
      question: isTrueFalse
        ? "True or False: In Python, True is a Boolean value."
        : "Which of these values is a Python integer?",
      options: isTrueFalse
        ? ["True", "False"]
        : ["3.14", "42", "True", "Hello"],
      correctIndex: isTrueFalse ? 0 : 1,
      durationSeconds,
      startedAt: Date.now(),
      answers: new Map(),
      timeout: null,
    };
    activeQuickChallenges.set(roomId, challenge);

    const studentPayload = {
      id: challenge.id,
      question: challenge.question,
      options: challenge.options,
      durationSeconds: challenge.durationSeconds,
      startedAt: challenge.startedAt,
    };
    const roomStudents = [];

    for (const [studentSocketId, student] of Object.entries(students)) {
      const studentSocket = io.sockets.sockets.get(studentSocketId);
      if (
        !studentSocket ||
        studentSocket.data.roomId !== roomId ||
        studentSocket.data.role === "instructor" ||
        studentSocket.data.clientType !== "classroom"
      ) continue;

      roomStudents.push({
        studentId: studentSocketId,
        userId: student.userId,
        name: student.name,
        seat: student.seat,
      });
      studentSocket.emit("quickChallengeStarted", studentPayload);
    }

    socket.emit("quickChallengeStartedForInstructor", {
      ...studentPayload,
      studentCount: roomStudents.length,
      students: roomStudents,
    });

    challenge.timeout = setTimeout(() => {
      if (activeQuickChallenges.get(roomId)?.id !== challenge.id) return;
      for (const client of io.sockets.sockets.values()) {
        if (client.data.roomId === roomId) {
          client.emit("quickChallengeEnded", { quizId: challenge.id });
        }
      }
      activeQuickChallenges.delete(roomId);
    }, durationSeconds * 1000 + 4000);
  });

  socket.on("quickChallengeAnswer", (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    const student = students[socket.id];
    const challenge = activeQuickChallenges.get(roomId);

    if (
      !student ||
      socket.data.role === "instructor" ||
      !challenge ||
      data.quizId !== challenge.id ||
      challenge.answers.has(socket.id)
    ) return;

    const rawIndex = data.selectedIndex;
    const selectedIndex =
      Number.isInteger(rawIndex) &&
      rawIndex >= 0 &&
      rawIndex < challenge.options.length
        ? rawIndex
        : null;
    const correct = selectedIndex === challenge.correctIndex;

    challenge.answers.set(socket.id, {
      selectedIndex,
      correct,
      answeredAt: Date.now(),
    });

    socket.emit("quickChallengeResult", {
      quizId: challenge.id,
      correct,
      correctIndex: challenge.correctIndex,
      selectedIndex,
      message: correct
        ? "Correct! 42 is a Python integer."
        : "Not quite. The correct answer is B. 42.",
    });

    const answerPayload = {
      quizId: challenge.id,
      studentId: socket.id,
      userId: student.userId,
      name: student.name,
      selectedIndex,
      selectedOption:
        selectedIndex === null ? null : challenge.options[selectedIndex],
      correctIndex: challenge.correctIndex,
      correctOption: challenge.options[challenge.correctIndex],
      correct,
      answeredCount: challenge.answers.size,
    };

    for (const client of io.sockets.sockets.values()) {
      if (
        client.data.roomId === roomId &&
        client.data.role === "instructor" &&
        client.data.clientType === "classroom"
      ) {
        client.emit("quickChallengeStudentAnswered", answerPayload);
      }
    }
  });


socket.on("registerClassroomClient", async data => {
  const userId = Number(data?.userId);
  const roomId = String(data?.roomId ?? "").trim();
  const participantId = String(data?.participantId ?? "").trim() || null;
  const requestedUsername = String(
    data?.username ?? ""
  ).trim();

  // Validate the permanent database user ID.
  if (
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    socket.emit("classroomRegistrationError", {
      message: "A valid user ID is required.",
    });

    return;
  }

  const databaseUser = getAppUserById(userId);

  if (!databaseUser) {
    socket.emit("classroomRegistrationError", {
      message: "The user was not found.",
    });

    return;
  }

  if (!roomId) {
    socket.emit("classroomRegistrationError", {
      message: "A classroom session is required.",
    });
    return;
  }

  const { data: activeRoom, error: activeRoomError } = await supabaseAdmin
    .from("rooms")
    .select("id,is_active")
    .eq("id", roomId)
    .eq("is_active", true)
    .maybeSingle();

  if (activeRoomError || !activeRoom) {
    socket.emit("classroomRegistrationError", {
      message: "This classroom is no longer active.",
    });
    return;
  }

  // Confirm that the provided username belongs to this user ID.
  if (
    requestedUsername &&
    databaseUser.username.toLowerCase() !==
      requestedUsername.toLowerCase()
  ) {
    socket.emit("classroomRegistrationError", {
      message:
        "The username does not match the user ID.",
    });

    return;
  }

  /*
   * Remove a previous classroom socket for the same
   * permanent user. This prevents duplicate avatars.
   */
  const previousClassroomSocketId =
    connectedUsers[userId]?.classroomSocketId;

  if (
    previousClassroomSocketId &&
    previousClassroomSocketId !== socket.id
  ) {
    delete students[previousClassroomSocketId];

    const previousSocket =
      io.sockets.sockets.get(
        previousClassroomSocketId
      );

    if (previousSocket) {
      previousSocket.emit("sessionReplaced", {
        message:
          "Your classroom account was opened in another connection.",
      });
    }
  }

  // Create the cross-application connection record once.
connectedUsers[userId] ??= {
  userId: databaseUser.id,
  username: databaseUser.username,
  fullName: databaseUser.fullName,
  role: databaseUser.role,
  seat: databaseUser.seat,
  classroomSocketId: null,
  labSocketId: null,
  location: "classroom",
  mode: "Classroom Mode",
  inLab: false,
  score: 0,
  accuracy: 0,
  wpm: 0,
  completedExercises: 0,
};

const connectedUser =
  connectedUsers[userId];

connectedUser.userId =
  databaseUser.id;

connectedUser.username =
  databaseUser.username;

connectedUser.fullName =
  databaseUser.fullName;

connectedUser.role =
  databaseUser.role;

connectedUser.seat =
  databaseUser.seat;

connectedUser.classroomSocketId =
  socket.id;

connectedUser.location =
  "classroom";

connectedUser.mode =
  "Classroom Mode";

connectedUser.inLab =
  false;

  // Store validated identity on this Socket.IO connection.
  socket.data.userId = databaseUser.id;
  socket.data.username = databaseUser.username;
  socket.data.role = databaseUser.role;
  socket.data.roomId = roomId;
  socket.data.participantId = participantId;
  socket.data.clientType = "classroom";

  if (databaseUser.role === "instructor") {
    cancelScheduledRoomClose(roomId);
    console.log(`[Room] Instructor activated classroom ${roomId}.`);
  }

  /*
   * Create the classroom student here.
   * Do not depend on automatic creation in io.on("connection").
   */
  students[socket.id] = {
    id: socket.id,

    userId: databaseUser.id,

    username: databaseUser.username,

    name:
      databaseUser.fullName ??
      databaseUser.username,

    role:
      databaseUser.role ??
      "student",

    seat:
      databaseUser.seat ??
      "Not selected",

    location: "classroom",

    mode: "Classroom Mode",

    isDemo: false,

    position: {
      x: 0,
      y: 1,
      z: 0,
    },

    rotation: {
      x: 0,
      y: 0,
      z: 0,
    },

    handRaised: false,

    isMuted: false,

    inLab: false,

    isDisconnected: false,
  };
const returnRecord =
  returningStudents[databaseUser.id];

if (returnRecord) {
  students[socket.id].seat =
    returnRecord.seat;

  students[socket.id].mode =
    "Classroom Mode";

  students[socket.id].location =
    "classroom";

  students[socket.id].inLab =
    false;

  students[socket.id].isDisconnected =
    false;

  delete returningStudents[
    databaseUser.id
  ];

  console.log(
    `[Server] Restored ${databaseUser.fullName} to ${students[socket.id].seat}`
  );
}
  void updateAppUserLocation(databaseUser.id, "classroom").catch(console.error);

  /*
   * Send all current players to this newly registered
   * classroom client.
   */
  socket.emit("currentPlayers", students);

  // Automatically confirm the database-assigned seat.
  if (databaseUser.seat) {
    socket.emit(
      "seatAccepted",
      students[socket.id].seat
    );
  }

socket.emit(
  "classroomClientRegistered",
  {
    success: true,

    user: {
      id:
        databaseUser.id,

      username:
        databaseUser.username,

      fullName:
        databaseUser.fullName,

      role:
        databaseUser.role,

      seat:
        students[socket.id].seat,

      location:
        "classroom",
    },
  }
);
  broadcastStudentList(io);

  console.log(
    `[Server] Classroom registered: ${databaseUser.fullName}`,
    {
      userId: databaseUser.id,
      socketId: socket.id,
      seat:students[socket.id].seat,

    }
  );
});

  socket.on("endClass", async (_data, acknowledge) => {
    const roomId = String(socket.data.roomId ?? "").trim();

    if (!isInstructorSocket(socket) || socket.data.clientType !== "classroom") {
      acknowledge?.({ success: false, message: "Only the instructor can end the class." });
      return;
    }

    if (!roomId) {
      acknowledge?.({ success: false, message: "No active classroom was found." });
      return;
    }

    cancelScheduledRoomClose(roomId);

    const { error } = await supabaseAdmin
      .from("rooms")
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq("id", roomId)
      .eq("is_active", true);

    if (error) {
      console.error(`[Room] Instructor could not end ${roomId}:`, error.message);
      acknowledge?.({ success: false, message: "Could not update the classroom." });
      return;
    }

    acknowledge?.({ success: true });
    io.emit("classEnded", { roomId, message: "The instructor ended the class." });
    console.log(`[Room] Instructor ended classroom ${roomId}.`);
  });

  socket.on("slideChanged", async (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    const slideIndex = Number(data.index);

    if (!isInstructorSocket(socket) || socket.data.clientType !== "classroom") {
      socket.emit("serverError", {
        message: "Only the instructor can change presentation slides.",
      });
      return;
    }

    if (!roomId || !Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex > 25) {
      socket.emit("serverError", {
        message: "The requested slide is invalid.",
      });
      return;
    }

    const { error } = await supabaseAdmin
      .from("rooms")
      .update({ current_slide: slideIndex })
      .eq("id", roomId)
      .eq("is_active", true);

    if (error) {
      console.error(`[Slides] Could not save slide ${slideIndex}:`, error.message);
      socket.emit("serverError", {
        message: "Could not synchronize the presentation slide.",
      });
      return;
    }

    for (const client of io.sockets.sockets.values()) {
      if (
        client.data.clientType === "classroom" &&
        client.data.roomId === roomId
      ) {
        client.emit("slideChanged", { index: slideIndex });
      }
    }

    console.log(`[Slides] Room ${roomId} moved to slide ${slideIndex + 1}.`);
  });

  // ========================================================
  // GAME CLIENT EVENTS
  // ========================================================
 socket.on("registerLabClient", (data = {}) => {
  const userId = Number(data.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    socket.emit("labRegistrationFailed", {
      success: false,
      message: "A valid user ID is required.",
    });
    return;
  }

  const user = getAppUserById(userId);

  if (!user) {
    socket.emit("labRegistrationFailed", {
      success: false,
      message: `User ID ${userId} was not found.`,
    });
    return;
  }

  if (user.role !== "student") {
    socket.emit("labRegistrationFailed", {
      success: false,
      message: "Only students can register in the lab.",
    });
    return;
  }

  console.log("[Lab] Registering student:", {
    userId: user.id,
    username: user.username,
    seat: user.seat,
    socketId: socket.id,
  });

  connectedUsers[user.id] ??= {
  userId: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  seat: user.seat,
  classroomSocketId: null,
  labSocketId: null,
  location: "classroom",
  mode: "Classroom Mode",
  inLab: false,
  score: 0,
  accuracy: 0,
  wpm: 0,
  completedExercises: 0,
};

const connectedUser = connectedUsers[user.id];

connectedUser.userId = user.id;
connectedUser.username = user.username;
connectedUser.fullName = user.fullName;
connectedUser.role = user.role;
connectedUser.seat = user.seat;

connectedUser.labSocketId = socket.id;
connectedUser.location = "python_lab";
connectedUser.mode = "Game Mode";
connectedUser.inLab = true;

  const labSession = new LabSession(
    user.id,
    user.fullName || user.username,
    user.seat
  );
  labSession.socketId = socket.id;

  labSessions[user.id] = labSession;

  void updateAppUserLocation(user.id, "python_lab").catch(console.error);
socket.data.userId = user.id;
socket.data.username = user.username;
socket.data.role = user.role;
socket.data.clientType = "lab";
socket.data.location = "python_lab";

  socket.emit("labRegistrationSuccess", {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      seat: user.seat,
      location: "python_lab",
    },
  });

  broadcastStudentList(io);
});
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
socket.on(
  "studentJoinLab",
  data => {
    const userId =
      Number(
        data?.userId ??
        socket.data.userId
      );

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      socket.emit(
        "labJoinError",
        {
          message:
            "A permanent user ID is required.",
        }
      );

      return;
    }

    const databaseUser = getAppUserById(userId);

    if (!databaseUser) {
      socket.emit(
        "labJoinError",
        {
          message:
            "The database user was not found.",
        }
      );

      return;
    }

    const studentName =
      databaseUser.fullName ??
      databaseUser.username;

    /*
     * Database-only seat.
     * Do not trust data.seat from the browser.
     */
    const seat =
      databaseUser.seat ??
      "Not selected";

    console.log(
      `[Server] Student joining lab: ${studentName} (${userId})`
    );

    let session =
      labSessions[userId];

    if (!session) {
      session =
        new LabSession(
          userId,
          studentName,
          seat
        );

      labSessions[userId] =
        session;
    }

    session.studentName =
      studentName;

    session.seat =
      seat;

    session.socketId =
      socket.id;

    socket.emit(
      "labEnvironment",
      {
        userId,

        studentId:
          userId,

        studentName,

        seat,

        isIndividual:
          true,

        message:
          `Welcome to your individual lab, ${studentName}!`,

        labState: {
          score:
            session.score,

          completedExercises:
            session
              .completedExercises
              .length,

          currentExercise:
            session.currentExercise,
        },

        gameState:
          session.gameState,
      }
    );

    socket.emit(
      "nextExercise",
      session.getNextExercise()
    );

    io.emit(
      "studentInLabNotification",
      {
        userId,

        studentId:
          userId,

        studentName,

        seat,

        labId:
          "python-type-lab",

        labName:
          "Python Type Lab",
      }
    );
  }
);

  // --- Student completes exercise ---
socket.on(
  "typingExerciseComplete",
  data => {
    const userId =
      Number(
        socket.data.userId
      );

    if (!userId) {
      console.warn(
        "[Server] Lab socket has no permanent user ID."
      );

      socket.emit(
        "typingExerciseError",
        {
          message:
            "Your lab identity was not found.",
        }
      );

      return;
    }

    const session =
      labSessions[userId];

    if (!session) {
      console.warn(
        `[Server] No lab session found for user ${userId}`
      );

      socket.emit(
        "typingExerciseError",
        {
          message:
            "Your lab session was not found.",
        }
      );

      return;
    }

    session.completeExercise(
      Number(data?.exerciseId),
      {
        score:
          Number(data?.score) ||
          1,

        streak:
          Number(data?.streak) ||
          0,

        wpm:
          Number(data?.wpm) ||
          0,

        accuracy:
          Number(data?.accuracy) ||
          0,
      }
    );

    const progress =
      session.getProgress();

    const connectedUser =
      connectedUsers[userId];

    if (connectedUser) {
      connectedUser.score =
        session.score;

      connectedUser.accuracy =
        session.accuracy;

      connectedUser.wpm =
        session.wpm;

      connectedUser.completedExercises =
        progress.completed;
    }

    socket.emit(
      "typingResult",
      {
        exerciseId:
          data?.exerciseId,

        status:
          "completed",

        score:
          session.score,

        streak:
          session.streak,

        wpm:
          session.wpm,

        accuracy:
          session.accuracy,

        progress,

        message:
          `Great job! Score: ${session.score}`,
      }
    );

    io.emit(
      "studentLabProgress",
      {
        userId,

        studentName:
          session.studentName,

        location:
          "python_lab",

        score:
          session.score,

        streak:
          session.streak,

        wpm:
          session.wpm,

        accuracy:
          session.accuracy,

        completedExercises:
          progress.completed,

        totalExercises:
          progress.total,
      }
    );

    console.log(
      `[Server] ${session.studentName}: score ${session.score}, exercises ${progress.completed}/${progress.total}`
    );
  }
);

  // --- Integrated in-session Python card lab progress ---
  socket.on("labProgressUpdated", data => {
    const userId = Number(socket.data.userId);
    const connectedUser = connectedUsers[userId];

    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !connectedUser ||
      connectedUser.role !== "student"
    ) {
      socket.emit("labSessionError", {
        message: "A registered student identity is required.",
      });
      return;
    }

    let session = labSessions[userId];
    if (!session) {
      session = new LabSession(
        userId,
        connectedUser.fullName ?? connectedUser.username,
        connectedUser.seat ?? "Not selected"
      );
      labSessions[userId] = session;
    }

    const totalCards = Math.max(1, Number(data?.totalCards) || 12);
    const completedCards = Math.min(
      totalCards,
      Math.max(0, Number(data?.completedCards) || 0)
    );

    session.socketId = socket.id;
    session.score = Math.max(0, Number(data?.score) || 0);
    session.streak = Math.max(0, Number(data?.streak) || 0);
    session.accuracy = Math.max(
      0,
      Math.min(100, Number(data?.accuracy) || 0)
    );
    session.totalCards = totalCards;
    session.correctAnswers = Math.max(
      0,
      Number(data?.correctAnswers) || 0
    );
    session.wrongAnswers = Math.max(
      0,
      Number(data?.wrongAnswers) || 0
    );
    session.durationSeconds = Math.max(
      0,
      Number(data?.durationSeconds) || 0
    );
    session.status =
      data?.status === "completed"
        ? "completed"
        : data?.status === "incomplete"
          ? "incomplete"
          : "working";
    session.returnReason =
      typeof data?.returnReason === "string"
        ? data.returnReason
        : null;
    session.currentExercise = completedCards;
    session.completedExercises = Array.from(
      { length: completedCards },
      (_, index) => index + 1
    );

    connectedUser.location = "python_lab";
    connectedUser.mode = "Game Mode";
    connectedUser.inLab = true;
    connectedUser.score = session.score;
    connectedUser.accuracy = session.accuracy;
    connectedUser.correctAnswers = session.correctAnswers;
    connectedUser.wrongAnswers = session.wrongAnswers;
    connectedUser.durationSeconds = session.durationSeconds;
    connectedUser.labReturnReason = session.returnReason;
    connectedUser.completedExercises = completedCards;
    connectedUser.labStatus = session.status;

    const classroomStudent = Object.values(students).find(
      student => Number(student.userId) === userId
    );

    if (classroomStudent) {
      classroomStudent.location = "python_lab";
      classroomStudent.mode = "Game Mode";
      classroomStudent.inLab = true;
      classroomStudent.score = session.score;
      classroomStudent.accuracy = session.accuracy;
      classroomStudent.correctAnswers = session.correctAnswers;
      classroomStudent.wrongAnswers = session.wrongAnswers;
      classroomStudent.durationSeconds = session.durationSeconds;
      classroomStudent.labReturnReason = session.returnReason;
      classroomStudent.completedExercises = completedCards;
      classroomStudent.totalExercises = totalCards;
      classroomStudent.labStatus = session.status;
    }

    io.emit("studentLabProgress", {
      userId,
      studentName: session.studentName,
      location: "python_lab",
      ...session.getProgress(),
    });

    broadcastStudentList(io);
  });

  socket.on("labCompleted", async data => {
    const userId = Number(socket.data.userId);
    const session = labSessions[userId];

    if (!session) {
      return;
    }

    session.status = "completed";
    session.returnReason = "student_completed";

    const result = data?.result ?? session.getProgress();

    if (!session.resultSaved) {
      try {
        await saveAppGameResult({
          userId,
          score: Number(result?.score ?? session.score) || 0,
          durationSeconds:
            Number(result?.durationSeconds ?? session.durationSeconds) || 0,
          status: "completed",
        });
        session.resultSaved = true;
      } catch (error) {
        console.error("[Lab] Could not persist completed result:", error);
        socket.emit("labResultSaveError", {
          message: "Your result could not be saved. Please notify the instructor.",
        });
        return;
      }
    }

    io.emit("studentLabCompleted", {
      userId,
      studentName: session.studentName,
      result,
      clientResult: data?.result,
    });

    broadcastStudentList(io);
  });

  socket.on("labMistake", data => {
    const userId = Number(socket.data.userId);
    const session = labSessions[userId];
    const connectedUser = connectedUsers[userId];

    if (!session || !connectedUser) {
      return;
    }

    const mistake = {
      userId,
      studentName:
        connectedUser.fullName ??
        connectedUser.username,
      seat: connectedUser.seat,
      cardId: String(data?.cardId ?? ""),
      question: String(data?.question ?? ""),
      selectedType: String(data?.selectedType ?? ""),
      correctType: String(data?.correctType ?? ""),
      attempt: Math.max(1, Number(data?.attempt) || 1),
      occurredAt: new Date().toISOString(),
    };

    session.mistakes.push(mistake);

    io.emit("labMistakesUpdated", {
      totalMistakes:
        Object.values(labSessions)
          .reduce(
            (total, item) =>
              total + item.mistakes.length,
            0
          ),
    });
  });

  socket.on("requestLabMistakes", () => {
    if (!isInstructorSocket(socket)) {
      return;
    }

    const allMistakes =
      Object.values(labSessions)
        .flatMap(session => session.mistakes);

    const grouped = new Map();

    for (const mistake of allMistakes) {
      const key =
        `${mistake.question}|${mistake.correctType}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          question: mistake.question,
          correctType: mistake.correctType,
          count: 0,
          students: new Set(),
          wrongChoices: new Set(),
        });
      }

      const item = grouped.get(key);
      item.count += 1;
      item.students.add(mistake.studentName);
      item.wrongChoices.add(mistake.selectedType);
    }

    const mistakes =
      Array.from(grouped.values())
        .map(item => ({
          question: item.question,
          correctType: item.correctType,
          count: item.count,
          students: Array.from(item.students),
          wrongChoices: Array.from(item.wrongChoices),
        }))
        .sort((a, b) => b.count - a.count);

    socket.emit("labMistakesReport", {
      totalMistakes: allMistakes.length,
      mistakes,
    });
  });

  socket.on("labReturnConfirmed", data => {
    const userId = Number(socket.data.userId);
    const connectedUser = connectedUsers[userId];

    if (!connectedUser) {
      return;
    }

    connectedUser.location = "classroom";
    connectedUser.mode = "Classroom Mode";
    connectedUser.inLab = false;
    connectedUser.labStatus =
      data?.reason === "student_completed"
        ? "completed"
        : "returned";

    const classroomStudent = Object.values(students).find(
      student => Number(student.userId) === userId
    );

    if (classroomStudent) {
      classroomStudent.location = "classroom";
      classroomStudent.mode = "Classroom Mode";
      classroomStudent.inLab = false;
      classroomStudent.labStatus =
        data?.reason === "student_completed"
          ? "completed"
          : "returned";
    }

    const session = labSessions[userId];
    const result = data?.result ?? session?.getProgress();

    connectedUser.correctAnswers =
      Number(result?.correctAnswers) || 0;
    connectedUser.wrongAnswers =
      Number(result?.wrongAnswers) || 0;
    connectedUser.durationSeconds =
      Number(result?.durationSeconds) || 0;
    connectedUser.labReturnReason =
      data?.reason ?? "instructor_return";

    if (classroomStudent) {
      classroomStudent.correctAnswers =
        connectedUser.correctAnswers;
      classroomStudent.wrongAnswers =
        connectedUser.wrongAnswers;
      classroomStudent.durationSeconds =
        connectedUser.durationSeconds;
      classroomStudent.labReturnReason =
        connectedUser.labReturnReason;
    }

    if (session) {
      session.status =
        data?.reason === "student_completed"
          ? "completed"
          : session.status;
      session.returnReason =
        data?.reason ?? "instructor_return";
    }

    if (
      session &&
      !session.resultSaved
    ) {
      void saveAppGameResult({
        userId,
        score: Number(result?.score) || 0,
        durationSeconds: Number(result?.durationSeconds) || 0,
        status: data?.reason === "student_completed"
          ? "completed"
          : "instructor_return",
      }).catch(console.error);

      session.resultSaved = true;
    }

    void updateAppUserLocation(userId, "classroom").catch(console.error);

    io.emit("studentReturnedFromLab", {
      userId,
      studentName: connectedUser.fullName,
      returnReason: data?.reason ?? "instructor_return",
      labData: result,
    });

    broadcastStudentList(io);
  });

  // --- Student requests next exercise ---
socket.on(
  "requestNextExercise",
  data => {
    const userId =
      Number(
        socket.data.userId
      );

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      console.warn(
        "[Server] Unknown student requested the next exercise."
      );

      socket.emit(
        "labSessionError",
        {
          message:
            "Your lab identity was not found.",
        }
      );

      return;
    }

    const session =
      labSessions[userId];

    if (!session) {
      socket.emit(
        "labSessionError",
        {
          message:
            "The lab session was not found.",
        }
      );

      return;
    }

    const currentId =
      Number(
        data?.currentExerciseId ??
        session.currentExercise
      );

    if (currentId >= 10) {
      socket.emit(
        "labComplete",
        {
          message:
            "🎉 Congratulations! You've completed all exercises!",

          finalScore:
            session.score,

          finalStats:
            session.getProgress(),
        }
      );

      return;
    }

    const exercise =
      session.getNextExercise();

    socket.emit(
      "nextExercise",
      exercise
    );

    console.log(
      `[Server] ${session.studentName} requested exercise ${exercise.exerciseId}`
    );
  }
);

  // --- Student leaves lab ---
socket.on("studentLeaveLab", data => {
  const userId = Number(
    data?.userId ??
    socket.data.userId
  );

  if (!userId) {
    socket.emit("labLeaveError", {
      message: "User ID was not found.",
    });
    return;
  }

  const session = labSessions[userId];

  if (!session) {
    socket.emit("labLeaveError", {
      message: "Lab session was not found.",
    });
    return;
  }

  const databaseUser = getAppUserById(userId);

  if (!databaseUser) {
    socket.emit("labLeaveError", {
      message: "The database user was not found.",
    });
    return;
  }

  const returnSeat =
    databaseUser.seat ??
    session.seat ??
    "Not selected";

  returningStudents[userId] = {
    userId,
    studentName: databaseUser.fullName,
    username: databaseUser.username,
    seat: returnSeat,
    mode: "Classroom Mode",
    labData: session.getProgress(),
    createdAt: Date.now(),
  };

  void updateAppUserLocation(userId, "classroom").catch(console.error);

  socket.emit("labLeft", {
    userId,
    studentName: databaseUser.fullName,
    username: databaseUser.username,
    seat: returnSeat,
    classroomUrl: "http://localhost:8081",
    message: "Return to the classroom.",
  });

  io.emit("studentReturnedFromLab", {
    userId,
    studentName: databaseUser.fullName,
    seat: returnSeat,
    labData: session.getProgress(),
    waitingForClassroomReconnect: true,
  });

  delete labSessions[userId];

  console.log(
    `[Server] ${databaseUser.fullName} will return to ${returnSeat}`
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

  socket.on("requestSavedLabResults", async () => {
    if (!isInstructorSocket(socket)) return;

    try {
      const results = await getRecentAppGameResults();
      socket.emit("savedLabResults", { results });
    } catch (error) {
      console.error("[Lab] Could not load saved results:", error);
      socket.emit("savedLabResults", {
        results: [],
        error: "Saved lab results could not be loaded.",
      });
    }
  });

  // ========================================================
  // STUDENT REQUEST HANDLERS
  // ========================================================

  socket.on("requestStudentList", () => {
    socket.emit("studentList", getStudentList());
  });
socket.on(
  "requestAssignedSeat",
  data => {
    const userId = Number(
      data?.userId ??
      socket.data.userId
    );

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      socket.emit(
        "seatRejected",
        {
          seat: null,
          message:
            "A valid database user ID is required.",
        }
      );

      return;
    }

    /*
     * Make sure this socket was registered as
     * the same classroom user.
     */
    if (
      socket.data.clientType !==
        "classroom" ||
      Number(socket.data.userId) !==
        userId
    ) {
      socket.emit(
        "seatRejected",
        {
          seat: null,
          message:
            "Register the classroom client before requesting a seat.",
        }
      );

      return;
    }

    const student =
      students[socket.id];

    if (!student) {
      socket.emit(
        "seatRejected",
        {
          seat: null,
          message:
            "The classroom student record was not found.",
        }
      );

      return;
    }

    /*
     * The database is the only source of truth.
     */
    const databaseUser = getAppUserById(userId);

    if (!databaseUser) {
      socket.emit(
        "seatRejected",
        {
          seat: null,
          message:
            "The database user was not found.",
        }
      );

      return;
    }

    const assignedSeat =
      typeof databaseUser.seat ===
        "string"
        ? databaseUser.seat.trim()
        : "";

    if (
      !assignedSeat ||
      assignedSeat === "Not selected"
    ) {
      socket.emit(
        "seatRejected",
        {
          seat: null,
          message:
            `${databaseUser.fullName} does not have a seat assigned in the database.`,
        }
      );

      return;
    }

    const occupiedByAnotherStudent =
      Object.values(students).find(
        otherStudent =>
          otherStudent.id !==
            socket.id &&
          otherStudent.userId !==
            userId &&
          otherStudent.seat ===
            assignedSeat &&
          otherStudent.location ===
            "classroom"
      );

    if (occupiedByAnotherStudent) {
      socket.emit(
        "seatRejected",
        {
          seat:
            assignedSeat,

          message:
            `${assignedSeat} is currently occupied by ${occupiedByAnotherStudent.name}.`,
        }
      );

      return;
    }

    student.seat =
      assignedSeat;

    student.location =
      "classroom";

    student.mode =
      "Classroom Mode";

    student.inLab =
      false;

    student.isDisconnected =
      false;

    socket.emit(
      "seatAccepted",
      assignedSeat
    );

    broadcastStudentList(io);

    console.log(
      `[Server] Confirmed database seat for ${student.name}: ${assignedSeat}`
    );
  }
);


  // ========================================================
  // RESTORE SEAT AFTER RETURNING FROM LAB
  // ========================================================

socket.on(
  "requestRestoreSeat",
  data => {
    const userId = Number(
      data?.userId ??
      socket.data.userId
    );

    const student =
      students[socket.id];

    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !student
    ) {
      socket.emit(
        "seatRestoreRejected",
        {
          message:
            "Register the classroom client before restoring the seat.",
        }
      );

      return;
    }

    const databaseUser = getAppUserById(userId);

    const finalSeat =
      typeof databaseUser?.seat ===
        "string"
        ? databaseUser.seat.trim()
        : "";

    if (
      !finalSeat ||
      finalSeat === "Not selected"
    ) {
      socket.emit(
        "seatRestoreRejected",
        {
          message:
            "No database seat was assigned to this user.",
        }
      );

      return;
    }

    student.seat =
      finalSeat;

    student.mode =
      "Classroom Mode";

    student.location =
      "classroom";

    student.inLab =
      false;

    student.isDisconnected =
      false;

    delete returningStudents[
      userId
    ];

    socket.emit(
      "seatAccepted",
      finalSeat
    );

    socket.emit(
      "seatRestored",
      {
        userId,

        studentId:
          socket.id,

        studentName:
          student.name,

        seat:
          finalSeat,

        mode:
          "Classroom Mode",
      }
    );

    broadcastStudentList(io);

    console.log(
      `[Server] ${student.name} restored to database seat ${finalSeat}`
    );
  }
);

  // ========================================================
  // INSTRUCTOR EVENTS
  // ========================================================

  socket.on("saveLabReport", () => {
    if (!isInstructorSocket(socket)) {
      socket.emit("labReportSaved", {
        success: false,
        message: "Only instructors can save lab reports.",
      });
      return;
    }

    try {
      const reportDirectory =
        path.resolve(process.cwd(), "lab");

      fs.mkdirSync(reportDirectory, {
        recursive: true,
      });

      const now = new Date();
      const timestamp =
        now.toISOString()
          .replace(/:/g, "-")
          .replace(/\..+$/, "")
          .replace("T", "_");

      const fileName =
        `lab-results-${timestamp}.csv`;
      const mistakesFileName =
        `lab-mistakes-${timestamp}.csv`;

      const escapeCsv = value => {
        const text = String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
      };

      const rows: Array<Array<string | number>> = [
        [
          "Student",
          "Username",
          "Seat",
          "Question",
          "Total Questions",
          "Correct Answers",
          "Wrong Attempts",
          "Score",
          "Accuracy",
          "Duration Seconds",
          "Duration Formatted",
          "Status",
          "Return Reason",
          "Location",
          "Saved At",
        ],
      ];

      Object.values(students)
        .filter(student =>
          student.role === "student" &&
          !student.isDemo
        )
        .sort((a, b) =>
          String(a.seat).localeCompare(
            String(b.seat)
          )
        )
        .forEach(student => {
          const completed =
            Number(student.completedExercises) || 0;
          const total =
            Number(student.totalExercises) || 12;
          const status =
            student.isDisconnected
              ? "Offline"
              : student.labStatus === "completed"
                ? "Finished"
                : student.mode === "Game Mode"
                  ? "Working"
                  : completed > 0
                    ? "Returned"
                    : "Waiting";
          const durationSeconds =
            Number(student.durationSeconds) || 0;
          const durationFormatted =
            `${Math.floor(durationSeconds / 60)}:${String(
              durationSeconds % 60
            ).padStart(2, "0")}`;

          rows.push([
            student.name,
            student.username,
            student.seat,
            status === "Finished"
              ? total
              : Math.min(completed + 1, total),
            total,
            Number(student.correctAnswers) || 0,
            Number(student.wrongAnswers) || 0,
            Number(student.score) || 0,
            Number(student.accuracy) || 0,
            durationSeconds,
            durationFormatted,
            status,
            student.labReturnReason ?? "",
            student.location,
            now.toISOString(),
          ]);
        });

      const csv =
        rows
          .map(row =>
            row.map(escapeCsv).join(",")
          )
          .join("\n") + "\n";

      fs.writeFileSync(
        path.join(reportDirectory, fileName),
        csv,
        "utf8"
      );

      const mistakeRows = [
        [
          "Student",
          "Seat",
          "Question",
          "Selected Type",
          "Correct Type",
          "Attempt",
          "Occurred At",
        ],
        ...Object.values(labSessions)
          .flatMap(session => session.mistakes)
          .map(mistake => [
            mistake.studentName,
            mistake.seat,
            mistake.question,
            mistake.selectedType,
            mistake.correctType,
            mistake.attempt,
            mistake.occurredAt,
          ]),
      ];

      const mistakesCsv =
        mistakeRows
          .map(row =>
            row.map(escapeCsv).join(",")
          )
          .join("\n") + "\n";

      fs.writeFileSync(
        path.join(
          reportDirectory,
          mistakesFileName
        ),
        mistakesCsv,
        "utf8"
      );

      socket.emit("labReportSaved", {
        success: true,
        fileName,
        mistakesFileName,
        folder: reportDirectory,
      });
    } catch (error) {
      console.error(
        "[Server] Could not save lab report:",
        error
      );

      socket.emit("labReportSaved", {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown save error",
      });
    }
  });

  socket.on("instructorSendStudent", ({ studentId, destination }) => {

    if (!isInstructorSocket(socket)) {
    socket.emit("serverError", {
      message: "Only instructors can perform this action."
    });
    return;
  }
    console.log(
    `[Server] 🎯 instructorSendStudent: ${studentId} → ${destination}`
  );

  const student = findStudent(studentId);

  if (!student) {
    socket.emit("serverError", {
      message: "Student not found",
    });

    return;
  }

  if (destination === "Game 1") {
    const gameId = "python-type-lab";
    const mode = "Game Mode";
    student.mode = "Game Mode";
    student.inLab = true;
    student.isDisconnected = false;
    student.labGameId = "python-type-lab";

    console.log(
      `[Server] 🧪 Sending ${student.name} to Python Type Lab`
    );

   if (!student.userId) {
      socket.emit(
        "serverError",
        {
          message:
            `${student.name} does not have a permanent database user ID.`,
        }
      );

      return;
    }

    void updateAppUserLocation(student.userId, "python_lab").catch(console.error);

  io.to(student.id).emit(
    "gameChanged",
    {
      gameId,

      mode,

      destination,

      userId:
        student.userId,

      studentId:
        student.id,

      username:
        student.username,

      studentName:
        student.name,

      seat:
        student.seat,

      message:
        `You were sent to ${gameId}`,
    }
);
  } else {
    student.inLab = false;

    if (destination === "Presentation") {
      student.mode = "Presentation Mode";
    } else {
      student.mode = "Classroom Mode";
    }

    io.to(studentId).emit("modeChanged", {
      mode: student.mode,
      destination,
      fromInstructor: true,
    });
  }

  broadcastStudentList(io);

  io.emit("studentModeChanged", {
    studentId: student.id,
    mode: student.mode,
    destination,
    name: student.name,
    seat: student.seat,
    inLab: student.inLab,
  });
});
socket.on(
  "instructorSendAllToDestination",
  ({ destination }) => {
    if (!isInstructorSocket(socket)) {
      socket.emit("serverError", {
        message:
          "Only instructors can perform this action.",
      });

      return;
    }

    console.log(
      `[Server] 🚀 Sending ALL students to ${destination}`
    );

    let mode =
      "Classroom Mode";

    let isGame =
      false;

    let gameId =
      null;

    if (
      destination ===
      "Presentation"
    ) {
      mode =
        "Presentation Mode";
    } else if (
      destination ===
      "Game 1"
    ) {
      mode =
        "Game Mode";

      isGame =
        true;

      gameId =
        "python-type-lab";
    }

    /*
     * Only select students who currently have an
     * active classroom Socket.IO connection.
     */
    const realStudents =
      Object.values(
        connectedUsers
      ).filter(
        user =>
          user.role ===
            "student" &&
          Boolean(
            user.classroomSocketId
          )
      );

    console.log(
      `[Server] Found ${realStudents.length} real students to send`
    );

    realStudents.forEach(
      (student, index) => {
        student.mode =
          mode;

        console.log(
          `[Server] [${index + 1}/${realStudents.length}] Updated ${student.fullName} to ${mode}`
        );

        if (
          isGame &&
          gameId
        ) {
          student.inLab =
            true;

          student.location =
            "python_lab";

          student.labGameId =
            gameId;

          if (
            !student.userId
          ) {
            console.warn(
              `[Server] ${student.fullName} has no permanent database user ID.`
            );

            return;
          }

          void updateAppUserLocation(student.userId, "python_lab").catch(console.error);

          labSessions[student.userId] =
            new LabSession(
              student.userId,
              student.fullName ??
                student.username,
              student.seat ??
                "Not selected"
            );

          console.log(
            `[Server] 🎮 Notifying ${student.fullName} (${student.classroomSocketId}) to enter ${gameId}`
          );

          io.to(
            student.classroomSocketId
          ).emit(
            "gameChanged",
            {
              gameId,
              mode,
              destination,

              userId:
                student.userId,

              /*
               * Permanent identity.
               */
              studentId:
                student.userId,

              username:
                student.username,

              studentName:
                student.fullName,

              seat:
                student.seat,

              message:
                `You were sent to ${gameId}`,
            }
          );

          return;
        }

        /*
         * Presentation or classroom mode.
         */
        student.inLab =
          false;

        student.location =
          "classroom";

        io.to(
          student.classroomSocketId
        ).emit(
          "modeChanged",
          {
            mode,
            destination,
            fromInstructor:
              true,
          }
        );
      }
    );

    broadcastStudentList(io);

    io.emit(
      "allStudentsModeChanged",
      {
        mode,
        destination,

        message:
          `All students sent to ${destination}`,
      }
    );

    if (isGame) {
      io.emit(
        "allStudentsSentToGame",
        {
          gameId,
          destination,

          count:
            realStudents.length,

          message:
            `${realStudents.length} students sent to ${destination}`,
        }
      );
    }

    console.log(
      `[Server] ✅ All ${realStudents.length} students processed for ${destination}`
    );
  }
);

  socket.on(
  "instructorReturnStudentFromLab",
  data => {
     if (!isInstructorSocket(socket)) {
      socket.emit("serverError", {
        message: "Only instructors can perform this action."
      });
      return;
    }
    const userId =
      Number(data?.userId);

    const connectedUser =
      connectedUsers[userId];

    if (!userId || !connectedUser) {
      socket.emit(
        "serverError",
        {
          message:
            "The lab student was not found.",
        }
      );

      return;
    }

    const labSocketId =
      connectedUser.labSocketId;

    if (!labSocketId) {
      socket.emit(
        "serverError",
        {
          message:
            "The student is not currently connected to the lab.",
        }
      );

      return;
    }

    const session =
      labSessions[userId];

    const progress =
      session?.getProgress() ?? {
        completed:
          connectedUser
            .completedExercises,

        total:
          10,

        score:
          connectedUser.score,

        streak:
          0,

        accuracy:
          connectedUser.accuracy,

        wpm:
          connectedUser.wpm,

        durationSeconds:
          connectedUser.durationSeconds ?? 0,
      };

    if (!session?.resultSaved) {
      void saveAppGameResult({
        userId,
        score: progress.score,
        durationSeconds: progress.durationSeconds ?? 0,
        status: "instructor_return",
      }).catch(console.error);

      if (session) {
        session.resultSaved = true;
        session.returnReason = "instructor_return";
      }
    }

    void updateAppUserLocation(userId, "classroom").catch(console.error);

    connectedUser.location =
      "classroom";

    io.to(labSocketId).emit(
      "returnToClassroom",
      {
        userId,

        username:
          connectedUser.username,

        studentName:
          connectedUser.fullName,

        score:
          progress.score,

        accuracy:
          progress.accuracy,

        wpm:
          progress.wpm,

        completedExercises:
          progress.completed,

        seat: getAppUserById(userId)?.seat,

        classroomUrl:
          "http://localhost:8081",
      }
    );

    io.emit(
      "studentReturnedFromLab",
      {
        userId,

        studentName:
          connectedUser.fullName,

        labData:
          progress,
      }
    );

    console.log(
      `[Server] Instructor returned ${connectedUser.fullName} from the lab`
    );
  }
);
 socket.on(
  "instructorReturnAllToClass",
  () => {
    if (!isInstructorSocket(socket)) {
      socket.emit("serverError", {
        message:
          "Only instructors can perform this action.",
      });

      return;
    }

    console.log(
      "[Server] Instructor returning ALL students to Class"
    );

    let returnedCount = 0;

    Object.values(
      connectedUsers
    ).forEach(
      connectedUser => {
        if (
          connectedUser.role !==
          "student"
        ) {
          return;
        }

        const userId =
          Number(
            connectedUser.userId
          );

        const wasInLab =
          connectedUser.inLab === true ||
          connectedUser.location === "python_lab";

        connectedUser.mode =
          "Classroom Mode";

        connectedUser.location =
          "classroom";

        connectedUser.inLab =
          false;

        connectedUser.labStatus =
          connectedUser.labStatus === "completed"
            ? "completed"
            : "returned";
        connectedUser.labReturnReason =
          connectedUser.labStatus === "completed"
            ? "student_completed"
            : "instructor_return";

        const classroomStudent =
          Object.values(students).find(
            student =>
              Number(student.userId) === userId
          );

        if (classroomStudent) {
          classroomStudent.mode =
            "Classroom Mode";
          classroomStudent.location =
            "classroom";
          classroomStudent.inLab = false;
          classroomStudent.labStatus =
            connectedUser.labStatus;
          classroomStudent.labReturnReason =
            connectedUser.labReturnReason;
        }

        void updateAppUserLocation(userId, "classroom").catch(console.error);

        /*
         * Integrated lab: the student remains on the original
         * classroom socket while their local scene changes.
         */
        if (
          wasInLab &&
          connectedUser.classroomSocketId
        ) {
          const session = labSessions[userId];
          const progress = session?.getProgress() ?? {
            completed: connectedUser.completedExercises ?? 0,
            total: 12,
            score: connectedUser.score ?? 0,
            streak: 0,
            accuracy: connectedUser.accuracy ?? 0,
            wpm: 0,
            status: "incomplete",
            returnReason: "instructor_return",
            durationSeconds: connectedUser.durationSeconds ?? 0,
          };

          const finalStatus =
            progress.status === "completed"
              ? "completed"
              : "instructor_return";

          if (!session?.resultSaved) {
            void saveAppGameResult({
              userId,
              score: progress.score,
              durationSeconds: progress.durationSeconds ?? 0,
              status: finalStatus,
            }).catch(console.error);

            if (session) {
              session.resultSaved = true;
              session.returnReason =
                finalStatus === "completed"
                  ? "student_completed"
                  : "instructor_return";
            }
          }

          io.to(
            connectedUser.classroomSocketId
          ).emit(
            "returnToClassroom",
            {
              userId,
              username: connectedUser.username,
              studentName: connectedUser.fullName,
              seat: connectedUser.seat,
              returnReason:
                finalStatus === "completed"
                  ? "student_completed"
                  : "instructor_return",
              result: progress,
              message:
                "The instructor returned you to the classroom.",
            }
          );

          returnedCount += 1;
          return;
        }

        /*
         * Student is currently in the lab.
         */
        if (
          connectedUser.labSocketId
        ) {
          const session =
            labSessions[userId];

          const progress =
            session?.getProgress() ?? {
              completed:
                connectedUser.completedExercises ??
                0,

              total:
                10,

              score:
                connectedUser.score ??
                0,

              accuracy:
                connectedUser.accuracy ??
                0,

              wpm:
                connectedUser.wpm ??
                0,
            };

          const databaseUser = getAppUserById(userId);

          returningStudents[userId] = {
            userId,

            studentName:
              databaseUser?.fullName ??
              connectedUser.fullName,

            username:
              databaseUser?.username ??
              connectedUser.username,

            seat:
              databaseUser?.seat ??
              connectedUser.seat,

            mode:
              "Classroom Mode",

            labData:
              progress,

            createdAt:
              Date.now(),
          };

          console.log(
            `[Server] Returning ${connectedUser.fullName} through lab socket ${connectedUser.labSocketId}`
          );

          io.to(
            connectedUser.labSocketId
          ).emit(
            "returnToClassroom",
            {
              userId,

              username:
                connectedUser.username,

              studentName:
                connectedUser.fullName,

              seat:
                databaseUser?.seat ??
                connectedUser.seat,

              score:
                progress.score,

              accuracy:
                progress.accuracy,

              wpm:
                progress.wpm,

              completedExercises:
                progress.completed,

              classroomUrl:
                "http://localhost:8081",

              message:
                "The instructor returned you to the classroom.",
            }
          );

          delete labSessions[
            userId
          ];

          returnedCount += 1;
          return;
        }

        /*
         * Student is still connected to the classroom.
         */
        if (
          connectedUser.classroomSocketId
        ) {
          io.to(
            connectedUser.classroomSocketId
          ).emit(
            "modeChanged",
            {
              mode:
                "Classroom Mode",

              destination:
                "Class",

              fromInstructor:
                true,
            }
          );

          returnedCount += 1;
        }
      }
    );

    /*
     * Guaranteed in-session return command. This is deliberately
     * independent of the progress/location flags so a student can
     * never become trapped in the lab because of stale state.
     */
    Object.values(connectedUsers).forEach(connectedUser => {
      if (
        connectedUser.role === "student" &&
        connectedUser.classroomSocketId
      ) {
        io.to(connectedUser.classroomSocketId).emit(
          "returnAllToClassroomNow",
          {
            returnReason: "instructor_return",
          }
        );
      }
    });

    broadcastStudentList(io);

    io.emit(
      "allStudentsReturnedToClass",
      {
        count:
          returnedCount,

        message:
          "All students returned to Class mode",
      }
    );

    console.log(
      `[Server] All ${returnedCount} students returned to Class mode`
    );
  }
);

  // ========================================================
  // STUDENT MODE CHANGE
  // ========================================================

  socket.on("modeChanged", (mode) => {
    const student = students[socket.id];
    if (!student) return;
    student.mode = mode;
    console.log(`${student.name} changed mode to ${mode}`);
    broadcastStudentList(io);
  });

  // ========================================================
  // HAND RAISE EVENTS
  // ========================================================

  socket.on("raiseHand", (data) => {
    const student = students[socket.id];
    if (!student) return;

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

    broadcastStudentList(io);
  });

  socket.on("instructorToggleHand", ({ studentId, raised }) => {
    console.log("[Server] instructorToggleHand received:", { studentId, raised });

    const student = findStudent(studentId);
    if (!student) {
      console.warn("[Server] Student not found:", studentId);
      return;
    }

    const nextState = typeof raised === "boolean" ? raised : !student.handRaised;
    sendHandState(studentId, student, nextState, true);
  });

  socket.on("instructorToggleMute", ({ studentId }) => {
    console.log(`[Server] Instructor toggling mute for: ${studentId}`);

    const student = findStudent(studentId);
    if (!student) {
      console.log(`[Server] Student ${studentId} not found`);
      socket.emit("error", { message: "Student not found" });
      return;
    }

    student.isMuted = !student.isMuted;
    console.log(`[Server] ${student.name} ${student.isMuted ? "muted" : "unmuted"} by instructor`);

    broadcastStudentList(io);

    io.emit("muteUpdated", {
      playerId: studentId,
      isMuted: student.isMuted,
      name: student.name,
      seat: student.seat,
    });

    if (students[studentId]) {
      io.to(studentId).emit("muteToggled", {
        isMuted: student.isMuted,
      });
    }
  });

  socket.on("instructorUnmuteAndLowerHand", ({ studentId }) => {
    console.log("[Server] instructorUnmuteAndLowerHand received:", studentId);

    const student = findStudent(studentId);
    if (!student) {
      console.warn("[Server] Cannot unmute/lower. Student not found:", studentId);
      return;
    }

    sendMuteState(studentId, student, false);
    sendHandState(studentId, student, false, true);

    console.log(`[Server] Instructor unmuted and lowered hand for ${student.name}`);
  });

  socket.on("instructorLowerHand", ({ studentId }) => {
    console.log("[Server] instructorLowerHand received:", studentId);

    const student = findStudent(studentId);
    if (!student) {
      console.warn("[Server] Cannot lower hand. Student not found:", studentId);
      return;
    }

    sendHandState(studentId, student, false, true);

    console.log(`[Server] Instructor lowered hand for ${student.name}`);
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
    if (
      socket.data.clientType === "classroom" &&
      socket.data.role === "instructor" &&
      socket.data.roomId
    ) {
      scheduleRoomClose(socket.data.roomId);
    }

    const permanentUserId =
  Number(
    socket.data.userId
  );

if (
  permanentUserId &&
  connectedUsers[permanentUserId]
) {
  const connectedUser =
    connectedUsers[
      permanentUserId
    ];

  if (
    socket.data.clientType ===
    "classroom"
  ) {
    connectedUser
      .classroomSocketId =
      null;
  }

  if (
    socket.data.clientType ===
    "lab"
  ) {
    connectedUser
      .labSocketId =
      null;
  }
}
    const student = students[socket.id];
    console.log("Disconnected:", student?.name ?? socket.id);

    const labStudentId = Object.keys(labSessions).find(
      (id) => labSessions[id].socketId === socket.id
    );

    // Don't delete lab session on temporary disconnect
    if (
      labStudentId &&
      socket.data.clientType === "lab"
    ) {
      const session = labSessions[labStudentId];
      session.socketId = null;
      console.log(`[Server] Lab client disconnected temporarily: ${session.studentName}`);
      return;
    }

    // Check if student is in lab - don't remove them
    const isInLab = student?.inLab === true;

    if (isInLab) {
      console.log(`[Server] 🧪 ${student?.name} is in lab, keeping in student list`);
      if (student) {
        student.isDisconnected = true;
      }
      broadcastStudentList(io);
      return;
    }

    // Remove if not in lab
    if (students[socket.id]) {
      delete students[socket.id];
      io.emit("playerDisconnected", { id: socket.id });
      broadcastStudentList(io);
    }
  });
});

// ========================================================
// START SERVER
// ========================================================

const serverPort = Number(process.env.PORT) || 3001;

httpServer.listen(serverPort, () => {
  console.log("================================================");
  console.log("🎓 CLASSROOM + LAB SERVER RUNNING");
  console.log("================================================");
  console.log(`📍 http://localhost:${serverPort}`);
  console.log("📊 Classroom Mode: Active");
  console.log("🧪 Lab Mode: Active (Individual Labs)");
  console.log("================================================");
});

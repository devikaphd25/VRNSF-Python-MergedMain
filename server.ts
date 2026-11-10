import { saveAppGameResult, getRecentAppGameResults } from "./server/services/game-results.service.js";
import { pickRandomAvatar } from "./shared/vr-avatars.js";
import {bindGameRun,recordGameResponse} from "./server/services/game-results.service.js";
import classroomRoutes from "./server/routes/classroom.routes.js";
import {activityForSession, selectSessionActivity} from "./server/repositories/course-content.repository.js";
import { saveChallengeResponses, saveDragDropResponses } from "./server/services/challenge-results.service.js";
import { sanitizeSeatAvatarPose } from "./shared/seat-avatar-tracking.js";
import { RoomActivityStore } from "./server/state/room-activity.js";
/**
 * Main multiplayer server.
 *
 * Goal: coordinate classroom, video, challenge, hand-raise, and Python-lab
 * events over Socket.IO while persisting identities/results through Supabase.
 * Data dependencies: users, game_results, rooms, participants,
 * activities, challenge_questions, and challenge_responses.
 * Called by: `npm run dev:server`; browser clients connect through
 * `src/network/socket.ts`.
 */
import express from "express";
import http from "http";
import fs from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import type {
  QuickChallengeStudentProgress,
  Challenge2Category,
  Challenge2Session,
  ClassroomSocket,
  ClassroomStudent,
  QuickChallenge,
  QuickChallengeReview
} from "./server/types.js";

import {
  students,
  labSessions,
  returningStudents,
  connectedUsers,
} from "./server/state/classroom-state.js";

import {
  LabAttemptState,
} from "./server/state/lab-attempt.js";
import {
  getStudentList,
  findStudent,
} from "./server/services/connected-students.service.js";

import {
  broadcastStudentList,
} from "./server/services/student-list-broadcast.service.js";
import loginRoutes from "./server/routes/device-registration.routes.js";
import { supabaseAdmin } from "./server/database/supabase-client.js";
import {
  getAppUserById,
  getAppUserByUsername,
  getAppUserCount,
  initializeAppDataRepository,
  updateAppUserLocation,
} from "./server/repositories/users.repository.js";
import { TRUE_FALSE_MAX_ATTEMPTS } from "./shared/true-false-settings.js";
import {
  TRUE_FALSE_CHALLENGE_TYPE,
  CODE_PATTERN_CHALLENGE_TYPE,
  CODE_PATTERN_ACTIVITY_KEY,
  LOOP_SORT_CHALLENGE_TYPE,
  LOOP_SORT_ACTIVITY_KEY,
  FLOWCHART_SHAPE_CHALLENGE_TYPE,
  FLOWCHART_SHAPE_ACTIVITY_KEY,
  WHILE_TRACE_CHALLENGE_TYPE,
  WHILE_TRACE_ACTIVITY_KEY,
  WHILE_PARTS_CHALLENGE_TYPE,
  WHILE_PARTS_ACTIVITY_KEY,
  WHILE_FACTORIAL_CHALLENGE_TYPE,
  WHILE_FACTORIAL_ACTIVITY_KEY,
  STRING_OK_ERROR_CHALLENGE_TYPE,
  STRING_OK_ERROR_ACTIVITY_KEY,
  STRING_IN_CHALLENGE_TYPE,
  STRING_IN_ACTIVITY_KEY,
  STRING_CLEAN_CHALLENGE_TYPE,
  STRING_CLEAN_ACTIVITY_KEY,
  isQuickChallengeSeries,
  isRetryableChallenge,
  DEFAULT_CHALLENGE_DURATION_SECONDS,
} from "./server/config/true-false-settings.js";
import { CSDP99_W1D1_CHALLENGE1_QUESTIONS } from "./shared/csdp99-w1d1-challenge1.js";
import { CSDP99_W1D1_CHALLENGE2_QUESTIONS } from "./shared/csdp99-w1d1-challenge2.js";
import { CSDP99_W1D1_CHALLENGE3_QUESTIONS } from "./shared/csdp99-w1d1-challenge3.js";
import { CSDP99_W1D2_CHALLENGE1_QUESTIONS } from "./shared/csdp99-w1d2-challenge1.js";
import { getCurriculumExtraCredit } from "./shared/curriculum-extra-credit.js";
import { CSDP99_W1D2_CHALLENGE2_QUESTIONS } from "./shared/csdp99-w1d2-challenge2.js";
import { CHALLENGE_2_ITEMS } from "./shared/device-classification.js";
import { CSDP99_W1D2_CHALLENGE3_QUESTIONS } from "./shared/csdp99-w1d2-challenge3.js";
import { CSDP120_W13D2_CHALLENGE1_QUESTIONS } from "./shared/csdp120-w13d2-challenge1.js";
import { CSDP120_W13D2_CHALLENGE2_QUESTIONS } from "./shared/csdp120-w13d2-challenge2.js";
import { CSDP120_W13D2_CHALLENGE3_QUESTIONS } from "./shared/csdp120-w13d2-challenge3.js";

// Separates saved results from different launches of the same lab. Historical
// rows remain in Supabase, but the live monitor reads only this run.
let activeLabRunStartedAt: string | null = null;

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
const INSTRUCTOR_DISCONNECT_GRACE_MS = 1_500;
const roomActivities = new RoomActivityStore();
const clearLiveActivity=roomActivities.clear.bind(roomActivities);
roomActivities.clear=(roomId,activityId)=>{
  if(activityId&&roomActivities.get(roomId)?.payload.id!==activityId)return;
  clearLiveActivity(roomId,activityId);
  void selectSessionActivity(roomId,null).catch(error=>console.error('[Session activity]',error));
};
const activeQuickChallenges = new Map<string, QuickChallenge>();
const lastQuickChallengeReviews = new Map<string, QuickChallengeReview>();
const activeChallenge2Sessions = new Map<string, Challenge2Session>();

function getChallenge2QuestionStats(session: Challenge2Session) {
  return session.questions.map((question, questionIndex) => {
    const itemId = String(question.options?.item?.id ?? "");
    const itemName = String(question.options?.item?.name ?? `Device ${questionIndex + 1}`);
    const progress = Array.from(session.progress.values());
    const correctCount = progress.filter(student => student.completedItemIds.has(itemId)).length;
    const wrongCount = progress.reduce((sum, student) => {
      const selections = student.wrongSelections.get(itemId);
      if (!selections) return sum;
      return sum + Array.from(selections.values()).reduce((total, count) => total + count, 0);
    }, 0);
    const answered = correctCount + wrongCount;
    return {
      questionIndex,
      label: `Q${questionIndex + 1}`,
      prompt: itemName,
      correctCount,
      wrongCount,
      accuracy: answered === 0 ? 0 : Math.round((correctCount / answered) * 100),
    };
  });
}

function buildChallenge2FinalResults(session: Challenge2Session) {
  const endedAt = Date.now();
  const rankings = [...session.progress.entries()].map(([socketId, progress]) => {
    const student = students[socketId];
    const correctAnswers = progress.completedItemIds.size;
    const accuracy = progress.attempts > 0
      ? correctAnswers / progress.attempts
      : 0;
    const elapsedSeconds = Math.max(
      0,
      ((progress.completedAt ?? endedAt) - progress.startedAt) / 1000
    );
    const speed = Math.max(
      0,
      Math.min(1, 1 - elapsedSeconds / session.durationSeconds)
    );
    const score = progress.attempts > 0
      ? accuracy * 0.70 + speed * 0.30
      : 0;
    const mistakes = [...progress.wrongSelections.entries()].map(
      ([itemId, selections]) => ({
        itemId,
        itemName: session.questions.find(q=>q.options.item.id===itemId)?.options.item.name ?? itemId,
        // Map insertion order preserves the student's first wrong category.
        firstAnswer: selections.keys().next().value as Challenge2Category,
        correctAnswer: session.questions.find(q=>q.options.item.id===itemId)?.correct_answer.category,
        attempts: [...selections.values()].reduce(
          (total, count) => total + count,
          0
        ),
      })
    );
    return {
      studentId: socketId,
      name: student?.name ?? "Student",
      seat: student?.seat,
      correctAnswers,
      wrongAnswers: progress.wrongAttempts,
      attempts: progress.attempts,
      accuracy: accuracy * 100,
      elapsedSeconds,
      score: score * 100,
      mistakes,
      placement: null as number | null,
    };
  });

  rankings.sort((left, right) => {
    const leftAttempted = left.attempts > 0;
    const rightAttempted = right.attempts > 0;
    if (leftAttempted !== rightAttempted) return leftAttempted ? -1 : 1;
    // Ranking priority: finish more devices, make fewer mistakes, then finish
    // faster. When everyone completes all five, this becomes exactly
    // "fewest mistakes first; fastest time breaks a tie."
    return right.correctAnswers - left.correctAnswers ||
      left.wrongAnswers - right.wrongAnswers ||
      left.elapsedSeconds - right.elapsedSeconds ||
      right.score - left.score;
  });
  rankings.filter(result => result.attempts > 0).forEach((result, index) => {
    result.placement = index < 3 ? index + 1 : null;
  });

  const commonErrors = session.questions.map(q=>[q.options.item.id,q.correct_answer.category] as [string,Challenge2Category]).flatMap(
    ([itemId, correctCategory]) => {
      const selections = new Map<
        Challenge2Category,
        { count: number; students: Set<string> }
      >();
      for (const [studentId, progress] of session.progress.entries()) {
        const itemSelections = progress.wrongSelections.get(itemId);
        itemSelections?.forEach((count, category) => {
          const selection = selections.get(category) ?? {
            count: 0,
            students: new Set<string>(),
          };
          selection.count += count;
          selection.students.add(students[studentId]?.name ?? "Student");
          selections.set(category, selection);
        });
      }
      const mostCommon = [...selections.entries()].sort(
        (a, b) => b[1].count - a[1].count
      )[0];
      return mostCommon
        ? [{
            itemId,
            itemName: session.questions.find(q=>q.options.item.id===itemId)?.options.item.name ?? itemId,
            selectedCategory: mostCommon[0],
            correctCategory,
            count: mostCommon[1].count,
            students: [...mostCommon[1].students],
          }]
        : [];
    }
  );

  return {
    challengeId: session.id,
    endedAt,
    durationSeconds: session.durationSeconds,
    rankings,
    commonErrors,
    correctAnswers: session.questions.map(q=>[q.options.item.id,q.correct_answer.category] as [string,Challenge2Category]).map(
      ([itemId, category]) => ({
        itemId,
        itemName: session.questions.find(q=>q.options.item.id===itemId)?.options.item.name ?? itemId,
        category,
      })
    ),
  };
}

function getRoomClassroomStudents(roomId: string) {
  return Object.entries(students).filter(([socketId, student]) => {
    const client = io.sockets.sockets.get(socketId);
    return (
      student.role === "student" &&
      client?.data.roomId === roomId &&
      client.data.clientType === "classroom"
    );
  });
}

function bitCount(value: number) {
  let count = 0;
  let remaining = value >>> 0;
  while (remaining) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

function gradeChallengeAnswer(
  question: NonNullable<QuickChallenge["questions"]>[number],
  selectedIndex: number
) {
  if (question.correctIndices?.length) {
    const required = question.correctIndices;
    const placedRequired = required.filter(index => ((selectedIndex >> index) & 1) === 1).length;
    const extras = Math.max(0, bitCount(selectedIndex) - placedRequired);
    return {
      correct: placedRequired === required.length && extras === 0,
      placementCorrect: placedRequired,
    };
  }
  return {
    correct: selectedIndex === question.correctIndex,
    placementCorrect: undefined as number | undefined,
  };
}

function getFivePartsQuestionStats(challenge: QuickChallenge) {
  const questions = challenge.questions ?? [];
  const progress = Array.from(challenge.studentProgress.values());
  return questions.map((question, questionIndex) => {
    // Count each student's latest selection, including unfinished attempts.
    // Drafts can skip questions, so their array position is not the question index.
    const answers = progress.flatMap(student =>
      student.answers.filter(answer => answer.questionIndex === questionIndex)
    );
    if (question.correctIndices?.length) {
      const requiredCount = question.correctIndices.length;
      const correctCount = answers.reduce(
        (sum, answer) => sum + (answer.placementCorrect ?? 0),
        0
      );
      const totalPlacements = answers.length * requiredCount;
      const wrongCount = Math.max(0, totalPlacements - correctCount);
      return {
        questionIndex,
        label: `Q${questionIndex + 1}`,
        prompt: question.instructorLabel ?? question.prompt ?? `Question ${questionIndex + 1}`,
        correctCount,
        wrongCount,
        accuracy: totalPlacements === 0 ? 0 : Math.round((correctCount / totalPlacements) * 100),
      };
    }
    const correctCount = answers.filter(answer => answer.correct).length;
    const wrongCount = answers.filter(answer => !answer.correct).length;
    const answered = correctCount + wrongCount;
    return {
      questionIndex,
      label: `Q${questionIndex + 1}`,
      prompt: question.instructorLabel ?? question.prompt ?? `Question ${questionIndex + 1}`,
      correctCount,
      wrongCount,
      accuracy: answered === 0 ? 0 : Math.round((correctCount / answered) * 100),
    };
  });
}

function getFivePartsScore(progress: QuickChallengeStudentProgress) {
  return progress.answers.filter(answer => answer.correct).length;
}

function getExtraCreditQuestionStats(challenge: QuickChallenge) {
  const catalog = getCurriculumExtraCredit(challenge.challengeType);
  if (catalog.length === 0) return [];
  const progress = Array.from(challenge.studentProgress.values());
  return catalog.map((question, questionIndex) => {
    const answers = progress.flatMap(student =>
      (student.extraCreditAnswers ?? []).filter(answer =>
        answer.questionIndex === questionIndex && Number(answer.selectedIndex) >= 0
      )
    );
    const correctCount = answers.filter(answer => answer.correct).length;
    const wrongCount = answers.filter(answer => !answer.correct).length;
    const answered = correctCount + wrongCount;
    return {
      questionIndex,
      label: `Q${questionIndex + 1}`,
      prompt: question.instructorLabel ?? question.prompt,
      correctCount,
      wrongCount,
      accuracy: answered === 0 ? 0 : Math.round((correctCount / answered) * 100),
    };
  });
}

function getInstructorQuestionStats(challenge: QuickChallenge) {
  const mainStats = getFivePartsQuestionStats(challenge);
  const extraStats = getExtraCreditQuestionStats(challenge);
  return extraStats.length > 0 ? [...mainStats, ...extraStats] : mainStats;
}

function findStudentProgressKey(challenge: QuickChallenge, socketId: string): string {
  if (challenge.studentProgress.has(socketId)) return socketId;
  const userId = students[socketId]?.userId;
  const participantId = io.sockets.sockets.get(socketId)?.data.participantId;
  if (userId) {
    for (const id of challenge.studentProgress.keys()) {
      if (students[id]?.userId === userId) return id;
    }
  }
  if (participantId && challenge.responseParticipants) {
    for (const [id, boundId] of challenge.responseParticipants) {
      if (String(boundId) === String(participantId) && challenge.studentProgress.has(id)) return id;
    }
  }
  return socketId;
}

function saveExtraCreditAnswers(
  challenge: QuickChallenge,
  socketId: string,
  rawAnswers: unknown
): boolean {
  const catalog = getCurriculumExtraCredit(challenge.challengeType);
  if (catalog.length === 0) return false;
  const progressKey = findStudentProgressKey(challenge, socketId);
  const progress = challenge.studentProgress.get(progressKey) ?? {
    answers: [],
    completed: true,
    attemptCount: 0,
  };
  const answers = Array.isArray(rawAnswers)
    ? rawAnswers
    : rawAnswers && typeof rawAnswers === "object"
      ? catalog.map((_, questionIndex) => (rawAnswers as Record<string, unknown>)[questionIndex])
      : [];
  const extraCreditAnswers = catalog.flatMap((question, questionIndex) => {
    const selectedIndex = Number(answers[questionIndex]);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return [];
    return [{
      questionIndex,
      selectedIndex,
      correct: selectedIndex === question.correctIndex,
      answeredAt: Date.now(),
    }];
  });
  challenge.studentProgress.set(progressKey, { ...progress, extraCreditAnswers });
  return true;
}

function getQuickChallengeWinner(challenge: QuickChallenge): {
  socketId: string | null;
  name: string | null;
  timeSeconds: number | null;
} {
  if (isQuickChallengeSeries(challenge.challengeType)) {
    const ranked = Array.from(challenge.studentProgress.entries())
      .filter(([, progress]) => progress.completed)
      .sort(([, left], [, right]) => {
        const scoreDiff = getFivePartsScore(right) - getFivePartsScore(left);
        if (scoreDiff !== 0) return scoreDiff;
        return (left.totalTimeSeconds ?? Number.MAX_SAFE_INTEGER) -
          (right.totalTimeSeconds ?? Number.MAX_SAFE_INTEGER);
      });
    const winner = ranked[0];
    return {
      socketId: winner?.[0] ?? null,
      name: winner ? students[winner[0]]?.name ?? null : null,
      timeSeconds: winner?.[1].totalTimeSeconds ?? null,
    };
  }

  const rankedCorrectAnswers = Array.from(challenge.answers.entries())
    .filter(([, answer]) => answer.correct)
    .sort(
      ([, left], [, right]) =>
        left.responseTimeSeconds - right.responseTimeSeconds
    );
  const winnerEntry = rankedCorrectAnswers[0];
  const winnerSocketId = winnerEntry?.[0] ?? null;
  const winnerAnswer = winnerEntry?.[1] ?? null;
  return {
    socketId: winnerSocketId,
    name: winnerSocketId ? students[winnerSocketId]?.name ?? null : null,
    timeSeconds: winnerAnswer?.responseTimeSeconds ?? null,
  };
}

function emitQuickChallengeEnded(
  challenge: QuickChallenge,
  extra: { stoppedByInstructor?: boolean } = {}
): void {
  void saveChallengeResponses(challenge, extra.stoppedByInstructor ? "instructor_stop" : "ended").catch(error => {
    console.error("[Challenge 1] Results pending:", error);
    for (const client of io.sockets.sockets.values()) if (client.data.roomId === challenge.roomId && isInstructorSocket(client))
      client.emit("challengeSaveFailed", { message: "Results could not be saved to Supabase. A server backup was retained." });
  });
  const winner = getQuickChallengeWinner(challenge);
  for (const client of io.sockets.sockets.values()) {
    if (client.data.roomId !== challenge.roomId) continue;
    client.emit("quickChallengeEnded", {
      quizId: challenge.id,
      winnerStudentId: winner.socketId,
      winnerName: winner.name,
      winnerTimeSeconds: winner.timeSeconds,
      ...extra,
    });
  }
}

function buildQuickChallengeReview(challenge: QuickChallenge): QuickChallengeReview {
  const roomStudents = getRoomClassroomStudents(challenge.roomId);
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - challenge.startedAt) / 1000)
  );

  if (isQuickChallengeSeries(challenge.challengeType)) {
    const progresses = Array.from(challenge.studentProgress.values());
    const completed = progresses.filter(progress => progress.completed);
    const correctCount = completed.reduce(
      (sum, progress) => sum + getFivePartsScore(progress),
      0
    );
    const wrongCount = completed.reduce(
      (sum, progress) => sum + (progress.answers.length - getFivePartsScore(progress)),
      0
    );
    return {
      quizId: challenge.id,
      cycleLabel: challenge.cycleLabel ?? "Current Learning Cycle",
      question: "Five Parts Challenge",
      options: ["Completed", "In progress"],
      correctIndex: 0,
      answerCounts: [completed.length, Math.max(0, roomStudents.length - completed.length)],
      studentCount: roomStudents.length,
      answeredCount: completed.length,
      correctCount,
      wrongCount,
      elapsedSeconds,
    };
  }

  const answers = Array.from(challenge.answers.values());
  const answerCounts = challenge.options.map((_, index) =>
    answers.filter(answer => answer.selectedIndex === index).length
  );
  return {
    quizId: challenge.id,
    cycleLabel: challenge.cycleLabel ?? "Current Learning Cycle",
    question: challenge.question,
    options: challenge.options,
    correctIndex: challenge.correctIndex,
    answerCounts,
    studentCount: roomStudents.length,
    answeredCount: answers.length,
    correctCount: answers.filter(answer => answer.correct).length,
    wrongCount: answers.filter(answer => !answer.correct).length,
    elapsedSeconds,
  };
}

function notifyInstructorStudentProgress(
  challenge: QuickChallenge,
  socketId: string,
  student: ClassroomStudent,
  extra: Record<string, unknown> = {}
): void {
  const progress = challenge.studentProgress.get(socketId);
  const answeredCount = progress?.answers.length ?? 0;
  const correctCount = progress ? getFivePartsScore(progress) : 0;
  const payload = {
    quizId: challenge.id,
    studentId: socketId,
    userId: student.userId,
    name: student.name,
    answeredCount,
    correctCount,
    totalQuestions: challenge.totalQuestions ?? challenge.questions?.length ?? 0,
    completed: Boolean(progress?.completed),
    responseTimeSeconds: progress?.totalTimeSeconds,
    questionStats: getInstructorQuestionStats(challenge),
    extraCreditStats: getExtraCreditQuestionStats(challenge),
    ...extra,
  };

  for (const client of io.sockets.sockets.values()) {
    if (
      client.data.roomId === challenge.roomId &&
      client.data.role === "instructor" &&
      client.data.clientType === "classroom"
    ) {
      client.emit("quickChallengeStudentAnswered", payload);
    }
  }
}

function finishFivePartsIfEveryoneDone(challenge: QuickChallenge): void {
  if (isRetryableChallenge(challenge.challengeType)) {
    publishQuickChallengeReview(challenge);
    return;
  }
  const roomStudents = getRoomClassroomStudents(challenge.roomId);
  if (roomStudents.length === 0) return;
  const everyoneDone = roomStudents.every(([socketId]) =>
    challenge.studentProgress.get(socketId)?.completed
  );
  if (!everyoneDone) return;
  if (challenge.timeout) clearTimeout(challenge.timeout);
  publishQuickChallengeReview(challenge);
  emitQuickChallengeEnded(challenge);
  roomActivities.clear(challenge.roomId,challenge.id);
  activeQuickChallenges.delete(challenge.roomId);
}

function publishQuickChallengeReview(challenge: QuickChallenge): void {
  const review = buildQuickChallengeReview(challenge);
  lastQuickChallengeReviews.set(challenge.roomId, review);
  for (const client of io.sockets.sockets.values()) {
    if (client.data.roomId === challenge.roomId) {
      client.emit("debriefReviewData", review);
    }
  }
}

function endChallenge2Session(
  session: Challenge2Session,
  reason: "completed" | "timeout" | "instructor_stop"
): void {
  roomActivities.clear(session.roomId, session.id);
  if (session.timeout) clearTimeout(session.timeout);
  void saveDragDropResponses(session).catch(error=>{
    console.error('[Challenge 2] Results pending:',error);
    for(const client of io.sockets.sockets.values())if(client.data.roomId===session.roomId&&isInstructorSocket(client))client.emit('challengeSaveFailed',{message:'Results pending. A server backup was retained.'});
  });
  for (const client of io.sockets.sockets.values()) {
    if (client.data.roomId !== session.roomId) continue;
    client.emit("challenge2Ended", {
      challengeId: session.id,
      reason,
    });

    if (client.data.role !== "instructor") {
      const student = students[client.id];
      if (student) student.mode = "Classroom Mode";
      client.emit("modeChanged", {
        mode: "Classroom Mode",
        destination: "Class",
        fromInstructor: true,
      });
    }
  }

  activeChallenge2Sessions.delete(session.roomId);
  broadcastStudentList(io);
}

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
    roomActivities.clear(roomId);

    const { error } = await supabaseAdmin
      .from("class_sessions")
      .update({ ended_at: new Date().toISOString(), active_activity_id: null })
      .eq("id", roomId)
      .is("ended_at", null);

    if (error) {
      console.error(`[Room] Could not close ${roomId}:`, error.message);
      // Do not leave students trapped in the classroom because persistence
      // failed. Live-session shutdown must still continue below.
    }

    // An instructor owns the live teaching session. When that instructor
    // disconnects, remove every live student representation and use the same
    // classEnded event as the End Class button so all clients return to login.
    for (const [studentSocketId, student] of Object.entries(students)) {
      if (student.role !== "student") continue;
      io.emit("playerDisconnected", { id: studentSocketId });
      delete students[studentSocketId];

      const connectedUser = connectedUsers[Number(student.userId)];
      if (connectedUser) {
        connectedUser.classroomSocketId = null;
        connectedUser.labSocketId = null;
        connectedUser.inLab = false;
        connectedUser.mode = "Classroom Mode";
        connectedUser.location = "classroom";
      }
    }
    broadcastStudentList(io);
    io.emit("classEnded", {
      roomId,
      message: "The instructor disconnected. Please sign in again."
    });
    console.log(`[Room] Closed ${roomId} after instructor disconnected.`);
  }, INSTRUCTOR_DISCONNECT_GRACE_MS);

  instructorRoomCloseTimers.set(roomId, timer);
  console.log(`[Room] Instructor disconnected; ${roomId} will close shortly.`);
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

app.use("/api", classroomRoutes);

// Optional production web host for the packaged Quest app. Only dist/ is served.
if (process.env.SERVE_WEB_APP === "true") {
  const webRoot = path.resolve(process.cwd(), "dist");
  app.use("/.well-known", express.static(path.join(webRoot, ".well-known")));
  app.use(express.static(webRoot));
}
io.on("connection", (socket: ClassroomSocket) => {
  console.log("Connected:", socket.id);

  // Acknowledge registration and finish constructing client systems before replay.
  let activitySynced = false;
  socket.on("classroomSceneReady", () => {
    const roomId = String(socket.data.roomId ?? "");
    const student = students[socket.id];
    if (activitySynced || !roomId || !student || socket.data.role !== "student" ||
        socket.data.clientType !== "classroom") return;
    activitySynced = true;
    const activity = roomActivities.get(roomId);
    socket.emit("studentWelcome", {
      roomId, userId: String(socket.data.userId ?? student.id ?? socket.id),
      activityEvent: activity?.event,
    });
    if (!activity) return;
    if(activity.event==='launchPythonPuzzle'){
      bindGameRun(Number(socket.data.userId),{participantId:Number(socket.data.participantId),activityId:activity.payload.activityId,startedAt:activity.payload.startedAt,roomId});
    }
    if (activity.event === "displayRoomOpened") {
      student.mode = "Display Room";
    } else if (activity.event === "challenge2Started") {
      const session = activeChallenge2Sessions.get(roomId);
      if (!session || session.id !== activity.payload.id) return;
      if(socket.data.participantId)session.participants.set(socket.id,String(socket.data.participantId));
      if (!session.progress.has(socket.id)) session.progress.set(socket.id, {
        completedItemIds: new Set(), attempts: 0, wrongAttempts: 0,
        wrongSelections: new Map(), startedAt: session.startedAt, completedAt: null,
      });
      student.mode = "Challenge 2";
    } else if (activity.event === "quickChallengeStarted") {
      if (activeQuickChallenges.get(roomId)?.id !== activity.payload.id) return;
      if(socket.data.participantId) activeQuickChallenges.get(roomId)?.responseParticipants?.set(socket.id,String(socket.data.participantId));
      student.mode = "Quick Challenge";
    } else if (activity.event === "gameChanged") {
      student.mode = "Game Mode";
      student.inLab = true;
      student.labGameId = "python-type-lab";
      const user = connectedUsers[Number(socket.data.userId)];
      if (user) { user.mode = "Game Mode"; user.inLab = true; }
    } else if (activity.event === "presentationContentChanged") {
      student.mode = "Presentation Mode";
      const review = lastQuickChallengeReviews.get(roomId);
      if (review && activity.payload.mediaType === "image") socket.emit("debriefReviewData", review);
    }
    socket.emit(activity.event, activity.payload);
    if (activity.event === "presentationContentChanged" && activity.payload.mediaType === "video" && activity.playback) {
      socket.emit("videoPlaybackCommand", activity.playback);
    }
    broadcastStudentList(io);
  });

  // The gallery is code-defined; only its room-scoped launch state is synchronized.
  socket.on("instructorDisplayRoom", async (data = {}) => {
    try {
    const roomId = String(socket.data.roomId ?? "").trim();
    if (!roomId || !isInstructorSocket(socket) || socket.data.clientType !== "classroom") return;
    const open = data.open !== false;
    const activity=open?await activityForSession(roomId,'display-room',Number(data.activityId)||undefined):null;
    await selectSessionActivity(roomId,activity?.id??null);
    if (open) roomActivities.set(roomId, { event: "displayRoomOpened", payload: {} });
    else if (roomActivities.get(roomId)?.event === "displayRoomOpened") roomActivities.clear(roomId);
    for (const client of io.sockets.sockets.values()) {
      if (client.data.roomId !== roomId || client.data.clientType !== "classroom") continue;
      client.emit(open ? "displayRoomOpened" : "displayRoomClosed");
      if (students[client.id]) students[client.id].mode = open ? "Display Room" : "Classroom Mode";
    }
    broadcastStudentList(io);
    } catch(error) {console.error('[Activity]',error);socket.emit('error',{message:error instanceof Error?error.message:'Could not start activity'});}

  });

  socket.on("instructorLaunchPythonPuzzle", async (data = {}) => {
    try {
    const roomId = String(socket.data.roomId ?? "").trim();
    if (!roomId || !isInstructorSocket(socket) || socket.data.clientType !== "classroom") return;
    if(data.returnToClass===true){
      await selectSessionActivity(roomId,null);roomActivities.clear(roomId);
    }else{
      const activity=await activityForSession(roomId,'python-puzzle',Number(data.activityId)||undefined);
      const startedAt=Date.now();
      await selectSessionActivity(roomId,activity.id);
      roomActivities.set(roomId,{event:'launchPythonPuzzle',payload:{activityId:activity.id,startedAt}});
      for(const [id,student]of getRoomClassroomStudents(roomId)){
        const participantId=Number(io.sockets.sockets.get(id)?.data.participantId);
        if(participantId)bindGameRun(Number(student.userId),{participantId,activityId:activity.id,startedAt,roomId});
      }
    }
    for(const [id]of getRoomClassroomStudents(roomId))io.to(id).emit(data.returnToClass===true?'returnFromPythonPuzzle':'launchPythonPuzzle');
    } catch(error) {console.error('[Activity]',error);socket.emit('error',{message:error instanceof Error?error.message:'Could not start activity'});}

  });

  socket.on("instructorQuickChallenge", async (data = {}) => {
    try {
    const roomId = String(socket.data.roomId ?? "").trim();
    if (!roomId || !isInstructorSocket(socket) || socket.data.clientType !== "classroom") {
      socket.emit("error", {
        message: "Only a registered classroom instructor can start a quick challenge.",
      });
      return;
    }

    const previous = activeQuickChallenges.get(roomId);
    if (previous) {
      if(previous.timeout)clearTimeout(previous.timeout);
      emitQuickChallengeEnded(previous,{stoppedByInstructor:true});
    }

    const requestedKey = data.challengeType === TRUE_FALSE_CHALLENGE_TYPE
      ? "true_false"
      : data.challengeType === CODE_PATTERN_CHALLENGE_TYPE
        ? CODE_PATTERN_ACTIVITY_KEY
        : data.challengeType === LOOP_SORT_CHALLENGE_TYPE
          ? LOOP_SORT_ACTIVITY_KEY
        : data.challengeType === FLOWCHART_SHAPE_CHALLENGE_TYPE
          ? FLOWCHART_SHAPE_ACTIVITY_KEY
        : data.challengeType === WHILE_TRACE_CHALLENGE_TYPE
          ? WHILE_TRACE_ACTIVITY_KEY
        : data.challengeType === WHILE_PARTS_CHALLENGE_TYPE
          ? WHILE_PARTS_ACTIVITY_KEY
        : data.challengeType === WHILE_FACTORIAL_CHALLENGE_TYPE
          ? WHILE_FACTORIAL_ACTIVITY_KEY
        : data.challengeType === STRING_OK_ERROR_CHALLENGE_TYPE
          ? STRING_OK_ERROR_ACTIVITY_KEY
        : data.challengeType === STRING_IN_CHALLENGE_TYPE
          ? STRING_IN_ACTIVITY_KEY
        : data.challengeType === STRING_CLEAN_CHALLENGE_TYPE
          ? STRING_CLEAN_ACTIVITY_KEY
        : "multiple_choice";
    const activity=await activityForSession(roomId,requestedKey,Number(data.activityId)||undefined);
    if(activity.activity_type!=='challenge'||!['true_false','multiple_choice',CODE_PATTERN_ACTIVITY_KEY,LOOP_SORT_ACTIVITY_KEY,FLOWCHART_SHAPE_ACTIVITY_KEY,WHILE_TRACE_ACTIVITY_KEY,WHILE_PARTS_ACTIVITY_KEY,WHILE_FACTORIAL_ACTIVITY_KEY,STRING_OK_ERROR_ACTIVITY_KEY,STRING_IN_ACTIVITY_KEY,STRING_CLEAN_ACTIVITY_KEY].includes(activity.activity_key))throw Error('Select a question challenge');
    const {data:loadedRows,error}=await supabaseAdmin.from('challenge_questions').select('*').eq('activity_id',activity.id).order('question_order');
    if(error)throw error;
    let rows = loadedRows ?? [];
    const isCodePattern = activity.activity_key === CODE_PATTERN_ACTIVITY_KEY;
    const isLoopSort = activity.activity_key === LOOP_SORT_ACTIVITY_KEY;
    const isFlowchartShape = activity.activity_key === FLOWCHART_SHAPE_ACTIVITY_KEY;
    const isWhileTrace = activity.activity_key === WHILE_TRACE_ACTIVITY_KEY;
    const isWhileParts = activity.activity_key === WHILE_PARTS_ACTIVITY_KEY;
    const isWhileFactorial = activity.activity_key === WHILE_FACTORIAL_ACTIVITY_KEY;
    const isStringOkError = activity.activity_key === STRING_OK_ERROR_ACTIVITY_KEY;
    const isStringIn = activity.activity_key === STRING_IN_ACTIVITY_KEY;
    const isStringClean = activity.activity_key === STRING_CLEAN_ACTIVITY_KEY;
    const curriculumCatalog = isCodePattern
      ? CSDP99_W1D1_CHALLENGE1_QUESTIONS
      : isLoopSort
        ? CSDP99_W1D1_CHALLENGE2_QUESTIONS
        : isFlowchartShape
          ? CSDP99_W1D1_CHALLENGE3_QUESTIONS
        : isWhileTrace
          ? CSDP99_W1D2_CHALLENGE1_QUESTIONS
        : isWhileParts
          ? CSDP99_W1D2_CHALLENGE2_QUESTIONS
        : isWhileFactorial
          ? CSDP99_W1D2_CHALLENGE3_QUESTIONS
        : isStringOkError
          ? CSDP120_W13D2_CHALLENGE1_QUESTIONS
        : isStringIn
          ? CSDP120_W13D2_CHALLENGE2_QUESTIONS
        : isStringClean
          ? CSDP120_W13D2_CHALLENGE3_QUESTIONS
          : undefined;
    if (curriculumCatalog && rows.length > curriculumCatalog.length) {
      await supabaseAdmin
        .from("challenge_questions")
        .delete()
        .eq("activity_id", activity.id)
        .gt("question_order", curriculumCatalog.length);
      rows = rows.slice(0, curriculumCatalog.length);
    }
    const questionsValid = curriculumCatalog
      ? curriculumCatalog.every((catalog, index) => {
          const q = rows[index];
          if (!q || !Array.isArray(q.options) || q.options.length !== catalog.options.length) return false;
          if (catalog.correctIndices) {
            return Array.isArray(q.correct_answer?.choice_indices);
          }
          return Number.isInteger(q.correct_answer?.choice_index) &&
            q.correct_answer.choice_index >= 0 &&
            q.correct_answer.choice_index < q.options.length;
        })
      : Boolean(rows.length) && rows.every(q =>
          Array.isArray(q.options) &&
          q.options.length >= 2 &&
          q.options.length <= 4 &&
          Number.isInteger(q.correct_answer?.choice_index) &&
          q.correct_answer.choice_index >= 0 &&
          q.correct_answer.choice_index < q.options.length
        );
    if (!questionsValid) throw Error('Challenge questions are missing or invalid');
    const isFiveParts=true, isDatabaseSeries=activity.activity_key!=='true_false' && !curriculumCatalog;
    const durationSeconds=Math.min(600,Math.max(15,Number(data.durationSeconds)||DEFAULT_CHALLENGE_DURATION_SECONDS));
    const cycleLabel=activity.title;
    const fivePartsQuestions=(curriculumCatalog ?? rows).map((catalogOrRow, index) => {
      const catalog = curriculumCatalog?.[index];
      const q = rows[index] ?? catalogOrRow;
      const correctIndices = Array.isArray(q.correct_answer?.choice_indices)
        ? q.correct_answer.choice_indices.filter((value: unknown) => Number.isInteger(value))
        : catalog?.correctIndices;
      return {
        id: String(q.id),
        prompt: catalog?.prompt ?? q.question_text,
        options: catalog?.options ?? (q.options as string[]),
        correctIndex: catalog?.correctIndex ?? (
          Number.isInteger(q.correct_answer?.choice_index)
            ? q.correct_answer.choice_index as number
            : 0
        ),
        correctIndices: catalog?.correctIndices ?? correctIndices,
        instructorLabel: catalog?.instructorLabel,
      };
    });
    const fivePartsQuestion=fivePartsQuestions[0];
    await selectSessionActivity(roomId,activity.id);
    const challenge: QuickChallenge = {
      activityId: activity.id,
      id: `quick-${roomId}-${Date.now()}`,
      roomId,
      question: fivePartsQuestion!.prompt,
      options: [...fivePartsQuestion!.options],
      correctIndex: fivePartsQuestion!.correctIndex,
      durationSeconds,
      startedAt: Date.now(),
      cycleLabel,
      challengeType: isCodePattern
        ? CODE_PATTERN_CHALLENGE_TYPE
        : isLoopSort
          ? LOOP_SORT_CHALLENGE_TYPE
        : isFlowchartShape
          ? FLOWCHART_SHAPE_CHALLENGE_TYPE
        : isWhileTrace
          ? WHILE_TRACE_CHALLENGE_TYPE
        : isWhileParts
          ? WHILE_PARTS_CHALLENGE_TYPE
        : isWhileFactorial
          ? WHILE_FACTORIAL_CHALLENGE_TYPE
        : isStringOkError
          ? STRING_OK_ERROR_CHALLENGE_TYPE
        : isStringIn
          ? STRING_IN_CHALLENGE_TYPE
        : isStringClean
          ? STRING_CLEAN_CHALLENGE_TYPE
        : isDatabaseSeries ? "database-series" : TRUE_FALSE_CHALLENGE_TYPE,
      questionIndex: 0,
      totalQuestions: fivePartsQuestions.length,
      questions: fivePartsQuestions,
      answers: new Map(),
      responseParticipants: new Map(getRoomClassroomStudents(roomId).flatMap(([id]) => {
        const participant = io.sockets.sockets.get(id)?.data.participantId;
        return participant ? [[id, String(participant)] as [string,string]] : [];
      })),
      studentProgress: new Map(),
      timeout: null,
    };
    activeQuickChallenges.set(roomId, challenge);
    lastQuickChallengeReviews.delete(roomId);

    const studentPayload = {
      id: challenge.id,
      question: challenge.question,
      options: challenge.options,
      durationSeconds: challenge.durationSeconds,
      startedAt: challenge.startedAt,
      challengeType: challenge.challengeType,
      questionIndex: challenge.questionIndex,
      totalQuestions: challenge.totalQuestions,
      questions: isFiveParts
        ? fivePartsQuestions.map(item => ({
            question: item.prompt,
            options: item.options,
            questionType: item.correctIndices?.length ? "multi_select" : "multiple_choice",
          }))
        : undefined,
    };
    roomActivities.set(roomId, {
      event: "quickChallengeStarted", payload: studentPayload,
      expiresAt: challenge.startedAt + challenge.durationSeconds * 1000,
    });
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
      questionStats: isFiveParts ? getInstructorQuestionStats(challenge) : undefined,
      extraCreditStats: isFiveParts ? getExtraCreditQuestionStats(challenge) : undefined,
    });

    challenge.timeout = setTimeout(() => {
      if (activeQuickChallenges.get(roomId)?.id !== challenge.id) return;

      publishQuickChallengeReview(challenge);
      emitQuickChallengeEnded(challenge);
      roomActivities.clear(roomId, challenge.id);
      activeQuickChallenges.delete(roomId);
    }, durationSeconds * 1000 + 4000);
    } catch(error) {console.error('[Activity]',error);socket.emit('error',{message:error instanceof Error?error.message:'Could not start activity'});}

  });

  // A retry is explicit and acknowledged only after the previous result is durable.
  let challengeRetryPending = false;
  socket.on("quickChallengeRetry", async (data = {}, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    const roomId = String(socket.data.roomId ?? "");
    const challenge = activeQuickChallenges.get(roomId);
    const progress = challenge?.studentProgress.get(socket.id);
    if (challengeRetryPending || !challenge || challenge.id !== data.quizId ||
        !isRetryableChallenge(challenge.challengeType) || socket.data.role !== "student" ||
        !students[socket.id] || !progress?.completed ||
        Date.now() >= challenge.startedAt + challenge.durationSeconds * 1000) {
      reply({ success: false, message: "This challenge is no longer available for retry." });
      return;
    }
    if ((progress.attemptCount ?? 0) >= TRUE_FALSE_MAX_ATTEMPTS) {
      reply({ success: false, message: "You have used all three attempts.", attemptCount: progress.attemptCount });
      return;
    }
    challengeRetryPending = true;
    try {
      await saveChallengeResponses(challenge, "completed");
      if (activeQuickChallenges.get(roomId) !== challenge || !socket.connected ||
          Date.now() >= challenge.startedAt + challenge.durationSeconds * 1000) {
        reply({ success: false, message: "The challenge has ended." });
        return;
      }
      const attemptStartedAt = Math.max(Date.now(), (progress.attemptStartedAt ?? challenge.startedAt) + 1);
      challenge.studentProgress.set(socket.id, { answers: [], completed: false, attemptStartedAt, attemptCount: progress.attemptCount ?? 0 });
      notifyInstructorStudentProgress(challenge, socket.id, students[socket.id]);
      reply({ success: true, attemptStartedAt, attemptCount: progress.attemptCount ?? 0 });
    } catch (error) {
      console.error("[Challenge retry] Could not preserve completed attempt", error);
      reply({ success: false, message: "Could not save the previous attempt. Please try again." });
    } finally {
      challengeRetryPending = false;
    }
  });

  socket.on("quickChallengeDraft", (data = {}) => {
    const challenge = activeQuickChallenges.get(String(socket.data.roomId ?? ""));
    if (!challenge || challenge.id !== data.quizId || !isQuickChallengeSeries(challenge.challengeType) ||
      socket.data.role !== "student" || !students[socket.id]) return;
    if (data.extraCredit) {
      if (saveExtraCreditAnswers(challenge, socket.id, data.answers)) {
        notifyInstructorStudentProgress(challenge, socket.id, students[socket.id]);
      }
      return;
    }
    if (challenge.studentProgress.get(socket.id)?.completed) return;
    const progress = challenge.studentProgress.get(socket.id);
    if (progress?.attemptStartedAt && data.attemptStartedAt !== progress.attemptStartedAt) return;
    if (!Array.isArray(data.answers) || data.answers.length > (challenge.questions?.length ?? 0)) return;
    const answers = data.answers.flatMap((value, questionIndex) => {
      const question = challenge.questions?.[questionIndex];
      if (!question || !Number.isInteger(value) || value < 0) return [];
      const maxMask = (1 << question.options.length) - 1;
      if (question.correctIndices?.length) {
        if (value === 0 || value > maxMask) return [];
        const graded = gradeChallengeAnswer(question, value);
        return [{ questionIndex, selectedIndex: value, correct: graded.correct, answeredAt: Date.now(), placementCorrect: graded.placementCorrect }];
      }
      if (value >= question.options.length) return [];
      const graded = gradeChallengeAnswer(question, value);
      return [{ questionIndex, selectedIndex: value, correct: graded.correct, answeredAt: Date.now() }];
    });
    challenge.studentProgress.set(socket.id, { ...progress, answers, completed: false });
    if(socket.data.participantId) challenge.responseParticipants?.set(socket.id,String(socket.data.participantId));
    // Refresh the instructor's live monitor without marking this attempt submitted.
    notifyInstructorStudentProgress(challenge, socket.id, students[socket.id]);
  });

  socket.on("quickChallengeAnswer", (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    const student = students[socket.id];
    const challenge = activeQuickChallenges.get(roomId);

    if (
      !student ||
      socket.data.role === "instructor" ||
      !challenge ||
      data.quizId !== challenge.id
    ) return;

    if (isQuickChallengeSeries(challenge.challengeType)) {
      const questions = challenge.questions ?? [];
      const progress = challenge.studentProgress.get(socket.id) ?? {
        answers: [],
        completed: false,
        attemptCount: 0,
      };
      if (progress.completed || questions.length === 0 ||
          (progress.attemptStartedAt && data.attemptStartedAt !== progress.attemptStartedAt)) return;

      const attemptsUsed = progress.attemptCount ?? 0;
      if (isRetryableChallenge(challenge.challengeType) && attemptsUsed >= TRUE_FALSE_MAX_ATTEMPTS) {
        const correctCount = getFivePartsScore(progress);
        socket.emit("quickChallengeResult", {
          quizId: challenge.id,
          completed: true,
          hasNext: false,
          correctCount,
          answeredCount: progress.answers.length,
          totalQuestions: questions.length,
          responseTimeSeconds: progress.totalTimeSeconds ?? 0,
          attemptCount: attemptsUsed,
          retriesRemaining: 0,
          results: progress.answers.map((answer, questionIndex) => ({
            questionIndex,
            selectedIndex: answer.selectedIndex,
            correctIndex: questions[questionIndex]?.correctIndex,
            correct: answer.correct,
          })),
          message: `Score: ${correctCount}/${questions.length}`,
        });
        return;
      }

      const rawAnswers = Array.isArray(data.answers) ? data.answers : null;
      if (!rawAnswers || rawAnswers.length !== questions.length) return;

      const graded = [];
      for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
        const currentQuestion = questions[questionIndex];
        const selectedIndex = Number.isInteger(rawAnswers[questionIndex])
          ? Number(rawAnswers[questionIndex])
          : null;
        if (selectedIndex === null || selectedIndex < 0) return;
        const maxMask = (1 << currentQuestion.options.length) - 1;
        if (currentQuestion.correctIndices?.length) {
          if (selectedIndex > maxMask) return;
        } else if (selectedIndex >= currentQuestion.options.length) {
          return;
        }
        const result = gradeChallengeAnswer(currentQuestion, selectedIndex);
        graded.push({
          questionIndex,
          selectedIndex,
          correct: result.correct,
          answeredAt: Date.now(),
          placementCorrect: result.placementCorrect,
        });
      }

      const answeredAt = Date.now();
      progress.answers = graded;
      progress.completed = true;
      progress.attemptCount = attemptsUsed + 1;
      progress.finishedAt = answeredAt;
      progress.totalTimeSeconds = Math.max(
        0,
        (answeredAt - (progress.attemptStartedAt ?? challenge.startedAt)) / 1000
      );
      challenge.studentProgress.set(socket.id, progress);
      if (socket.data.participantId) challenge.responseParticipants?.set(socket.id, String(socket.data.participantId));
      void saveChallengeResponses(challenge, "completed").catch(error => {
        console.error("[Challenge 1] Save failed:", error);
        socket.emit("challengeSaveFailed", { message: "Result backup retained; database save failed." });
      });
      publishQuickChallengeReview(challenge);

      const correctCount = getFivePartsScore(progress);
      socket.emit("quickChallengeResult", {
        quizId: challenge.id,
        completed: true,
        hasNext: false,
        correctCount,
        answeredCount: graded.length,
        totalQuestions: questions.length,
        responseTimeSeconds: progress.totalTimeSeconds,
        results: graded.map((answer, questionIndex) => ({
          questionIndex,
          selectedIndex: answer.selectedIndex,
          correctIndex: questions[questionIndex].correctIndex,
          correct: answer.correct,
        })),
        attemptCount: progress.attemptCount,
        retriesRemaining: Math.max(
          0,
          TRUE_FALSE_MAX_ATTEMPTS - (progress.attemptCount ?? 0)
        ),
        message: `Score: ${correctCount}/${questions.length}`,
      });
      notifyInstructorStudentProgress(challenge, socket.id, student);
      finishFivePartsIfEveryoneDone(challenge);
      return;
    }

    if (challenge.answers.has(socket.id)) return;

    const rawIndex = data.selectedIndex;
    const selectedIndex =
      Number.isInteger(rawIndex) &&
      rawIndex >= 0 &&
      rawIndex < challenge.options.length
        ? rawIndex
        : null;

    // A missing selection means the student did not submit an answer. Do not
    // add it to the answer map or report it as an incorrect response.
    if (selectedIndex === null) return;

    const correct = selectedIndex === challenge.correctIndex;
    const answeredAt = Date.now();
    const responseTimeSeconds = Math.max(
      0,
      (answeredAt - challenge.startedAt) / 1000
    );

    console.log("[Quick Challenge] Answer timing", {
      quizId: challenge.id,
      student: student.name,
      startedAt: challenge.startedAt,
      answeredAt,
      responseTimeSeconds,
    });

    challenge.answers.set(socket.id, {
      selectedIndex,
      correct,
      answeredAt,
      responseTimeSeconds,
    });
    publishQuickChallengeReview(challenge);

    socket.emit("quickChallengeResult", {
      quizId: challenge.id,
      correct,
      correctIndex: challenge.correctIndex,
      selectedIndex,
      responseTimeSeconds,
      message: correct
        ? "Correct!"
        : challenge.options.length === 2
          ? `Not quite. The correct answer is ${challenge.options[challenge.correctIndex]}.`
        : `Not quite. The correct answer is ${String.fromCharCode(
            65 + challenge.correctIndex
          )}. ${challenge.options[challenge.correctIndex]}.`,
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
      responseTimeSeconds,
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

  socket.on("quickChallengeExtraCredit", (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    const challenge = activeQuickChallenges.get(roomId);
    const student = students[socket.id];
    if (!student || socket.data.role === "instructor" || !challenge || data.quizId !== challenge.id) return;
    if (!saveExtraCreditAnswers(challenge, socket.id, data.answers)) return;
    notifyInstructorStudentProgress(challenge, socket.id, student);
  });

  socket.on("stopQuickChallenge", (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    const challenge = activeQuickChallenges.get(roomId);
    if (
      !roomId ||
      !isInstructorSocket(socket) ||
      socket.data.clientType !== "classroom" ||
      !challenge ||
      (data.quizId && data.quizId !== challenge.id)
    ) return;

    if (challenge.timeout) clearTimeout(challenge.timeout);
    publishQuickChallengeReview(challenge);
    emitQuickChallengeEnded(challenge, { stoppedByInstructor: true });
    for (const client of io.sockets.sockets.values()) {
      if (client.data.roomId !== roomId) continue;
      if (client.data.role !== "instructor") {
        const connectedStudent = students[client.id];
        if (connectedStudent) connectedStudent.mode = "Classroom Mode";
        client.emit("modeChanged", {
          mode: "Classroom Mode",
          destination: "Class",
          fromInstructor: true,
        });
        client.emit("returnAllToClassroomNow", {
          returnReason: "challenge_stopped",
        });
      }
    }
    roomActivities.clear(roomId, challenge.id);
    activeQuickChallenges.delete(roomId);
    broadcastStudentList(io);
  });

  // ========================================================
  // LESSON 2 - CHALLENGE 2 (DEVICE GRAB AND DROP)
  // ========================================================

  socket.on("instructorStartChallenge2", async (data = {}) => {
    try {
    const roomId = String(socket.data.roomId ?? "").trim();
    if (!roomId || !isInstructorSocket(socket) || socket.data.clientType !== "classroom") {
      socket.emit("error", {
        message: "Only a registered classroom instructor can start Challenge 2.",
      });
      return;
    }

    const requestedId = Number(data.activityId) || undefined;
    let activity;
    try {
      activity = await activityForSession(roomId, "drag_drop", requestedId);
    } catch {
      try {
        activity = await activityForSession(roomId, "drag_drop");
      } catch {
        activity = await activityForSession(roomId, WHILE_PARTS_ACTIVITY_KEY, requestedId);
      }
    }
    const {data:loadedQuestions,error}=await supabaseAdmin.from('challenge_questions').select('*').eq('activity_id',activity.id).order('question_order');
    if(error)throw error;
    const dbValid = Boolean(loadedQuestions?.length) && loadedQuestions.every(q =>
      q.question_type === "drag_drop" &&
      q.options?.item?.id &&
      ["input", "output", "both", "storage"].includes(q.correct_answer?.category)
    );
    const questions = dbValid
      ? loadedQuestions
      : CHALLENGE_2_ITEMS.map((item, index) => ({
          id: index + 1,
          options: {
            item: {
              id: item.id,
              name: item.name,
              model_path: item.modelPath,
              image_path: item.imagePath,
              model_rotation_y: item.modelRotationY,
              feedback: item.feedback,
            },
          },
          correct_answer: { category: item.category },
        }));
    const items = questions.map(q => ({
      id: q.options.item.id,
      name: q.options.item.name,
      modelPath: q.options.item.model_path,
      imagePath: q.options.item.image_path,
      modelRotationY: q.options.item.model_rotation_y,
      feedback: q.options.item.feedback,
      category: q.correct_answer.category,
    }));
    const previous = activeChallenge2Sessions.get(roomId);
    if (previous) endChallenge2Session(previous, "instructor_stop");
    await selectSessionActivity(roomId,activity.id);

    const durationSeconds = Math.min(
      600,
      Math.max(60, Number(data.durationSeconds) || 180)
    );
    const session: Challenge2Session = {
      activityId:activity.id,questions,
      participants:new Map(getRoomClassroomStudents(roomId).flatMap(([id])=>{
        const participant=io.sockets.sockets.get(id)?.data.participantId;
        return participant?[[id,String(participant)] as [string,string]]:[];
      })),
      id: `challenge-2-${roomId}-${Date.now()}`,
      roomId,
      durationSeconds,
      startedAt: Date.now(),
      progress: new Map(),
      timeout: null,
    };
    activeChallenge2Sessions.set(roomId, session);
    roomActivities.set(roomId, {
      event: "challenge2Started",
      payload: { id: session.id, durationSeconds, startedAt: session.startedAt, totalItems: session.questions.length, items },
      expiresAt: session.startedAt + durationSeconds * 1000,
    });

    const roomStudents = [];
    for (const [studentSocketId, student] of Object.entries(students)) {
      const studentSocket = io.sockets.sockets.get(studentSocketId);
      if (
        !studentSocket ||
        studentSocket.data.roomId !== roomId ||
        studentSocket.data.role === "instructor" ||
        studentSocket.data.clientType !== "classroom"
      ) continue;

      session.progress.set(studentSocketId, {
        completedItemIds: new Set(),
        attempts: 0,
        wrongAttempts: 0,
        wrongSelections: new Map(),
        startedAt: session.startedAt,
        completedAt: null,
      });
      student.mode = "Challenge 2";
      roomStudents.push({
        studentId: studentSocketId,
        userId: student.userId,
        name: student.name,
        seat: student.seat,
      });
      studentSocket.emit("challenge2Started", {
        items,
        id: session.id,
        durationSeconds,
        startedAt: session.startedAt,
        totalItems: session.questions.length,
      });
    }

    socket.emit("challenge2StartedForInstructor", {
      id: session.id,
      question: "Challenge 2: Predict - Devices In & Out",
      options: ["Input", "Output", "Both", "Storage"],
      durationSeconds,
      startedAt: session.startedAt,
      totalItems: session.questions.length,
      totalQuestions: session.questions.length,
      challengeType: "challenge-2",
      questionStats: getChallenge2QuestionStats(session),
      studentCount: roomStudents.length,
      students: roomStudents,
    });
    broadcastStudentList(io);

    session.timeout = null;
    } catch(error) {console.error('[Activity]',error);socket.emit('error',{message:error instanceof Error?error.message:'Could not start activity'});}

  });

  socket.on("challenge2ItemAnswer", (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    const student = students[socket.id];
    const session = activeChallenge2Sessions.get(roomId);
    if (
      !student ||
      socket.data.role === "instructor" ||
      !session ||
      data.challengeId !== session.id
    ) return;

    const itemId = String(data.itemId ?? "").trim();
    const selectedCategory = String(data.selectedCategory ?? "").trim() as Challenge2Category;
    const expectedCategory = session.questions.find(q=>q.options.item.id===itemId)?.correct_answer.category;
    const progress = session.progress.get(socket.id);
    if (!expectedCategory || !progress || progress.completedItemIds.has(itemId)) return;
    if (!["input", "output", "both", "storage"].includes(selectedCategory)) return;

    progress.attempts += 1;
    const correct = selectedCategory === expectedCategory;
    if (correct) progress.completedItemIds.add(itemId);
    else {
      progress.wrongAttempts += 1;
      let itemSelections = progress.wrongSelections.get(itemId);
      if (!itemSelections) {
        itemSelections = new Map();
        progress.wrongSelections.set(itemId, itemSelections);
      }
      itemSelections.set(
        selectedCategory,
        (itemSelections.get(selectedCategory) ?? 0) + 1
      );
    }

    const completedCount = progress.completedItemIds.size;
    const completed = completedCount === session.questions.length;
    if (completed && progress.completedAt === null) {
      progress.completedAt = Date.now();
      void saveDragDropResponses(session,true).catch(error=>console.error('[Challenge 2] Result pending:',error));
    }
    const responseTimeSeconds = Math.max(
      0,
      ((progress.completedAt ?? Date.now()) - progress.startedAt) / 1000
    );

    socket.emit("challenge2ItemResult", {
      challengeId: session.id,
      itemId,
      selectedCategory,
      expectedCategory,
      correct,
      completedCount,
      totalItems: session.questions.length,
    });

    for (const client of io.sockets.sockets.values()) {
      if (
        client.data.roomId === roomId &&
        client.data.role === "instructor" &&
        client.data.clientType === "classroom"
      ) {
        client.emit("challenge2StudentProgress", {
          challengeId: session.id,
          studentId: socket.id,
          userId: student.userId,
          name: student.name,
          seat: student.seat,
          itemId,
          selectedCategory,
          expectedCategory,
          correct,
          completed,
          completedCount,
          totalItems: session.questions.length,
          attempts: progress.attempts,
          wrongAttempts: progress.wrongAttempts,
          responseTimeSeconds,
          questionStats: getChallenge2QuestionStats(session),
        });
      }
    }
  });

  socket.on("instructorStopChallenge2", (data = {}) => {
    const roomId = String(socket.data.roomId ?? "").trim();
    const session = activeChallenge2Sessions.get(roomId);
    if (
      !roomId ||
      !isInstructorSocket(socket) ||
      socket.data.clientType !== "classroom" ||
      !session ||
      (data.challengeId && data.challengeId !== session.id)
    ) return;
    endChallenge2Session(session, "instructor_stop");
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
    .from("class_sessions")
    .select("id,instructor_id")
    .eq("id", roomId)
    .is("ended_at", null)
    .maybeSingle();

  if (activeRoomError || !activeRoom) {
    socket.emit("classroomRegistrationError", {
      message: "This classroom is no longer active.",
    });
    return;
  }

  if(databaseUser.role==='instructor' && Number(activeRoom.instructor_id)!==userId){
    socket.emit('classroomRegistrationError',{message:'This session belongs to another instructor.'});return;
  }
  if(databaseUser.role==='student'){
    const {data:participant,error}=await supabaseAdmin.from('participants').select('seat_name').eq('id',participantId).eq('session_id',roomId).eq('student_id',userId).maybeSingle();
    if(error||!participant){socket.emit('classroomRegistrationError',{message:'Join this session before entering.'});return;}
    databaseUser.seat=participant.seat_name;
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

  const assignedAvatarId = students[socket.id]?.avatarId
    ?? (previousClassroomSocketId ? students[previousClassroomSocketId]?.avatarId : undefined)
    ?? pickRandomAvatar().id;

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
    avatarId: assignedAvatarId,
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
    const quick=activeQuickChallenges.get(roomId);
    if(quick){if(quick.timeout)clearTimeout(quick.timeout);emitQuickChallengeEnded(quick,{stoppedByInstructor:true});activeQuickChallenges.delete(roomId);}
    const drag=activeChallenge2Sessions.get(roomId);if(drag)endChallenge2Session(drag,'instructor_stop');

    const { error } = await supabaseAdmin
      .from("class_sessions")
      .update({ ended_at: new Date().toISOString(), active_activity_id: null })
      .eq("id", roomId)
      .is("ended_at", null);

    if (error) {
      console.error(`[Room] Instructor could not end ${roomId}:`, error.message);
      acknowledge?.({ success: false, message: "Could not update the classroom." });
      return;
    }

    roomActivities.clear(roomId);
    // Clear every live student representation before sending clients back to
    // login. The empty student list removes avatars and seat markers on all
    // connected classroom views immediately.
    for (const [studentSocketId, student] of Object.entries(students)) {
      if (student.role !== "student") continue;

      io.emit("playerDisconnected", { id: studentSocketId });
      delete students[studentSocketId];

      const userId = Number(student.userId);
      const session = labSessions[userId];
      if (session && !session.resultSaved) {
        const progress = session.getProgress();
        try {
          await saveAppGameResult({
            userId,
            score: Number(progress.score) || 0,
            durationSeconds: Number(progress.durationSeconds) || 0,
            correctAnswers: Number(progress.correctAnswers) || 0,
            wrongAnswers: Number(progress.wrongAnswers) || 0,
            completedExercises: Number(progress.completed) || 0,
            totalExercises: Number(progress.total) || 12,
            accuracy: Number(progress.accuracy) || 0,
            status: progress.status === "completed"
              ? "completed"
              : "instructor_return",
          });
          session.resultSaved = true;
        } catch (saveError) {
          console.error("[Lab] Could not save result while ending class:", saveError);
        }
      }

      const connectedUser = connectedUsers[userId];
      if (connectedUser) {
        connectedUser.classroomSocketId = null;
        connectedUser.labSocketId = null;
        connectedUser.inLab = false;
        connectedUser.mode = "Classroom Mode";
        connectedUser.location = "classroom";
      }
    }

    broadcastStudentList(io);

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

    // Slide position is live session state; active_activity_id is persisted separately.
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

  const labSession = new LabAttemptState(
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

    if (
      !session ||
      session.resultSaved ||
      session.status !== "working"
    ) {
      session =
        new LabAttemptState(
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
      session = new LabAttemptState(
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

  socket.on('gameResponse',data=>{
    if(socket.data.role!=='student')return;
    void recordGameResponse(Number(socket.data.userId),String(data?.itemKey||'submission'),data?.answer??null,typeof data?.correct==='boolean'?data.correct:null)
      .catch(error=>{console.error('[Game response]',error);socket.emit('labResultSaveError',{message:'Game response could not be saved.'});});
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
          correctAnswers: Number(result?.correctAnswers ?? session.correctAnswers) || 0,
          wrongAnswers: Number(result?.wrongAnswers ?? session.wrongAnswers) || 0,
          completedExercises:
            Number(result?.completed ?? result?.completedCards) || 0,
          totalExercises: Number(result?.total ?? session.totalCards) || 12,
          accuracy: Number(result?.accuracy ?? session.accuracy) || 0,
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
      session.durationSeconds = Math.max(
        session.durationSeconds,
        connectedUser.durationSeconds
      );
      session.status =
        data?.reason === "student_completed"
          ? "completed"
          : "instructor_return";
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
        correctAnswers: Number(result?.correctAnswers) || 0,
        wrongAnswers: Number(result?.wrongAnswers) || 0,
        completedExercises:
          Number(result?.completed ?? result?.completedCards) || 0,
        totalExercises: Number(result?.total) || 12,
        accuracy: Number(result?.accuracy) || 0,
        status: data?.reason === "student_completed"
          ? "completed"
          : "instructor_return",
      })
        .then(() => {
          io.emit("labResultPersisted", {
            userId,
            name: connectedUser.fullName,
            seat: connectedUser.seat,
            score: Number(result?.score) || 0,
            durationSeconds: Number(result?.durationSeconds) || 0,
            correctAnswers: Number(result?.correctAnswers) || 0,
            wrongAnswers: Number(result?.wrongAnswers) || 0,
            completedExercises:
              Number(result?.completed ?? result?.completedCards) || 0,
            totalExercises: Number(result?.total) || 12,
            accuracy: Number(result?.accuracy) || 0,
            status: data?.reason === "student_completed"
              ? "completed"
              : "instructor_return",
          });
        })
        .catch(console.error);

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
      const results = activeLabRunStartedAt
        ? await getRecentAppGameResults(50, activeLabRunStartedAt)
        : [];
      console.log("[LabTrace][Server] saved results query", {
        runStartedAt: activeLabRunStartedAt,
        rows: results.map((result: any) => ({
          userId: result.userId,
          seat: result.seat,
          durationSeconds: result.durationSeconds,
          status: result.status,
          completedAt: result.completedAt,
        })),
      });
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

      const escapeCsv = (value: unknown): string => {
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

  if (!student.id) {
    console.warn(`[Server] ${student.name} has no active socket ID.`);
    return;
  }

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
  async ({ destination, assetPath, mediaType, debriefView, activityId }) => {
    try {
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

    const activityRoomId = String(socket.data.roomId ?? "").trim();
    if(destination==='Presentation'&&activityId){
      const activity=await activityForSession(activityRoomId,undefined,Number(activityId));
      if(!['video','debrief'].includes(activity.activity_type))throw Error('Invalid media activity');
      await selectSessionActivity(activityRoomId,activity.id);
    }else if(destination==='Game 1'){
      const activity=await activityForSession(activityRoomId,'variable-sorting');
      const startedAt=Date.now();await selectSessionActivity(activityRoomId,activity.id);
      for(const [id,student]of getRoomClassroomStudents(activityRoomId)){
        bindGameRun(Number(student.userId),{participantId:Number(io.sockets.sockets.get(id)?.data.participantId),activityId:activity.id,startedAt,roomId:activityRoomId});
      }
    }else if(destination!=='Presentation')await selectSessionActivity(activityRoomId,null);
    if (destination === "Presentation" && assetPath) {
      roomActivities.set(activityRoomId, {
        event: "presentationContentChanged",
        payload: { assetPath, mediaType: mediaType === "image" ? "image" : "video", debriefView: "classroom" },
        playback: { command: "pause", currentTime: 0, sentAt: Date.now() },
      });
    } else if (destination === "Game 1") {
      roomActivities.set(activityRoomId, {
        event: "gameChanged", payload: { gameId: "python-type-lab", mode: "Game Mode", destination },
      });
    } else {
      roomActivities.clear(activityRoomId);
    }

    // A debrief can be opened after the challenge monitor was closed. Replay
    // the retained review payload so every connected display uses the latest
    // completed challenge statistics instead of placeholder values.
    if (destination === "Presentation" && mediaType === "image") {
      const roomId = socket.data.roomId as string | undefined;
      const review = roomId ? lastQuickChallengeReviews.get(roomId) : undefined;
      if (review) {
        for (const client of io.sockets.sockets.values()) {
          if (client.data.roomId === roomId) client.emit("debriefReviewData", review);
        }
      }
    }

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

    /* Every student timer begins at the same instructor launch moment. */
    const gameStartedAt = new Date();
    if (isGame) {
      activeLabRunStartedAt = gameStartedAt.toISOString();
      console.log("[LabTrace][Server] new game run", {
        runStartedAt: activeLabRunStartedAt,
        gameId,
        studentCount: realStudents.length,
      });
    }

    realStudents.forEach(
      (student, index) => {
        const classroomSocketId = student.classroomSocketId;
        if (!classroomSocketId) {
          console.warn(
            `[Server] ${student.fullName} has no active classroom socket.`
          );
          return;
        }

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

          const labSession = new LabAttemptState(
            student.userId,
            student.fullName ?? student.username,
            student.seat ?? "Not selected"
          );
          labSession.joinedAt = gameStartedAt;
          labSessions[student.userId] = labSession;

          console.log(
            `[Server] 🎮 Notifying ${student.fullName} (${student.classroomSocketId}) to enter ${gameId}`
          );

          io.to(
            classroomSocketId
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
          classroomSocketId
        ).emit(
          "modeChanged",
          {
            mode,
            destination,
            assetPath: destination === "Presentation" ? assetPath : undefined,
            mediaType: destination === "Presentation" ? mediaType : undefined,
            debriefView:
              destination === "Presentation" && mediaType === "image"
                ? debriefView ?? "classroom"
                : undefined,
            fromInstructor:
              true,
          }
        );

        if (destination === "Presentation" && assetPath) {
          io.to(classroomSocketId).emit(
            "presentationContentChanged",
            {
              assetPath,
              mediaType: mediaType === "image" ? "image" : "video",
              debriefView:
                mediaType === "image"
                  ? debriefView ?? "classroom"
                  : undefined,
              sentAt: Date.now(),
            }
          );
        }
      }
    );

    broadcastStudentList(io);

    io.emit(
      "allStudentsModeChanged",
      {
        mode,
        destination,
        assetPath: destination === "Presentation" ? assetPath : undefined,
        mediaType: destination === "Presentation" ? mediaType : undefined,
        debriefView:
          destination === "Presentation" && mediaType === "image"
            ? debriefView ?? "classroom"
            : undefined,

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
    }catch(error){console.error('[Destination]',error);socket.emit('serverError',{message:'Could not open the activity. Check its database entry.'});}
  }

);

socket.on("instructorVideoPlayback", data => {
  if (!isInstructorSocket(socket)) return;
  const allowedCommands = new Set(["play", "pause", "restart"]);
  const command = allowedCommands.has(String(data?.command))
    ? String(data.command)
    : "pause";
  const currentTime = Number.isFinite(Number(data?.currentTime))
    ? Math.max(0, Number(data.currentTime))
    : 0;
  const activity = roomActivities.get(String(socket.data.roomId ?? ""));
  if (activity?.event === "presentationContentChanged" && activity.payload.mediaType === "video") {
    activity.playback = { command, currentTime, sentAt: Date.now() };
  }
  let recipientCount = 0;

  // Use the registered classroom student sockets. Some clients do not carry
  // roomId on socket.data, which previously caused valid students to be
  // silently excluded from video synchronization.
  for (const user of Object.values(connectedUsers)) {
    if (user.role !== "student" || !user.classroomSocketId) continue;
    io.to(user.classroomSocketId).emit("videoPlaybackCommand", {
      command,
      currentTime,
      sentAt: Date.now(),
    });
    recipientCount += 1;
  }

  console.log("[Server] Video playback synchronized", {
    command,
    currentTime,
    recipientCount,
  });
});

socket.on("instructorBriefingAnnotation", data => {
  if (!isInstructorSocket(socket)) return;
  const action = data?.action === "clear" ? "clear" : "segment";
  const normalizePoint = (point: any) => ({
    x: Math.min(1, Math.max(0, Number(point?.x) || 0)),
    y: Math.min(1, Math.max(0, Number(point?.y) || 0)),
  });
  const payload = action === "clear"
    ? { action }
    : {
        action,
        from: normalizePoint(data?.from),
        to: normalizePoint(data?.to),
      };
  let recipientCount = 0;

  for (const user of Object.values(connectedUsers)) {
    if (user.role !== "student" || !user.classroomSocketId) continue;
    io.to(user.classroomSocketId).emit("briefingAnnotation", payload);
    recipientCount += 1;
  }

  if (action === "clear") {
    console.log("[Server] Briefing annotations cleared", { recipientCount });
  }
});

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

        correctAnswers:
          connectedUser.correctAnswers ?? 0,

        wrongAnswers:
          connectedUser.wrongAnswers ?? 0,

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
        correctAnswers: Number(progress.correctAnswers) || 0,
        wrongAnswers: Number(progress.wrongAnswers) || 0,
        completedExercises: Number(progress.completed) || 0,
        totalExercises: Number(progress.total) || 12,
        accuracy: Number(progress.accuracy) || 0,
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

    // Classroom/emergency return must also close the active Challenge 2
    // session so students remove its panorama, device, and drop boxes.
    const challenge2RoomId = String(socket.data.roomId ?? "").trim();
    roomActivities.clear(challenge2RoomId);
    const quick=activeQuickChallenges.get(challenge2RoomId);
    if(quick){if(quick.timeout)clearTimeout(quick.timeout);emitQuickChallengeEnded(quick,{stoppedByInstructor:true});activeQuickChallenges.delete(challenge2RoomId);}
    const activeChallenge2 = activeChallenge2Sessions.get(challenge2RoomId);
    if (activeChallenge2) {
      endChallenge2Session(activeChallenge2, "instructor_stop");
    }

    let returnedCount = 0;
    const resultSavePromises: Promise<void>[] = [];

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
        const activeSession = labSessions[userId];
        const activeProgress = activeSession?.getProgress() ?? {
          completed: connectedUser.completedExercises ?? 0,
          total: 12,
          score: connectedUser.score ?? 0,
          correctAnswers: connectedUser.correctAnswers ?? 0,
          wrongAnswers: connectedUser.wrongAnswers ?? 0,
          streak: 0,
          accuracy: connectedUser.accuracy ?? 0,
          wpm: 0,
          status: "incomplete",
          returnReason: "instructor_return",
          durationSeconds: connectedUser.durationSeconds ?? 0,
        };

        /* Freeze the student's final time before changing scenes. */
        connectedUser.durationSeconds = Math.max(
          connectedUser.durationSeconds ?? 0,
          Number(activeProgress.durationSeconds) || 0
        );
        if (activeSession) {
          activeSession.durationSeconds = connectedUser.durationSeconds;
          activeSession.status =
            activeProgress.status === "completed"
              ? "completed"
              : "instructor_return";
          activeSession.returnReason =
            activeSession.status === "completed"
              ? "student_completed"
              : "instructor_return";
        }
        if (classroomStudent) {
          classroomStudent.durationSeconds = connectedUser.durationSeconds;
        }

        if (wasInLab && !activeSession?.resultSaved) {
          const finalStatus =
            activeProgress.status === "completed"
              ? "completed"
              : "instructor_return";

          console.log("[LabTrace][Server] Stop Game snapshot", {
            runStartedAt: activeLabRunStartedAt,
            userId,
            name: connectedUser.fullName,
            seat: connectedUser.seat,
            connectedDuration: connectedUser.durationSeconds,
            progressDuration: activeProgress.durationSeconds,
            completed: activeProgress.completed,
            status: finalStatus,
          });

          const resultSavePromise = saveAppGameResult({
            userId,
            score: activeProgress.score,
            durationSeconds: activeProgress.durationSeconds ?? 0,
            correctAnswers: Number(activeProgress.correctAnswers) || 0,
            wrongAnswers: Number(activeProgress.wrongAnswers) || 0,
            completedExercises: Number(activeProgress.completed) || 0,
            totalExercises: Number(activeProgress.total) || 12,
            accuracy: Number(activeProgress.accuracy) || 0,
            status: finalStatus,
          })
            .then(() => {
              console.log("[LabTrace][Server] result persisted", {
                runStartedAt: activeLabRunStartedAt,
                userId,
                seat: connectedUser.seat,
                durationSeconds: activeProgress.durationSeconds,
                status: finalStatus,
              });
              io.emit("labResultPersisted", {
                userId,
                name: connectedUser.fullName,
                seat: connectedUser.seat,
                score: Number(activeProgress.score) || 0,
                durationSeconds:
                  Number(activeProgress.durationSeconds) || 0,
                correctAnswers:
                  Number(activeProgress.correctAnswers) || 0,
                wrongAnswers:
                  Number(activeProgress.wrongAnswers) || 0,
                completedExercises:
                  Number(activeProgress.completed) || 0,
                totalExercises: Number(activeProgress.total) || 12,
                accuracy: Number(activeProgress.accuracy) || 0,
                status: finalStatus,
              });
            })
            .catch(console.error);
          resultSavePromises.push(resultSavePromise);

          if (activeSession) {
            activeSession.resultSaved = true;
            activeSession.returnReason =
              finalStatus === "completed"
                ? "student_completed"
                : "instructor_return";
          }
        }

        if (
          wasInLab &&
          connectedUser.classroomSocketId
        ) {
          const session = activeSession;
          const progress = activeProgress;

          const finalStatus =
            progress.status === "completed"
              ? "completed"
              : "instructor_return";

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

    void Promise.allSettled(resultSavePromises).then(() => {
      broadcastStudentList(io);

      io.emit(
        "allStudentsReturnedToClass",
        {
          count: returnedCount,
          message: "All students returned to Class mode",
        }
      );

      console.log(
        `[Server] All ${returnedCount} students returned to Class mode and results persisted`
      );
    });
  }
);

  // ========================================================
  // STUDENT MODE CHANGE
  // ========================================================

  socket.on("modeChanged", (mode) => {
    const student = students[socket.id];
    if (!student) return;
    if (!isInstructorSocket(socket)) {
      console.warn(
        `[Server] Ignored student-initiated mode change from ${student.name}: ${String(mode)}`
      );
      return;
    }
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

  // AVATAR MOVEMENT: receive a student pose and relay it to classroom peers.
  // No database write: these are short-lived snapshots, not saved animations.
  let lastAvatarPoseAt = 0;
  socket.on("seatAvatarPose", (data: unknown) => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role !== "student" || socket.data.clientType !== "classroom" || !students[socket.id]) return;
    const now = Date.now();
    // Limit incoming traffic; the normal client sends a pose about every 67 ms.
    if (now - lastAvatarPoseAt < 40) return;
    const pose = data === null ? null : sanitizeSeatAvatarPose(data);
    if (data !== null && !pose) return;
    lastAvatarPoseAt = now;
    // Never trust a studentId from a tracking packet; relay only to this room.
    for (const client of io.sockets.sockets.values()) {
      if (client.id !== socket.id && client.data.roomId === roomId && client.data.clientType === "classroom") {
        // Exclude the sender: their first-person arms already update locally each frame.
        client.emit("seatAvatarPose", { studentId: socket.id, pose });
      }
    }
  });

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

  socket.on("disconnect", async () => {
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

  const disconnectedLabSession = labSessions[permanentUserId];
  const disconnectedWhileInLab =
    connectedUser.inLab === true ||
    connectedUser.location === "python_lab" ||
    disconnectedLabSession?.status === "working";

  if (disconnectedWhileInLab && !disconnectedLabSession?.resultSaved) {
    const progress = disconnectedLabSession?.getProgress();
    try {
      await saveAppGameResult({
        userId: permanentUserId,
        score: Number(progress?.score ?? connectedUser.score) || 0,
        durationSeconds:
          Number(progress?.durationSeconds ?? connectedUser.durationSeconds) || 0,
        correctAnswers: Number(progress?.correctAnswers ?? connectedUser.correctAnswers) || 0,
        wrongAnswers: Number(progress?.wrongAnswers ?? connectedUser.wrongAnswers) || 0,
        completedExercises: Number(progress?.completed ?? connectedUser.completedExercises) || 0,
        totalExercises: Number(progress?.total) || 12,
        accuracy: Number(progress?.accuracy ?? connectedUser.accuracy) || 0,
        status: "disconnected",
      });
      if (disconnectedLabSession) {
        disconnectedLabSession.durationSeconds = Math.max(
          disconnectedLabSession.durationSeconds,
          Number(progress?.durationSeconds) || 0
        );
        disconnectedLabSession.resultSaved = true;
        disconnectedLabSession.status = "disconnected";
        disconnectedLabSession.returnReason = "disconnected";
      }
      connectedUser.labStatus = "disconnected";
      io.emit("studentReturnedFromLab", {
        userId: permanentUserId,
        studentName: connectedUser.fullName,
        returnReason: "disconnected",
        labData: progress,
      });
    } catch (error) {
      console.error("[Lab] Could not persist disconnected result:", error);
    }
  }

  if (
    socket.data.clientType === "classroom" &&
    connectedUser.classroomSocketId === socket.id
  ) {
    connectedUser
      .classroomSocketId =
      null;
  }

  if (
    socket.data.clientType === "lab" &&
    connectedUser.labSocketId === socket.id
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

    if (labStudentId) {
      const session = labSessions[labStudentId];
      session.socketId = null;
      console.log(`[Server] Lab client disconnected: ${session.studentName}`);
    }

    // A closed classroom session must release the avatar and seat marker even
    // when the student disconnected while a lab was active. The final lab
    // result was persisted above before this live representation is removed.
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

/** Opt-in live round trip. Copies curriculum into its own course; cleans up only those fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import { loadDatabaseChallengeQuestions } from '../build/server/repositories/challenge-content.repository.js';
import { loadSavedChallengeMistakes } from '../build/server/repositories/debrief-mistakes.repository.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false }, realtime: { transport: WebSocket } });
const tag = `curriculum-test-${Date.now()}`;
const accessCode = String(randomInt(100000, 1000000));
const value = async query => { const { data, error } = await query; if (error) throw Error(error.message); return data; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn) { for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await pause(150); } throw Error('Timed out waiting for saved result'); }
function event(socket, name) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(`Timed out: ${name}`)), 15000); socket.once(name, data => { clearTimeout(timer); resolve(data); }); }); }
const freePort = createServer();
await new Promise(resolve => freePort.listen(0, '127.0.0.1', resolve));
const port = freePort.address().port;
await new Promise(resolve => freePort.close(resolve));
const base = `http://127.0.0.1:${port}`;
const sockets = [], userIds = [], weekIds = [], dayIds = [], activityIds = [], sessionIds = [], groups = [];
let course, server, log = '';
async function post(path, body) { const response = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data; }
async function connect(user, session, participant) {
  const socket = io(base, { transports: ['websocket'], autoConnect: false }); sockets.push(socket);
  const ready = event(socket, 'connect'); socket.connect(); await ready;
  const registered = event(socket, 'classroomClientRegistered');
  socket.emit('registerClassroomClient', { userId: user.id, username: user.username, roomId: session.room_id, participantId: participant?.participant_id });
  await registered; return socket;
}
const typeFor = { code_pattern: 'CodePattern', loop_sort: 'LoopSort', flowchart_shape: 'FlowchartShape', while_trace: 'WhileTrace', while_parts: 'WhileParts', while_factorial: 'WhileFactorial', string_ok_error: 'StringOkError', string_in: 'StringIn', string_clean: 'StringClean' };
try {
  course = await value(db.from('courses').insert({ course_code: tag, title: 'Temporary curriculum verification', access_code: accessCode }).select().single());
  for (const [sourceCode, weekNumber, dayNumbers] of [['CSDP-99', 1, [1, 2]], ['CSDP-120', 13, [2]]]) {
    const sourceCourse = await value(db.from('courses').select('id').eq('course_code', sourceCode).single());
    const sourceWeek = await value(db.from('weeks').select('id').eq('course_id', sourceCourse.id).eq('week_number', weekNumber).single());
    const week = await value(db.from('weeks').insert({ course_id: course.id, week_number: weekNumber, title: 'Test week' }).select().single()); weekIds.push(week.id);
    for (const dayNumber of dayNumbers) {
      const sourceDay = await value(db.from('days').select('id').eq('week_id', sourceWeek.id).eq('day_number', dayNumber).single());
      const day = await value(db.from('days').insert({ week_id: week.id, day_number: dayNumber, title: 'Test day' }).select().single()); dayIds.push(day.id);
      const sourceActivities = await value(db.from('activities').select('*').eq('day_id', sourceDay.id).eq('activity_type', 'challenge').neq('activity_key', 'drag_drop').order('activity_order'));
      assert.equal(sourceActivities.length, sourceCode === 'CSDP-99' && dayNumber === 2 ? 2 : 3);
      const activities = [];
      for (const [index, source] of sourceActivities.entries()) {
        const activity = await value(db.from('activities').insert({ week_id: week.id, day_id: day.id, activity_key: source.activity_key, activity_type: 'challenge', title: `Database title ${source.activity_key}`, activity_order: index + 1 }).select().single()); activityIds.push(activity.id);
        const sourceQuestions = (await value(db.from('challenge_questions').select('*').eq('activity_id', source.id).order('question_order'))).filter(question => !question.options?.extra_credit && !question.options?.archived);
        const loaded = await loadDatabaseChallengeQuestions(source, true);
        for (const question of sourceQuestions) {
          if (!question.options?.presentation) {
            const panel = loaded.find(item => item.id === String(question.id));
            question.options = { choices: Array.isArray(question.options) ? question.options : question.options.choices, presentation: panel.presentation };
          }
        }
        const rows = sourceQuestions.map(({ id, activity_id, ...question }) => ({ ...question, activity_id: activity.id }));
        // Make fixture data differ from the branch catalog to prove that the runtime uses Supabase.
        rows[0].options.presentation.prompt = `Database prompt ${tag}`;
        rows[0].options.presentation.instructorLabel = 'Database monitor label';
        rows[0].options.presentation.codeLines = ['database_owned = 42'];
        rows[0].options.choices[0] = 'Database-only option';
        rows[0].correct_answer = { choice_index: 0 };
        const questions = await value(db.from('challenge_questions').insert(rows).select());
        questions.sort((a, b) => a.question_order - b.question_order);
        activities.push({ ...activity, questions });
      }
      groups.push({ week, day, activities });
    }
  }
  server = spawn(process.execPath, ['server/start-production.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => log += data); server.stderr.on('data', data => log += data);
  await poll(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
  const teacherUser = (await post('device-login', { deviceId: `${tag}-teacher`, displayName: 'Curriculum Test Instructor', role: 'instructor' })).user; userIds.push(teacherUser.id);
  const studentUser = (await post('device-login', { deviceId: `${tag}-student`, displayName: 'Curriculum Test Student', role: 'student' })).user; userIds.push(studentUser.id);
  let checkedChallenges = 0, checkedResponses = 0;
  for (const group of groups) {
    const session = await post('class-sessions', { instructorId: teacherUser.id, accessCode, weekId: group.week.id, dayId: group.day.id }); sessionIds.push(session.room_id);
    const join = await post('class-sessions/join', { deviceId: `${tag}-student` });
    const teacher = await connect(teacherUser, session), pupil = await connect(studentUser, session, join);
    const before = await value(db.from('challenge_questions').select('*').in('activity_id', group.activities.map(a => a.id)).order('id'));
    const content = await (await fetch(base + '/api/instructor-content?sessionId=' + session.room_id)).json();
    assert.equal(content.activities.length, group.activities.length);
    assert.deepEqual(await value(db.from('challenge_questions').select('*').in('activity_id', group.activities.map(a => a.id)).order('id')), before, 'Reading the dashboard must never rewrite questions');
    for (const activity of group.activities) {
      const studentStarted = event(pupil, 'quickChallengeStarted'), teacherStarted = event(teacher, 'quickChallengeStartedForInstructor');
      teacher.emit('instructorQuickChallenge', { activityId: activity.id, challengeType: typeFor[activity.activity_key], durationSeconds: 60 });
      const launch = await studentStarted, monitor = await teacherStarted;
      assert.equal(launch.title, activity.title);
      assert.equal(launch.questions.length, activity.questions.length);
      assert.equal(launch.questions[0].question, `Database prompt ${tag}`);
      assert.equal(launch.questions[0].options[0], 'Database-only option');
      assert.deepEqual(launch.questions[0].presentation.codeLines, ['database_owned = 42']);
      assert.equal(monitor.questionStats[0].prompt, 'Database monitor label');
      for (const question of launch.questions) { assert.equal(question.correctIndex, undefined); assert.equal(question.correctIndices, undefined); assert.equal(question.correct_answer, undefined); }
      // A resumed student receives the same database code panels.
      if (activity === group.activities[0]) {
        const replay = event(pupil, 'quickChallengeStarted'); pupil.emit('classroomSceneReady'); assert.deepEqual((await replay).questions, launch.questions);
      }
      const answers = activity.questions.map(q => q.correct_answer.choice_indices ? q.correct_answer.choice_indices.reduce((mask, index) => mask | (1 << index), 0) : q.correct_answer.choice_index);
      const update = event(teacher, 'quickChallengeStudentAnswered'); pupil.emit('quickChallengeDraft', { quizId: launch.id, answers });
      const live = await update; assert.equal(live.completed, false); assert.equal(live.questionStats[0].correctCount, 1);
      assert.equal((await value(db.from('challenge_results').select('id').eq('activity_id', activity.id))).length, 0);
      let result = event(pupil, 'quickChallengeResult'); pupil.emit('quickChallengeAnswer', { quizId: launch.id, answers, correctCount: 999 });
      assert.equal((await result).correctCount, answers.length);
      const saved = await poll(async () => { const rows = await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id', activity.id).eq('participant_id', join.participant_id)); return rows.find(row => row.status === 'completed'); });
      assert.equal(Number(saved.score), answers.length); assert.equal(saved.attempt_number, 1);
      assert.equal(saved.challenge_responses.length, answers.length);
      for (const response of saved.challenge_responses) {
        assert.equal(response.is_correct, true);
        const question = activity.questions.find(q => q.id === response.question_id); assert.ok(question);
        if (question.correct_answer.choice_indices) assert.deepEqual(response.student_answer.choice_indices, question.correct_answer.choice_indices);
        else { assert.equal(response.student_answer.choice_index, question.correct_answer.choice_index); assert.equal(response.student_answer.value, question.options.choices[question.correct_answer.choice_index]); }
      }
      checkedResponses += saved.challenge_responses.length;
      const mistakes = await loadSavedChallengeMistakes(Number(session.room_id), activity);
      assert.equal(mistakes.studentCount, 1);
      assert.equal(mistakes.questions.length, answers.length);
      assert.ok(mistakes.questions.every(question => question.answers.length === 0));
      // A repeated submission must not create a second attempt.
      pupil.emit('quickChallengeAnswer', { quizId: launch.id, answers });
      if (checkedChallenges === 0) {
        for (let attempt = 2; attempt <= 3; attempt++) {
          const retry = await new Promise(resolve => pupil.emit('quickChallengeRetry', { quizId: launch.id }, resolve)); assert.equal(retry.success, true);
          const wrong = [...answers]; wrong[0] = 1;
          result = event(pupil, 'quickChallengeResult'); pupil.emit('quickChallengeAnswer', { quizId: launch.id, attemptStartedAt: retry.attemptStartedAt, answers: wrong });
          assert.equal((await result).correctCount, answers.length - 1);
          await poll(async () => { const rows = await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id', activity.id)); const row = rows.find(r => r.attempt_number === attempt && r.status === 'completed'); if (!row) return false; assert.equal(Number(row.score), answers.length - 1); assert.equal(row.challenge_responses.find(r => r.question_id === activity.questions[0].id).is_correct, false); return true; });
        }
        assert.equal((await new Promise(resolve => pupil.emit('quickChallengeRetry', { quizId: launch.id }, resolve))).success, false);
        const retryMistakes = await loadSavedChallengeMistakes(Number(session.room_id), activity);
        assert.equal(retryMistakes.questions[0].answers[0].studentCount, 1, 'Retries must not count the same student twice');
      }
      let partialRetry;
      if (activity.activity_key === 'string_clean') {
        partialRetry = await new Promise(resolve => pupil.emit('quickChallengeRetry', { quizId: launch.id }, resolve)); assert.equal(partialRetry.success, true);
        const drafted = event(teacher, 'quickChallengeStudentAnswered');
        pupil.emit('quickChallengeDraft', { quizId: launch.id, attemptStartedAt: partialRetry.attemptStartedAt, answers: [0, ...answers.slice(1).map(() => null)] }); await drafted;
      }
      const stopped = event(pupil, 'quickChallengeEnded'); teacher.emit('stopQuickChallenge', { quizId: launch.id }); await stopped;
      if (partialRetry) {
        await poll(async () => { const rows = await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id', activity.id)); const partial = rows.find(r => r.attempt_number === 2 && r.status === 'stopped'); if (!partial) return false; assert.equal(partial.challenge_responses.filter(r => r.student_answer !== null).length, 1); assert.equal(partial.challenge_responses.filter(r => r.is_correct === null).length, answers.length - 1); return true; });
        console.log('PASS instructor stop preserves partial responses and previous completed attempt');
      }
      checkedChallenges++;
      console.log(`PASS ${activity.activity_key}: database UI content, monitor, grading and ${answers.length} saved responses`);
    }
    const lastActivity = group.activities.at(-1);
    const debrief = await value(db.from('activities').insert({ week_id: group.week.id, day_id: group.day.id,
      activity_type: 'debrief', activity_key: `debrief-${tag}`, title: 'Test debrief', activity_order: 4,
      file_path: 'supabase://course-media/csdp-99/week1/day-1/debriefs/03-match-flowchart-shapes.png' }).select().single());
    activityIds.push(debrief.id);
    const teacherReview = event(teacher, 'debriefMistakesData'), studentReview = event(pupil, 'debriefMistakesData');
    teacher.emit('instructorSendAllToDestination', { destination: 'Presentation', mediaType: 'image', activityId: debrief.id, assetPath: '/test-debrief.png' });
    const displayed = await teacherReview;
    assert.equal(displayed.activityId, lastActivity.id);
    assert.deepEqual(await studentReview, displayed, 'Both sides receive the same session-scoped saved mistake list');
    pupil.disconnect();
    const reconnected = await connect(studentUser, session, join);
    const resumedReview = event(reconnected, 'debriefMistakesData'); reconnected.emit('classroomSceneReady');
    assert.deepEqual(await resumedReview, displayed, 'A reconnected student receives the selected debrief statistics');
    console.log('PASS selected debrief loads preceding challenge mistakes for both sides and reconnect');
    await new Promise((resolve, reject) => teacher.emit('endClass', {}, reply => reply.success ? resolve() : reject(Error(reply.message))));
    teacher.disconnect(); pupil.disconnect();
  }
  assert.equal(checkedChallenges, 8); assert.equal(checkedResponses, 43);
  console.log('PASS all 8 question challenges / 43 main responses, exact multi-select, wrong answers, three attempts, duplicate submissions and read-only dashboard');
} catch (error) { console.error(log.slice(-5000)); throw error; }
finally {
  for (const socket of sockets) socket.disconnect();
  if (server) { server.kill(); await pause(500); }
  if (activityIds.length) {
    const results = await value(db.from('challenge_results').select('id').in('activity_id', activityIds));
    if (results.length) { await value(db.from('challenge_responses').delete().in('challenge_result_id', results.map(r => r.id))); await value(db.from('challenge_results').delete().in('id', results.map(r => r.id))); }
  }
  if (sessionIds.length) { await value(db.from('participants').delete().in('session_id', sessionIds)); await value(db.from('class_sessions').delete().in('id', sessionIds)); }
  if (activityIds.length) { await value(db.from('challenge_questions').delete().in('activity_id', activityIds)); await value(db.from('activities').delete().in('id', activityIds)); }
  if (dayIds.length) await value(db.from('days').delete().in('id', dayIds));
  if (weekIds.length) await value(db.from('weeks').delete().in('id', weekIds));
  if (userIds.length) await value(db.from('users').delete().in('id', userIds));
  if (course) await value(db.from('courses').delete().eq('id', course.id));
  console.log('Removed temporary test course, users, sessions and results.');
}

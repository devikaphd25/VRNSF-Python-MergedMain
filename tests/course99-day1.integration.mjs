/** Opt-in: actual dashboard click handlers -> Supabase -> both UI start handlers -> saved answers. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';
import vm from 'node:vm';
import ts from 'typescript';
import { io } from 'socket.io-client';
import * as types from '../shared/challenge-types.ts';
import { ActivitySequence } from '../src/instructor/activity-sequence.ts';
import { supabaseAdmin as db } from '../server/database/supabase-client.ts';
import { loadDatabaseChallengeQuestions } from '../server/repositories/challenge-content.repository.ts';

const value = async q => { const { data, error } = await q; if (error) throw Error(error.message); return data; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const tag = `day1-ui-test-${Date.now()}`, accessCode = String(randomInt(100000, 1000000));
const files = [], activityIds = [], users = [], sockets = [];
let course, week, day, session, server, log = '';
const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
async function poll(fn) { for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await pause(200); } throw Error('Timed out waiting for the test server/database'); }
function event(socket, name) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Timed out: ' + name)), 30000); socket.once(name, data => { clearTimeout(timer); resolve(data); }); }); }
async function post(path, body) { const response = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data; }
async function connect(user, participant) {
  const socket = io(base, { transports: ['websocket'], autoConnect: false }); sockets.push(socket);
  const ready = event(socket, 'connect'); socket.connect(); await ready;
  const registered = event(socket, 'classroomClientRegistered');
  socket.emit('registerClassroomClient', { userId: user.id, username: user.username, roomId: session.room_id, participantId: participant?.participant_id }); await registered;
  return socket;
}
function parsed(path) { return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true); }
function methods(source, names) { return source.statements.find(ts.isClassDeclaration).members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n'); }
function uiHarness(teacher) {
  const dashboard = parsed('src/systems/instructor-dashboard.system.ts');
  let instructorStart;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(dashboard) === 'socket.on' && node.arguments[0]?.text === 'quickChallengeStartedForInstructor') instructorStart = node.arguments[1].getText(dashboard);
    ts.forEachChild(node, visit);
  }
  visit(dashboard);
  const context = vm.createContext({ ...types, socket: teacher, console, window: { clearTimeout() {} } });
  const compile = code => vm.runInContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), context);
  compile(`class Dashboard { ${methods(dashboard, ['getTaskQueue', 'activateQueueSlot', 'activateCodePatternChallenge', 'activateLoopSortChallenge', 'activateFlowchartShapeChallenge'])} }; globalThis.Dashboard=Dashboard;`);
  const instructor = new context.Dashboard();
  Object.assign(instructor, { taskView: 'current', taskLaunchPending: false, currentActivity: new ActivitySequence(), completedTaskKeys: new Set(),
    loadInstructorMenuContent: async () => { const response = await fetch(base + '/api/instructor-content?sessionId=' + session.room_id); assert.equal(response.status, 200); instructor.databaseActivities = (await response.json()).activities; },
    setCurrentMode() {}, setLatestResultType() {}, showStatusMessage() {}, setDashboardVisible() {}, setLabMonitorVisible() {}, setLabMonitorAvailable() {}, renderLessonPage() {},
    startQuizCountdown() {}, renderQuizMonitor() {}, setQuizMonitorVisible: visible => instructor.monitorVisible = visible,
  });
  const onInstructorStart = compile(`(function(data) { return (${instructorStart})(data); })`);
  teacher.on('quickChallengeStartedForInstructor', data => {
    try { onInstructorStart.call(instructor, data); } catch (error) { instructor.uiError = error; }
  });
  const studentSource = parsed('src/systems/curriculum-challenge.system.ts');
  compile(`class Student { ${methods(studentSource, ['startChallenge'])} }; globalThis.Student=Student;`);
  const student = new context.Student();
  Object.assign(student, { layoutStudentShell() {}, paintLeftPanel() {}, renderCurrentView() {}, setVisible: visible => student.visible = visible, startTimer() {}, sync() {} });
  return { instructor, student };
}

try {
  const sourceActivities = await value(db.from('activities').select('*').eq('week_id', 8).eq('day_id', 2).order('activity_order'));
  assert.equal(sourceActivities[3].activity_key, 'code_pattern'); assert.equal(sourceActivities[3].title, 'Find the Repeating Pattern');
  course = await value(db.from('courses').insert({ course_code: tag, title: 'Temporary Day 1 launch test', access_code: accessCode }).select().single());
  week = await value(db.from('weeks').insert({ course_id: course.id, week_number: 1, title: 'Week 1' }).select().single());
  day = await value(db.from('days').insert({ week_id: week.id, day_number: 1, title: 'Day 1' }).select().single());
  const challenges = [];
  for (const source of sourceActivities) {
    const activity = await value(db.from('activities').insert({ week_id: week.id, day_id: day.id, title: source.title, activity_type: source.activity_type, activity_key: source.activity_key, activity_order: source.activity_order, file_path: source.activity_type === 'challenge' ? null : source.file_path }).select().single()); activityIds.push(activity.id);
    if (source.activity_type !== 'challenge') continue;
    const loaded = await loadDatabaseChallengeQuestions(source, true);
    const questions = await value(db.from('challenge_questions').insert(loaded.map((q, index) => ({ activity_id: activity.id, question_order: index + 1, question_type: 'multiple_choice', question_text: q.prompt, options: q.options, correct_answer: q.correctIndices ? { choice_indices: q.correctIndices } : { choice_index: q.correctIndex } }))).select());
    questions.sort((a, b) => a.question_order - b.question_order);
    const panels = { version: 1, activityId: activity.id, questions: questions.map((q, index) => ({ questionId: q.id, presentation: loaded[index].presentation })) };
    const path = `integration-tests/${tag}/${activity.activity_key}.json`; files.push(path);
    await value(db.storage.from('course-media').upload(path, Buffer.from(JSON.stringify(panels)), { contentType: 'application/json' }));
    await value(db.from('activities').update({ file_path: `supabase://course-media/${path}` }).eq('id', activity.id));
    // Simulate the repeated overwrite: answer options remain plain arrays, with no embedded presentation.
    assert.ok(questions.every(q => Array.isArray(q.options)));
    challenges.push({ ...activity, questions, loaded });
  }
  server = spawn(process.execPath, ['server/start-production.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => log += data); server.stderr.on('data', data => log += data);
  await poll(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
  const teacherUser = (await post('device-login', { deviceId: tag + '-teacher', displayName: 'Day 1 Test Instructor', role: 'instructor' })).user; users.push(teacherUser.id);
  const pupilUser = (await post('device-login', { deviceId: tag + '-student', displayName: 'Day 1 Test Student', role: 'student' })).user; users.push(pupilUser.id);
  session = await post('class-sessions', { instructorId: teacherUser.id, accessCode, weekId: week.id, dayId: day.id });
  const join = await post('class-sessions/join', { deviceId: tag + '-student' });
  const teacher = await connect(teacherUser), pupil = await connect(pupilUser, join);
  const { instructor, student } = uiHarness(teacher);
  pupil.on('quickChallengeStarted', data => { try { student.startChallenge(data); } catch (error) { student.uiError = error; } });
  await instructor.loadInstructorMenuContent();
  let total = 0;
  for (const activity of challenges) {
    instructor.currentActivity.index = activity.activity_order - 1; instructor.monitorVisible = false; student.visible = false;
    const instructorStarted = event(teacher, 'quickChallengeStartedForInstructor'), studentStarted = event(pupil, 'quickChallengeStarted');
    await instructor.activateQueueSlot(0);
    const launch = await studentStarted, monitor = await instructorStarted;
    if (instructor.uiError) throw instructor.uiError;
    if (student.uiError) throw student.uiError;
    assert.equal(instructor.selectedActivityId, activity.id);
    assert.equal(instructor.monitorVisible, true, 'The production instructor start handler opens the monitor');
    assert.equal(student.visible, true, 'The production student start handler opens the question panel');
    assert.equal(launch.title, activity.title); assert.equal(monitor.totalQuestions, activity.questions.length);
    assert.equal(student.questions.length, activity.questions.length);
    assert.deepEqual(JSON.parse(JSON.stringify(student.questions[0].presentation)), activity.loaded[0].presentation);
    const answers = activity.questions.map(q => q.correct_answer.choice_indices ? q.correct_answer.choice_indices.reduce((mask, index) => mask | (1 << index), 0) : q.correct_answer.choice_index);
    const result = event(pupil, 'quickChallengeResult'); pupil.emit('quickChallengeAnswer', { quizId: launch.id, answers });
    assert.equal((await result).correctCount, answers.length);
    const saved = await poll(async () => { const rows = await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id', activity.id)); return rows.find(row => row.status === 'completed'); });
    assert.equal(Number(saved.score), answers.length); assert.equal(saved.challenge_responses.length, answers.length);
    assert.ok(saved.challenge_responses.every(answer => answer.is_correct)); total += answers.length;
    const stopped = event(pupil, 'quickChallengeEnded'); teacher.emit('stopQuickChallenge', { quizId: launch.id }); await stopped;
    console.log(`PASS order ${activity.activity_order}, ${activity.title}: actual dashboard click opens both UI handlers; ${answers.length} answers saved.`);
  }
  assert.equal(total, 15);
  await new Promise((resolve, reject) => teacher.emit('endClass', {}, data => data.success ? resolve() : reject(Error(data.message))));
  console.log('PASS all three Day 1 challenges, protected Supabase code panels, and 15 saved responses.');
} catch (error) { console.error(log.slice(-5000)); throw error; }
finally {
  for (const socket of sockets) socket.disconnect();
  if (server) { server.kill(); await pause(500); }
  if (activityIds.length) {
    const results = await value(db.from('challenge_results').select('id').in('activity_id', activityIds));
    if (results.length) { await value(db.from('challenge_responses').delete().in('challenge_result_id', results.map(r => r.id))); await value(db.from('challenge_results').delete().in('id', results.map(r => r.id))); }
  }
  if (session) { await value(db.from('participants').delete().eq('session_id', session.room_id)); await value(db.from('class_sessions').delete().eq('id', session.room_id)); }
  if (activityIds.length) { await value(db.from('challenge_questions').delete().in('activity_id', activityIds)); await value(db.from('activities').delete().in('id', activityIds)); }
  if (day) await value(db.from('days').delete().eq('id', day.id));
  if (week) await value(db.from('weeks').delete().eq('id', week.id));
  if (users.length) await value(db.from('users').delete().in('id', users));
  if (course) await value(db.from('courses').delete().eq('id', course.id));
  if (files.length) await value(db.storage.from('course-media').remove(files));
  console.log('Removed only temporary Day 1 test records and panel files.');
}

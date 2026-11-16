/** Opt-in test: six concurrent students fill five first-row seats before row two. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });
const value = async query => { const { data, error } = await query; if (error) throw Error(error.message); return data; };
const tag = `seating-test-${Date.now()}`, userIds = [], accessCode = String(randomInt(100000, 1000000));
const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let course, week, day, session, server, log = '';
async function post(path, body) { const response = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data; }
try {
  course = await value(db.from('courses').insert({ course_code: tag, title: 'Temporary seat test', access_code: accessCode }).select().single());
  week = await value(db.from('weeks').insert({ course_id: course.id, week_number: 1, title: 'Test week' }).select().single());
  day = await value(db.from('days').insert({ week_id: week.id, day_number: 1, title: 'Test day' }).select().single());
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => log += data); server.stderr.on('data', data => log += data);
  let ready = false;
  for (let i = 0; i < 80; i++) { try { ready = (await fetch(base + '/api/health')).ok; } catch {} if (ready) break; await pause(200); }
  assert.ok(ready, 'Test server must start');
  const teacher = (await post('device-login', { deviceId: tag + '-teacher', displayName: 'Seating Test Instructor', role: 'instructor' })).user; userIds.push(teacher.id);
  session = await post('class-sessions', { instructorId: teacher.id, accessCode, weekId: week.id, dayId: day.id });
  const devices = Array.from({ length: 6 }, (_, i) => `${tag}-student-${i + 1}`);
  for (const [index, deviceId] of devices.entries()) { const student = (await post('device-login', { deviceId, displayName: `Seating Test ${index + 1}`, role: 'student' })).user; userIds.push(student.id); }
  const joins = await Promise.all(devices.map(deviceId => post('class-sessions/join', { deviceId })));
  const expected = ['Seat_R1_01', 'Seat_R1_02', 'Seat_R1_03', 'Seat_R1_04', 'Seat_R1_05', 'Seat_R2_01'];
  assert.deepEqual(joins.map(join => join.seat).sort(), expected);
  assert.equal(joins.filter(join => join.seat.startsWith('Seat_R1_')).length, 5);
  const rejoined = await Promise.all(devices.map(deviceId => post('class-sessions/join', { deviceId })));
  for (const [index, join] of rejoined.entries()) { assert.equal(join.seat, joins[index].seat); assert.equal(join.participant_id, joins[index].participant_id); }
  const rows = await value(db.from('participants').select('seat_name').eq('session_id', session.room_id));
  assert.equal(rows.length, 6); assert.deepEqual(rows.map(row => row.seat_name).sort(), expected);
  console.log('PASS six concurrent joins: all five row-1 seats occupied before row 2; no duplicate seats; reconnect preserves assignments.');
} catch (error) { console.error(log.slice(-3000)); throw error; }
finally {
  if (server) { server.kill(); await pause(300); }
  if (session) { await value(db.from('participants').delete().eq('session_id', session.room_id)); await value(db.from('class_sessions').delete().eq('id', session.room_id)); }
  if (day) await value(db.from('days').delete().eq('id', day.id));
  if (week) await value(db.from('weeks').delete().eq('id', week.id));
  if (userIds.length) await value(db.from('users').delete().in('id', userIds));
  if (course) await value(db.from('courses').delete().eq('id', course.id));
  console.log('Removed only temporary seating test records.');
}

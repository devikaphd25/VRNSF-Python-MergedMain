import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// No network requests: every database call below uses a per-test fake query.
process.env.SUPABASE_URL ||= 'https://course-test.invalid';
process.env.SUPABASE_SECRET_KEY ||= 'test-only';
const { supabaseAdmin: db } = await import('../server/database/supabase-client.js');
const { courseByAccessCode, selectedWeek, instructorContent, courseOutline, selectedCourseDay, activityForSession } = await import('../server/repositories/course-content.repository.js');
const { createSession, joinSession } = await import('../server/services/classroom-sessions.service.js');
const { initializeAppDataRepository } = await import('../server/repositories/users.repository.js');

type Rows = Record<string, Array<Record<string, any>>>;
function database(rows: Rows) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  mock.method(db, 'from', (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let operation = 'select'; let payload: any;
    const call = { table, filters }; calls.push(call);
    const query: any = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      is(key: string, value: unknown) { return query.eq(key, value); },
      in(key: string, values: unknown[]) { filters.push([key, values]); return query; },
      order() { return query; }, limit() { return query; },
      update(value: any) { operation = 'update'; payload = value; return query; },
      insert(value: any) { operation = 'insert'; payload = value; return query; },
      single() { return run(true); }, maybeSingle() { return run(true); },
      then(resolve: any, reject: any) { return run(false).then(resolve, reject); },
    };
    async function run(single: boolean) {
      const tableRows = rows[table] ??= [];
      let data = tableRows.filter(row => filters.every(([key, v]) => Array.isArray(v) ? v.includes(row[key]) : String(row[key]) === String(v)));
      if (operation === 'update') data.forEach(row => Object.assign(row, payload));
      if (operation === 'insert') {
        data = [{ id: tableRows.length + 100, ended_at: null, ...payload }];
        tableRows.push(...data);
      }
      return { data: single ? data[0] ?? null : data, error: null };
    }
    return query;
  });
  return calls;
}
afterEach(() => mock.restoreAll());

test('code lookup preserves leading zero and finds its database course', async () => {
  const calls = database({ courses: [{ id: 7, access_code: '012345', course_code: 'CSDP-200', title: 'Course B' }] });
  const course = await courseByAccessCode('012345');
  assert.equal(course.id, 7);
  assert.deepEqual(calls[0].filters, [['access_code', '012345']]);
});

test('invalid format and unknown codes never fall back to a default course', async () => {
  const calls = database({ courses: [{ id: 1, access_code: '123456', course_code: 'CSDP-120' }] });
  for (const code of [undefined, 123456, '12345', '1234567', 'abcdef', ' 123456']) {
    await assert.rejects(courseByAccessCode(code), /6-digit/);
  }
  assert.equal(calls.length, 0);
  await assert.rejects(courseByAccessCode('999999'), /not found/);
});

test('missing access_code column reports incomplete database setup', async () => {
  mock.method(db, 'from', () => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: { code: '42703' } }) };
    return query;
  });
  await assert.rejects(courseByAccessCode('123456'), /database setup is incomplete/);
});

test('week lookup uses the selected course ID', async () => {
  database({ courses: [{ id: 7, course_code: 'CSDP-200' }], weeks: [
    { id: 1, course_id: 1, week_number: 1 }, { id: 9, course_id: 7, week_number: 1 },
  ] });
  assert.equal((await selectedWeek(7)).id, 9);
});

test('dashboard follows the session week, not WEEK_NUMBER or another course', async () => {
  database({ class_sessions: [{ id: 41, week_id: 9, day_id: 31, ended_at: null }], weeks: [{ id: 9, course_id: 7, week_number: 2, title: 'Week2' }],
    courses: [{ id: 7, course_code: 'CSDP-200' }], days: [{ id: 31, week_id: 9, day_number: 2, title: 'Day 2' }], activities: [
      { id: 1, week_id: 1, title: 'Wrong course', activity_type: 'game' },
      { id: 3, week_id: 9, day_id: 30, title: 'Wrong day', activity_type: 'game' },
      { id: 2, week_id: 9, day_id: 31, title: 'Selected course', activity_type: 'game', activity_order: 1, file_path: null },
    ] });
  const content = await instructorContent('41');
  assert.equal(content.courseCode, 'CSDP-200'); assert.equal(content.weekNumber, 2); assert.equal(content.dayNumber, 2);
  assert.deepEqual(content.activities.map(a => a.title), ['Selected course']);
});

test('closed sessions cannot supply dashboard content', async () => {
  database({ class_sessions: [{ id: 41, week_id: 9, ended_at: '2026-10-14' }] });
  await assert.rejects(instructorContent('41'), /no longer active/);
});

test('session creation selects the code course and prevents mixing two live classes', async () => {
  const rows: Rows = { users: [{ id: 1, full_name: 'Instructor', role: 'instructor', device_id: 'test' }],
    courses: [{ id: 1, access_code: '123456', course_code: 'CSDP-120' }, { id: 2, access_code: '012345', course_code: 'CSDP-200' }],
    weeks: [{ id: 1, course_id: 1, week_number: 1 }, { id: 2, course_id: 2, week_number: 1 }], days: [{ id: 11, week_id: 1, day_number: 1 }, { id: 21, week_id: 2, day_number: 1 }, { id: 22, week_id: 2, day_number: 2 }], class_sessions: [] };
  database(rows); await initializeAppDataRepository();
  await assert.rejects(createSession(1, '999999', 2, 21), /not found/);
  assert.equal(rows.class_sessions.length, 0);
  const first = await createSession(1, '012345', 2, 21);
  assert.equal(first.courseCode, 'CSDP-200'); assert.equal(rows.class_sessions[0].week_id, 2);
  assert.equal(rows.class_sessions[0].day_id, 21);
  assert.equal((await createSession(1, '012345', 2, 21)).room_id, first.room_id);
  await assert.rejects(createSession(1, '012345', 2, 22), /End the current class/);
  await assert.rejects(createSession(1, '123456', 1, 11), /End the current class/);
  rows.class_sessions[0].ended_at = '2026-10-14';
  const next = await createSession(1, '123456', 1, 11); assert.equal(next.courseCode, 'CSDP-120');
  rows.class_sessions[1].ended_at = '2026-10-14';
  assert.equal(await joinSession('student-device'), null);
});


test('course code validation lists only its weeks and days without starting a class', async () => {
  const rows: Rows = {
    courses: [{ id: 1, access_code: '123456', course_code: 'CSDP-120', title: 'Programming' }],
    weeks: [{ id: 10, course_id: 1, week_number: 1 }, { id: 20, course_id: 2, week_number: 1 }],
    days: [{ id: 100, week_id: 10, day_number: 1 }, { id: 200, week_id: 20, day_number: 1 }],
    class_sessions: [],
  };
  database(rows);
  const result = await courseOutline('123456');
  assert.deepEqual(result.weeks.map(w => w.id), [10]);
  assert.deepEqual(result.weeks[0].days.map(d => d.id), [100]);
  assert.equal(rows.class_sessions.length, 0);
});

test('selection rejects weeks from other courses and days from other weeks', async () => {
  database({ weeks: [{ id: 10, course_id: 1 }, { id: 20, course_id: 2 }],
    days: [{ id: 100, week_id: 10 }, { id: 200, week_id: 20 }] });
  await assert.rejects(selectedCourseDay(1, undefined, undefined), /Select a week and day/);
  await assert.rejects(selectedCourseDay(1, 20, 200), /does not belong/);
  await assert.rejects(selectedCourseDay(1, 10, 200), /unavailable/);
  assert.equal((await selectedCourseDay(1, 10, 100)).day.id, 100);
});

test('task launch cannot access another day in the same week', async () => {
  database({ class_sessions: [{ id: 41, week_id: 10, day_id: 100, ended_at: null }],
    activities: [{ id: 1, week_id: 10, day_id: 100 }, { id: 2, week_id: 10, day_id: 101 }] });
  assert.equal((await activityForSession('41', undefined, 1)).id, 1);
  await assert.rejects(activityForSession('41', undefined, 2), /unavailable/);
});

test('missing days table reports incomplete setup instead of starting a class', async () => {
  database({ courses: [{ id: 1, access_code: '123456' }], weeks: [{ id: 10, course_id: 1 }] });
  const original = db.from.bind(db);
  mock.method(db, 'from', (table: string) => {
    if (table !== 'days') return original(table);
    const q: any = { select: () => q, in: () => q, order: async () => ({ data: null, error: { code: 'PGRST205' } }) };
    return q;
  });
  await assert.rejects(courseOutline('123456'), /database setup is incomplete/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ClassroomContentLoader } from '../src/content/classroom-content-loader.ts';
import { ClassroomContentError } from '../src/content/classroom-content-loader.ts';
import { batchMediaLinks } from '../server/services/batch-media-links.ts';

test('the default loader calls browser fetch with its global receiver, not the loader instance', async () => {
  const original = globalThis.fetch;
  let receiver: unknown;
  globalThis.fetch = (function(this: unknown) {
    receiver = this;
    if (this !== globalThis) throw TypeError('Illegal invocation');
    return Promise.resolve({ ok: true, json: async () => ({ activities: [], videos: [] }) } as Response);
  }) as typeof fetch;
  try {
    await new ClassroomContentLoader().load('/class');
    assert.equal(receiver, globalThis);
  } finally { globalThis.fetch = original; }
});

test('dashboard startup and side boards share one request; task launches refresh database content', async () => {
  let calls = 0, now = 0;
  const loader = new ClassroomContentLoader((async () => {
    calls++; return { ok: true, json: async () => ({ activities: [{ title: `Database version ${calls}` }], videos: [] }) };
  }) as any, () => now);
  const first = loader.load('/session/1'); const sideBoards = loader.load('/session/1');
  assert.equal(first, sideBoards); await first; assert.equal(calls, 1);
  await loader.load('/session/1'); assert.equal(calls, 1);
  const fresh = await loader.load('/session/1', true); assert.equal(calls, 2);
  assert.equal(fresh.activities[0].title, 'Database version 2');
  now = 15001; await loader.load('/session/1'); assert.equal(calls, 3);
  await loader.load('/session/2'); assert.equal(calls, 4, 'a different class cannot reuse the previous course data');
});

test('a failed startup request is retried instead of being cached', async () => {
  let calls = 0;
  const loader = new ClassroomContentLoader((async () => {
    if (++calls === 1) throw Error('offline');
    return { ok: true, json: async () => ({ activities: [], videos: [] }) };
  }) as any);
  await assert.rejects(loader.load('/class'), /offline/);
  await loader.load('/class'); assert.equal(calls, 2);
});

test('media links are batched per bucket and duplicates do not add requests', async () => {
  const calls: any[] = [];
  const storage = { from: (bucket: string) => ({ createSignedUrls: async (paths: string[], expiry: number) => {
    calls.push({ bucket, paths, expiry });
    return { data: paths.map(path => ({ path, signedUrl: `https://signed/${bucket}/${path}` })), error: null };
  } }) };
  const links = await batchMediaLinks(['supabase://media/a.mp4', 'supabase://media/b.png', 'supabase://media/a.mp4',
    'supabase://other/c.png', '/local/image.png', null], storage);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].paths, ['a.mp4', 'b.png']);
  assert.equal(links.get('supabase://media/b.png'), 'https://signed/media/b.png');
  assert.equal(links.get('/local/image.png'), '/local/image.png');
  assert.equal(links.get(''), null);
});

test('missing signed media is reported instead of showing an unrelated or broken link', async () => {
  const storage = { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) };
  await assert.rejects(batchMediaLinks(['supabase://media/missing.png'], storage), /Missing course media link/);
});

test('a server session error reaches the shared loader instead of becoming an empty activity list', async () => {
  const loader = new ClassroomContentLoader((async () => ({ ok: false, status: 409,
    json: async () => ({ message: 'This classroom has ended. Refresh and sign in again.' }) })) as any);
  await assert.rejects(loader.load('/ended-class'), error => error instanceof ClassroomContentError && error.needsLogin);
});

test('an empty dashboard shows a failed load and retries when opened again, without launching stale activities', async () => {
  const source = ts.createSourceFile('dashboard.ts', readFileSync('src/systems/instructor-dashboard.system.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const members = source.statements.find(ts.isClassDeclaration)!.members
    .filter(node => ['loadInstructorMenuContent', 'onDashboardOpened'].includes(node.name?.getText(source) ?? ''))
    .map(node => node.getText(source)).join('\n');
  let calls = 0;
  const context = vm.createContext({ Error, ClassroomContentError, console: { log() {}, error() {} },
    loadClassroomContent: async () => {
      if (++calls === 1) throw new ClassroomContentError('Offline');
      return { activities: [{ activityId: 180, title: 'Database activity' }], videos: [] };
    } });
  vm.runInContext(ts.transpile(`class Dashboard { ${members} }; globalThis.Dashboard = Dashboard;`, { target: ts.ScriptTarget.ES2022 }), context);
  const dashboard = new context.Dashboard();
  let renders = 0;
  Object.assign(dashboard, { databaseActivities: [], renderLessonPage: () => renders++ });
  assert.equal(await dashboard.loadInstructorMenuContent(), false);
  assert.equal(dashboard.contentState, 'error'); assert.equal(dashboard.contentError, 'Offline');
  dashboard.onDashboardOpened(); await dashboard.contentLoadPending;
  assert.equal(dashboard.contentState, 'ready'); assert.equal(dashboard.databaseActivities[0].activityId, 180);
  assert.equal(calls, 2); assert.ok(renders >= 4);
});

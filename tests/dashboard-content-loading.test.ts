import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassroomContentLoader } from '../src/content/classroom-content-loader.ts';
import { batchMediaLinks } from '../server/services/batch-media-links.ts';

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

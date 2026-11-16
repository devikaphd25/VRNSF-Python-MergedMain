import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup({ packaged = true, fail = false } = {}) {
  const calls = [];
  const session = { async end() { calls.push('end'); }, addEventListener() {} };
  const window = { location: { search: '?quest-apk=1' } };
  if (packaged) window.getDigitalGoodsService = () => {};
  const world = { xrDefaults: { features: { handTracking: true } }, renderer: { xr: {
    getSession() { return null; },
    setReferenceSpaceType(value) { calls.push(value); },
    async setSession(value) { assert.equal(value, session); calls.push('set-session'); },
  } } };
  const context = { window, URLSearchParams, Reflect,
    navigator: { xr: { async isSessionSupported() { return true; }, async requestSession(mode, options) {
      calls.push(mode); assert.equal(options.features.handTracking, true);
      return session;
    } } },
    buildSessionInit: options => options,
    normalizeReferenceSpec: () => ({ type: 'local-floor', required: false, fallbackOrder: ['local'] }),
    resolveReferenceSpaceType: async () => { if (fail) throw Error('No reference space'); return 'local-floor'; },
    console: { warn() {} },
  };
  const source = readFileSync('src/presentation/packaged-quest-session.ts', 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/export /g, '');
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 })
    + '\nglobalThis.api = { isPackagedQuestApp, startPackagedQuestSession };', context);
  return { api: context.api, world, calls, session };
}

test('a normal browser does not automatically enter VR, even with the APK query flag', async () => {
  const { api, world, calls } = setup({ packaged: false });
  assert.equal(api.isPackagedQuestApp(), false);
  await api.startPackagedQuestSession(world);
  assert.deepEqual(calls, []);
});
test('packaged launch requests immersive VR with hand tracking and attaches the session', async () => {
  const { api, world, calls, session } = setup();
  await api.startPackagedQuestSession(world);
  assert.deepEqual(calls, ['immersive-vr', 'local-floor', 'set-session']);
  assert.equal(world.session, session);
});
test('an existing XR session is preserved', async () => {
  const { api, world, calls, session } = setup();
  world.renderer.xr.getSession = () => session;
  await api.startPackagedQuestSession(world);
  assert.deepEqual(calls, []);
});
test('failed setup closes the partial session and leaves manual VR entry available', async () => {
  const { api, world, calls } = setup({ fail: true });
  await api.startPackagedQuestSession(world);
  assert.deepEqual(calls, ['immersive-vr', 'end']);
  assert.equal(world.session, undefined);
});

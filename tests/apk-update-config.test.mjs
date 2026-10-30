import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { launchOrigin, nextVersion } = createRequire(import.meta.url)('../apk/update-config.cjs');
test('APK updates advance the existing version while preserving package identity', () => {
  const id='edu.umes.vrclassroom.test';
  assert.deepEqual(nextVersion({packageId:id,appVersionCode:1},id),{code:2,name:'1.0.2'});
  assert.deepEqual(nextVersion({packageId:id,appVersionCode:8},id),{code:9,name:'1.0.9'});
  assert.throws(()=>nextVersion({packageId:'different.app',appVersionCode:1},id),/Package ID/);
  assert.throws(()=>nextVersion({packageId:id,appVersionCode:'2'},id),/version code/);
});
test('APK URL updates accept only an HTTPS origin without credentials or a page path', () => {
  assert.equal(launchOrigin('https://new-address.trycloudflare.com/'),'https://new-address.trycloudflare.com');
  for(const url of ['http://localhost:3100','https://user:secret@example.com','https://example.com/page','https://example.com/?token=secret']) {
    assert.throws(()=>launchOrigin(url));
  }
});

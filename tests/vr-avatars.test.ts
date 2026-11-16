import test from 'node:test';
import assert from 'node:assert/strict';
import { VR_AVATARS, pickRandomAvatar } from '../shared/vr-avatars';
test('avatar catalog has 15 distinct public GLB models', () => {
  assert.equal(VR_AVATARS.length, 15);
  assert.equal(new Set(VR_AVATARS.map(a => a.id)).size, 15);
  for (const avatar of VR_AVATARS) {
    assert.match(avatar.url, /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/vr-avatars\/Avatar.+\.glb$/);
  }
});
test('random avatar selection reaches every catalog entry', () => {
  for (let i = 0; i < VR_AVATARS.length; i++) {
    assert.equal(pickRandomAvatar(() => (i + 0.5) / VR_AVATARS.length), VR_AVATARS[i]);
  }
  assert.equal(pickRandomAvatar(() => 0), VR_AVATARS[0]);
  assert.equal(pickRandomAvatar(() => 1), VR_AVATARS.at(-1));
});

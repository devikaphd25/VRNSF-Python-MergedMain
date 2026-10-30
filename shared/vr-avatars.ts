import catalog from './vr-avatar-catalog.json' with { type: 'json' };
export const VR_AVATARS: readonly { id: string; url: string }[] = catalog;
export function pickRandomAvatar(random = Math.random): { id: string; url: string } {
  if (!VR_AVATARS.length) throw new Error('VR avatar catalog is empty');
  return VR_AVATARS[Math.min(VR_AVATARS.length - 1, Math.floor(Math.max(0, random()) * VR_AVATARS.length))];
}

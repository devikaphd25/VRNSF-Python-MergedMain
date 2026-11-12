import type { ClassroomContent } from './classroom-content';
import { instructorContentUrl } from '../services/classroom-session.service';

export class ClassroomContentError extends Error {
  constructor(message: string, readonly needsLogin = false) { super(message); }
}

/** Share startup work across the dashboard and side boards; refresh before launching tasks. */
export class ClassroomContentLoader {
  private url = '';
  private cached?: ClassroomContent;
  private expiresAt = 0;
  private pending?: Promise<ClassroomContent>;
  constructor(private readonly request: typeof fetch = (input, init) => globalThis.fetch(input, init), private readonly now = () => Date.now()) {}

  load(url: string, fresh = false): Promise<ClassroomContent> {
    if (this.url !== url) {
      this.url = url; this.cached = undefined; this.pending = undefined;
    }
    if (this.pending) return this.pending;
    if (!fresh && this.cached && this.now() < this.expiresAt) return Promise.resolve(this.cached);
    const pending = this.request(url).then(async response => {
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new ClassroomContentError(error?.message ?? 'Could not load activities. Please try again.', response.status === 409);
      }
      const content = await response.json() as ClassroomContent;
      if (!Array.isArray(content.activities) || !Array.isArray(content.videos)) throw Error('Invalid classroom content');
      if (this.url === url) { this.cached = content; this.expiresAt = this.now() + 15000; }
      return content;
    });
    this.pending = pending;
    void pending.finally(() => { if (this.pending === pending) this.pending = undefined; }).catch(() => {});
    return pending;
  }
}

const loader = new ClassroomContentLoader();
export function loadClassroomContentForSession(roomId: string): Promise<ClassroomContent> {
  return loader.load(`/api/instructor-content?sessionId=${encodeURIComponent(roomId)}`);
}
export function loadClassroomContent(fresh = false): Promise<ClassroomContent> {
  return loader.load(instructorContentUrl(), fresh);
}

/** Run related writes in sequence; unrelated keys can proceed independently. */
const queues = new Map<string, Promise<unknown>>();
export function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const job = (queues.get(key) ?? Promise.resolve()).catch(() => { }).then(work);
    queues.set(key, job);
    void job.finally(() => { if (queues.get(key) === job)
        queues.delete(key); }).catch(() => { });
    return job;
}

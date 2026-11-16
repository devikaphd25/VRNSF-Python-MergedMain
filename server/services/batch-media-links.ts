/** Sign a day's media in one Storage request per bucket, preserving activity order. */
export async function batchMediaLinks(paths: Array<string | null>, storage: {
  from(bucket: string): { createSignedUrls(paths: string[], expiresIn: number): PromiseLike<{ data: any; error: any }> };
}): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>();
  const buckets = new Map<string, Set<string>>();
  for (const path of paths) {
    if (!path?.startsWith('supabase://')) { resolved.set(path ?? '', path); continue; }
    const key = path.slice(11), split = key.indexOf('/');
    if (split < 1) throw Error('Invalid Storage path');
    const bucket = key.slice(0, split);
    if (!buckets.has(bucket)) buckets.set(bucket, new Set());
    buckets.get(bucket)!.add(key.slice(split + 1));
  }
  await Promise.all([...buckets].map(async ([bucket, files]) => {
    const { data, error } = await storage.from(bucket).createSignedUrls([...files], 86400);
    if (error) throw error;
    for (const entry of data ?? []) {
      if (entry.error || !entry.path || !entry.signedUrl) throw Error('Could not sign course media');
      resolved.set(`supabase://${bucket}/${entry.path}`, entry.signedUrl);
    }
    for (const file of files) if (!resolved.has(`supabase://${bucket}/${file}`)) throw Error('Missing course media link');
  }));
  return resolved;
}

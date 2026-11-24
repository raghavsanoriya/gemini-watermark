import { serverConfig } from './config';

/**
 * Fixed-window limit per client address, kept in memory. Each server instance
 * counts separately (on Vercel, each warm function instance), so this curbs
 * casual abuse rather than enforcing an exact global quota.
 */
const windows = new Map<string, { start: number; count: number }>();
/** Addresses tracked at once. Beyond this the oldest windows are dropped, so memory stays bounded. */
const MAX_ENTRIES = 10_000;

/**
 * The client address as reported by the proxy in front of the app. On Vercel the platform sets
 * these headers and drops client-supplied values; a self-hosted `next start` must sit behind a
 * proxy that does the same, or clients can pick their own key and skip the limit.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/** Records one use. Returns seconds to wait when the limit is reached, otherwise 0. */
export function takeRateLimit(key: string, now = Date.now()): number {
  const { rateLimitCount, rateLimitWindowMs } = serverConfig;
  const current = windows.get(key);
  if (!current || now - current.start >= rateLimitWindowMs) {
    windows.delete(key);
    windows.set(key, { start: now, count: 1 });
    if (windows.size > MAX_ENTRIES) {
      for (const [entry, value] of windows) if (now - value.start >= rateLimitWindowMs) windows.delete(entry);
      // Still full of live windows: drop the oldest (Map keeps insertion order).
      for (const entry of windows.keys()) {
        if (windows.size <= MAX_ENTRIES) break;
        windows.delete(entry);
      }
    }
    return 0;
  }
  if (current.count >= rateLimitCount) return Math.ceil((current.start + rateLimitWindowMs - now) / 1000);
  current.count += 1;
  return 0;
}

export function rateLimitEntryCount(): number {
  return windows.size;
}

export function resetRateLimitsForTests(): void {
  windows.clear();
}

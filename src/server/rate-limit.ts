import { serverConfig } from './config';

/**
 * Fixed-window limit per client address, kept in memory. Each server instance
 * counts separately (on Vercel, each warm function instance), so this curbs
 * casual abuse rather than enforcing an exact global quota.
 */
const windows = new Map<string, { start: number; count: number }>();

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/** Records one use. Returns seconds to wait when the limit is reached, otherwise 0. */
export function takeRateLimit(key: string, now = Date.now()): number {
  const { rateLimitCount, rateLimitWindowMs } = serverConfig;
  const current = windows.get(key);
  if (!current || now - current.start >= rateLimitWindowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [entry, value] of windows) if (now - value.start >= rateLimitWindowMs) windows.delete(entry);
    }
    return 0;
  }
  if (current.count >= rateLimitCount) return Math.ceil((current.start + rateLimitWindowMs - now) / 1000);
  current.count += 1;
  return 0;
}

export function resetRateLimitsForTests(): void {
  windows.clear();
}

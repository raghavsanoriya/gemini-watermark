/**
 * A positive, finite number from an environment value, else the default. A typo such as
 * `4MB` used to become NaN, which silently switched the upload or rate limit off.
 */
export function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (value.trim() !== '' && Number.isFinite(parsed) && parsed > 0) return parsed;
  console.warn(`[gemclean] Ignoring invalid setting "${value}"; using ${fallback}.`);
  return fallback;
}

/** Server-mode settings. See README "Server mode". */
export const serverConfig = {
  /**
   * Largest upload accepted, in bytes. Vercel functions reject request bodies over
   * 4.5 MB, so the default stays under that; raise it on hosts without the limit.
   */
  maxUploadBytes: positiveNumber(process.env.GEMCLEAN_MAX_UPLOAD_MB, 4) * 1024 * 1024,
  /** Images one client address may clean per window. */
  rateLimitCount: Math.floor(positiveNumber(process.env.GEMCLEAN_RATE_LIMIT, 20)),
  rateLimitWindowMs: positiveNumber(process.env.GEMCLEAN_RATE_WINDOW_MINUTES, 10) * 60 * 1000,
};

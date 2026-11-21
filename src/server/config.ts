/** Server-mode settings. See README "Server mode". */
export const serverConfig = {
  /**
   * Largest upload accepted, in bytes. Vercel functions reject request bodies over
   * 4.5 MB, so the default stays under that; raise it on hosts without the limit.
   */
  maxUploadBytes: Number(process.env.GEMCLEAN_MAX_UPLOAD_MB ?? 4) * 1024 * 1024,
  /** Images one client address may clean per window. */
  rateLimitCount: Number(process.env.GEMCLEAN_RATE_LIMIT ?? 20),
  rateLimitWindowMs: Number(process.env.GEMCLEAN_RATE_WINDOW_MINUTES ?? 10) * 60 * 1000,
};

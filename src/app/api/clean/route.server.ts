import { cleanUploadedImage } from '@/server/clean';
import { handle, HttpError } from '@/server/http';
import { serverConfig } from '@/server/config';
import { clientAddress, takeRateLimit } from '@/server/rate-limit';
import { readUploadedFile } from '@/server/upload';

// Decoding, cleaning and a cold MI-GAN load can take several seconds.
export const maxDuration = 60;

/**
 * Cleans one uploaded image and returns it as PNG in the same response. Nothing
 * is stored. When no mark is found, responds with JSON `{ applied: false }`.
 */
export const POST = handle(async (request: Request) => {
  const wait = takeRateLimit(clientAddress(request));
  if (wait > 0) {
    throw new HttpError(429, `Server limit reached. Try again in ${Math.ceil(wait / 60)} min, or use "This device".`, {
      'Retry-After': String(wait),
    });
  }
  const file = await readUploadedFile(request, serverConfig.maxUploadBytes);
  const outcome = await cleanUploadedImage(file);
  if (!outcome.png) {
    return Response.json({ applied: false, repairMode: outcome.repairMode, message: outcome.message });
  }
  return new Response(new Uint8Array(outcome.png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'X-GemClean-Repair-Mode': outcome.repairMode ?? 'reverse-alpha',
      // Diagnostic flag only: the error text (which can name server paths) stays in the server log.
      ...(outcome.miganError ? { 'X-GemClean-Migan-Error': 'unavailable' } : {}),
    },
  });
});

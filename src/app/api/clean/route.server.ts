import { cleanUploadedImage } from '@/server/clean';
import { handle, HttpError } from '@/server/http';
import { clientAddress, takeRateLimit } from '@/server/rate-limit';

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
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Upload an image in the "file" field.');

  const outcome = await cleanUploadedImage(file);
  if (!outcome.png) {
    return Response.json({ applied: false, repairMode: outcome.repairMode, message: outcome.message });
  }
  return new Response(new Uint8Array(outcome.png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'X-GemClean-Repair-Mode': outcome.repairMode ?? 'reverse-alpha',
      // Diagnostic: the AI fill could not run on this host (see server logs).
      ...(outcome.miganError ? { 'X-GemClean-Migan-Error': outcome.miganError.replace(/[^ -~]/g, ' ').slice(0, 300) } : {}),
    },
  });
});

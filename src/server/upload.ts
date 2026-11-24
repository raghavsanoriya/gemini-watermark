import { HttpError } from './http';

/** Room for multipart framing around the file: boundaries, part headers, the field name. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

const tooLarge = (maxFileBytes: number) => new HttpError(
  413,
  `Server processing accepts images up to ${Math.max(1, Math.round(maxFileBytes / 1024 / 1024))} MB. Use "This device" for larger files.`,
);

/**
 * Reads the multipart upload with a hard size cap. `request.formData()` buffers the whole body
 * before anything can check its size, so a 60 MB post used ~180 MB of memory before being
 * rejected. Here an oversized declared length is refused without reading, and a streamed body
 * is cut off as soon as it passes the cap.
 */
export async function readUploadedFile(request: Request, maxFileBytes: number): Promise<File> {
  const limit = maxFileBytes + FORM_OVERHEAD_BYTES;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(maxFileBytes);
  if (!request.body) throw new HttpError(400, 'Upload an image in the "file" field.');

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxFileBytes);
    }
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }

  const contentType = request.headers.get('content-type') ?? '';
  const form = await new Response(new Blob(chunks), { headers: { 'content-type': contentType } }).formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Upload an image in the "file" field.');
  return file;
}

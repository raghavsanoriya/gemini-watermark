/** An error with an HTTP status that route handlers return as JSON. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly headers: Record<string, string> = {}) {
    super(message);
  }
}

/** Wraps a route handler and turns errors into JSON responses. */
export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message }, { status: error.status, headers: error.headers });
      }
      console.error('[gemclean] Unexpected server error', error);
      return Response.json({ error: 'Something went wrong on the server.' }, { status: 500 });
    }
  };
}

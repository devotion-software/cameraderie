/** HTTP error with a status code, caught by a Fastify error handler. */
export class AppError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new AppError(400, code, msg);
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Not allowed') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new AppError(409, code, msg);
export const payloadTooLarge = (msg: string) => new AppError(413, 'quota_exceeded', msg);

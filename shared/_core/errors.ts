/**
 * Base HTTP error class with status code.
 * Throw this from route handlers to send specific HTTP errors.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Convenience constructors
export const BadRequestError = (msg: string) => new HttpError(400, msg);
export const UnauthorizedError = (msg: string) => new HttpError(401, msg);
export const ForbiddenError = (msg: string) => new HttpError(403, msg);
export const NotFoundError = (msg: string) => new HttpError(404, msg);
/** 依赖的存储/上游暂时不可用；调用方应重试，**不要**当成凭证无效 */
export const ServiceUnavailableError = (msg: string) => new HttpError(503, msg);

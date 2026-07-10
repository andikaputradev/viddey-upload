export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'An unknown error occurred'
}

export function toError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(toMessage(err))
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message, code, 422)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, code, 409)
    this.name = 'ConflictError'
  }
}

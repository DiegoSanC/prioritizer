export type DomainErrorCode =
  | 'validation'
  | 'not_found'
  | 'invalid_transition'
  | 'unauthorized'
  | 'conflict';

/**
 * Every rejection the core produces on purpose. Adapters map these to their own
 * vocabulary (HTTP status, MCP tool error); they never reinterpret the rule.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function validationError(message: string): DomainError {
  return new DomainError('validation', message);
}

export function notFound(message: string): DomainError {
  return new DomainError('not_found', message);
}

export function invalidTransition(message: string): DomainError {
  return new DomainError('invalid_transition', message);
}

export function unauthorized(message: string): DomainError {
  return new DomainError('unauthorized', message);
}

export function requireText(value: string | undefined | null, field: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    throw validationError(`The ${field} field is required.`);
  }
  return trimmed;
}

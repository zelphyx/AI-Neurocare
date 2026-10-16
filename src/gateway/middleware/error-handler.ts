import { DomainError, ValidationError } from '../../shared/errors/domain-error.js';
import type { ProblemDetails } from '../../shared/errors/domain-error.js';

export interface GatewayResponse {
  status: number;
  body: ProblemDetails | Record<string, unknown>;
}

/**
 * Unified Error-Handling Middleware (Checkpoint 24).
 * Catches ANY exception escaping a route handler and serializes it into the
 * standard RFC 7807 Problem Details contract:
 *   - DomainError        -> its own HTTP status (400/404/422/502/504)
 *   - ZodError           -> 400 via ValidationError.fromZodError
 *   - anything else      -> 500 with a non-leaking generic message
 */
export function toErrorResponse(error: unknown, instance: string): GatewayResponse {
  if (error instanceof DomainError) {
    return {
      status: error.status,
      body: error.toProblemDetails(instance),
    };
  }

  if (error instanceof Error && error.name === 'ZodError') {
    const validationError = ValidationError.fromZodError(
      error as never,
      { instance }
    );
    return {
      status: validationError.status,
      body: validationError.toProblemDetails(instance),
    };
  }

  // Unknown/unexpected failure: never leak internals to the client
  return {
    status: 500,
    body: {
      type: 'https://errors.ai-neurocare.org/v1/internal-server-error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Terjadi kesalahan internal pada server. Silakan coba lagi nanti.',
      instance,
      errorCode: 'ERR_INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString(),
    },
  };
}

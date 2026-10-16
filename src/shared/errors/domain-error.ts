import { z } from 'zod';

/**
 * RFC 7807 Invalid Parameter Schema
 * Represents specific field-level validation errors.
 */
export const InvalidParamSchema = z.object({
  field: z.string().min(1, 'Field name must not be empty'),
  rejectedValue: z.unknown().optional(),
  reason: z.string().min(1, 'Reason must not be empty'),
});

export type InvalidParam = z.infer<typeof InvalidParamSchema>;

/**
 * RFC 7807 Problem Details Schema for AI-Neurocare Platform
 * Standardized error structure for all 4xx and 5xx HTTP responses.
 */
export const ProblemDetailsSchema = z.object({
  type: z.string().url('Type must be a valid URI'),
  title: z.string().min(1, 'Title must not be empty'),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1, 'Detail must not be empty'),
  instance: z.string().min(1, 'Instance must not be empty'),
  errorCode: z.string().regex(/^ERR_[A-Z0-9_]+$/, 'ErrorCode must match format ERR_XXX'),
  invalidParams: z.array(InvalidParamSchema).optional(),
  timestamp: z.string().datetime({ message: 'Timestamp must be an ISO 8601 string' }),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export interface DomainErrorOptions {
  title: string;
  status: number;
  detail: string;
  errorCode: string;
  instance?: string | undefined;
  type?: string | undefined;
  invalidParams?: InvalidParam[] | undefined;
  cause?: unknown;
}

/**
 * Base Domain Error class adhering to RFC 7807 Problem Details
 */
export class DomainError extends Error {
  public readonly title: string;
  public readonly status: number;
  public readonly detail: string;
  public readonly errorCode: string;
  public readonly instance: string;
  public readonly type: string;
  public readonly invalidParams?: InvalidParam[] | undefined;
  public readonly timestamp: string;

  constructor(options: DomainErrorOptions) {
    super(options.detail);
    this.name = this.constructor.name;
    this.title = options.title;
    this.status = options.status;
    this.detail = options.detail;
    this.errorCode = options.errorCode;
    this.instance = options.instance ?? '/api/v1/unknown';
    this.type = options.type ?? `https://errors.ai-neurocare.org/v1/${this.kebabCase(options.errorCode)}`;
    this.invalidParams = options.invalidParams;
    this.timestamp = new Date().toISOString();

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  private kebabCase(str: string): string {
    return str
      .replace(/^ERR_/, '')
      .toLowerCase()
      .replace(/_/g, '-');
  }

  /**
   * Serializes the error to a validated RFC 7807 Problem Details object
   */
  public toProblemDetails(instanceOverride?: string): ProblemDetails {
    const payload: ProblemDetails = {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance: instanceOverride ?? this.instance,
      errorCode: this.errorCode,
      timestamp: this.timestamp,
    };

    if (this.invalidParams !== undefined && this.invalidParams.length > 0) {
      payload.invalidParams = this.invalidParams;
    }

    // Validate using Zod schema to ensure 100% compliance with RFC 7807 specification
    return ProblemDetailsSchema.parse(payload);
  }

  public toJSON(): ProblemDetails {
    return this.toProblemDetails();
  }
}

/**
 * Specialized Clinical Validation Error (HTTP 422)
 * Triggered when clinical data violates physiological boundaries or model constraints.
 */
export class ClinicalValidationError extends DomainError {
  constructor(options: {
    detail: string;
    errorCode: string;
    instance?: string | undefined;
    invalidParams?: InvalidParam[] | undefined;
    cause?: unknown;
  }) {
    super({
      type: 'https://errors.ai-neurocare.org/v1/clinical-validation-failed',
      title: 'Clinical Parameter Validation Failed',
      status: 422,
      detail: options.detail,
      errorCode: options.errorCode,
      instance: options.instance,
      invalidParams: options.invalidParams,
      cause: options.cause,
    });
  }
}

/**
 * Schema / Parameter Validation Error (HTTP 400 / 422)
 */
export class ValidationError extends DomainError {
  constructor(options: {
    detail: string;
    errorCode?: string | undefined;
    status?: 400 | 422 | undefined;
    instance?: string | undefined;
    invalidParams?: InvalidParam[] | undefined;
    cause?: unknown;
  }) {
    super({
      type: 'https://errors.ai-neurocare.org/v1/validation-error',
      title: 'Request Validation Error',
      status: options.status ?? 400,
      detail: options.detail,
      errorCode: options.errorCode ?? 'ERR_REQUEST_VALIDATION_FAILED',
      instance: options.instance,
      invalidParams: options.invalidParams,
      cause: options.cause,
    });
  }

  /**
   * Factory function to convert ZodError directly into an RFC 7807 ValidationError
   */
  public static fromZodError(
    zodError: z.ZodError,
    options?: {
      instance?: string | undefined;
      title?: string | undefined;
      errorCode?: string | undefined;
      status?: 400 | 422 | undefined;
    }
  ): ValidationError {
    const invalidParams: InvalidParam[] = zodError.issues.map((issue) => {
      const param: InvalidParam = {
        // Root-level Zod issues carry an empty path; RFC 7807 requires a
        // non-empty field, so fall back to the request body pointer.
        field: issue.path.length > 0 ? issue.path.join('.') : 'body',
        reason: issue.message,
      };
      return param;
    });

    return new ValidationError({
      detail: `Validasi skema gagal: ${invalidParams.map((p) => `${p.field} (${p.reason})`).join(', ')}`,
      errorCode: options?.errorCode ?? 'ERR_SCHEMA_VALIDATION_FAILED',
      status: options?.status ?? 400,
      instance: options?.instance,
      invalidParams,
      cause: zodError,
    });
  }
}

/**
 * Upstream Service Error (HTTP 502 / 504)
 * For external LLM (Gemini/OpenAI), SATUSEHAT, or Python DSP microservice timeouts/failures.
 */
export class UpstreamServiceError extends DomainError {
  constructor(options: {
    serviceName: string;
    detail: string;
    errorCode: string;
    status?: 502 | 504 | undefined;
    instance?: string | undefined;
    cause?: unknown;
  }) {
    super({
      type: `https://errors.ai-neurocare.org/v1/upstream-${options.serviceName.toLowerCase()}-error`,
      title: `Upstream Service Error: ${options.serviceName}`,
      status: options.status ?? 502,
      detail: options.detail,
      errorCode: options.errorCode,
      instance: options.instance,
      cause: options.cause,
    });
  }
}

/**
 * Resource Not Found Error (HTTP 404)
 */
export class NotFoundError extends DomainError {
  constructor(options: {
    resource: string;
    identifier: string;
    instance?: string | undefined;
  }) {
    super({
      type: 'https://errors.ai-neurocare.org/v1/resource-not-found',
      title: 'Resource Not Found',
      status: 404,
      detail: `Sumber daya ${options.resource} dengan identitas '${options.identifier}' tidak ditemukan.`,
      errorCode: 'ERR_RESOURCE_NOT_FOUND',
      instance: options.instance,
    });
  }
}

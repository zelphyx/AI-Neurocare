import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  DomainError,
  ClinicalValidationError,
  ValidationError,
  NotFoundError,
  UpstreamServiceError,
  ProblemDetailsSchema,
} from '../../src/shared/errors/domain-error.js';

describe('DomainError & RFC 7807 Problem Details Specification', () => {
  it('TC-CORE-ERR-001: should serialize DomainError into valid RFC 7807 problem details', () => {
    const error = new DomainError({
      title: 'Invalid Screening Input',
      status: 400,
      detail: 'Parameter usia tidak memenuhi batasan studi WHO.',
      errorCode: 'ERR_AGE_OUT_OF_STUDY_RANGE',
      instance: '/api/v1/screening/evaluate',
      invalidParams: [
        {
          field: 'patientAgeYears',
          rejectedValue: 35,
          reason: 'Nilai harus berada dalam rentang 40 hingga 59 tahun.',
        },
      ],
    });

    const problemDetails = error.toProblemDetails();

    // Verify adherence to Zod schema
    const parseResult = ProblemDetailsSchema.safeParse(problemDetails);
    expect(parseResult.success).toBe(true);

    // Verify field values
    expect(problemDetails.type).toBe('https://errors.ai-neurocare.org/v1/age-out-of-study-range');
    expect(problemDetails.title).toBe('Invalid Screening Input');
    expect(problemDetails.status).toBe(400);
    expect(problemDetails.detail).toBe('Parameter usia tidak memenuhi batasan studi WHO.');
    expect(problemDetails.errorCode).toBe('ERR_AGE_OUT_OF_STUDY_RANGE');
    expect(problemDetails.instance).toBe('/api/v1/screening/evaluate');
    expect(problemDetails.invalidParams).toHaveLength(1);
    expect(problemDetails.invalidParams?.[0]?.field).toBe('patientAgeYears');
    expect(problemDetails.invalidParams?.[0]?.rejectedValue).toBe(35);
    expect(problemDetails.timestamp).toBeDefined();
    expect(new Date(problemDetails.timestamp).toISOString()).toBe(problemDetails.timestamp);
  });

  it('should correctly format ClinicalValidationError matching PRD 01 specification', () => {
    const clinicalError = new ClinicalValidationError({
      detail:
        'Nilai tekanan darah sistolik (260 mmHg) berada di atas batas keamanan input otomatis dan memerlukan penanganan kegawatdaruratan klinis.',
      errorCode: 'ERR_CLINICAL_SBP_EXCEEDS_THRESHOLD',
      instance: '/api/v1/screening/evaluate',
      invalidParams: [
        {
          field: 'systolicBloodPressureMmHg',
          rejectedValue: 260,
          reason: 'Nilai harus berada dalam rentang fisiologis skrining 70 hingga 240 mmHg.',
        },
      ],
    });

    const details = clinicalError.toProblemDetails();

    expect(details.status).toBe(422);
    expect(details.type).toBe('https://errors.ai-neurocare.org/v1/clinical-validation-failed');
    expect(details.title).toBe('Clinical Parameter Validation Failed');
    expect(details.errorCode).toBe('ERR_CLINICAL_SBP_EXCEEDS_THRESHOLD');
    expect(details.invalidParams?.[0]?.field).toBe('systolicBloodPressureMmHg');
  });

  it('should transform ZodError into standardized RFC 7807 ValidationError', () => {
    const SampleSchema = z.object({
      age: z.number().min(40).max(59),
      smoker: z.boolean(),
    });

    const validationResult = SampleSchema.safeParse({ age: 25, smoker: 'yes' });
    expect(validationResult.success).toBe(false);

    if (!validationResult.success) {
      const error = ValidationError.fromZodError(validationResult.error, {
        instance: '/api/v1/screening/evaluate',
      });

      const details = error.toProblemDetails();
      expect(details.status).toBe(400);
      expect(details.type).toBe('https://errors.ai-neurocare.org/v1/validation-error');
      expect(details.invalidParams).toBeDefined();
      expect(details.invalidParams?.length).toBe(2);
      expect(details.invalidParams?.map((p) => p.field)).toEqual(['age', 'smoker']);
    }
  });

  it('should correctly serialize NotFoundError', () => {
    const notFoundError = new NotFoundError({
      resource: 'PatientScreeningRecord',
      identifier: 'REC-99999',
      instance: '/api/v1/records/REC-99999',
    });

    const details = notFoundError.toProblemDetails();
    expect(details.status).toBe(404);
    expect(details.errorCode).toBe('ERR_RESOURCE_NOT_FOUND');
    expect(details.detail).toContain('REC-99999');
  });

  it('should correctly serialize UpstreamServiceError with status 502/504', () => {
    const upstreamError = new UpstreamServiceError({
      serviceName: 'Gemini-API',
      detail: 'Penyedia LLM mengalami batas laju (Rate Limit HTTP 429) setelah 3 kali percobaan.',
      errorCode: 'ERR_UPSTREAM_RATE_LIMITED',
      status: 504,
      instance: '/api/v1/insights/generate',
    });

    const details = upstreamError.toProblemDetails();
    expect(details.status).toBe(504);
    expect(details.type).toBe('https://errors.ai-neurocare.org/v1/upstream-gemini-api-error');
    expect(details.errorCode).toBe('ERR_UPSTREAM_RATE_LIMITED');
  });

  it('should support JSON.stringify() directly through toJSON()', () => {
    const error = new DomainError({
      title: 'Internal Server Error',
      status: 500,
      detail: 'Terjadi kegagalan internal sistem tak terduga.',
      errorCode: 'ERR_INTERNAL_FAILURE',
    });

    const jsonString = JSON.stringify(error);
    const parsed = JSON.parse(jsonString);

    expect(parsed.title).toBe('Internal Server Error');
    expect(parsed.status).toBe(500);
    expect(parsed.errorCode).toBe('ERR_INTERNAL_FAILURE');
  });
});

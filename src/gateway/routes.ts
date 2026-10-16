import { evaluateClinicalScreening } from '../modules/screening/engine.js';
import { detectScreeningGaps } from '../modules/gap-detection/engine.js';
import { generateHealthInsight } from '../modules/insights/engine.js';
import { evaluateWeeklyRecovery } from '../modules/recovery/engine.js';
import { evaluateRehabSession } from '../modules/rehab/session-evaluator.js';
import { UpstreamServiceError } from '../shared/errors/domain-error.js';

export interface GatewayRequestContext {
  method: 'GET' | 'POST';
  path: string;
  body: unknown;
}

export type RouteHandler = (
  body: unknown
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface RouteDefinition {
  method: 'GET' | 'POST';
  handler: RouteHandler;
}

/**
 * Unified API Gateway route registry (Checkpoint 24).
 * All /api/v1/... module endpoints are exposed here through their engines;
 * the error-handling middleware wraps every invocation in RFC 7807.
 */
export const API_ROUTES: Record<string, RouteDefinition> = {
  '/api/v1/screening/evaluate': {
    method: 'POST',
    handler: (body) => evaluateClinicalScreening(body) as unknown as Record<string, unknown>,
  },
  '/api/v1/screening/gaps': {
    method: 'POST',
    handler: (body) => detectScreeningGaps(body) as unknown as Record<string, unknown>,
  },
  '/api/v1/insights/health': {
    method: 'POST',
    handler: async (body) =>
      (await generateHealthInsight(body)) as unknown as Record<string, unknown>,
  },
  '/api/v1/recovery/insight': {
    method: 'POST',
    handler: async (body) =>
      (await evaluateWeeklyRecovery(body)) as unknown as Record<string, unknown>,
  },
  '/api/v1/rehab/session/evaluate': {
    method: 'POST',
    handler: (body) => evaluateRehabSession(body) as unknown as Record<string, unknown>,
  },
  '/api/v1/biomarkers/ppg/process': {
    method: 'POST',
    handler: async (body) => proxyToPpgEngine(body),
  },
};

const PPG_ENGINE_BASE_URL = process.env['PPG_ENGINE_BASE_URL'] ?? '';

/**
 * The PPG DSP pipeline lives in the Python microservice (services/ppg_engine);
 * the Node gateway proxies to it. Failures surface as RFC 7807 502.
 */
async function proxyToPpgEngine(body: unknown): Promise<Record<string, unknown>> {
  if (!PPG_ENGINE_BASE_URL) {
    throw new UpstreamServiceError({
      serviceName: 'PPG Engine',
      errorCode: 'ERR_PPG_ENGINE_NOT_CONFIGURED',
      detail: 'Microservice PPG belum dikonfigurasi (PPG_ENGINE_BASE_URL tidak tersedia).',
    });
  }

  let response: Response;
  try {
    response = await fetch(
      `${PPG_ENGINE_BASE_URL.replace(/\/$/, '')}/api/v1/biomarkers/ppg/process`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  } catch (cause) {
    throw new UpstreamServiceError({
      serviceName: 'PPG Engine',
      errorCode: 'ERR_PPG_ENGINE_UNREACHABLE',
      status: 502,
      detail: 'Microservice PPG tidak dapat dihubungi.',
      cause,
    });
  }

  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new UpstreamServiceError({
      serviceName: 'PPG Engine',
      errorCode: 'ERR_PPG_ENGINE_HTTP_FAILURE',
      detail: `Microservice PPG merespons dengan status HTTP ${response.status}.`,
      cause: payload,
    });
  }
  return payload as Record<string, unknown>;
}

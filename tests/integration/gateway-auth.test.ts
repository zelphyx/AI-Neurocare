import { describe, it, expect, afterEach } from 'vitest';
import { handleGatewayRequest } from '../../src/gateway/server.js';

/**
 * Deployment-hardening checks for the gateway dispatcher:
 * optional API-key auth, health probe openness, RFC 7807 401s.
 */

const VALID_KEY = 'test-deploy-key-001';

const SCREENING_BODY = {
  patientAgeYears: 52,
  gender: 'MALE',
  systolicBloodPressureMmHg: 158,
  isCurrentSmoker: true,
  weightKg: 82,
  heightCm: 170,
};

const originalKeys = process.env['GATEWAY_API_KEYS'];

function withKeys(value: string | undefined): void {
  if (value === undefined) {
    delete process.env['GATEWAY_API_KEYS'];
  } else {
    process.env['GATEWAY_API_KEYS'] = value;
  }
}

afterEach(() => {
  withKeys(originalKeys);
});

describe('Gateway deployment hardening (auth + probes)', () => {
  it('is open when GATEWAY_API_KEYS is unset (dev default)', async () => {
    withKeys(undefined);
    const response = await handleGatewayRequest({
      method: 'POST',
      path: '/api/v1/screening/evaluate',
      body: SCREENING_BODY,
    });
    expect(response.status).toBe(200);
  });

  it('returns 401 RFC 7807 when the key is missing', async () => {
    withKeys(VALID_KEY);
    const response = await handleGatewayRequest({
      method: 'POST',
      path: '/api/v1/screening/evaluate',
      body: SCREENING_BODY,
      headers: {},
    });
    expect(response.status).toBe(401);
    const body = response.body as Record<string, unknown>;
    expect(body['errorCode']).toBe('ERR_API_KEY_MISSING');
    expect(body['type']).toMatch(/^https:\/\/errors\.ai-neurocare\.org\//);
  });

  it('returns 401 when the key is wrong', async () => {
    withKeys(`${VALID_KEY},another-key-002`);
    const response = await handleGatewayRequest({
      method: 'POST',
      path: '/api/v1/screening/evaluate',
      body: SCREENING_BODY,
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(response.status).toBe(401);
    expect((response.body as Record<string, unknown>)['errorCode']).toBe('ERR_API_KEY_INVALID');
  });

  it('accepts any of the configured comma-separated keys', async () => {
    withKeys(`first-key,${VALID_KEY}`);
    const response = await handleGatewayRequest({
      method: 'POST',
      path: '/api/v1/screening/evaluate',
      body: SCREENING_BODY,
      headers: { 'x-api-key': VALID_KEY },
    });
    expect(response.status).toBe(200);
  });

  it('keeps /health open for container probes even when auth is on', async () => {
    withKeys(VALID_KEY);
    const response = await handleGatewayRequest({ method: 'GET', path: '/health', body: null });
    expect(response.status).toBe(200);
  });
});

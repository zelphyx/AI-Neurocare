import crypto from 'node:crypto';
import http from 'node:http';
import { API_ROUTES, type GatewayRequestContext } from './routes.js';
import { toErrorResponse, type GatewayResponse } from './middleware/error-handler.js';
import { DomainError, NotFoundError } from '../shared/errors/domain-error.js';

const INSTANCE_PREFIX = '/api/v1';

/**
 * Optional API-key authentication (deployment hardening).
 *
 * When GATEWAY_API_KEYS is set (comma-separated), every /api/v1/... request
 * must carry a matching X-API-Key header; /health stays open for probes.
 * When unset, the gateway runs open — the local/dev default.
 */
function requireApiKey(ctx: GatewayRequestContext): void {
  const configuredKeys = (process.env['GATEWAY_API_KEYS'] ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (configuredKeys.length === 0) {
    return; // auth disabled
  }

  const headers = ctx.headers ?? {};
  const providedRaw = headers['x-api-key'] ?? headers['X-API-Key'];
  const provided = Array.isArray(providedRaw) ? providedRaw[0] : providedRaw;

  if (typeof provided !== 'string' || provided.length === 0) {
    throw new DomainError({
      title: 'API Key Required',
      status: 401,
      detail: 'Header X-API-Key wajib disertakan pada setiap permintaan API.',
      errorCode: 'ERR_API_KEY_MISSING',
      instance: ctx.path,
    });
  }

  // Constant-time comparison over the configured key set
  const providedBuf = Buffer.from(provided);
  const matched = configuredKeys.some((key) => {
    const keyBuf = Buffer.from(key);
    return (
      keyBuf.length === providedBuf.length && crypto.timingSafeEqual(keyBuf, providedBuf)
    );
  });

  if (!matched) {
    throw new DomainError({
      title: 'Invalid API Key',
      status: 401,
      detail: 'API key tidak valid atau tidak memiliki akses.',
      errorCode: 'ERR_API_KEY_INVALID',
      instance: ctx.path,
    });
  }
}

/**
 * Pure request dispatcher (Checkpoint 24) — framework-agnostic so the whole
 * gateway is testable without opening a socket.
 */
export async function handleGatewayRequest(
  ctx: GatewayRequestContext
): Promise<GatewayResponse> {
  try {
    if (ctx.method === 'GET' && ctx.path === '/health') {
      return { status: 200, body: { status: 'ok', service: 'ai-neurocare-gateway' } };
    }

    requireApiKey(ctx);

    const route = API_ROUTES[ctx.path];
    if (!route || route.method !== ctx.method) {
      throw new NotFoundError({
        resource: 'Rute API',
        identifier: `${ctx.method} ${ctx.path}`,
        instance: ctx.path,
      });
    }

    const result = await route.handler(ctx.body);
    return { status: 200, body: result };
  } catch (error) {
    return toErrorResponse(error, ctx.path);
  }
}

/**
 * CORS allow-list for browser frontends. CORS_ORIGINS is comma-separated;
 * unset or "*" allows any origin (dev default). In production, pin it to the
 * frontend's origin(s).
 */
function corsOriginHeader(requestOrigin: string | undefined): string {
  const configured = (process.env['CORS_ORIGINS'] ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (configured.includes('*')) {
    return '*';
  }
  return requestOrigin && configured.includes(requestOrigin) ? requestOrigin : configured[0] ?? '*';
}

/**
 * node:http server adapter around the pure dispatcher.
 */
export function createGatewayServer(port?: number): http.Server {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const corsHeaders = {
          'Access-Control-Allow-Origin': corsOriginHeader(req.headers.origin),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
          'Access-Control-Max-Age': '86400',
        };

        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders);
          res.end();
          return;
        }

        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body: unknown = null;
        if (rawBody.length > 0) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody; // let the route's Zod validation reject it
          }
        }

        const response = await handleGatewayRequest({
          method: (req.method ?? 'GET') as 'GET' | 'POST',
          path: req.url ?? '/',
          body,
          headers: req.headers,
        });

        res.writeHead(response.status, {
          'Content-Type': 'application/problem+json',
          ...corsHeaders,
        });
        res.end(JSON.stringify(response.body));
      })();
    });
  });

  if (port !== undefined) {
    server.listen(port);
  }
  return server;
}

/** Convenience: generates a request id for tracing (used by future middleware) */
export function newRequestId(): string {
  return crypto.randomUUID();
}

export { INSTANCE_PREFIX };

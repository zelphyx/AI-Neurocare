import crypto from 'node:crypto';
import http from 'node:http';
import { API_ROUTES, type GatewayRequestContext } from './routes.js';
import { toErrorResponse, type GatewayResponse } from './middleware/error-handler.js';
import { NotFoundError } from '../shared/errors/domain-error.js';

const INSTANCE_PREFIX = '/api/v1';

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
 * node:http server adapter around the pure dispatcher.
 */
export function createGatewayServer(port?: number): http.Server {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
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
        });

        res.writeHead(response.status, { 'Content-Type': 'application/problem+json' });
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

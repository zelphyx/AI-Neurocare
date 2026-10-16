import fs from 'node:fs';
import path from 'node:path';
import { createGatewayServer } from './gateway/server.js';

/**
 * Zero-dependency .env loader: fills process.env from ./.env without
 * overriding variables that are already set (real env wins over file).
 */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadDotEnv();

/**
 * Deployment entry point: boots the HTTP gateway.
 * PORT is read first — Cloud Run / App Engine / PaaS platforms inject it.
 * GATEWAY_PORT is the self-hosted override; 8080 is the local default.
 * The PPG microservice runs separately (services/ppg_engine) and is reached
 * through PPG_ENGINE_BASE_URL.
 */
const port = Number.parseInt(
  process.env['PORT'] ?? process.env['GATEWAY_PORT'] ?? '8080',
  10
);

const server = createGatewayServer(port);

server.on('listening', () => {
  // eslint-disable-next-line no-console
  console.log(
    `[ai-neurocare] gateway listening on :${port} ` +
      `(auth ${process.env['GATEWAY_API_KEYS'] ? 'ON' : 'OFF'}, ` +
      `ppg ${process.env['PPG_ENGINE_BASE_URL'] ?? 'not-configured'})`
  );
});

server.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error('[ai-neurocare] gateway failed to start:', error);
  process.exit(1);
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
  // Force-exit if connections do not drain in time
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

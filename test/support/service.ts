import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Core } from '../../src/core/index.js';
import { startService } from '../../src/service.js';

export interface RunningService {
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Boots the real service on an ephemeral port. Both edges under test — the web and the
 * MCP endpoint — are reached the way they are deployed: over HTTP, from the same origin.
 */
export async function startTestService(core: Core): Promise<RunningService> {
  const server: Server = startService(core, 0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

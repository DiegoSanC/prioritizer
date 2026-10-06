import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Core } from '../../src/core/index.js';
import { MCP_PATH } from '../../src/mcp/server.js';
import { startTestService } from './service.js';

export interface McpHarness {
  /** Opens a real MCP client against the running server, carrying the given bearer token. */
  connect(token: string): Promise<Client>;
  close(): Promise<void>;
}

/**
 * Boots the real service on an ephemeral port and talks to its MCP endpoint with a
 * real MCP client over HTTP — the contract tests exercise the edge, never the handler.
 */
export async function startTestMcp(core: Core): Promise<McpHarness> {
  const service = await startTestService(core);
  const url = new URL(MCP_PATH, service.baseUrl);
  const clients: Client[] = [];

  return {
    async connect(token: string): Promise<Client> {
      const client = new Client({ name: 'agente-de-prueba', version: '0.0.0' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        }),
      );
      return client;
    },
    async close(): Promise<void> {
      await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
      await service.close();
    },
  };
}

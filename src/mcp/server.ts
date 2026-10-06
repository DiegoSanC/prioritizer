import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Core, PersonRef } from '../core/index.js';
import { registerTools } from './tools.js';

/** Where the MCP endpoint listens, inside the same service that serves the web. */
export const MCP_PATH = '/mcp';

const SERVER_INFO = { name: 'prioritizer', version: '0.1.0' };

export type McpHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The MCP edge: streamable HTTP with a personal bearer token, one stateless exchange
 * per request. It carries no domain logic — it asks the core who is at the door, and
 * hands the core over to the tools.
 */
export function createMcpHandler(core: Core): McpHandler {
  return (req, res) => {
    void handle(core, req, res);
  };
}

async function handle(core: Core, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    // No server-initiated stream and no session to delete: every exchange is one POST.
    sendError(res, 405, -32000, 'The MCP endpoint only accepts POST.');
    return;
  }

  let actor: PersonRef | null;
  try {
    // The core's door, not a plain lookup: it decides who gets in and what a rejection
    // is worth recording. The edge only maps the verdict onto HTTP.
    actor = core.admitAgent(bearerToken(req));
  } catch {
    // The store is unreachable. A system failure is never reported as a bad token.
    sendError(res, 503, -32000, 'The service cannot handle the request right now.');
    return;
  }
  if (!actor) {
    res.setHeader('www-authenticate', 'Bearer realm="prioritizer"');
    sendError(res, 401, -32001, 'Invalid or revoked token.');
    return;
  }

  const server = new McpServer(SERVER_INFO);
  registerTools(server, { core, actor });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.once('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? '';
}

function sendError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }));
}

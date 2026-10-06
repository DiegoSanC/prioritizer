import { createServer, type Server } from 'node:http';
import type { Core } from './core/index.js';
import { createMcpHandler, MCP_PATH } from './mcp/server.js';
import { createWebApp, type WebHandler } from './web/server.js';

/**
 * One deployable service, as the spec's infrastructure budget demands: the product web
 * and the MCP endpoint share a port, a process and a store.
 */
export function createService(core: Core): WebHandler {
  const web = createWebApp(core);
  const mcp = createMcpHandler(core);

  return (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === MCP_PATH) {
      mcp(req, res);
      return;
    }
    web(req, res);
  };
}

export function startService(core: Core, port: number): Server {
  return createServer(createService(core)).listen(port);
}

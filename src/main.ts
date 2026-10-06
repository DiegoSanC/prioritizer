import { openCore, DEFAULT_DB_PATH } from './core/index.js';
import { MCP_PATH } from './mcp/server.js';
import { startService } from './service.js';

const dbPath = process.env['PRIORITIZER_DB'] ?? DEFAULT_DB_PATH;
const port = Number(process.env['PORT'] ?? 3000);

/**
 * The staleness threshold, so the operator can retune it for a deployment without editing
 * source — the spec's range is 48-72 business hours. Unset means the core's default.
 */
function stalenessThreshold(): number | undefined {
  const raw = process.env['PRIORITIZER_STALENESS_HOURS'];
  if (raw === undefined) return undefined;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    // Refusing to boot beats booting with a threshold nobody meant: a NaN one reads as
    // "stale the moment anything is accepted", and a warning that is always on is one
    // everybody learns to ignore.
    throw new Error(`PRIORITIZER_STALENESS_HOURS is not a valid number of hours: ${raw}`);
  }
  return hours;
}

const threshold = stalenessThreshold();
const core = openCore({
  dbPath,
  config: threshold === undefined ? undefined : { stalenessThresholdBusinessHours: threshold },
});
const server = startService(core, port);

server.once('listening', () => {
  console.log(`Prioritizer listening at http://localhost:${port} (database: ${dbPath})`);
  console.log(`MCP at http://localhost:${port}${MCP_PATH} (authentication: Bearer <personal token>)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      core.close();
      process.exit(0);
    });
  });
}

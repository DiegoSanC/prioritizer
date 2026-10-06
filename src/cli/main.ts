import { openCore, DEFAULT_DB_PATH } from '../core/index.js';
import { runCli } from './commands.js';

const dbPath = process.env['PRIORITIZER_DB'] ?? DEFAULT_DB_PATH;
const core = openCore({ dbPath });

try {
  // Only the ingest is asynchronous; awaiting a plain `void` costs nothing and keeps the
  // refusal of a failed pass inside the same catch as every other refusal.
  await runCli(core, process.argv.slice(2), (line) => console.log(line));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  core.close();
}

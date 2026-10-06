import type DatabaseType from 'better-sqlite3';
import type { CoreConfig } from './config.js';

/** Time is injected so the staleness rule and every timestamp are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Everything the core modules need. There is no other ambient state. */
export interface CoreContext {
  db: DatabaseType.Database;
  clock: Clock;
  config: CoreConfig;
}

export function nowIso(ctx: CoreContext): string {
  return ctx.clock.now().toISOString();
}

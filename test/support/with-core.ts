import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { openCore, type Core } from '../../src/core/index.js';
import type { Clock } from '../../src/core/context.js';
import type { CoreConfig } from '../../src/core/config.js';

/** A clock the tests drive by hand, so time-dependent rules are deterministic. */
export class TestClock implements Clock {
  private current: Date;

  constructor(start: string | Date) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: string | Date): void {
    this.current = new Date(instant);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }
}

export interface CoreHarness {
  core: Core;
  clock: TestClock;
  dbPath: string;
  /** Closes and reopens the core against the same file, to prove state is really persisted. */
  reopen(): void;
}

/**
 * Boots a Core backed by a real SQLite file in a temp dir — the seam under test is
 * the Core API, and the store is real (never mocked), per the spec's testing decisions.
 */
export function useCore(options: { start?: string; config?: Partial<CoreConfig> } = {}): CoreHarness {
  const harness = {} as CoreHarness;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prioritizer-test-'));
    harness.dbPath = join(dir, 'prioritizer.sqlite');
    harness.clock = new TestClock(options.start ?? '2026-08-11T09:00:00.000Z');
    harness.core = openCore({ dbPath: harness.dbPath, clock: harness.clock, config: options.config });
    harness.reopen = () => {
      harness.core.close();
      harness.core = openCore({ dbPath: harness.dbPath, clock: harness.clock, config: options.config });
    };
  });

  afterEach(() => {
    harness.core.close();
    rmSync(dir, { recursive: true, force: true });
  });

  return harness;
}

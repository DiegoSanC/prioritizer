import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readResponse,
  type FirefliesTranscriptsResponse,
  type ResponseReading,
} from '../../src/ingest/fireflies.js';

/**
 * Loader for the ingest fixtures produced by the ingest spike.
 *
 * The schema types and the response reader live in `src/ingest/fireflies.ts`, where the
 * adapter uses them: a second copy here could drift, and the first thing it would drift on
 * is what counts as a hole. The fixtures themselves are synthetic and say so in their own
 * contents — see test/fixtures/ingest/README.md before trusting any of it.
 */

export type {
  FirefliesError,
  FirefliesSummary,
  FirefliesTranscript,
  FirefliesTranscriptsResponse,
} from '../../src/ingest/fireflies.js';

const INGEST_FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'ingest',
);

/**
 * A fixture file. The `_` fields are the synthetic-payload marking and the case notes; only
 * `response` imitates the API. Reading `response` alone is the mistake this envelope prevents.
 */
export interface IngestFixture {
  _synthetic: true;
  _notice: string;
  _case: string;
  _query: string;
  _expected: string;
  _notes: string[];
  response: FirefliesTranscriptsResponse;
}

/** Fixture file names, sorted, so a test can sweep every recorded case. */
export function ingestFixtureNames(): string[] {
  return readdirSync(INGEST_FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** Reads one fixture by file name, e.g. `01-typical-meeting.json`. */
export function loadIngestFixture(name: string): IngestFixture {
  return JSON.parse(readFileSync(join(INGEST_FIXTURES_DIR, name), 'utf8')) as IngestFixture;
}

/**
 * Reads a fixture's response exactly as a pass would, holes and errors in plain sight.
 * A helper that quietly filtered the nulls away would turn a broken pass into a pass with
 * fewer meetings, which is the failure the spike's D-1 warns against.
 */
export function readFixture(fixture: IngestFixture): ResponseReading {
  return readResponse(fixture.response);
}

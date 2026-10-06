import { describe, expect, it } from 'vitest';
import { ingestFixtureNames, loadIngestFixture, readFixture } from '../support/ingest-fixtures.js';

/**
 * Guard over the spike fixtures. It asserts nothing about the adapter — that is what
 * `action-extraction.test.ts` and `run.test.ts` are for — but it keeps the fixtures
 * loadable and, above all, keeps them honestly labelled: the day somebody drops in a payload
 * without the synthetic warning, this fails.
 */
describe('the spike ingest fixtures', () => {
  const names = ingestFixtureNames();

  const PRIMERA_PASADA = '06-idempotency-first-run.json';
  const SEGUNDA_PASADA = '07-idempotency-second-run.json';
  const RESPUESTA_PARCIAL = '08-partial-response-with-errors.json';
  const FALLO_DURO = '09-rate-limit-error.json';
  const PASADA_VACIA = '10-empty-run.json';
  /** The meeting whose summary is regenerated between the two passes. */
  const REUNION_REGENERADA = 'Nz9gCe2JhV';
  /** The meeting that arrives byte for byte the same in both passes. */
  const REUNION_IDENTICA = 'Oa2hDf5KiW';
  /** The meeting that only the second pass brings. */
  const REUNION_NUEVA = 'Pb5iEg8LjX';

  const transcriptsOf = (name: string) => readFixture(loadIngestFixture(name)).transcripts;
  const idsOf = (name: string) => transcriptsOf(name).map((transcript) => transcript.id);

  it('there are recorded fixtures', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)('%s declares itself synthetic in its own content', (name) => {
    const fixture = loadIngestFixture(name);

    expect(fixture._synthetic).toBe(true);
    expect(fixture._notice).toContain('SYNTHETIC PAYLOAD');
    expect(fixture._notice).toContain('Not a real capture');
  });

  it.each(names)('%s documents the case, the query and what the adapter is expected to do', (name) => {
    const fixture = loadIngestFixture(name);

    expect(fixture._case.length).toBeGreaterThan(0);
    expect(fixture._query.length).toBeGreaterThan(0);
    expect(fixture._expected.length).toBeGreaterThan(0);
    expect(fixture._notes.length).toBeGreaterThan(0);
  });

  it.each(names)('%s gives every meeting a source id, which is the idempotency key', (name) => {
    for (const transcript of transcriptsOf(name)) {
      expect(transcript.id).toMatch(/\S/);
    }
  });

  it('the idempotency pair shares meetings between the two passes', () => {
    const primera = new Set(idsOf(PRIMERA_PASADA));
    const segunda = idsOf(SEGUNDA_PASADA);

    expect(segunda.filter((id) => primera.has(id))).toEqual([
      REUNION_REGENERADA,
      REUNION_IDENTICA,
    ]);
    expect(segunda.filter((id) => !primera.has(id))).toEqual([REUNION_NUEVA]);
  });

  it('the first pass repeats a meeting within the same response', () => {
    const ids = idsOf(PRIMERA_PASADA);

    expect(ids.length).toBeGreaterThan(new Set(ids).size);
  });

  it('the regenerated summary changes content without changing id', () => {
    const enPasada = (name: string) =>
      transcriptsOf(name).find((transcript) => transcript.id === REUNION_REGENERADA);

    expect(enPasada(PRIMERA_PASADA)?.summary?.action_items).not.toBe(
      enPasada(SEGUNDA_PASADA)?.summary?.action_items,
    );
  });

  it('the partial response keeps the hole and the error in sight', () => {
    const reading = readFixture(loadIngestFixture(RESPUESTA_PARCIAL));

    expect(reading.transcripts.length).toBeGreaterThan(0);
    expect(reading.holes).toBe(1);
    expect(reading.errors.map((error) => error.code)).toEqual(['require_elevated_privilege']);
  });

  it('the legitimate empty and the hard failure cannot be confused', () => {
    const vacia = readFixture(loadIngestFixture(PASADA_VACIA));
    const fallo = readFixture(loadIngestFixture(FALLO_DURO));

    expect(vacia.transcripts).toEqual([]);
    expect(vacia.holes).toBe(0);
    expect(vacia.errors).toEqual([]);
    expect(fallo.transcripts).toEqual([]);
    expect(fallo.errors.map((error) => error.code)).toEqual(['too_many_requests']);
  });
});

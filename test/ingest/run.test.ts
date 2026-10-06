import { describe, expect, it } from 'vitest';
import { IngestFailure, isCleanPass, runIngest } from '../../src/ingest/index.js';
import type { FirefliesTransport } from '../../src/ingest/fireflies.js';
import { UNCLASSIFIED_INITIATIVE } from '../../src/core/index.js';
import { useCore } from '../support/with-core.js';
import { loadIngestFixture } from '../support/ingest-fixtures.js';

/**
 * A whole ingest pass against the recorded fixtures. No network is touched: the transport
 * is injected, and nobody has ever run any of this against the real Fireflies API.
 */
describe('an ingest pass against the spike fixtures', () => {
  const h = useCore();

  /** Serves one recorded response per page, in the order given. */
  const sirviendo = (...fixtures: string[]): FirefliesTransport => {
    let page = 0;
    return async () => {
      const name = fixtures[Math.min(page, fixtures.length - 1)] ?? '';
      page += 1;
      return loadIngestFixture(name).response;
    };
  };

  const ingesta = () => h.core.addPerson({ name: 'Ingesta Fireflies' }).id;

  const pasada = (transport: FirefliesTransport, actor: string, pageSize = 50) =>
    runIngest(h.core, {
      actor,
      transport,
      fromDate: '2026-08-01',
      toDate: '2026-08-10',
      pageSize,
    });

  it('a window with no meetings is a correct empty pass, not a failure', async () => {
    const pass = await pasada(sirviendo('10-empty-run.json'), ingesta());

    expect(pass.meetings).toBe(0);
    expect(pass.outcome.registered).toEqual([]);
    expect(pass.errors).toEqual([]);
    expect(pass.holes).toBe(0);
    expect(h.core.listActions()).toEqual([]);
  });

  it('a rate limit fails the whole pass instead of letting it look empty', async () => {
    const actor = ingesta();

    await expect(pasada(sirviendo('09-rate-limit-error.json'), actor)).rejects.toThrow(
      IngestFailure,
    );
    await expect(pasada(sirviendo('09-rate-limit-error.json'), actor)).rejects.toThrow(
      /too_many_requests/,
    );
    expect(h.core.listActions()).toEqual([]);
  });

  it('a partial response ingests what arrived and leaves the hole and the error in sight', async () => {
    const pass = await pasada(sirviendo('08-partial-response-with-errors.json'), ingesta());

    expect(pass.outcome.registered.map((accion) => accion.text)).toEqual([
      'Actualizar el tablero de la iniciativa',
    ]);
    expect(pass.holes).toBe(1);
    expect(pass.errors.map((error) => error.code)).toEqual(['require_elevated_privilege']);
  });

  it('stores each action lineage and tolerates a missing title and date', async () => {
    const pass = await pasada(sirviendo('04-missing-optional-fields.json'), ingesta());

    expect(pass.meetings).toBe(4);
    expect(pass.outcome.registered.map((accion) => accion.origin)).toEqual([
      {
        kind: 'ingested',
        source: {
          tool: 'fireflies',
          sourceId: 'Iu4bXz7EcQ',
          meetingDate: '2026-08-06T17:00:00.000Z',
          meetingTitle: null,
        },
      },
      {
        kind: 'ingested',
        source: {
          tool: 'fireflies',
          sourceId: 'Jv7cYa0FdR',
          meetingDate: null,
          meetingTitle: 'Reunión sin fecha resoluble',
        },
      },
    ]);
  });

  it('does not repeat a meeting that arrives twice within the same response', async () => {
    const pass = await pasada(sirviendo('06-idempotency-first-run.json'), ingesta());

    // Three transcripts in the response, two distinct meetings: skip-based pagination
    // repeats material and counting the same meeting twice would inflate the inbox.
    expect(pass.meetings).toBe(2);
    expect(pass.outcome.registered).toHaveLength(3);
    expect(pass.outcome.alreadySeen).toBe(0);
  });

  it('a second pass over an overlapping window does not duplicate what was seen', async () => {
    const actor = ingesta();
    await pasada(sirviendo('06-idempotency-first-run.json'), actor);

    const segunda = await pasada(sirviendo('07-idempotency-second-run.json'), actor);

    // The identical meeting contributes nothing; the new one contributes its action; and
    // the one with the regenerated summary contributes both new versions, because the key
    // is meeting + text.
    expect(segunda.outcome.alreadySeen).toBe(1);
    expect(segunda.outcome.registered.map((accion) => accion.text)).toEqual([
      'Cerrar el alcance del sprint con los stakeholders antes del viernes',
      'Avisar a dirección del cambio de alcance',
      'Repasar el inbox de triage antes de consolidar',
    ]);
    // What the first pass registered is still there: nothing gets trampled and nothing gets lost.
    expect(h.core.listActions().map((accion) => accion.text)).toContain(
      'Cerrar el alcance del sprint con los stakeholders',
    );
    expect(h.core.listActions()).toHaveLength(6);
  });

  it('returns the lines it could not read, with the meeting they came from', async () => {
    const pass = await pasada(sirviendo('03-useless-texts.json'), ingesta());

    expect(pass.unread).toEqual([
      { sourceId: 'Fr5yUw9BzI', line: '-' },
      { sourceId: 'Fr5yUw9BzI', line: '(31:12)' },
    ]);
  });

  it('leaves everything ingested in the inbox, unclassified and unassigned', async () => {
    const pass = await pasada(sirviendo('01-typical-meeting.json'), ingesta());

    expect(pass.outcome.unresolvedAssignee).toBe(4);
    expect(h.core.listActions({ status: 'registered' })).toHaveLength(4);
    expect(
      h.core.listActions().every((accion) => accion.initiative === UNCLASSIFIED_INITIATIVE),
    ).toBe(true);
    expect(h.core.listActions().every((accion) => accion.assignee === null)).toBe(true);
  });

  it('keeps asking for pages while they come full and stops at a short one', async () => {
    let peticiones = 0;
    // Each page serves a different fixture, so the third is only reached if the pass
    // truly advances through the window instead of repeating the first one.
    const paginas = [
      '01-typical-meeting.json',
      '04-missing-optional-fields.json',
      '10-empty-run.json',
    ];
    const transport: FirefliesTransport = async (query) => {
      peticiones += 1;
      return loadIngestFixture(paginas[query.skip] ?? '10-empty-run.json').response;
    };

    // With one-meeting pages: the first comes full, the second brings four which no longer
    // fit in the page, and the third is empty and stops the loop.
    const pass = await pasada(transport, ingesta(), 1);

    expect(peticiones).toBe(3);
    expect(pass.meetings).toBe(5);
    expect(pass.truncated).toBe(false);
    expect(isCleanPass(pass)).toBe(true);
  });

  it('says so when it stops partway through the window instead of calling it read', async () => {
    // A window that never ends: nobody ever returns a short page.
    const pass = await pasada(sirviendo('01-typical-meeting.json'), ingesta(), 1);

    // Having stopped reading is not having read little: if this passed as clean, a
    // truncated window would be identical to a week without meetings.
    expect(pass.truncated).toBe(true);
    expect(isCleanPass(pass)).toBe(false);
  });

  it('says so when the source goes quiet mid-pagination', async () => {
    const transport: FirefliesTransport = async (query) =>
      loadIngestFixture(
        query.skip === 0 ? '01-typical-meeting.json' : '09-rate-limit-error.json',
      ).response;

    const pass = await pasada(transport, ingesta(), 1);

    // What the first page carried got in; the rest of the window went unread, and it says so.
    expect(pass.outcome.registered).toHaveLength(4);
    expect(pass.truncated).toBe(true);
    expect(pass.errors.map((error) => error.code)).toEqual(['too_many_requests']);
    expect(isCleanPass(pass)).toBe(false);
  });

  it('ingests actions with an unresolvable assignee instead of blocking them', async () => {
    const pass = await pasada(sirviendo('02-problematic-assignees.json'), ingesta());

    // With no possible alias — «Speaker 2», an email, a collective, someone external — none
    // gets discarded: they all enter as registered and unassigned.
    expect(pass.outcome.registered).toHaveLength(7);
    expect(h.core.listActions({ status: 'registered' })).toHaveLength(7);
    expect(h.core.listActions().every((accion) => accion.assignee === null)).toBe(true);
    // Only the item the meeting attributed to nobody stops counting as unresolvable.
    expect(pass.outcome.unresolvedAssignee).toBe(6);
  });

  it('with aliases, each action reaches the inbox with its rightful assignee', async () => {
    const actor = ingesta();
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    const lucia = h.core.addPerson({ name: 'Lucía Ortega' });
    // The same person under both names the meeting gives them: the email Fireflies
    // labelled one speaker with and the first name it labelled the other with.
    h.core.addAlias({ person: juan.id, alias: 'juan.perez@ejemplo.es' });
    h.core.addAlias({ person: lucia.id, alias: 'Lucía' });

    const pass = await pasada(sirviendo('02-problematic-assignees.json'), actor);

    expect(
      pass.outcome.registered.map((accion) => [accion.text, accion.assignee?.name ?? null]),
    ).toEqual([
      ['Enviar el acta a todos los asistentes', null],
      ['Preparar el presupuesto de la integración', null],
      ['Confirmar con su equipo legal la cláusula de datos', null],
      ['Dimensionar el entorno de preproducción', null],
      ['Partir la historia de migración en dos', 'Juan Pérez'],
      ['Revisar los criterios de aceptación del refinamiento', 'Lucía Ortega'],
      ['Leer el documento de arquitectura antes del lunes', null],
    ]);
    // What remains unresolved are the four ways the attribution is not a person of the
    // system: an unidentified speaker, someone external and two collectives.
    expect(pass.outcome.unresolvedNames).toEqual([
      'Speaker 2',
      'Roberto Calvo',
      'Equipo de Plataforma',
      'Todos',
    ]);
    expect(pass.outcome.unresolvedAssignee).toBe(4);
  });

  it('an alias registered later does not reopen what was already ingested', async () => {
    const actor = ingesta();
    await pasada(sirviendo('02-problematic-assignees.json'), actor);

    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    h.core.addAlias({ person: juan.id, alias: 'juan.perez@ejemplo.es' });
    const segunda = await pasada(sirviendo('02-problematic-assignees.json'), actor);

    // The meeting has not changed, so neither has the idempotency key: nothing new gets
    // in and the first pass's action remains unassigned, for triage. Bringing the alias
    // up to date does not remake the past; it only changes what the ingest captures from
    // now on, which is the only honest thing once triage may already have decided.
    expect(segunda.outcome.registered).toEqual([]);
    expect(segunda.outcome.alreadySeen).toBe(7);
    expect(h.core.listActions().every((accion) => accion.assignee === null)).toBe(true);
  });
});

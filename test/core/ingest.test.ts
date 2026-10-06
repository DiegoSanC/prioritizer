import { describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';
import { UNCLASSIFIED_INITIATIVE, type IngestedItem } from '../../src/core/index.js';

/**
 * The ingest as the core sees it: items already normalized, with no idea which tool they
 * came from beyond the lineage they carry. Everything Fireflies-shaped is tested against
 * the recorded fixtures in test/ingest/, which is the other half of the story.
 */
describe('action ingest in the core', () => {
  const h = useCore();

  const reunion = (sourceId: string, title: string | null = 'Semanal de Checkout') => ({
    tool: 'fireflies',
    sourceId,
    meetingDate: '2026-07-27T09:00:00.000Z',
    meetingTitle: title,
  });

  const item = (text: string, sourceId = 'ASxwZxCstx'): IngestedItem => ({
    text,
    attributedTo: null,
    source: reunion(sourceId),
  });

  it('registers each ingested action with its meeting lineage', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Cerrar el contrato del endpoint de pagos')],
    });

    expect(outcome.registered).toHaveLength(1);
    const [accion] = h.core.listActions();
    expect(accion).toMatchObject({
      text: 'Cerrar el contrato del endpoint de pagos',
      status: 'registered',
      origin: {
        kind: 'ingested',
        source: {
          tool: 'fireflies',
          sourceId: 'ASxwZxCstx',
          meetingDate: '2026-07-27T09:00:00.000Z',
          meetingTitle: 'Semanal de Checkout',
        },
      },
    });
  });

  it('duplicates nothing when the pass repeats with the same items', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const items = [
      item('Cerrar el alcance del sprint con los stakeholders'),
      item('Estimar la historia de conciliación'),
    ];

    h.core.ingestActions({ actor: ingesta.id, items });
    const segunda = h.core.ingestActions({ actor: ingesta.id, items });

    expect(segunda.registered).toEqual([]);
    expect(segunda.alreadySeen).toBe(2);
    expect(h.core.listActions()).toHaveLength(2);
  });

  it('recognizes the repeated item within the same pass', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const repetido = item('Escribir el postmortem de la caída del martes');

    const outcome = h.core.ingestActions({ actor: ingesta.id, items: [repetido, repetido] });

    expect(outcome.registered).toHaveLength(1);
    expect(outcome.alreadySeen).toBe(1);
  });

  it('idempotency survives a service restart', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const items = [item('Repasar el inbox de triage antes de consolidar')];
    h.core.ingestActions({ actor: ingesta.id, items });

    h.reopen();
    const segunda = h.core.ingestActions({ actor: ingesta.id, items });

    expect(segunda.alreadySeen).toBe(1);
    expect(h.core.listActions()).toHaveLength(1);
  });

  it('ignores whitespace and case when deciding whether it saw an item', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    h.core.ingestActions({ actor: ingesta.id, items: [item('Preparar la demo de dirección')] });

    const segunda = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('  preparar   la\nDEMO de dirección  ')],
    });

    expect(segunda.alreadySeen).toBe(1);
    expect(h.core.listActions()).toHaveLength(1);
  });

  it('a reworded item enters as a new action and both stay visible in the inbox', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Cerrar el alcance del sprint con los stakeholders')],
    });

    // The same meeting, its summary regenerated: the text changes and the id does not.
    const segunda = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Cerrar el alcance del sprint con los stakeholders antes del viernes')],
    });

    expect(segunda.registered).toHaveLength(1);
    expect(segunda.alreadySeen).toBe(0);
    // Err toward the visible duplicate: triage has the `duplicate` outcome to resolve
    // it by hand, and neither of the two versions has been lost along the way.
    expect(h.core.listActions({ status: 'registered' }).map((a) => a.text)).toEqual([
      'Cerrar el alcance del sprint con los stakeholders',
      'Cerrar el alcance del sprint con los stakeholders antes del viernes',
    ]);
  });

  it('the same text in two different meetings is two different actions', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const texto = 'Leer el documento de arquitectura antes del lunes';

    h.core.ingestActions({ actor: ingesta.id, items: [item(texto, 'Nz9gCe2JhV')] });
    const otra = h.core.ingestActions({ actor: ingesta.id, items: [item(texto, 'Oa2hDf5KiW')] });

    expect(otra.registered).toHaveLength(1);
    expect(h.core.listActions()).toHaveLength(2);
  });

  it('does not confuse a manual action with an ingested one even when they say the same', () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const texto = 'Actualizar el tablero de la iniciativa';
    h.core.registerAction({ text: texto, initiative: 'Checkout', actor: marta.id });
    h.core.registerAction({ text: texto, initiative: 'Checkout', actor: marta.id });

    const outcome = h.core.ingestActions({ actor: ingesta.id, items: [item(texto)] });

    expect(outcome.registered).toHaveLength(1);
    expect(h.core.listActions()).toHaveLength(3);
  });

  it('leaves ingested actions unclassified and unassigned, for triage to correct', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    h.core.addPerson({ name: 'Marta Ruiz' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [
        { ...item('Revisar la propuesta de precios antes del jueves'), attributedTo: 'Marta Ruiz' },
        item('Dimensionar el entorno de preproducción'),
      ],
    });

    const [conNombre, sinNombre] = outcome.registered;
    expect(conNombre?.initiative).toBe(UNCLASSIFIED_INITIATIVE);
    // Not even with a person of the system who bears the same name: matching names is
    // exactly what the alias table is there to solve, and guessing here would assign
    // someone's work to a namesake.
    expect(conNombre?.assignee).toBeNull();
    expect(sinNombre?.assignee).toBeNull();
    // A name that could not be resolved is counted; one that never came is not.
    expect(outcome.unresolvedAssignee).toBe(1);
  });

  it('ingested actions go through triage like manual ones', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'triager');
    const [accion] = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Migrar el job nocturno de conciliación al nuevo runner')],
    }).registered;

    h.core.acceptAction(accion?.id ?? '', {
      actor: marta.id,
      initiative: 'Plataforma',
      assignee: marta.id,
    });

    expect(h.core.getAction(accion?.id ?? '')).toMatchObject({
      status: 'accepted',
      initiative: 'Plataforma',
      assignee: { id: marta.id, name: 'Marta' },
      // Correcting the initiative and the assignee does not erase where the action came from.
      origin: { kind: 'ingested', source: { sourceId: 'ASxwZxCstx' } },
    });
  });

  it('signs the ingest with whoever runs it, and it shows in the trace', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const [accion] = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Documentar el procedimiento de despliegue')],
    }).registered;

    expect(h.core.getAction(accion?.id ?? '')?.transitions).toEqual([
      { to: 'registered', from: null, at: '2026-08-11T09:00:00.000Z', by: ingesta.id, note: null },
    ]);
  });

  it('refuses the ingest when the signer is not a person of the system', () => {
    expect(() =>
      h.core.ingestActions({ actor: 'nadie', items: [item('Da igual')] }),
    ).toThrow(/ingest signing person/i);
  });

  it('refuses an item without a source id, because without a key there is no idempotency', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });

    expect(() =>
      h.core.ingestActions({
        actor: ingesta.id,
        items: [{ ...item('Sin reunión que la respalde'), source: { ...reunion(''), sourceId: '' } }],
      }),
    ).toThrow(/source id/i);
    expect(h.core.listActions()).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';
import type { ActionChange } from '../../src/core/index.js';

describe('an action trajectory', () => {
  const h = useCore();
  let marta: string;
  let juan: string;

  beforeEach(() => {
    marta = h.core.addPerson({ name: 'Marta' }).id;
    juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(marta, 'triager');
    h.core.grantRole(marta, 'consolidator');
  });

  /** Registers and accepts an action, leaving it ready to enter the order. */
  const accepted = (text: string, initiative = 'Checkout'): string => {
    const action = h.core.registerAction({ text, initiative, assignee: juan, actor: marta });
    h.core.acceptAction(action.id, { actor: marta });
    return action.id;
  };

  /** How a change reads: what happened, between which positions, in which version and why. */
  const readable = (change: ActionChange) => [
    change.kind,
    change.before?.position ?? null,
    change.after?.position ?? null,
    change.signature.version,
    change.signature.reason,
  ];

  it('the entry carries version, date, who consolidated and that consolidation reason', () => {
    const pagos = accepted('Migrar pagos');
    h.core.setDraftOrder([pagos]);
    h.clock.set('2026-08-10T09:00:00.000Z');
    h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

    expect(h.core.changesFor(pagos)).toEqual([
      {
        actionId: pagos,
        kind: 'enters',
        before: null,
        after: {
          position: 1,
          actionId: pagos,
          text: 'Migrar pagos',
          initiative: 'Checkout',
          assignee: { id: juan, name: 'Juan' },
        },
        namingChanged: false,
        signature: {
          version: 1,
          at: '2026-08-10T09:00:00.000Z',
          by: { id: marta, name: 'Marta' },
          reason: 'Pagos primero',
        },
        // The first consolidation succeeds none: there is nothing to compare it against.
        previous: null,
      },
    ]);
  });

  it('walks entries, exits and repositions, newest first', () => {
    const pagos = accepted('Migrar pagos');
    const alta = accepted('Rediseñar el alta');
    const informes = accepted('Informes de uso');

    h.core.setDraftOrder([pagos, alta, informes]);
    h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

    h.core.setDraftOrder([alta, pagos, informes]);
    h.core.consolidate({ actor: marta, reason: 'El alta se adelanta' });

    h.core.removeFromDraft(pagos, marta);
    h.core.consolidate({ actor: marta, reason: 'Pagos se saca hasta tener presupuesto' });

    h.core.placeInDraft(pagos);
    h.core.consolidate({ actor: marta, reason: 'Vuelve pagos, con presupuesto' });

    h.core.setDraftOrder([pagos, alta, informes]);
    h.core.consolidate({ actor: marta, reason: 'Pagos vuelve a ser lo primero' });

    expect(h.core.changesFor(pagos).map(readable)).toEqual([
      ['rises', 3, 1, 5, 'Pagos vuelve a ser lo primero'],
      ['enters', null, 3, 4, 'Vuelve pagos, con presupuesto'],
      ['leaves', 2, null, 3, 'Pagos se saca hasta tener presupuesto'],
      ['falls', 1, 2, 2, 'El alta se adelanta'],
      ['enters', null, 1, 1, 'Orden inicial'],
    ]);
  });

  it('a consolidation that leaves it where it was is not a change of its own', () => {
    const pagos = accepted('Migrar pagos');
    const alta = accepted('Rediseñar el alta');
    h.core.setDraftOrder([pagos, alta]);
    h.core.consolidate({ actor: marta, reason: 'Orden inicial' });
    h.core.consolidate({ actor: marta, reason: 'Se ratifica el orden' });
    h.core.setDraftOrder([alta, pagos]);
    h.core.consolidate({ actor: marta, reason: 'El alta se adelanta' });

    // v2 signed it just like v1 did: in this action's trajectory, nothing happened.
    expect(h.core.changesFor(pagos).map(readable)).toEqual([
      ['falls', 1, 2, 3, 'El alta se adelanta'],
      ['enters', null, 1, 1, 'Orden inicial'],
    ]);
  });

  it('being frozen again under another initiative in the same place is a change of its own', () => {
    const pagos = accepted('Migrar pagos', 'Checkout');
    const alta = accepted('Rediseñar el alta', 'Altas');
    h.core.setDraftOrder([pagos, alta]);
    h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

    // Pagos leaves the order, gets reassigned to another initiative and returns to the same spot.
    h.core.removeFromDraft(pagos, marta);
    h.core.deferAction(pagos, { actor: marta });
    h.core.reactivateAction(pagos, { actor: marta });
    h.core.acceptAction(pagos, { actor: marta, initiative: 'Plataforma', assignee: marta });
    h.core.setDraftOrder([pagos, alta]);
    h.core.consolidate({ actor: marta, reason: 'Pagos pasa a Plataforma' });

    const [recongelada] = h.core.changesFor(pagos);

    expect(readable(recongelada!)).toEqual(['stays', 1, 1, 2, 'Pagos pasa a Plataforma']);
    expect(recongelada?.namingChanged).toBe(true);
    expect([recongelada?.before?.initiative, recongelada?.after?.initiative]).toEqual([
      'Checkout',
      'Plataforma',
    ]);
    expect([recongelada?.before?.assignee?.name, recongelada?.after?.assignee?.name]).toEqual([
      'Juan',
      'Marta',
    ]);
  });

  it('reads each move against the immediately previous consolidation', () => {
    const pagos = accepted('Migrar pagos');
    const alta = accepted('Rediseñar el alta');
    h.core.setDraftOrder([pagos, alta]);
    h.core.consolidate({ actor: marta, reason: 'Orden inicial' });
    h.core.removeFromDraft(pagos, marta);
    h.core.consolidate({ actor: marta, reason: 'Pagos se saca' });
    h.core.consolidate({ actor: marta, reason: 'Se ratifica lo que quedaba' });
    h.core.placeInDraft(pagos);
    h.core.consolidate({ actor: marta, reason: 'Vuelve pagos' });

    // The return is compared against v3, where it was absent, not against v1, where it was not.
    expect(
      h.core.changesFor(pagos).map((change) => [change.signature.version, change.previous]),
    ).toEqual([
      [4, 3],
      [2, 1],
      [1, null],
    ]);
  });

  it('what completes shows as an exit, without vanishing from the snapshot that named it', () => {
    const pagos = accepted('Migrar pagos');
    const alta = accepted('Rediseñar el alta');
    h.core.setDraftOrder([pagos, alta]);
    h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

    h.core.completeAction(pagos, { actor: juan, comment: 'Desplegado' });
    h.core.consolidate({ actor: marta, reason: 'Pagos ya está hecho' });

    expect(h.core.changesFor(pagos).map(readable)).toEqual([
      ['leaves', 1, null, 2, 'Pagos ya está hecho'],
      ['enters', null, 1, 1, 'Orden inicial'],
    ]);
    expect(h.core.getConsolidation(1)?.entries.map((entry) => entry.text)).toEqual([
      'Migrar pagos',
      'Rediseñar el alta',
    ]);
  });

  it('an action nobody has consolidated yet has never moved', () => {
    const pagos = accepted('Migrar pagos');
    h.core.setDraftOrder([pagos]);

    expect(h.core.changesFor(pagos)).toEqual([]);
  });

  it('does not confuse never having moved with not existing', () => {
    expect(() => h.core.changesFor('accion-inventada')).toThrow(/No such action/);
  });

  it('survives reopening the store: the trajectory is the snapshots themselves', () => {
    const pagos = accepted('Migrar pagos');
    h.core.setDraftOrder([pagos]);
    h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

    h.reopen();

    expect(h.core.changesFor(pagos).map(readable)).toEqual([
      ['enters', null, 1, 1, 'Pagos primero'],
    ]);
  });
});

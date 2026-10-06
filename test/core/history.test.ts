import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('the consolidation history', () => {
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

  describe('as of a date', () => {
    it('returns the hierarchy in force on that date, not the latest', () => {
      const primera = accepted('Migrar pagos');
      const segunda = accepted('Rediseñar el alta');
      h.core.setDraftOrder([primera, segunda]);
      h.clock.set('2026-08-10T09:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

      h.core.setDraftOrder([segunda, primera]);
      h.clock.set('2026-08-17T09:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'El alta se adelanta' });

      const vigente = h.core.consolidationAt('2026-08-12');

      expect(vigente?.version).toBe(1);
      expect(vigente?.reason).toBe('Pagos primero');
      expect(vigente?.entries.map((entry) => entry.text)).toEqual(['Migrar pagos', 'Rediseñar el alta']);
    });

    it('no hierarchy was in force before the first consolidation', () => {
      h.core.setDraftOrder([accepted('Migrar pagos')]);
      h.clock.set('2026-08-10T09:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

      expect(h.core.consolidationAt('2026-08-09')).toBeNull();
    });

    it('counts a same-day consolidation, even one signed that very morning', () => {
      h.core.setDraftOrder([accepted('Migrar pagos')]);
      h.clock.set('2026-08-10T09:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

      expect(h.core.consolidationAt('2026-08-10')?.version).toBe(1);
    });

    it('accepts an exact instant to tell two same-day consolidations apart', () => {
      const primera = accepted('Migrar pagos');
      const segunda = accepted('Rediseñar el alta');
      h.core.setDraftOrder([primera, segunda]);
      h.clock.set('2026-08-10T09:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

      h.core.setDraftOrder([segunda, primera]);
      h.clock.set('2026-08-10T17:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'El alta se adelanta' });

      expect(h.core.consolidationAt('2026-08-10T12:00:00.000Z')?.version).toBe(1);
      expect(h.core.consolidationAt('2026-08-10')?.version).toBe(2);
    });

    it('refuses a date it cannot understand', () => {
      expect(() => h.core.consolidationAt('el martes pasado')).toThrow(/date/i);
    });

    it('returns the whole snapshot: it still names what completed later', () => {
      const primera = accepted('Migrar pagos');
      const segunda = accepted('Rediseñar el alta');
      h.core.setDraftOrder([primera, segunda]);
      h.clock.set('2026-08-10T09:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

      h.clock.set('2026-08-11T09:00:00.000Z');
      h.core.completeAction(primera, { actor: juan, comment: 'Desplegado' });

      // The hierarchy in force as of date X is the one that was signed, not the one still alive today.
      const vigente = h.core.consolidationAt('2026-08-10');
      expect(vigente?.entries.map((entry) => [entry.position, entry.text])).toEqual([
        [1, 'Migrar pagos'],
        [2, 'Rediseñar el alta'],
      ]);
      // What does drop out of the active hierarchy is the agent's reading.
      expect(h.core.prioritiesFor(juan).ordered.map((entry) => entry.text)).toEqual([
        'Rediseñar el alta',
      ]);
    });

    it('survives reopening the store: the history is the snapshots themselves', () => {
      h.core.setDraftOrder([accepted('Migrar pagos')]);
      h.clock.set('2026-08-10T09:00:00.000Z');
      h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

      h.reopen();

      expect(h.core.consolidationAt('2026-08-10')?.reason).toBe('Pagos primero');
    });
  });

  describe('what changed between two consolidations', () => {
    /** How a change reads: what happened to which action and between which positions. */
    const readable = (change: {
      kind: string;
      before: { position: number; text: string } | null;
      after: { position: number; text: string } | null;
    }) => [
      change.kind,
      (change.after ?? change.before)?.text,
      change.before?.position ?? null,
      change.after?.position ?? null,
    ];

    it('lists entries, exits and position changes', () => {
      const pagos = accepted('Migrar pagos');
      const alta = accepted('Rediseñar el alta');
      const informes = accepted('Informes de uso');
      h.core.setDraftOrder([pagos, alta, informes]);
      h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

      const soporte = accepted('Soporte multi-idioma');
      h.core.removeFromDraft(alta, marta);
      h.core.setDraftOrder([informes, pagos, soporte]);
      h.core.consolidate({ actor: marta, reason: 'Los informes se adelantan' });

      const diff = h.core.diffConsolidations(1, 2);

      expect([diff.from.version, diff.to.version]).toEqual([1, 2]);
      expect(diff.changes.map(readable)).toEqual([
        ['rises', 'Informes de uso', 3, 1],
        ['falls', 'Migrar pagos', 1, 2],
        ['enters', 'Soporte multi-idioma', null, 3],
        ['leaves', 'Rediseñar el alta', 2, null],
      ]);
    });

    it('flags the action each version froze differently', () => {
      const pagos = accepted('Migrar pagos', 'Checkout');
      const alta = accepted('Rediseñar el alta', 'Checkout');
      h.core.setDraftOrder([pagos, alta]);
      h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

      // Pagos returns to the inbox, gets reassigned to another initiative and is ordered again.
      h.core.removeFromDraft(pagos, marta);
      h.core.deferAction(pagos, { actor: marta });
      h.core.reactivateAction(pagos, { actor: marta });
      h.core.acceptAction(pagos, { actor: marta, initiative: 'Plataforma', assignee: marta });
      h.core.setDraftOrder([alta, pagos]);
      h.core.consolidate({ actor: marta, reason: 'Pagos pasa a Plataforma' });

      const changes = h.core.diffConsolidations(1, 2).changes;
      const reasignada = changes.find((change) => change.actionId === pagos);
      const movida = changes.find((change) => change.actionId === alta);

      expect(reasignada?.namingChanged).toBe(true);
      expect([reasignada?.before?.initiative, reasignada?.after?.initiative]).toEqual([
        'Checkout',
        'Plataforma',
      ]);
      // The one that merely changes place is still named the same in both versions.
      expect(movida?.kind).toBe('rises');
      expect(movida?.namingChanged).toBe(false);
    });

    it('compares any two versions, not only consecutive ones', () => {
      const pagos = accepted('Migrar pagos');
      const alta = accepted('Rediseñar el alta');
      h.core.setDraftOrder([pagos, alta]);
      h.core.consolidate({ actor: marta, reason: 'Orden inicial' });
      h.core.setDraftOrder([alta, pagos]);
      h.core.consolidate({ actor: marta, reason: 'Se invierte' });
      h.core.setDraftOrder([pagos, alta]);
      h.core.consolidate({ actor: marta, reason: 'Se vuelve al orden inicial' });

      const saltando = h.core.diffConsolidations(1, 3);

      expect(saltando.changes.every((change) => change.kind === 'stays')).toBe(true);
      expect([saltando.from.reason, saltando.to.reason]).toEqual([
        'Orden inicial',
        'Se vuelve al orden inicial',
      ]);
    });

    it('what completed between two versions shows as an exit, without vanishing from the old snapshot', () => {
      const pagos = accepted('Migrar pagos');
      const alta = accepted('Rediseñar el alta');
      h.core.setDraftOrder([pagos, alta]);
      h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

      h.core.completeAction(pagos, { actor: juan, comment: 'Desplegado' });
      h.core.consolidate({ actor: marta, reason: 'Pagos ya está hecho' });

      const diff = h.core.diffConsolidations(1, 2);

      expect(diff.changes.map((change) => [change.kind, change.before?.text ?? change.after?.text])).toEqual([
        ['rises', 'Rediseñar el alta'],
        ['leaves', 'Migrar pagos'],
      ]);
      expect(h.core.getConsolidation(1)?.entries.map((entry) => entry.text)).toEqual([
        'Migrar pagos',
        'Rediseñar el alta',
      ]);
    });

    it('does not compare against a consolidation that does not exist', () => {
      h.core.setDraftOrder([accepted('Migrar pagos')]);
      h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

      expect(() => h.core.diffConsolidations(1, 7)).toThrow(/v7/);
      expect(() => h.core.diffConsolidations(1, Number.NaN)).toThrow(/integer/i);
    });
  });

  it('the sequence tells version, author, date, reason and whom each one succeeds', () => {
    const pagos = accepted('Migrar pagos');
    h.core.setDraftOrder([pagos]);
    h.clock.set('2026-08-10T09:00:00.000Z');
    h.core.consolidate({ actor: marta, reason: 'Pagos primero' });
    h.clock.set('2026-08-17T09:00:00.000Z');
    h.core.consolidate({ actor: marta, reason: 'Se ratifica el orden' });

    expect(h.core.consolidationHistory()).toEqual([
      {
        signature: {
          version: 2,
          at: '2026-08-17T09:00:00.000Z',
          by: { id: marta, name: 'Marta' },
          reason: 'Se ratifica el orden',
        },
        previous: 1,
      },
      {
        signature: {
          version: 1,
          at: '2026-08-10T09:00:00.000Z',
          by: { id: marta, name: 'Marta' },
          reason: 'Pagos primero',
        },
        // The first one succeeds none: there is nothing to compare it against.
        previous: null,
      },
    ]);
  });
});

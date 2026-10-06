import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('a person priorities', () => {
  const h = useCore();
  let marta: string;
  let juan: string;

  beforeEach(() => {
    marta = h.core.addPerson({ name: 'Marta' }).id;
    juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(marta, 'triager');
    h.core.grantRole(marta, 'consolidator');
  });

  /** Leaves the action accepted and positioned in the draft: ready to consolidate. */
  const drafted = (text: string, assignee: string | null) => {
    const action = h.core.registerAction({ text, initiative: 'Checkout', assignee, actor: marta });
    h.core.acceptAction(action.id, { actor: marta });
    h.core.placeInDraft(action.id);
    return action.id;
  };

  it('tells never-consolidated apart from nothing-pending', () => {
    const priorities = h.core.prioritiesFor(juan);

    expect(priorities.situation).toBe('never_consolidated');
    expect(priorities.consolidation).toBeNull();
  });

  it('answers a legitimate empty when a hierarchy is in force and nothing belongs to that person', () => {
    drafted('Cosa de nadie', null);
    h.clock.set('2026-08-12T08:00:00.000Z');
    h.core.consolidate({ actor: marta, reason: 'Primer orden global' });

    const priorities = h.core.prioritiesFor(juan);

    expect(priorities.situation).toBe('no_pending');
    expect(priorities.consolidation).toEqual({
      version: 1,
      at: '2026-08-12T08:00:00.000Z',
      by: { id: marta, name: 'Marta' },
      reason: 'Primer orden global',
    });
    expect(priorities.ordered).toEqual([]);
    expect(priorities.unprioritized).toEqual([]);
  });

  it('returns only the assignee own work, keeping its position in the global order', () => {
    const ana = h.core.addPerson({ name: 'Ana' }).id;
    const deAna = drafted('Migrar el pago', ana);
    const deJuan = drafted('Arreglar el carrito', juan);
    const otraDeAna = drafted('Revisar el IVA', ana);
    const otraDeJuan = drafted('Cachear el catálogo', juan);
    h.core.setDraftOrder([deAna, deJuan, otraDeAna, otraDeJuan]);
    h.core.consolidate({ actor: marta, reason: 'Orden acordado en el comité' });

    const priorities = h.core.prioritiesFor(juan);

    expect(priorities.situation).toBe('has_pending');
    expect(priorities.ordered).toEqual([
      { position: 2, actionId: deJuan, text: 'Arreglar el carrito', initiative: 'Checkout' },
      { position: 4, actionId: otraDeJuan, text: 'Cachear el catálogo', initiative: 'Checkout' },
    ]);
  });

  it('separates into its own block the assignee actions nobody has prioritized', () => {
    drafted('Ya priorizada', juan);
    h.core.consolidate({ actor: marta, reason: 'Lo que había' });
    const pendienteDeTriage = h.core.registerAction({
      text: 'Sin triar',
      initiative: 'Plataforma',
      assignee: juan,
      actor: marta,
    });
    const pendienteDeConsolidar = h.core.registerAction({
      text: 'Aceptada pero suelta',
      initiative: 'Plataforma',
      assignee: juan,
      actor: marta,
    });
    h.core.acceptAction(pendienteDeConsolidar.id, { actor: marta });

    const priorities = h.core.prioritiesFor(juan);

    expect(priorities.situation).toBe('has_pending');
    expect(priorities.unprioritized).toEqual([
      { actionId: pendienteDeTriage.id, text: 'Sin triar', initiative: 'Plataforma' },
      { actionId: pendienteDeConsolidar.id, text: 'Aceptada pero suelta', initiative: 'Plataforma' },
    ]);
  });

  it('counts as unprioritized neither another person work nor what left the flow', () => {
    const ana = h.core.addPerson({ name: 'Ana' }).id;
    h.core.registerAction({ text: 'De Ana', initiative: 'Plataforma', assignee: ana, actor: marta });
    h.core.registerAction({ text: 'De nadie', initiative: 'Plataforma', actor: marta });
    const rechazada = h.core.registerAction({
      text: 'Descartada',
      initiative: 'Plataforma',
      assignee: juan,
      actor: marta,
    });
    h.core.rejectAction(rechazada.id, { actor: marta });
    const aplazada = h.core.registerAction({
      text: 'Para más adelante',
      initiative: 'Plataforma',
      assignee: juan,
      actor: marta,
    });
    h.core.deferAction(aplazada.id, { actor: marta });

    expect(h.core.prioritiesFor(juan).unprioritized).toEqual([]);
    expect(h.core.prioritiesFor(ana).unprioritized).toHaveLength(1);
  });

  it('stays has_pending even when none of their work is prioritized yet', () => {
    drafted('De otro', h.core.addPerson({ name: 'Ana' }).id);
    h.core.consolidate({ actor: marta, reason: 'Solo lo de Ana' });
    h.core.registerAction({ text: 'Mía y suelta', initiative: 'Checkout', assignee: juan, actor: marta });

    const priorities = h.core.prioritiesFor(juan);

    expect(priorities.situation).toBe('has_pending');
    expect(priorities.ordered).toEqual([]);
    expect(priorities.unprioritized).toHaveLength(1);
  });

  it('does not report empty for someone whose action was removed from the order after consolidation', () => {
    const sacada = drafted('La sacan del orden', juan);
    h.core.consolidate({ actor: marta, reason: 'Primer orden' });
    h.core.removeFromDraft(sacada, marta);
    h.core.consolidate({ actor: marta, reason: 'Se replantea esa acción' });

    const priorities = h.core.prioritiesFor(juan);

    expect(priorities.situation).toBe('has_pending');
    expect(priorities.unprioritized).toEqual([
      { actionId: sacada, text: 'La sacan del orden', initiative: 'Checkout' },
    ]);
  });

  it('does not answer for a person that does not exist', () => {
    expect(() => h.core.prioritiesFor('nadie')).toThrow(/assignee/i);
  });
});

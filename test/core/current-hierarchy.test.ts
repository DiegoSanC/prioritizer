import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('hierarchy in force', () => {
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
  const drafted = (text: string, assignee: string | null = juan) => {
    const action = h.core.registerAction({ text, initiative: 'Checkout', assignee, actor: marta });
    h.core.acceptAction(action.id, { actor: marta });
    h.core.placeInDraft(action.id);
    return action.id;
  };

  it('there is none while nobody has consolidated', () => {
    drafted('Aceptada pero sin consolidar');

    const hierarchy = h.core.currentHierarchy();

    expect(hierarchy.consolidation).toBeNull();
    expect(hierarchy.ordered).toEqual([]);
    expect(hierarchy.gone).toEqual([]);
  });

  it('is the whole order of the last consolidation, with its signature', () => {
    const pagos = drafted('Migrar el pago');
    const carrito = drafted('Arreglar el carrito', null);
    h.core.setDraftOrder([pagos, carrito]);
    h.clock.set('2026-08-12T08:00:00.000Z');
    h.core.consolidate({ actor: marta, reason: 'Checkout va primero' });

    const hierarchy = h.core.currentHierarchy();

    expect(hierarchy.consolidation).toEqual({
      version: 1,
      at: '2026-08-12T08:00:00.000Z',
      by: { id: marta, name: 'Marta' },
      reason: 'Checkout va primero',
    });
    expect(hierarchy.ordered).toEqual([
      { position: 1, actionId: pagos, text: 'Migrar el pago', initiative: 'Checkout', assignee: { id: juan, name: 'Juan' } },
      { position: 2, actionId: carrito, text: 'Arreglar el carrito', initiative: 'Checkout', assignee: null },
    ]);
  });

  it('removes from the order what was completed later, without renumbering the rest', () => {
    const pagos = drafted('Migrar el pago');
    const carrito = drafted('Arreglar el carrito');
    const iva = drafted('Revisar el IVA');
    h.core.setDraftOrder([pagos, carrito, iva]);
    h.core.consolidate({ actor: marta, reason: 'Orden acordado en el comité' });

    h.core.completeAction(carrito, { actor: juan, comment: 'Desplegado el martes' });
    const hierarchy = h.core.currentHierarchy();

    // The global position is never renumbered: whoever held 3 still holds 3.
    expect(hierarchy.ordered.map((entry) => [entry.position, entry.text])).toEqual([
      [1, 'Migrar el pago'],
      [3, 'Revisar el IVA'],
    ]);
    expect(hierarchy.gone.map((entry) => [entry.position, entry.text])).toEqual([
      [2, 'Arreglar el carrito'],
    ]);
    // The signed snapshot is untouched: it still names all three, which is what upholds the history.
    expect(h.core.currentConsolidation()?.entries).toHaveLength(3);
  });

  it('becomes the most recent consolidation as soon as somebody consolidates again', () => {
    const pagos = drafted('Migrar el pago');
    const carrito = drafted('Arreglar el carrito');
    h.core.setDraftOrder([pagos, carrito]);
    h.core.consolidate({ actor: marta, reason: 'Pagos primero' });

    h.core.setDraftOrder([carrito, pagos]);
    h.core.consolidate({ actor: marta, reason: 'El carrito se adelanta' });

    const hierarchy = h.core.currentHierarchy();

    expect(hierarchy.consolidation?.version).toBe(2);
    expect(hierarchy.consolidation?.reason).toBe('El carrito se adelanta');
    expect(hierarchy.ordered.map((entry) => entry.text)).toEqual([
      'Arreglar el carrito',
      'Migrar el pago',
    ]);
  });

  it('keeps in force what somebody removed from the draft until the next consolidation', () => {
    const sacada = drafted('La sacan del orden');
    h.core.consolidate({ actor: marta, reason: 'Primer orden' });

    h.core.removeFromDraft(sacada, marta);

    // The draft is a proposal; what remains in force is the last signed consolidation.
    expect(h.core.currentHierarchy().ordered.map((entry) => entry.text)).toEqual([
      'La sacan del orden',
    ]);
    expect(h.core.getDraft().ordered).toEqual([]);
  });
});

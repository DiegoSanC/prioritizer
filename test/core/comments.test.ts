import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('discussion on the draft', () => {
  const h = useCore();
  let marta: string;

  beforeEach(() => {
    marta = h.core.addPerson({ name: 'Marta' }).id;
    h.core.grantRole(marta, 'triager');
  });

  const accepted = (text: string) => {
    const action = h.core.registerAction({ text, initiative: 'Checkout', actor: marta });
    h.core.acceptAction(action.id, { actor: marta });
    return action.id;
  };

  it('leaves a comment on a draft action, with author and date', () => {
    const pagos = accepted('Migrar el pago');
    h.core.setDraftOrder([pagos]);
    h.clock.set('2026-08-12T10:30:00.000Z');

    h.core.commentInDraft(pagos, { actor: marta, text: 'Depende del contrato con el banco.' });
    h.reopen();

    expect(h.core.draftComments()[pagos]).toEqual([
      {
        author: { id: marta, name: 'Marta' },
        text: 'Depende del contrato con el banco.',
        at: '2026-08-12T10:30:00.000Z',
        positionThen: 1,
      },
    ]);
  });

  it('keeps the position the action held when written, even if the order changes', () => {
    const pagos = accepted('Migrar el pago');
    const iva = accepted('Revisar el IVA');
    const alta = accepted('Rediseñar el alta');
    h.core.setDraftOrder([pagos, iva, alta]);
    const sinPosicion = accepted('Aceptada sin ordenar');

    // Commenting «on the position» and commenting «on the action» are the same act: what
    // changes is what is being talked about. What does get lost on reordering is the point
    // of the complaint, so the position held back then travels with the comment.
    h.core.commentInDraft(alta, { actor: marta, text: 'Debería ir antes que el IVA.' });
    h.core.commentInDraft(sinPosicion, { actor: marta, text: 'Esta ni siquiera está en el orden.' });

    h.core.setDraftOrder([alta, pagos, iva]);

    expect(h.core.draftComments()[alta]?.[0]).toMatchObject({ positionThen: 3 });
    expect(h.core.draftComments()[sinPosicion]?.[0]).toMatchObject({ positionThen: null });
  });

  it('collects the discussion of several stakeholders in speaking order, requiring no role', () => {
    const juan = h.core.addPerson({ name: 'Juan' }).id;
    const pagos = accepted('Migrar el pago');
    h.core.setDraftOrder([pagos]);

    // Neither of the two holds a role: commenting is the open surface of the negotiation,
    // and reserving it for a few would send everyone else back to the parallel channel.
    expect(h.core.rolesOf(juan)).toEqual([]);

    h.clock.set('2026-08-12T09:00:00.000Z');
    h.core.commentInDraft(pagos, { actor: marta, text: 'Va primero por el cierre de trimestre.' });
    h.clock.set('2026-08-12T09:05:00.000Z');
    h.core.commentInDraft(pagos, { actor: juan, text: 'Entonces el alta se me va a octubre.' });

    expect(h.core.draftComments()[pagos]).toMatchObject([
      { author: { name: 'Marta' }, text: 'Va primero por el cierre de trimestre.' },
      { author: { name: 'Juan' }, text: 'Entonces el alta se me va a octubre.' },
    ]);
  });

  it('does not block consolidation: one consolidates unilaterally over the open objection', () => {
    const juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(marta, 'consolidator');
    const pagos = accepted('Migrar el pago');
    const iva = accepted('Revisar el IVA');
    h.core.setDraftOrder([pagos, iva]);

    // Juan disagrees with both and nobody answers him: there is no way to close, resolve or
    // accept a comment, because consensus is a human ritual that lives outside the tool.
    h.core.commentInDraft(pagos, { actor: juan, text: 'No estoy de acuerdo con este orden.' });
    h.core.commentInDraft(iva, { actor: juan, text: 'Y esta debería ni estar.' });

    const consolidation = h.core.consolidate({ actor: marta, reason: 'Cierre de trimestre' });

    // The order freezes whole, as if nobody had said anything.
    expect(consolidation.version).toBe(1);
    expect(consolidation.entries.map((entry) => entry.text)).toEqual([
      'Migrar el pago',
      'Revisar el IVA',
    ]);
    // And the discussion is still there: consolidating neither consumes it nor deems it settled.
    expect(h.core.draftComments()[pagos]).toHaveLength(1);
    expect(h.core.draftComments()[iva]).toHaveLength(1);

    // And one can consolidate again with the objection still alive.
    expect(h.core.consolidate({ actor: marta, reason: 'Sin cambios' }).version).toBe(2);
  });

  it('only draft actions can be commented on, and never blank', () => {
    const pagos = accepted('Migrar el pago');
    const sinTriar = h.core.registerAction({
      text: 'Recién salida de la reunión',
      initiative: 'Checkout',
      actor: marta,
    }).id;

    expect(() => h.core.commentInDraft(pagos, { actor: marta, text: '   ' })).toThrow(/comment/i);
    expect(() => h.core.commentInDraft(sinTriar, { actor: marta, text: 'Ojo con esta.' })).toThrow(
      /draft|aceptad/i,
    );
    expect(() => h.core.commentInDraft('inventada', { actor: marta, text: 'Ojo.' })).toThrow(
      /no such/i,
    );

    expect(h.core.draftComments()).toEqual({});
  });

  it('leaves out of the draft discussion what was said about an action no longer in it', () => {
    const pagos = accepted('Migrar el pago');
    h.core.setDraftOrder([pagos]);
    h.core.commentInDraft(pagos, { actor: marta, text: 'Se discutió en su día.' });

    h.core.completeAction(pagos, { actor: marta });

    // What was said is not erased, but the draft is what is still under discussion.
    expect(h.core.draftComments()).toEqual({});
  });
});

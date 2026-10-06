import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('draft hierarchy', () => {
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

  const texts = (items: { text: string }[]) => items.map((item) => item.text);

  it('leaves accepted actions without a position in the unprioritized section', () => {
    accepted('Recién aceptada');

    const draft = h.core.getDraft();

    expect(texts(draft.ordered)).toEqual([]);
    expect(texts(draft.unordered)).toEqual(['Recién aceptada']);
  });

  it('orders the accepted and the order survives restarts', () => {
    const primera = accepted('Primera');
    const segunda = accepted('Segunda');
    const tercera = accepted('Tercera');

    h.core.setDraftOrder([tercera, primera, segunda]);
    h.reopen();

    expect(texts(h.core.getDraft().ordered)).toEqual(['Tercera', 'Primera', 'Segunda']);
    expect(h.core.getDraft().unordered).toEqual([]);
  });

  it('moves an action up and down within the order', () => {
    const a = accepted('A');
    const b = accepted('B');
    const c = accepted('C');
    h.core.setDraftOrder([a, b, c]);

    h.core.moveInDraft(c, 'up');
    expect(texts(h.core.getDraft().ordered)).toEqual(['A', 'C', 'B']);

    h.core.moveInDraft(a, 'down');
    expect(texts(h.core.getDraft().ordered)).toEqual(['C', 'A', 'B']);
  });

  it('does not step past the ends when moving', () => {
    const a = accepted('A');
    const b = accepted('B');
    h.core.setDraftOrder([a, b]);

    h.core.moveInDraft(a, 'up');
    h.core.moveInDraft(b, 'down');

    expect(texts(h.core.getDraft().ordered)).toEqual(['A', 'B']);
  });

  it('places an unprioritized action at the end of the order and can remove it', () => {
    const a = accepted('Ya ordenada');
    h.core.setDraftOrder([a]);
    const b = accepted('Sin posición');

    h.core.placeInDraft(b);
    expect(texts(h.core.getDraft().ordered)).toEqual(['Ya ordenada', 'Sin posición']);
    expect(h.core.getDraft().unordered).toEqual([]);

    h.core.removeFromDraft(b, marta);
    expect(texts(h.core.getDraft().ordered)).toEqual(['Ya ordenada']);
    expect(texts(h.core.getDraft().unordered)).toEqual(['Sin posición']);
  });

  it('returns an already consolidated action to accepted when removed from the order', () => {
    h.core.grantRole(marta, 'consolidator');
    const a = accepted('Se saca luego');
    h.core.setDraftOrder([a]);
    h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

    h.core.removeFromDraft(a, marta);

    const action = h.core.getAction(a);
    expect(action?.status).toBe('accepted');
    expect(action?.transitions.at(-1)).toMatchObject({
      from: 'prioritized',
      to: 'accepted',
      by: marta,
    });
    expect(texts(h.core.getDraft().unordered)).toEqual(['Se saca luego']);
  });

  it('does not admit actions that have not passed triage into the draft', () => {
    const sinTriar = h.core.registerAction({ text: 'Sin triar', initiative: 'Checkout', actor: marta }).id;

    expect(() => h.core.placeInDraft(sinTriar)).toThrow(/triage|accepted/i);
  });

  it('removes actions that leave the flow from the draft', () => {
    const a = accepted('Se queda');
    const b = h.core.registerAction({ text: 'Se rechaza', initiative: 'Checkout', actor: marta }).id;
    h.core.acceptAction(b, { actor: marta });
    h.core.setDraftOrder([a, b]);

    h.core.rejectAction(b, { actor: marta });

    expect(texts(h.core.getDraft().ordered)).toEqual(['Se queda']);
  });

  it('counts registered and accepted as unprioritized, with or without a position', () => {
    const conPosicion = accepted('Con posición');
    h.core.setDraftOrder([conPosicion]);
    accepted('Sin posición');
    h.core.registerAction({ text: 'Sin triar', initiative: 'Checkout', actor: marta });

    const draft = h.core.getDraft();

    expect(draft.unprioritizedCount).toBe(3);
    expect(draft.pendingTriageCount).toBe(1);
  });

  it('rejects an order that omits or invents actions', () => {
    const a = accepted('A');
    const b = accepted('B');
    h.core.setDraftOrder([a, b]);

    expect(() => h.core.setDraftOrder([a, a])).toThrow(/repeated/i);
    expect(() => h.core.setDraftOrder([a, 'inexistente'])).toThrow(/no such/i);
  });

  it('does not leave an already prioritized action out of the order', () => {
    h.core.grantRole(marta, 'consolidator');
    const a = accepted('Consolidada A');
    const b = accepted('Consolidada B');
    h.core.setDraftOrder([a, b]);
    h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

    // A partial order would leave it prioritized yet positionless: invisible in the draft
    // and out of the next consolidation without anyone having decided so.
    expect(() => h.core.setDraftOrder([a])).toThrow(/prioritized/i);
    expect(texts(h.core.getDraft().ordered)).toEqual(['Consolidada A', 'Consolidada B']);
  });
});

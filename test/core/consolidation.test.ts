import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('consolidation', () => {
  const h = useCore();
  let marta: string;
  let ana: string;
  let juan: string;

  beforeEach(() => {
    marta = h.core.addPerson({ name: 'Marta' }).id;
    ana = h.core.addPerson({ name: 'Ana' }).id;
    juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(marta, 'triager');
    h.core.grantRole(marta, 'consolidator');
    h.core.grantRole(ana, 'consolidator');
  });

  const ordered = (...texts: string[]) => {
    const ids = texts.map((text) => {
      const action = h.core.registerAction({ text, initiative: 'Checkout', assignee: juan, actor: marta });
      h.core.acceptAction(action.id, { actor: marta });
      return action.id;
    });
    h.core.setDraftOrder(ids);
    return ids;
  };

  it('demands a required line of reason', () => {
    ordered('Algo');

    expect(() => h.core.consolidate({ actor: marta, reason: '   ' })).toThrow(/reason/i);
    expect(h.core.currentConsolidation()).toBeNull();
  });

  it('produces a signed, versioned snapshot with the whole order', () => {
    ordered('Primera', 'Segunda');
    h.clock.set('2026-08-12T08:00:00.000Z');

    const consolidation = h.core.consolidate({
      actor: marta,
      reason: 'Checkout va antes que Plataforma este sprint',
    });

    expect(consolidation.version).toBe(1);
    expect(consolidation.at).toBe('2026-08-12T08:00:00.000Z');
    expect(consolidation.by).toEqual({ id: marta, name: 'Marta' });
    expect(consolidation.reason).toBe('Checkout va antes que Plataforma este sprint');
    expect(consolidation.entries.map((e) => [e.position, e.text])).toEqual([
      [1, 'Primera'],
      [2, 'Segunda'],
    ]);
    expect(consolidation.entries[0]?.assignee).toEqual({ id: juan, name: 'Juan' });
  });

  it('moves the consolidated to prioritized, leaving a trace of the transition', () => {
    const [primera] = ordered('Primera');

    h.core.consolidate({ actor: marta, reason: 'Primera consolidación' });

    const action = h.core.getAction(primera as string);
    expect(action?.status).toBe('prioritized');
    expect(action?.transitions.at(-1)).toMatchObject({ from: 'accepted', to: 'prioritized', by: marta });
  });

  it('leaves accepted actions without a position out of the snapshot, still accepted', () => {
    ordered('Ordenada');
    const suelta = h.core.registerAction({ text: 'Sin posición', initiative: 'X', actor: marta });
    h.core.acceptAction(suelta.id, { actor: marta });

    const consolidation = h.core.consolidate({ actor: marta, reason: 'Solo lo ordenado' });

    expect(consolidation.entries.map((e) => e.text)).toEqual(['Ordenada']);
    expect(h.core.getAction(suelta.id)?.status).toBe('accepted');
  });

  it('is append-only: a new consolidation does not mutate the previous ones', () => {
    const ids = ordered('Primera', 'Segunda');
    const v1 = h.core.consolidate({ actor: marta, reason: 'Orden inicial' });

    h.core.setDraftOrder([ids[1] as string, ids[0] as string]);
    const v2 = h.core.consolidate({ actor: ana, reason: 'Se invierte tras hablar con los stakeholders' });

    expect(v2.version).toBe(2);
    expect(v2.entries.map((e) => e.text)).toEqual(['Segunda', 'Primera']);
    expect(h.core.getConsolidation(1)?.entries.map((e) => e.text)).toEqual(['Primera', 'Segunda']);
    expect(h.core.getConsolidation(1)?.reason).toBe(v1.reason);
    expect(h.core.currentConsolidation()?.version).toBe(2);
  });

  it('only someone with the consolidator role consolidates', () => {
    ordered('Algo');

    expect(() => h.core.consolidate({ actor: juan, reason: 'No me toca' })).toThrow(/consolidator/i);
  });

  it('any consolidator consolidates on their own, with no approval flow', () => {
    ordered('Algo');

    const primera = h.core.consolidate({ actor: marta, reason: 'Marta consolida' });
    const segunda = h.core.consolidate({ actor: ana, reason: 'Ana consolida sin pedir permiso' });

    expect([primera.by.name, segunda.by.name]).toEqual(['Marta', 'Ana']);
  });

  it('there is no consolidation in force until somebody consolidates', () => {
    expect(h.core.currentConsolidation()).toBeNull();
    expect(h.core.listConsolidations()).toEqual([]);
  });
});

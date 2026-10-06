import { describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('manual action registration', () => {
  const h = useCore();

  it('registers an action with text and initiative and leaves it in status registered', () => {
    const marta = h.core.addPerson({ name: 'Marta' });

    const action = h.core.registerAction({
      text: 'Cerrar el contrato del endpoint de pagos',
      initiative: 'Checkout',
      actor: marta.id,
    });

    expect(action.text).toBe('Cerrar el contrato del endpoint de pagos');
    expect(action.initiative).toBe('Checkout');
    expect(action.status).toBe('registered');
    expect(action.assignee).toBeNull();
    expect(action.createdAt).toBe('2026-08-11T09:00:00.000Z');
  });

  it('accepts an optional assignee at registration', () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    const juan = h.core.addPerson({ name: 'Juan' });

    const action = h.core.registerAction({
      text: 'Migrar el job nocturno',
      initiative: 'Plataforma',
      assignee: juan.id,
      actor: marta.id,
    });

    expect(action.assignee).toEqual({ id: juan.id, name: 'Juan' });
  });

  it('shows registered actions in the list, with their manual origin', () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.registerAction({ text: 'Primera', initiative: 'Checkout', actor: marta.id });
    h.core.registerAction({ text: 'Segunda', initiative: 'Plataforma', actor: marta.id });

    const listed = h.core.listActions();

    expect(listed.map((a) => a.text)).toEqual(['Primera', 'Segunda']);
    expect(listed.every((a) => a.origin.kind === 'manual')).toBe(true);
  });

  it('persists actions across service restarts', () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.registerAction({ text: 'Sobrevive al reinicio', initiative: 'Checkout', actor: marta.id });

    h.reopen();

    expect(h.core.listActions().map((a) => a.text)).toEqual(['Sobrevive al reinicio']);
  });

  it('refuses to register an action without text or initiative', () => {
    const marta = h.core.addPerson({ name: 'Marta' });

    expect(() => h.core.registerAction({ text: '   ', initiative: 'Checkout', actor: marta.id })).toThrow(
      /text/i,
    );
    expect(() => h.core.registerAction({ text: 'Algo', initiative: '  ', actor: marta.id })).toThrow(
      /initiative/i,
    );
  });

  it('records the author and moment of creation as the first transition', () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    const action = h.core.registerAction({ text: 'Con traza', initiative: 'Checkout', actor: marta.id });

    expect(h.core.getAction(action.id)?.transitions).toEqual([
      { to: 'registered', from: null, at: '2026-08-11T09:00:00.000Z', by: marta.id, note: null },
    ]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('completing actions', () => {
  const h = useCore();
  let marta: string;
  let juan: string;

  beforeEach(() => {
    marta = h.core.addPerson({ name: 'Marta' }).id;
    juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(marta, 'triager');
    h.core.grantRole(marta, 'consolidator');
  });

  /** Leaves the action prioritized: accepted, ordered and already inside the hierarchy in force. */
  const prioritized = (text: string) => {
    const action = h.core.registerAction({
      text,
      initiative: 'Checkout',
      assignee: juan,
      actor: marta,
    });
    h.core.acceptAction(action.id, { actor: marta });
    h.core.placeInDraft(action.id);
    h.core.consolidate({ actor: marta, reason: 'Orden acordado' });
    return action.id;
  };

  it('marks the action completed, with who closed it and when', () => {
    const id = prioritized('Migrar el endpoint de pagos');
    h.clock.set('2026-08-13T17:20:00.000Z');

    const completed = h.core.completeAction(id, { actor: juan });

    expect(completed.status).toBe('completed');
    expect(completed.completedBy).toEqual({ id: juan, name: 'Juan' });
    expect(completed.completedAt).toBe('2026-08-13T17:20:00.000Z');
  });

  it('stores the optional evidence: comment and links to the external tracker and the PR', () => {
    const id = prioritized('Migrar el endpoint de pagos');

    const completed = h.core.completeAction(id, {
      actor: juan,
      comment: 'Desplegado el martes con la migración de datos incluida',
      links: ['https://jira.example.com/browse/CHK-42', 'https://github.com/acme/api/pull/318'],
    });

    expect(completed.evidence).toEqual({
      comment: 'Desplegado el martes con la migración de datos incluida',
      links: ['https://jira.example.com/browse/CHK-42', 'https://github.com/acme/api/pull/318'],
    });
  });

  it('closes just as well with no evidence at all', () => {
    const id = prioritized('Sin nada que enseñar');

    const completed = h.core.completeAction(id, { actor: juan, comment: '   ', links: [] });

    expect(completed.status).toBe('completed');
    expect(completed.evidence).toEqual({ comment: null, links: [] });
  });

  it('removes the completed action from the priorities in force', () => {
    const hecha = prioritized('Ya está hecha');
    const pendiente = prioritized('Todavía no');

    h.core.completeAction(hecha, { actor: juan });

    const priorities = h.core.prioritiesFor(juan);
    expect(priorities.ordered.map((entry) => entry.actionId)).toEqual([pendiente]);
    expect(priorities.unprioritized).toEqual([]);
  });

  it('leaves whoever completes their only action with nothing pending', () => {
    const id = prioritized('La única');

    h.core.completeAction(id, { actor: juan });

    expect(h.core.prioritiesFor(juan).situation).toBe('no_pending');
  });

  it('does not touch the consolidated snapshot: the action stays in the hierarchy as signed', () => {
    const id = prioritized('Estaba en la v1');

    h.core.completeAction(id, { actor: juan });

    expect(h.core.getConsolidation(1)?.entries.map((entry) => entry.actionId)).toEqual([id]);
  });

  it('leaves the draft order so it is never consolidated again', () => {
    const id = prioritized('Se completa');

    h.core.completeAction(id, { actor: juan });
    const segunda = h.core.consolidate({ actor: marta, reason: 'Tras cerrar lo hecho' });

    expect(h.core.getDraft().ordered).toEqual([]);
    expect(h.core.getDraft().unordered).toEqual([]);
    expect(segunda.entries).toEqual([]);
  });

  it('remains in the history with evidence, date and author, even after a restart', () => {
    const id = prioritized('Con traza');
    h.clock.set('2026-08-13T17:20:00.000Z');
    h.core.completeAction(id, { actor: juan, comment: 'Cerrada', links: ['https://acme.test/pr/1'] });

    h.reopen();

    const action = h.core.getAction(id);
    expect(action).toMatchObject({
      status: 'completed',
      completedAt: '2026-08-13T17:20:00.000Z',
      completedBy: { id: juan, name: 'Juan' },
      evidence: { comment: 'Cerrada', links: ['https://acme.test/pr/1'] },
    });
    expect(action?.transitions.at(-1)).toMatchObject({
      from: 'prioritized',
      to: 'completed',
      at: '2026-08-13T17:20:00.000Z',
      by: juan,
    });
    expect(h.core.listActions({ status: 'completed' }).map((a) => a.id)).toEqual([id]);
  });

  it('also closes what nobody has prioritized yet, and it stops counting as unprioritized', () => {
    const action = h.core.registerAction({
      text: 'Aceptada y hecha antes de que nadie la ordenara',
      initiative: 'Plataforma',
      assignee: juan,
      actor: marta,
    });
    h.core.acceptAction(action.id, { actor: marta });

    h.core.completeAction(action.id, { actor: juan });

    expect(h.core.getAction(action.id)?.status).toBe('completed');
    expect(h.core.unprioritizedCount()).toBe(0);
    expect(h.core.prioritiesFor(juan).unprioritized).toEqual([]);
  });

  it('closes a still untriaged action, which stops waiting in the inbox', () => {
    // Deliberate deviation from the diagram: the assignee already receives their registered
    // actions in the unprioritized block, so they may have done them before anyone triages them.
    const action = h.core.registerAction({
      text: 'Se la pidieron en la reunión y la hizo',
      initiative: 'Plataforma',
      assignee: juan,
      actor: marta,
    });

    const completed = h.core.completeAction(action.id, { actor: juan, comment: 'Hecha ya' });

    expect(completed.status).toBe('completed');
    // The trace says which status it was closed from, which is what makes the deviation auditable.
    expect(h.core.getAction(action.id)?.transitions.at(-1)).toMatchObject({
      from: 'registered',
      to: 'completed',
      by: juan,
    });
    expect(h.core.listActions({ status: 'registered' })).toEqual([]);
    expect(h.core.unprioritizedCount()).toBe(0);
  });

  it('does not complete the same action twice', () => {
    const id = prioritized('Solo una vez');
    h.core.completeAction(id, { actor: juan });

    expect(() => h.core.completeAction(id, { actor: juan })).toThrow(/completed/i);
  });

  it('does not complete an action that already left the flow', () => {
    const rechazada = h.core.registerAction({ text: 'Descartada', initiative: 'X', actor: marta });
    h.core.rejectAction(rechazada.id, { actor: marta });
    const aplazada = h.core.registerAction({ text: 'Más adelante', initiative: 'X', actor: marta });
    h.core.deferAction(aplazada.id, { actor: marta });

    expect(() => h.core.completeAction(rechazada.id, { actor: juan })).toThrow(/rejected/i);
    expect(() => h.core.completeAction(aplazada.id, { actor: juan })).toThrow(/deferred/i);
  });

  it('completes neither a nonexistent action nor on behalf of a nonexistent person', () => {
    const id = prioritized('Existe');

    expect(() => h.core.completeAction('inventada', { actor: juan })).toThrow(/no such/i);
    expect(() => h.core.completeAction(id, { actor: 'nadie' })).toThrow(/completing person/i);
    expect(h.core.getAction(id)?.status).toBe('prioritized');
  });

  it('rejects as evidence what is not a link', () => {
    const id = prioritized('Con evidencia dudosa');

    expect(() => h.core.completeAction(id, { actor: juan, links: ['lo hablamos el martes'] })).toThrow(
      /link/i,
    );
    expect(h.core.getAction(id)?.status).toBe('prioritized');
  });

  it('closes on behalf of another, which is what the web offers product', () => {
    const id = prioritized('La cierra producto por él');

    const completed = h.core.completeAction(id, { actor: marta, comment: 'Verificado en la demo' });

    expect(completed.completedBy).toEqual({ id: marta, name: 'Marta' });
  });

  describe('closing in one own name, the developer agent way', () => {
    it('closes the action one is the assignee of, with its evidence', () => {
      const id = prioritized('Migrar el endpoint de pagos');
      h.clock.set('2026-08-13T17:20:00.000Z');

      const completed = h.core.completeOwnAction(id, {
        actor: juan,
        comment: 'Desplegado el martes',
        links: ['https://github.com/acme/api/pull/318'],
      });

      expect(completed).toMatchObject({
        status: 'completed',
        completedBy: { id: juan, name: 'Juan' },
        completedAt: '2026-08-13T17:20:00.000Z',
        evidence: { comment: 'Desplegado el martes', links: ['https://github.com/acme/api/pull/318'] },
      });
    });

    it('refuses to close another person action, which stays live', () => {
      const ana = h.core.addPerson({ name: 'Ana' }).id;
      const deAna = h.core.registerAction({
        text: 'Migrar el pago',
        initiative: 'Checkout',
        assignee: ana,
        actor: marta,
      });

      expect(() => h.core.completeOwnAction(deAna.id, { actor: juan })).toThrow(/assignee/i);
      expect(h.core.getAction(deAna.id)?.status).toBe('registered');
    });

    it('refuses to close an unassigned action, which no agent ever sees', () => {
      const sinDueno = h.core.registerAction({
        text: 'De nadie en particular',
        initiative: 'Plataforma',
        actor: marta,
      });

      expect(() => h.core.completeOwnAction(sinDueno.id, { actor: juan })).toThrow(/assignee/i);
      expect(h.core.getAction(sinDueno.id)?.status).toBe('registered');
    });

  });
});

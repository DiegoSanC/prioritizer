import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('triage', () => {
  const h = useCore();
  let marta: string;
  let juan: string;

  beforeEach(() => {
    marta = h.core.addPerson({ name: 'Marta' }).id;
    juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(marta, 'triager');
  });

  const register = (text: string, initiative = 'Checkout') =>
    h.core.registerAction({ text, initiative, actor: marta }).id;

  describe('accept', () => {
    it('moves the action to accepted, recording author and moment', () => {
      const id = register('Cerrar el contrato de pagos');
      h.clock.set('2026-08-12T10:30:00.000Z');

      const accepted = h.core.acceptAction(id, { actor: marta });

      expect(accepted.status).toBe('accepted');
      expect(h.core.getAction(id)?.transitions.at(-1)).toEqual({
        from: 'registered',
        to: 'accepted',
        at: '2026-08-12T10:30:00.000Z',
        by: marta,
        note: null,
      });
    });

    it('allows assigning or correcting initiative and assignee on accept', () => {
      const id = register('Revisar el job nocturno', 'Iniciativa equivocada');

      const accepted = h.core.acceptAction(id, {
        actor: marta,
        initiative: 'Plataforma',
        assignee: juan,
      });

      expect(accepted.initiative).toBe('Plataforma');
      expect(accepted.assignee).toEqual({ id: juan, name: 'Juan' });
    });

    it('removes the action from the inbox but keeps it in the list', () => {
      const id = register('Sale del inbox');
      h.core.acceptAction(id, { actor: marta });

      expect(h.core.listActions({ status: 'registered' })).toEqual([]);
      expect(h.core.listActions().map((a) => a.status)).toEqual(['accepted']);
    });

    it('does not accept an action that already left the inbox', () => {
      const id = register('Ya rechazada');
      h.core.rejectAction(id, { actor: marta });

      expect(() => h.core.acceptAction(id, { actor: marta })).toThrow(/rejected/i);
    });
  });

  describe('reject', () => {
    it('moves the action to rejected and out of the inbox', () => {
      const id = register('Ruido de una reunión');

      const rejected = h.core.rejectAction(id, { actor: marta });

      expect(rejected.status).toBe('rejected');
      expect(h.core.listActions({ status: 'registered' })).toEqual([]);
    });

    it('removes it from the unprioritized signal', () => {
      register('Se queda');
      const descartada = register('Se va');

      expect(h.core.unprioritizedCount()).toBe(2);
      h.core.rejectAction(descartada, { actor: marta });
      expect(h.core.unprioritizedCount()).toBe(1);
    });

    it('records the reason when given', () => {
      const id = register('Con motivo');
      h.core.rejectAction(id, { actor: marta, note: 'Ya lo cubre otra iniciativa' });

      expect(h.core.getAction(id)?.transitions.at(-1)?.note).toBe('Ya lo cubre otra iniciativa');
    });
  });

  describe('defer', () => {
    it('moves the action to deferred and it stops counting as unprioritized', () => {
      const id = register('No ahora');

      const deferred = h.core.deferAction(id, { actor: marta });

      expect(deferred.status).toBe('deferred');
      expect(h.core.unprioritizedCount()).toBe(0);
      expect(h.core.listActions({ status: 'registered' })).toEqual([]);
    });

    it('keeps deferred actions reviewable at any time', () => {
      const id = register('Revisable más adelante');
      h.core.deferAction(id, { actor: marta });

      expect(h.core.listActions({ status: 'deferred' }).map((a) => a.text)).toEqual([
        'Revisable más adelante',
      ]);
    });

    it('allows reactivating a deferred action back into the inbox', () => {
      const id = register('Vuelve al inbox');
      h.core.deferAction(id, { actor: marta });

      const reactivated = h.core.reactivateAction(id, { actor: marta });

      expect(reactivated.status).toBe('registered');
      expect(h.core.unprioritizedCount()).toBe(1);
      expect(h.core.getAction(id)?.transitions.map((t) => t.to)).toEqual([
        'registered',
        'deferred',
        'registered',
      ]);
    });

    it('only reactivates deferred actions', () => {
      const id = register('Sigue registrada');
      expect(() => h.core.reactivateAction(id, { actor: marta })).toThrow(/deferred/i);
    });
  });

  describe('mark duplicate', () => {
    it('merges the action into the existing one and stores the reference', () => {
      const original = register('Definir el contrato de pagos');
      const repetida = register('Definir contrato del endpoint de pagos');

      const merged = h.core.markDuplicate(repetida, { actor: marta, duplicateOf: original });

      expect(merged.status).toBe('duplicate');
      expect(merged.duplicateOf).toBe(original);
    });

    it('removes the duplicate from every signal, leaving only the original', () => {
      const original = register('Original');
      const repetida = register('Repetida');

      h.core.markDuplicate(repetida, { actor: marta, duplicateOf: original });

      expect(h.core.unprioritizedCount()).toBe(1);
      expect(h.core.listActions({ status: 'registered' }).map((a) => a.text)).toEqual(['Original']);
    });

    it('does not merge an action with itself', () => {
      const id = register('Sola');
      expect(() => h.core.markDuplicate(id, { actor: marta, duplicateOf: id })).toThrow(/of itself/i);
    });

    it('does not merge against another duplicate: point at the original', () => {
      const original = register('Original');
      const primera = register('Primera copia');
      const segunda = register('Segunda copia');
      h.core.markDuplicate(primera, { actor: marta, duplicateOf: original });

      expect(() => h.core.markDuplicate(segunda, { actor: marta, duplicateOf: primera })).toThrow(
        /original/i,
      );
    });
  });

  describe('who may triage', () => {
    it('does not let someone without the triager role accept', () => {
      const id = register('La decide el triage, no cualquiera');

      expect(() => h.core.acceptAction(id, { actor: juan })).toThrow(/triager role/i);
      expect(h.core.getAction(id)?.status).toBe('registered');
    });

    it('gates the three inbox exits and reactivation alike', () => {
      const otra = register('La original');
      const id = register('Sigue esperando decisión');
      const aplazada = register('Aplazada por Marta');
      h.core.deferAction(aplazada, { actor: marta });

      expect(() => h.core.rejectAction(id, { actor: juan })).toThrow(/triager role/i);
      expect(() => h.core.deferAction(id, { actor: juan })).toThrow(/triager role/i);
      expect(() => h.core.markDuplicate(id, { actor: juan, duplicateOf: otra })).toThrow(
        /triager role/i,
      );
      expect(() => h.core.reactivateAction(aplazada, { actor: juan })).toThrow(/triager role/i);

      expect(h.core.getAction(id)?.status).toBe('registered');
      expect(h.core.getAction(aplazada)?.status).toBe('deferred');
    });

    it('leaves no trace of the decision it refuses', () => {
      const original = register('La original');
      const id = register('Intento sin rol', 'Checkout');

      expect(() =>
        h.core.acceptAction(id, { actor: juan, initiative: 'Plataforma', assignee: juan }),
      ).toThrow(/triager role/i);
      expect(() => h.core.markDuplicate(id, { actor: juan, duplicateOf: original })).toThrow(
        /triager role/i,
      );

      expect(h.core.getAction(id)).toMatchObject({
        status: 'registered',
        initiative: 'Checkout',
        assignee: null,
        duplicateOf: null,
      });
      expect(h.core.getAction(id)?.transitions.map((t) => t.to)).toEqual(['registered']);
    });

    it('tells someone who cannot triage not even whether the action exists', () => {
      expect(() => h.core.rejectAction('una-que-no-existe', { actor: juan })).toThrow(
        /triager role/i,
      );
    });

    it('lets every person with the role triage at once', () => {
      const ana = h.core.addPerson({ name: 'Ana' }).id;
      h.core.grantRole(ana, 'triager');
      const deMarta = register('La tría Marta');
      const deAna = register('La tría Ana');

      h.core.acceptAction(deMarta, { actor: marta });
      h.core.acceptAction(deAna, { actor: ana });

      expect(h.core.getAction(deMarta)?.status).toBe('accepted');
      expect(h.core.getAction(deAna)?.status).toBe('accepted');
      expect(h.core.getAction(deAna)?.transitions.at(-1)?.by).toBe(ana);
    });

    it('opens and closes the door as the role is granted and revoked', () => {
      h.core.grantRole(juan, 'triager');
      h.core.acceptAction(register('Con el rol recién concedido'), { actor: juan });

      h.core.revokeRole(juan, 'triager');

      expect(() => h.core.acceptAction(register('Ya sin el rol'), { actor: juan })).toThrow(
        /triager role/i,
      );
    });

    it('answers who may triage without the surfaces repeating the rule', () => {
      expect(h.core.canTriage(marta)).toBe(true);
      expect(h.core.canTriage(juan)).toBe(false);

      h.core.grantRole(juan, 'triager');
      expect(h.core.canTriage(juan)).toBe(true);
    });
  });

  it('counts as unprioritized only the registered and the accepted', () => {
    const registrada = register('Registrada');
    const aceptada = register('Aceptada');
    h.core.acceptAction(aceptada, { actor: marta });
    h.core.rejectAction(register('Rechazada'), { actor: marta });
    h.core.deferAction(register('Aplazada'), { actor: marta });
    h.core.markDuplicate(register('Duplicada'), { actor: marta, duplicateOf: registrada });

    expect(h.core.unprioritizedCount()).toBe(2);
    expect(h.core.getAction(registrada)?.status).toBe('registered');
  });
});

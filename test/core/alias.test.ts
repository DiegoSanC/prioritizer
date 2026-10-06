import { describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';
import type { IngestedItem } from '../../src/core/index.js';

/**
 * The alias table: the operator's correspondence between a person and the names a
 * transcription tool attributes work to. It is the only thing that can turn an attributed
 * name into an assignee — see `ingestActions`.
 */
describe('aliases between a person and their transcript name', () => {
  const h = useCore();

  const item = (text: string, attributedTo: string | null, sourceId = 'ASxwZxCstx'): IngestedItem => ({
    text,
    attributedTo,
    source: {
      tool: 'fireflies',
      sourceId,
      meetingDate: '2026-07-27T09:00:00.000Z',
      meetingTitle: 'Semanal de Checkout',
    },
  });

  it('registers an alias and leaves it visible with the person it points at', () => {
    const juan = h.core.addPerson({ name: 'Juan Pérez' });

    h.core.addAlias({ person: juan.id, alias: 'juan.perez@ejemplo.es' });

    expect(h.core.listAliases()).toMatchObject([
      { alias: 'juan.perez@ejemplo.es', person: { id: juan.id, name: 'Juan Pérez' } },
    ]);
  });

  it('the ingest assigns the assignee when the attributed name has an alias', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    h.core.addAlias({ person: juan.id, alias: 'juan.perez@ejemplo.es' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Partir la historia de migración en dos', 'juan.perez@ejemplo.es')],
    });

    expect(outcome.registered[0]?.assignee).toEqual({ id: juan.id, name: 'Juan Pérez' });
    expect(outcome.unresolvedAssignee).toBe(0);
  });

  it('without an alias the action enters unassigned, even if a person has that very name', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    h.core.addPerson({ name: 'Marta Ruiz' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Enviar el acta a todos los asistentes', 'Marta Ruiz')],
    });

    // Matching the attributed name against people's names is precisely the shortcut the
    // alias table is there to avoid: two people can share a name and the work would go to the wrong one.
    expect(outcome.registered[0]?.assignee).toBeNull();
    expect(outcome.unresolvedAssignee).toBe(1);
    expect(outcome.unresolvedNames).toEqual(['Marta Ruiz']);
  });

  it('what the alias does not resolve, triage assigns, as always', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'triager');
    const [accion] = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Dimensionar el entorno de preproducción', 'Equipo de Plataforma')],
    }).registered;

    h.core.acceptAction(accion?.id ?? '', {
      actor: marta.id,
      initiative: 'Plataforma',
      assignee: marta.id,
    });

    expect(h.core.getAction(accion?.id ?? '')).toMatchObject({
      status: 'accepted',
      assignee: { id: marta.id, name: 'Marta' },
    });
  });

  it('names the missing alias once, even when the meeting spells the name two ways', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [
        item('Dimensionar el entorno de preproducción', 'Equipo de Plataforma'),
        item('Escribir el postmortem de la caída del martes', 'equipo  de plataforma'),
      ],
    });

    // Two actions without an assignee, but a single alias worth creating: offering both
    // spellings would have the operator type the second one only to see it refused as a repeat.
    expect(outcome.unresolvedAssignee).toBe(2);
    expect(outcome.unresolvedNames).toEqual(['Equipo de Plataforma']);
  });

  it('the same name cannot answer for two people', () => {
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    const otro = h.core.addPerson({ name: 'Juan Peral' });
    h.core.addAlias({ person: juan.id, alias: 'Juan P.' });

    expect(() => h.core.addAlias({ person: otro.id, alias: 'juan p.' })).toThrow(
      /is already an alias of Juan Pérez/,
    );
  });

  it('one person answers for as many names as meetings give them', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const lucia = h.core.addPerson({ name: 'Lucía Ortega' });
    h.core.addAlias({ person: lucia.id, alias: 'Lucía' });
    h.core.addAlias({ person: lucia.id, alias: 'lucia.ortega@ejemplo.es' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [
        item('Revisar los criterios de aceptación', 'Lucía'),
        item('Preparar la demo de dirección', 'lucia.ortega@ejemplo.es'),
      ],
    });

    expect(outcome.registered.map((accion) => accion.assignee?.name)).toEqual([
      'Lucía Ortega',
      'Lucía Ortega',
    ]);
  });

  it('case and whitespace do not make another person', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    h.core.addAlias({ person: juan.id, alias: 'Juan Pérez' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Cerrar el contrato del endpoint de pagos', '  juan   PÉREZ ')],
    });

    expect(outcome.registered[0]?.assignee?.id).toBe(juan.id);
  });

  it('accents do make another person: better unassigned than misassigned', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const pena = h.core.addPerson({ name: 'Ana Peña' });
    h.core.addAlias({ person: pena.id, alias: 'Ana Peña' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Dimensionar el entorno de preproducción', 'Ana Pena')],
    });

    // «Pena» and «Peña» are two different surnames. Stripping accents would resolve more
    // names and some would go to the wrong person; the price of not resolving is one more alias.
    expect(outcome.registered[0]?.assignee).toBeNull();
    expect(outcome.unresolvedNames).toEqual(['Ana Pena']);
  });

  it('corrects an alias that pointed at the wrong person', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const luis = h.core.addPerson({ name: 'Luis Ortega' });
    const lucia = h.core.addPerson({ name: 'Lucía Ortega' });
    const alias = h.core.addAlias({ person: luis.id, alias: 'Lucía' });

    h.core.updateAlias(alias.id, { person: lucia.id, alias: 'Lucía' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Revisar los criterios de aceptación', 'Lucía')],
    });
    expect(outcome.registered[0]?.assignee?.id).toBe(lucia.id);
    expect(h.core.listAliases()).toHaveLength(1);
  });

  it('corrects an alias misspelled name', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    const alias = h.core.addAlias({ person: juan.id, alias: 'Jaun Pérez' });

    h.core.updateAlias(alias.id, { person: juan.id, alias: 'Juan Pérez' });

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [
        item('Cerrar el contrato del endpoint de pagos', 'Juan Pérez'),
        item('Preparar la demo de dirección', 'Jaun Pérez'),
      ],
    });
    expect(outcome.registered.map((accion) => accion.assignee?.id ?? null)).toEqual([
      juan.id,
      null,
    ]);
  });

  it('a corrected alias cannot take another alias name either', () => {
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    const lucia = h.core.addPerson({ name: 'Lucía Ortega' });
    h.core.addAlias({ person: juan.id, alias: 'Juan P.' });
    const suyo = h.core.addAlias({ person: lucia.id, alias: 'Lucía' });

    expect(() => h.core.updateAlias(suyo.id, { person: lucia.id, alias: 'Juan P.' })).toThrow(
      /is already an alias of Juan Pérez/,
    );
    // And Juan's alias is still his: the failed attempt took nothing down with it.
    expect(h.core.listAliases().map((entry) => [entry.alias, entry.person.id])).toEqual([
      ['Juan P.', juan.id],
      ['Lucía', lucia.id],
    ]);
  });

  it('removes an alias and the ingest leaves that name unresolved again', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    const alias = h.core.addAlias({ person: juan.id, alias: 'Juan P.' });

    h.core.removeAlias(alias.id);

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Partir la historia de migración en dos', 'Juan P.')],
    });
    expect(outcome.registered[0]?.assignee).toBeNull();
    expect(h.core.listAliases()).toEqual([]);
  });

  it('removing an alias does not touch the assignee of what was already ingested', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    const alias = h.core.addAlias({ person: juan.id, alias: 'Juan P.' });
    const [accion] = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Documentar el procedimiento de despliegue', 'Juan P.')],
    }).registered;

    h.core.removeAlias(alias.id);

    // The alias resolves at ingest time and its role ends there: reopening already
    // registered actions would trample whatever triage has decided since.
    expect(h.core.getAction(accion?.id ?? '')?.assignee?.id).toBe(juan.id);
  });

  it('an alias can only point at a person of the system', () => {
    expect(() => h.core.addAlias({ person: 'nadie', alias: 'Roberto Calvo' })).toThrow(
      /alias person/i,
    );
  });

  it('refuses an alias without a name', () => {
    const juan = h.core.addPerson({ name: 'Juan Pérez' });

    expect(() => h.core.addAlias({ person: juan.id, alias: '   ' })).toThrow(
      /transcript name/i,
    );
  });

  it('aliases survive a service restart', () => {
    const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
    const juan = h.core.addPerson({ name: 'Juan Pérez' });
    h.core.addAlias({ person: juan.id, alias: 'Juan P.' });

    h.reopen();

    const outcome = h.core.ingestActions({
      actor: ingesta.id,
      items: [item('Repasar el inbox de triage antes de consolidar', 'juan p.')],
    });
    expect(outcome.registered[0]?.assignee?.id).toBe(juan.id);
    expect(h.core.listAliases()).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { extractActionItems } from '../../src/ingest/action-items.js';
import { loadIngestFixture, readFixture } from '../support/ingest-fixtures.js';

/**
 * The parser, alone, against the recorded strings.
 *
 * Nobody has seen the real value of `Summary.action_items`: Fireflies types it as a String
 * and publishes no example of it. Every shape below is the spike's working hypothesis, so
 * what these tests defend is not "this is the format" but "no shape makes the parser lose
 * anything in silence" — either a line becomes an action or it comes back as residue.
 */
describe('extracting actions from the meeting string', () => {
  /** The `action_items` of the nth meeting of a fixture. */
  const cadena = (fixture: string, index = 0): string | null =>
    readFixture(loadIngestFixture(fixture)).transcripts[index]?.summary?.action_items ?? null;

  it('groups items under the name the meeting attributes them to', () => {
    const { items, unread } = extractActionItems(cadena('01-typical-meeting.json'));

    expect(items).toEqual([
      {
        text: 'Cerrar el contrato del endpoint de pagos con el proveedor',
        attributedTo: 'Marta Ruiz',
      },
      { text: 'Revisar la propuesta de precios antes del jueves', attributedTo: 'Marta Ruiz' },
      {
        text: 'Migrar el job nocturno de conciliación al nuevo runner',
        attributedTo: 'Juan Pérez',
      },
      {
        text: 'Preparar la demo de la pantalla de cobro para la reunión de dirección',
        attributedTo: 'Lucía Ortega',
      },
    ]);
    expect(unread).toEqual([]);
  });

  it('leaves unattributed what the meeting attributes to nobody', () => {
    const { items } = extractActionItems(cadena('02-problematic-assignees.json'));

    // The first item goes loose, before any name heading.
    expect(items[0]).toEqual({ text: 'Enviar el acta a todos los asistentes', attributedTo: null });
    // And the rest keep the name as-is, be it an unidentified speaker label, someone
    // external or a collective: judging them is not the parser's job.
    expect(items.map((accion) => accion.attributedTo)).toEqual([
      null,
      'Speaker 2',
      'Roberto Calvo',
      'Equipo de Plataforma',
    ]);
  });

  it('extracts no action from a meeting with no string, an empty one, or one saying there are none', () => {
    expect(extractActionItems(null)).toEqual({ items: [], unread: [] });
    expect(extractActionItems(cadena('03-useless-texts.json', 0))).toEqual({
      items: [],
      unread: [],
    });
    expect(extractActionItems(cadena('03-useless-texts.json', 1))).toEqual({
      items: [],
      unread: [],
    });
  });

  it('does not filter action-shaped noise, and does return what it could not read', () => {
    const { items, unread } = extractActionItems(cadena('03-useless-texts.json', 2));

    // Deciding whether «Seguir así, buen trabajo todos» is an action is human judgment,
    // and the spec places that judgment in triage: it enters the inbox and gets rejected there.
    expect(items).toEqual([
      { text: 'N/A', attributedTo: 'Marta Ruiz' },
      { text: 'Seguir así, buen trabajo todos', attributedTo: 'Marta Ruiz' },
      {
        text: 'Bloquear una hora el viernes para cerrar el informe de retro',
        attributedTo: 'Marta Ruiz',
      },
      { text: 'TBD', attributedTo: 'Juan Pérez' },
    ]);
    // A bullet with nothing after it and a stray timestamp are not actions, but they do
    // not vanish either: they are the only clue to what the real string looks like.
    expect(unread).toEqual(['-', '(31:12)']);
  });

  it('withstands line endings, bullets and bold inside the text', () => {
    const { items, unread } = extractActionItems(cadena('05-hostile-formats.json', 0));

    expect(items).toEqual([
      { text: 'Escribir el ADR de la cola de eventos', attributedTo: 'Marta Ruiz' },
      {
        // Bold in the middle of the sentence is not a name heading: if it were, the
        // whole sentence would be lost and «Finanzas» would show up as the assignee.
        text: 'Validar el presupuesto con **Finanzas** antes de cerrar',
        attributedTo: 'Marta Ruiz',
      },
      { text: 'Convocar a los equipos afectados', attributedTo: 'Marta Ruiz' },
      {
        text:
          'Probar el nuevo runner en preproducción y, si funciona, ' +
          'documentar el procedimiento de vuelta atrás',
        attributedTo: 'Juan Pérez',
      },
    ]);
    expect(unread).toEqual([]);
  });

  it('does not confuse a line with two bolds with a name heading', () => {
    // It starts and ends in bold, but it is not a heading: reading it as one would lose
    // the whole action and leave «Finanzas» as the assignee, the worst of both worlds.
    const { items, unread } = extractActionItems(
      '**Finanzas** valida el presupuesto **antes del cierre**',
    );

    expect(items).toEqual([
      { text: '**Finanzas** valida el presupuesto **antes del cierre**', attributedTo: null },
    ]);
    expect(unread).toEqual([]);
  });

  it('does not demand a name heading to read the items', () => {
    const { items, unread } = extractActionItems(cadena('05-hostile-formats.json', 1));

    expect(items.map((accion) => accion.text)).toEqual([
      'Cerrar el plan de formación del trimestre',
      'Compartir el enlace del curso de accesibilidad',
      'Agendar la siguiente sesión para dentro de dos semanas',
    ]);
    expect(unread).toEqual([]);
  });

  it('keeps accents, curly quotes and long items as they are', () => {
    const { items } = extractActionItems(cadena('05-hostile-formats.json', 2));

    expect(items[0]).toEqual({
      text:
        'Redactar la definición de «sin priorizar» para el glosario, contrastarla con lo ' +
        'que ya dice la spec, pasarla por Marta y Lucía, y dejarla enlazada desde la ' +
        'página publicada de solo lectura para que cualquiera de la organización pueda ' +
        'consultarla sin pedir permisos',
      attributedTo: 'Álvaro de la Peña',
    });
  });
});

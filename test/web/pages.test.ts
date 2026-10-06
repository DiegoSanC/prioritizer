import { describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';
import { completePage } from '../../src/web/views/complete.js';
import { historyPage } from '../../src/web/views/history.js';
import { mainPage } from '../../src/web/views/main.js';
import { publishedPage } from '../../src/web/views/published.js';
import type { PersonRef } from '../../src/core/index.js';

/**
 * What each page reads, with no server and no HTML: the presenter returns the ViewModel
 * and here it is checked against the real core. Whatever gets painted with it is the
 * view's business; what the screen knows — and what it never gets to know — is decided here.
 */
describe('web: what each page reads', () => {
  const h = useCore();

  /** Marta decides and signs; she is the one present in almost every setup. */
  const conMarta = (): PersonRef => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'triager');
    h.core.grantRole(marta.id, 'consolidator');
    return marta;
  };

  const preguntar = (query: string) => new URLSearchParams(query);

  describe('hierarchy', () => {
    it('brings what was just registered into the inbox', () => {
      const marta = conMarta();
      h.core.registerAction({
        text: 'Cerrar el contrato de pagos',
        initiative: 'Checkout',
        actor: marta.id,
      });

      const model = mainPage(h.core, marta);

      expect(model.inbox).toHaveLength(1);
      expect(model.inbox[0]).toMatchObject({
        text: 'Cerrar el contrato de pagos',
        initiative: 'Checkout',
        status: 'registered',
      });
    });

    it('offers deciding only to whoever the core would let decide', () => {
      const juan = h.core.addPerson({ name: 'Juan' });
      h.core.registerAction({ text: 'Pendiente de decisión', initiative: 'Checkout', actor: juan.id });

      // Hiding without enforcing would be a hole, and enforcing without hiding a button
      // that lies: the screen does not derive it, it asks the core. That the shell also
      // enforces it is the shell's business.
      expect(mainPage(h.core, juan).canTriage).toBe(false);
      expect(mainPage(h.core, juan).canConsolidate).toBe(false);

      h.core.grantRole(juan.id, 'triager');

      expect(mainPage(h.core, juan).canTriage).toBe(true);
    });

    it('tells apart in the inbox the ingested from the manual, and which meeting it came from', () => {
      const marta = conMarta();
      const ingesta = h.core.addPerson({ name: 'Ingesta Fireflies' });
      h.core.registerAction({ text: 'Escrita a mano', initiative: 'Checkout', actor: marta.id });
      h.core.ingestActions({
        actor: ingesta.id,
        items: [
          {
            text: 'Salida de la semanal',
            attributedTo: 'Marta Ruiz',
            source: {
              tool: 'fireflies',
              sourceId: 'ASxwZxCstx',
              meetingDate: '2026-07-27T09:00:00.000Z',
              meetingTitle: 'Semanal de Checkout',
            },
          },
        ],
      });

      const porTexto = Object.fromEntries(
        mainPage(h.core, marta).inbox.map((action) => [action.text, action.origin]),
      );

      expect(porTexto['Escrita a mano']).toEqual({ kind: 'manual' });
      expect(porTexto['Salida de la semanal']).toMatchObject({
        kind: 'ingested',
        source: { tool: 'fireflies', meetingTitle: 'Semanal de Checkout' },
      });
    });

    it('brings the draft discussion with its author and the position of that moment', () => {
      const marta = conMarta();
      const juan = h.core.addPerson({ name: 'Juan' });
      const action = h.core.registerAction({
        text: 'Migrar el pago',
        initiative: 'Checkout',
        actor: marta.id,
      });
      h.core.acceptAction(action.id, { actor: marta.id });
      h.core.placeInDraft(action.id);
      h.core.consolidate({ actor: marta.id, reason: 'Checkout primero' });
      h.clock.set('2026-08-12T09:00:00.000Z');
      h.core.commentInDraft(action.id, { actor: marta.id, text: 'Va primero por el trimestre.' });
      h.clock.set('2026-08-12T09:05:00.000Z');
      h.core.commentInDraft(action.id, { actor: juan.id, text: 'Entonces el alta se me va.' });

      const model = mainPage(h.core, marta);

      expect(model.comments[action.id]).toMatchObject([
        {
          text: 'Va primero por el trimestre.',
          author: { name: 'Marta' },
          at: '2026-08-12T09:00:00.000Z',
          positionThen: 1,
        },
        { text: 'Entonces el alta se me va.', author: { name: 'Juan' }, positionThen: 1 },
      ]);
      // What is negotiated internally never reaches the model of the credential-free page.
      expect(JSON.stringify(publishedPage(h.core))).not.toContain('Va primero por el trimestre.');
    });

    it('counts as unprioritized the registered and the accepted, and nothing else', () => {
      const marta = conMarta();
      const registrada = h.core.registerAction({
        text: 'Recién llegada',
        initiative: 'Plataforma',
        actor: marta.id,
      });
      const aceptada = h.core.registerAction({
        text: 'Aceptada sin posición',
        initiative: 'Plataforma',
        actor: marta.id,
      });
      h.core.acceptAction(aceptada.id, { actor: marta.id });
      const aplazada = h.core.registerAction({
        text: 'Para más adelante',
        initiative: 'Plataforma',
        actor: marta.id,
      });
      h.core.deferAction(aplazada.id, { actor: marta.id });

      const model = mainPage(h.core, marta);

      expect(model.draft.unprioritizedCount).toBe(2);
      expect(model.draft.pendingTriageCount).toBe(1);
      expect(model.draft.unordered.map((action) => action.id)).toEqual([aceptada.id]);
      expect(model.deferred.map((action) => action.text)).toEqual(['Para más adelante']);
      expect(registrada.status).toBe('registered');
    });

    it('leaves the completed action out of the active hierarchy and inside the history', () => {
      const marta = conMarta();
      const action = h.core.registerAction({
        text: 'Migrar el endpoint de pagos',
        initiative: 'Checkout',
        assignee: marta.id,
        actor: marta.id,
      });
      h.core.acceptAction(action.id, { actor: marta.id });
      h.core.placeInDraft(action.id);
      h.core.consolidate({ actor: marta.id, reason: 'Orden acordado' });
      h.core.completeAction(action.id, {
        actor: marta.id,
        comment: 'Desplegado el martes',
        links: ['https://acme.test/pr/318'],
      });

      const model = mainPage(h.core, marta);

      expect(model.draft.ordered).toEqual([]);
      expect(model.completed).toMatchObject([
        {
          text: 'Migrar el endpoint de pagos',
          completedBy: { name: 'Marta' },
          evidence: { comment: 'Desplegado el martes', links: ['https://acme.test/pr/318'] },
        },
      ]);
    });
  });

  describe('complete', () => {
    it('offers the closing only while the core admits it', () => {
      const marta = conMarta();
      const viva = h.core.registerAction({ text: 'Viva', initiative: 'Checkout', actor: marta.id });
      const descartada = h.core.registerAction({
        text: 'Descartada',
        initiative: 'Checkout',
        actor: marta.id,
      });
      h.core.rejectAction(descartada.id, { actor: marta.id });

      // Whether closing is allowed is the core's call; the page asks and does not restate it.
      expect(completePage(h.core, marta, viva.id).canComplete).toBe(true);
      expect(completePage(h.core, marta, descartada.id).canComplete).toBe(false);
    });

    it('refuses to assemble for an identifier that names nothing', () => {
      const marta = conMarta();

      expect(() => completePage(h.core, marta, 'no-existe')).toThrowError(/no such/i);
    });
  });

  describe('published page', () => {
    /** Three actions prioritized and signed: the world the published page shows. */
    const consolidada = () => {
      const marta = conMarta();
      const juan = h.core.addPerson({ name: 'Juan' });
      const priorizada = (text: string) => {
        const action = h.core.registerAction({
          text,
          initiative: 'Checkout',
          assignee: juan.id,
          actor: marta.id,
        });
        h.core.acceptAction(action.id, { actor: marta.id });
        h.core.placeInDraft(action.id);
        return action.id;
      };
      const pagos = priorizada('Migrar el pago');
      const carrito = priorizada('Arreglar el carrito');
      const iva = priorizada('Revisar el IVA');
      h.clock.set('2026-08-12T08:00:00.000Z');
      h.core.consolidate({ actor: marta.id, reason: 'Checkout va antes que Plataforma' });
      return { marta, juan, pagos, carrito, iva };
    };

    it('serves the hierarchy in force with its signature', () => {
      consolidada();

      const { hierarchy } = publishedPage(h.core);

      expect(hierarchy.consolidation).toMatchObject({
        version: 1,
        by: { name: 'Marta' },
        at: '2026-08-12T08:00:00.000Z',
        reason: 'Checkout va antes que Plataforma',
      });
      expect(hierarchy.ordered.map((entry) => entry.text)).toEqual([
        'Migrar el pago',
        'Arreglar el carrito',
        'Revisar el IVA',
      ]);
    });

    it('removes the completed from the order in force without renumbering the rest', () => {
      const { juan, carrito } = consolidada();
      h.core.completeAction(carrito, { actor: juan.id });

      const { hierarchy } = publishedPage(h.core);

      // It still names it, but outside the order in force: whoever held 3 still holds 3.
      expect(hierarchy.gone.map((entry) => [entry.position, entry.text])).toEqual([
        [2, 'Arreglar el carrito'],
      ]);
      expect(hierarchy.ordered.map((entry) => [entry.position, entry.text])).toEqual([
        [1, 'Migrar el pago'],
        [3, 'Revisar el IVA'],
      ]);
    });

    it('reflects the most recent consolidation as soon as somebody consolidates again', () => {
      const { marta, pagos, carrito, iva } = consolidada();
      h.core.setDraftOrder([iva, pagos, carrito]);
      h.clock.set('2026-08-19T08:00:00.000Z');
      h.core.consolidate({ actor: marta.id, reason: 'El IVA se adelanta por la auditoría' });

      const { hierarchy } = publishedPage(h.core);

      expect(hierarchy.consolidation).toMatchObject({
        version: 2,
        reason: 'El IVA se adelanta por la auditoría',
      });
      expect(hierarchy.ordered[0]).toMatchObject({ position: 1, text: 'Revisar el IVA' });
    });

    it('publishes neither the draft nor the triage inbox', () => {
      const { marta } = consolidada();
      h.core.registerAction({
        text: 'Recién salida de la reunión',
        initiative: 'Plataforma',
        actor: marta.id,
      });
      const negociandose = h.core.registerAction({
        text: 'En discusión con los stakeholders',
        initiative: 'Plataforma',
        actor: marta.id,
      });
      h.core.acceptAction(negociandose.id, { actor: marta.id });

      const { hierarchy } = publishedPage(h.core);
      const nombradas = [...hierarchy.ordered, ...hierarchy.gone].map((entry) => entry.text);

      expect(nombradas).not.toContain('Recién salida de la reunión');
      expect(nombradas).not.toContain('En discusión con los stakeholders');
    });

    it('tells apart never having consolidated from having consolidated empty', () => {
      expect(publishedPage(h.core).hierarchy.consolidation).toBeNull();

      const marta = conMarta();
      h.core.consolidate({ actor: marta.id, reason: 'Se firma sin nada ordenado todavía' });

      const { hierarchy } = publishedPage(h.core);

      expect(hierarchy.consolidation).toMatchObject({ version: 1 });
      expect(hierarchy.ordered).toEqual([]);
      expect(hierarchy.gone).toEqual([]);
    });

    it('warns of the stale hierarchy with the same reading as the main screen', () => {
      const marta = conMarta();
      const ordenada = h.core.registerAction({
        text: 'Ya ordenada',
        initiative: 'Checkout',
        actor: marta.id,
      });
      h.core.acceptAction(ordenada.id, { actor: marta.id });
      h.core.placeInDraft(ordenada.id);
      h.core.consolidate({ actor: marta.id, reason: 'Lo que había' });
      const suelta = h.core.registerAction({
        text: 'Aceptada el martes',
        initiative: 'Plataforma',
        actor: marta.id,
      });
      h.core.acceptAction(suelta.id, { actor: marta.id });

      // Friday: what was accepted on Tuesday hit its 48 business hours on Thursday.
      h.clock.set('2026-08-14T10:00:00.000Z');

      // The two views cannot contradict each other because it is literally the same
      // reading: neither of them derives it, which is why the signal can settle the argument.
      expect(publishedPage(h.core).hierarchy.staleness).toEqual({
        since: '2026-08-13T09:00:00.000Z',
        thresholdBusinessHours: 48,
      });
      expect(mainPage(h.core, marta).hierarchy).toEqual(publishedPage(h.core).hierarchy);

      // And consolidating switches it off in both at once, which is what the signal was asking for.
      h.core.placeInDraft(suelta.id);
      h.core.consolidate({ actor: marta.id, reason: 'Se firma lo pendiente' });

      expect(publishedPage(h.core).hierarchy.staleness).toBeNull();
      expect(mainPage(h.core, marta).hierarchy.staleness).toBeNull();
    });
  });

  describe('history', () => {
    /** Two consolidations with a real order change between them. */
    const conDosConsolidaciones = () => {
      const marta = conMarta();
      const pagos = h.core.registerAction({
        text: 'Migrar pagos',
        initiative: 'Checkout',
        actor: marta.id,
      });
      const alta = h.core.registerAction({
        text: 'Rediseñar el alta',
        initiative: 'Altas',
        actor: marta.id,
      });
      h.core.acceptAction(pagos.id, { actor: marta.id });
      h.core.acceptAction(alta.id, { actor: marta.id });

      h.core.setDraftOrder([pagos.id, alta.id]);
      h.clock.set('2026-08-10T09:00:00.000Z');
      h.core.consolidate({ actor: marta.id, reason: 'Pagos primero' });
      h.core.setDraftOrder([alta.id, pagos.id]);
      h.clock.set('2026-08-17T09:00:00.000Z');
      h.core.consolidate({ actor: marta.id, reason: 'El alta se adelanta' });

      return { marta, pagos: pagos.id };
    };

    it('says there is no history while nobody has consolidated', () => {
      const marta = conMarta();

      const model = historyPage(h.core, marta, preguntar('date=2026-08-12'));

      expect(model.history).toEqual([]);
      expect(model.shown).toEqual({ asked: 'date', date: '2026-08-12', consolidation: null });
      expect(model.refusal).toBeNull();
    });

    it('lists consolidations with version, author, date and reason', () => {
      const { marta } = conDosConsolidaciones();

      const model = historyPage(h.core, marta, preguntar(''));

      expect(model.history).toHaveLength(2);
      expect(model.history[0]?.signature).toMatchObject({
        version: 2,
        by: { name: 'Marta' },
        at: '2026-08-17T09:00:00.000Z',
        reason: 'El alta se adelanta',
      });
      expect(model.history[0]?.previous).toBe(1);
    });

    it('shows what changed between two consolidations', () => {
      const { marta } = conDosConsolidaciones();

      const model = historyPage(h.core, marta, preguntar('from=1&to=2'));

      expect(model.diff).toMatchObject({ from: { version: 1 }, to: { version: 2 } });
      // «rises» and «falls» are the diff's observation, never anyone's instruction.
      expect(
        model.diff?.changes.map((change) => [change.kind, change.before?.position, change.after?.position]),
      ).toEqual(
        expect.arrayContaining([
          ['rises', 2, 1],
          ['falls', 1, 2],
        ]),
      );
    });

    it('answers with the hierarchy in force on a given date', () => {
      const { marta } = conDosConsolidaciones();

      const model = historyPage(h.core, marta, preguntar('date=2026-08-12'));

      expect(model.shown).toMatchObject({
        asked: 'date',
        consolidation: { version: 1, reason: 'Pagos primero' },
      });
    });

    it('shows a specific version as it was signed', () => {
      const { marta } = conDosConsolidaciones();

      const model = historyPage(h.core, marta, preguntar('version=1'));

      expect(model.shown).toMatchObject({ asked: 'version', consolidation: { version: 1 } });
      expect(
        model.shown?.consolidation?.entries.map((entry) => entry.text),
      ).toEqual(['Migrar pagos', 'Rediseñar el alta']);
    });

    it('shows an action trajectory with the reason each move was signed with', () => {
      const { marta, pagos } = conDosConsolidaciones();

      const model = historyPage(h.core, marta, preguntar(`action=${pagos}`));

      expect(model.trajectory?.action).toMatchObject({ text: 'Migrar pagos' });
      expect(
        model.trajectory?.changes.map((change) => [change.kind, change.signature.reason]),
      ).toEqual([
        ['falls', 'El alta se adelanta'],
        ['enters', 'Pagos primero'],
      ]);
    });

    it('refuses the question it cannot understand without wiping the other answer', () => {
      const { marta } = conDosConsolidaciones();

      const model = historyPage(h.core, marta, preguntar('date=el martes pasado&from=1&to=2'));

      expect(model.refusal).toMatchObject({
        source: 'date',
        code: 'validation',
        values: { date: 'el martes pasado' },
      });
      expect(model.refusal?.message).toContain('is not understood');
      expect(model.diff).toMatchObject({ from: { version: 1 }, to: { version: 2 } });
      expect(model.history).toHaveLength(2);
    });

    it('attributes the refusal to the question that caused it', () => {
      const { marta } = conDosConsolidaciones();

      expect(historyPage(h.core, marta, preguntar('version=9')).refusal).toMatchObject({
        source: 'version',
        code: 'not_found',
      });
      expect(historyPage(h.core, marta, preguntar('action=no-existe')).refusal).toMatchObject({
        source: 'action',
        code: 'not_found',
      });
    });
  });
});

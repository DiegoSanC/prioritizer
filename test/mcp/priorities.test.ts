import { describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { useCore } from '../support/with-core.js';
import { useMcpAgent } from '../support/mcp-agent.js';

describe('MCP edge: get_priorities', () => {
  const h = useCore();
  const mcp = useMcpAgent(h);

  const priorities = async (client: Client = mcp.agent) =>
    client.callTool({ name: 'get_priorities', arguments: {} });

  /**
   * Breaks the store underneath the tool: the token still validates, so the failure
   * happens inside the call and not at the edge. There is no seam to inject the failure
   * through, so the rig reaches down to the table; renaming it breaks this.
   */
  const breakTheStore = () => {
    h.core.database.pragma('foreign_keys = OFF');
    h.core.database.exec('drop table consolidations');
  };

  it('says nothing has ever been consolidated, instead of answering an empty list', async () => {
    const result = await priorities();

    expect(result.structuredContent).toMatchObject({
      situation: 'never_consolidated',
      consolidation: null,
      priorities: [],
    });
  });

  it('tells the legitimate empty apart, with the signature of the hierarchy in force', async () => {
    mcp.drafted('De nadie', null);
    h.clock.set('2026-08-12T08:00:00.000Z');
    h.core.consolidate({ actor: mcp.marta, reason: 'Checkout va antes que Plataforma' });

    const result = await priorities();

    expect(result.structuredContent).toEqual({
      situation: 'no_pending',
      consolidation: {
        version: 1,
        at: '2026-08-12T08:00:00.000Z',
        by: { id: mcp.marta, name: 'Marta' },
        reason: 'Checkout va antes que Plataforma',
      },
      priorities: [],
      unprioritized: { count: 0, actions: [] },
      staleness: null,
    });
  });

  it('gives each agent its own assignee list, according to the token it carries', async () => {
    const ana = h.core.addPerson({ name: 'Ana' }).id;
    const deAna = mcp.drafted('Migrar el pago', ana);
    const deJuan = mcp.drafted('Arreglar el carrito', mcp.juan);
    h.core.setDraftOrder([deAna, deJuan]);
    h.core.consolidate({ actor: mcp.marta, reason: 'Orden acordado en el comité' });
    const agenteDeAna = await mcp.connect(ana, 'agente de Ana');

    const paraJuan = await priorities();
    const paraAna = await priorities(agenteDeAna);

    // The same hierarchy, the same argument-less call: the only thing that changes is the token.
    expect(paraJuan.structuredContent).toMatchObject({
      situation: 'has_pending',
      priorities: [
        { position: 2, actionId: deJuan, text: 'Arreglar el carrito', initiative: 'Checkout' },
      ],
      unprioritized: { count: 0, actions: [] },
    });
    expect(paraAna.structuredContent).toMatchObject({
      situation: 'has_pending',
      priorities: [
        { position: 1, actionId: deAna, text: 'Migrar el pago', initiative: 'Checkout' },
      ],
      unprioritized: { count: 0, actions: [] },
    });
  });

  it('delivers unprioritized actions in a separate block, with their count', async () => {
    mcp.drafted('Ya ordenada', mcp.juan);
    h.core.consolidate({ actor: mcp.marta, reason: 'Lo que había' });
    const suelta = h.core.registerAction({
      text: 'Nadie la ha ordenado',
      initiative: 'Plataforma',
      assignee: mcp.juan,
      actor: mcp.marta,
    });

    const result = await priorities();

    expect(result.structuredContent).toMatchObject({
      situation: 'has_pending',
      unprioritized: {
        count: 1,
        actions: [
          { actionId: suelta.id, text: 'Nadie la ha ordenado', initiative: 'Plataforma' },
        ],
      },
    });
  });

  it('stops offering a completed action as a priority, without reconsolidating anything', async () => {
    const hecha = mcp.drafted('Ya la hice', mcp.juan);
    const pendiente = mcp.drafted('Esta no', mcp.juan);
    h.core.setDraftOrder([hecha, pendiente]);
    h.core.consolidate({ actor: mcp.marta, reason: 'Orden acordado' });

    h.core.completeAction(hecha, { actor: mcp.juan, comment: 'Desplegada' });
    const result = await priorities();

    // The morning query comes out clean even though the hierarchy in force still names it:
    // the snapshot is immutable, what changed is that the action left the live flow.
    expect(result.structuredContent).toMatchObject({
      situation: 'has_pending',
      priorities: [{ position: 2, actionId: pendiente, text: 'Esta no' }],
      unprioritized: { count: 0, actions: [] },
    });
  });

  it('answers no_pending to whoever completed everything of theirs', async () => {
    const suya = mcp.drafted('La única', mcp.juan);
    h.core.consolidate({ actor: mcp.marta, reason: 'Lo que había' });
    h.core.completeAction(suya, { actor: mcp.juan });

    const result = await priorities();

    expect(result.structuredContent).toMatchObject({
      situation: 'no_pending',
      priorities: [],
      unprioritized: { count: 0, actions: [] },
    });
  });

  it('carries date, author and reason of the last consolidation in every answer', async () => {
    mcp.drafted('Ya ordenada', mcp.juan);
    h.clock.set('2026-08-12T08:00:00.000Z');
    h.core.consolidate({ actor: mcp.marta, reason: 'Primera' });
    h.clock.set('2026-08-14T11:30:00.000Z');
    h.core.consolidate({ actor: mcp.marta, reason: 'Se adelanta Plataforma tras hablar con Ana' });

    const result = await priorities();

    expect(result.structuredContent).toMatchObject({
      consolidation: {
        version: 2,
        at: '2026-08-14T11:30:00.000Z',
        by: { id: mcp.marta, name: 'Marta' },
        reason: 'Se adelanta Plataforma tras hablar con Ana',
      },
    });
  });

  it('returns an explicit error, and never an empty list, when the store fails', async () => {
    mcp.drafted('Ya ordenada', mcp.juan);
    h.core.consolidate({ actor: mcp.marta, reason: 'Lo que había' });
    breakTheStore();

    const result = await priorities();

    expect(result.isError).toBe(true);
    // Without `structuredContent` there is no payload to read: a failure cannot pass for
    // «you have nothing pending», because it carries neither situation nor lists.
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: 'The service could not resolve the request.' },
    ]);
  });

  it('writes the system failure in the log, with the detail for the operator', async () => {
    breakTheStore();

    await priorities();

    expect(h.core.listInvocations()).toMatchObject([
      { person: { id: mcp.juan, name: 'Juan' }, tool: 'get_priorities', outcome: 'failed' },
    ]);
    // Whoever operates gets the real cause, not the sanitized message the agent receives.
    const detail = h.core.listInvocations()[0]?.detail;
    expect(detail).toBeTruthy();
    expect(detail).not.toBe('The service could not resolve the request.');
  });

  it('with the database down the whole call fails, returning no answer at all', async () => {
    h.core.close();

    // The edge does not even get to authenticate: the call dies as a transport error,
    // which is the opposite of an empty answer the agent could read as «nothing
    // pending». And the message is not the invalid-token one: an outage is not a refusal.
    await expect(priorities()).rejects.toThrow(/The service cannot handle the request/);
  });

  it('records the agent query in the invocation log', async () => {
    await priorities();

    expect(h.core.listInvocations()).toEqual([
      {
        at: '2026-08-11T09:00:00.000Z',
        person: { id: mcp.juan, name: 'Juan' },
        tool: 'get_priorities',
        outcome: 'handled',
        detail: null,
      },
    ]);
  });

  describe('stale hierarchy signal', () => {
    it('travels in every answer with the date the hierarchy has been stale since', async () => {
      mcp.drafted('Ya ordenada', mcp.juan);
      h.core.consolidate({ actor: mcp.marta, reason: 'Lo que había' });
      mcp.accepted('Aceptada el martes y sin consolidar');

      h.clock.set('2026-08-14T10:00:00.000Z');
      const result = await priorities();

      expect(result.structuredContent).toMatchObject({
        situation: 'has_pending',
        staleness: { since: '2026-08-13T09:00:00.000Z', thresholdBusinessHours: 48 },
      });
    });

    it('switches off as soon as somebody consolidates, with nothing for the agent to infer', async () => {
      const suelta = mcp.accepted('Aceptada el martes y sin consolidar');
      h.clock.set('2026-08-14T10:00:00.000Z');
      expect((await priorities()).structuredContent).toMatchObject({
        staleness: { since: '2026-08-13T09:00:00.000Z' },
      });

      h.core.placeInDraft(suelta);
      h.core.consolidate({ actor: mcp.marta, reason: 'Se firma lo pendiente' });

      expect((await priorities()).structuredContent).toMatchObject({ staleness: null });
    });

    it('warns just the same someone with nothing pending of their own', async () => {
      const ana = h.core.addPerson({ name: 'Ana' }).id;
      const deAna = h.core.registerAction({
        text: 'Aceptada de Ana',
        initiative: 'Plataforma',
        assignee: ana,
        actor: mcp.marta,
      });
      h.core.acceptAction(deAna.id, { actor: mcp.marta });
      h.core.consolidate({ actor: mcp.marta, reason: 'Se firma sin nada ordenado' });

      h.clock.set('2026-08-14T10:00:00.000Z');
      const result = await priorities();

      // The warning is not about the asker's own work but about the hierarchy everyone
      // reads: Juan's agent has to be able to give it even when he himself is free.
      expect(result.structuredContent).toMatchObject({
        situation: 'no_pending',
        staleness: { since: '2026-08-13T09:00:00.000Z' },
      });
    });

    it('says the same as the published page, which is the fallback surface', async () => {
      mcp.accepted('Aceptada el martes y sin consolidar');

      h.clock.set('2026-08-14T10:00:00.000Z');
      const result = await priorities();

      // If the agent and the page read when the MCP is unavailable disagreed, the signal
      // would do more harm than not having it.
      expect(result.structuredContent).toMatchObject({
        staleness: h.core.currentHierarchy().staleness,
      });
    });
  });
});

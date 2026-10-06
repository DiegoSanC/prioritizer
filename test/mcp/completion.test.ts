import { describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { useCore } from '../support/with-core.js';
import { useMcpAgent } from '../support/mcp-agent.js';

describe('MCP edge: complete_action', () => {
  const h = useCore();
  const mcp = useMcpAgent(h);

  const complete = async (
    args: { actionId: string; comment?: string; links?: string[] },
    client: Client = mcp.agent,
  ) => client.callTool({ name: 'complete_action', arguments: args });

  it('closes with no evidence at all, and returns the author and instant of the closing', async () => {
    const id = mcp.prioritized('Migrar el endpoint de pagos');
    h.clock.set('2026-08-13T17:20:00.000Z');

    const result = await complete({ actionId: id });

    expect(result.structuredContent).toEqual({
      actionId: id,
      text: 'Migrar el endpoint de pagos',
      initiative: 'Checkout',
      completedAt: '2026-08-13T17:20:00.000Z',
      completedBy: { id: mcp.juan, name: 'Juan' },
      evidence: { comment: null, links: [] },
    });
  });

  it('closes with evidence: comment and links to the PR and the external tracker', async () => {
    const id = mcp.prioritized('Migrar el endpoint de pagos');

    const result = await complete({
      actionId: id,
      comment: 'Desplegado el martes con la migración de datos incluida',
      links: ['https://github.com/acme/api/pull/318', 'https://jira.example.com/browse/CHK-42'],
    });

    expect(result.structuredContent).toMatchObject({
      evidence: {
        comment: 'Desplegado el martes con la migración de datos incluida',
        links: ['https://github.com/acme/api/pull/318', 'https://jira.example.com/browse/CHK-42'],
      },
    });
  });

  it('stops offering in get_priorities the action the agent itself just closed', async () => {
    const hecha = mcp.prioritized('Ya la hice');
    const pendiente = mcp.prioritized('Esta no');

    await complete({ actionId: hecha });
    const result = await mcp.agent.callTool({ name: 'get_priorities', arguments: {} });

    // Nobody has consolidated again: the signed snapshot still names it, and even so the
    // morning query comes out clean because the action left the live flow.
    expect(result.structuredContent).toMatchObject({
      situation: 'has_pending',
      priorities: [{ actionId: pendiente, text: 'Esta no' }],
      unprioritized: { count: 0, actions: [] },
    });
  });

  it('remains in the history with evidence, date and author, even after a restart', async () => {
    const id = mcp.prioritized('Con traza');
    h.clock.set('2026-08-13T17:20:00.000Z');

    await complete({ actionId: id, comment: 'Cerrada', links: ['https://acme.test/pr/1'] });
    h.reopen();

    const action = h.core.getAction(id);
    expect(action).toMatchObject({
      status: 'completed',
      completedAt: '2026-08-13T17:20:00.000Z',
      completedBy: { id: mcp.juan, name: 'Juan' },
      evidence: { comment: 'Cerrada', links: ['https://acme.test/pr/1'] },
    });
    // What is closed from the agent enters the same trace as what is closed from the web.
    expect(action?.transitions.at(-1)).toMatchObject({
      from: 'prioritized',
      to: 'completed',
      by: mcp.juan,
    });
    // And it is queried the way the history is queried, not only by its identifier.
    expect(h.core.listActions({ status: 'completed' }).map((a) => a.id)).toEqual([id]);
  });

  it('records the closing in the invocation log, with and without evidence', async () => {
    const conEvidencia = mcp.prioritized('Con evidencia');
    const sinEvidencia = mcp.prioritized('Sin evidencia');

    await complete({ actionId: conEvidencia, comment: 'Hecha' });
    h.clock.advanceHours(1);
    await complete({ actionId: sinEvidencia });

    expect(h.core.listInvocations()).toEqual([
      {
        at: '2026-08-11T09:00:00.000Z',
        person: { id: mcp.juan, name: 'Juan' },
        tool: 'complete_action',
        outcome: 'handled',
        detail: null,
      },
      {
        at: '2026-08-11T10:00:00.000Z',
        person: { id: mcp.juan, name: 'Juan' },
        tool: 'complete_action',
        outcome: 'handled',
        detail: null,
      },
    ]);
  });

  describe('what the core refuses, in its own words', () => {
    /** A domain refusal: explicit error, no payload, and with the core's message. */
    const expectRefusal = (result: Awaited<ReturnType<typeof complete>>, message: string) => {
      expect(result.isError).toBe(true);
      // Without `structuredContent` there is nothing an agent could read as a completed closing.
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([{ type: 'text', text: message }]);
    };

    it('refuses an action that does not exist', async () => {
      const result = await complete({ actionId: 'inventada' });

      expectRefusal(result, 'No such action.');
    });

    it('refuses an action that no longer admits closing, naming its status', async () => {
      const id = mcp.prioritized('Solo una vez');
      await complete({ actionId: id });

      const result = await complete({ actionId: id });

      expectRefusal(result, 'Only live actions can be completed; this one is in status completed.');
    });

    it('refuses as evidence what is not a link, and closes nothing', async () => {
      const id = mcp.prioritized('Con evidencia dudosa');

      const result = await complete({ actionId: id, links: ['lo hablamos el martes'] });

      expectRefusal(result, 'The evidence link is not a valid URL: lo hablamos el martes');
      expect(h.core.getAction(id)?.status).toBe('prioritized');
    });

    it('refuses to close another person action, which stays live and prioritized', async () => {
      const ana = h.core.addPerson({ name: 'Ana' }).id;
      const deAna = mcp.prioritized('Migrar el pago', ana);

      const result = await complete({ actionId: deAna });

      expectRefusal(result, 'You can only complete actions you are the assignee of.');
      expect(h.core.getAction(deAna)?.status).toBe('prioritized');
    });

    it('writes the refusal in the log with the same motive the agent received', async () => {
      await complete({ actionId: 'inventada' });

      // The refusal is not a system failure, but it is a call that went unserved:
      // whoever operates reads the exact motive, without having to deduce it.
      expect(h.core.listInvocations()).toEqual([
        {
          at: '2026-08-11T09:00:00.000Z',
          person: { id: mcp.juan, name: 'Juan' },
          tool: 'complete_action',
          outcome: 'failed',
          detail: 'No such action.',
        },
      ]);
    });
  });
});

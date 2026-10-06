import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';
import { startTestMcp, type McpHarness } from '../support/mcp-client.js';

describe('MCP edge: identity by token', () => {
  const h = useCore();
  let mcp: McpHarness;

  beforeEach(async () => {
    mcp = await startTestMcp(h.core);
  });

  afterEach(async () => {
    await mcp.close();
  });

  it('returns the identity of the person who owns the token', async () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'agente de Juan' });

    const client = await mcp.connect(token.value);
    const result = await client.callTool({ name: 'whoami', arguments: {} });

    expect(result.structuredContent).toEqual({
      id: juan.id,
      name: 'Juan',
      roles: [],
    });
  });

  it('refuses with a clear error a token nobody issued', async () => {
    await expect(mcp.connect('prz_inventado')).rejects.toThrow('Invalid or revoked token.');
  });

  it('refuses with a clear error a revoked token', async () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'agente de Juan' });
    h.core.revokeToken(token.id);

    await expect(mcp.connect(token.value)).rejects.toThrow('Invalid or revoked token.');
  });

  it('refuses with a clear error a call with no token', async () => {
    await expect(mcp.connect('')).rejects.toThrow('Invalid or revoked token.');
  });

  it('records each invocation with its user and instant', async () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'agente de Juan' });

    const client = await mcp.connect(token.value);
    await client.callTool({ name: 'whoami', arguments: {} });
    h.clock.advanceHours(1);
    await client.callTool({ name: 'whoami', arguments: {} });

    expect(h.core.listInvocations()).toEqual([
      {
        at: '2026-08-11T09:00:00.000Z',
        person: { id: juan.id, name: 'Juan' },
        tool: 'whoami',
        outcome: 'handled',
        detail: null,
      },
      {
        at: '2026-08-11T10:00:00.000Z',
        person: { id: juan.id, name: 'Juan' },
        tool: 'whoami',
        outcome: 'handled',
        detail: null,
      },
    ]);
  });

  it('leaves a trace of a revoked token denial, in its person name', async () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'portátil viejo' });
    h.core.revokeToken(token.id);

    await expect(mcp.connect(token.value)).rejects.toThrow('Invalid or revoked token.');

    // Rotating a token cannot look like a dev who abandoned the product: the row
    // exists, with its person, and names no tool because the call died beforehand.
    expect(h.core.listInvocations()).toEqual([
      {
        at: '2026-08-11T09:00:00.000Z',
        person: { id: juan.id, name: 'Juan' },
        tool: null,
        outcome: 'denied',
        detail: 'Revoked token («portátil viejo»).',
      },
    ]);
  });

  it('records no invocation at all when the token is unknown', async () => {
    await expect(mcp.connect('prz_inventado')).rejects.toThrow('Invalid or revoked token.');
    await expect(mcp.connect('')).rejects.toThrow('Invalid or revoked token.');

    expect(h.core.listInvocations()).toEqual([]);
  });

  it('tells apart in the log the denial from the query that was handled', async () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const vivo = h.core.issueToken({ person: juan.id, label: 'portátil nuevo' });
    const caducado = h.core.issueToken({ person: juan.id, label: 'portátil viejo' });
    h.core.revokeToken(caducado.id);

    await expect(mcp.connect(caducado.value)).rejects.toThrow('Invalid or revoked token.');
    h.clock.advanceHours(1);
    const client = await mcp.connect(vivo.value);
    await client.callTool({ name: 'whoami', arguments: {} });

    expect(h.core.listInvocations()).toMatchObject([
      { at: '2026-08-11T09:00:00.000Z', tool: null, outcome: 'denied' },
      { at: '2026-08-11T10:00:00.000Z', tool: 'whoami', outcome: 'handled' },
    ]);
  });
});

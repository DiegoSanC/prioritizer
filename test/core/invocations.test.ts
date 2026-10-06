import { describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('the agent invocation log', () => {
  const h = useCore();

  it('records each invocation with its user and instant', () => {
    const juan = h.core.addPerson({ name: 'Juan' });

    h.core.recordInvocation({ actor: juan.id, tool: 'whoami', outcome: 'handled' });

    expect(h.core.listInvocations()).toEqual([
      {
        at: '2026-08-11T09:00:00.000Z',
        person: { id: juan.id, name: 'Juan' },
        tool: 'whoami',
        outcome: 'handled',
        detail: null,
      },
    ]);
  });

  it('also records the failed invocation, with its motive', () => {
    const juan = h.core.addPerson({ name: 'Juan' });

    h.core.recordInvocation({
      actor: juan.id,
      tool: 'whoami',
      outcome: 'failed',
      detail: 'La base de datos no responde.',
    });

    expect(h.core.listInvocations()).toEqual([
      expect.objectContaining({
        tool: 'whoami',
        outcome: 'failed',
        detail: 'La base de datos no responde.',
      }),
    ]);
  });

  it('keeps the log across service restarts', () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    h.core.recordInvocation({ actor: juan.id, tool: 'whoami', outcome: 'handled' });

    h.reopen();

    expect(h.core.listInvocations()).toHaveLength(1);
  });
});

describe('the MCP door: who it admits and what it leaves a trace of', () => {
  const h = useCore();

  it('writes down a revoked token denial in its person name', () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'portátil viejo' });
    h.core.revokeToken(token.id);

    expect(h.core.admitAgent(token.value)).toBeNull();

    // The denial names no tool at all: it died before there was one. That is what keeps
    // it from counting as a query and from confusing a dev with an expired token
    // with one who stopped asking.
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

  it('writes down nothing for a token nobody issued', () => {
    expect(h.core.admitAgent('prz_inventado')).toBeNull();
    expect(h.core.admitAgent('')).toBeNull();

    // There is nobody to attribute it to, and anyone reaching the endpoint could bloat
    // the log with garbage.
    expect(h.core.listInvocations()).toEqual([]);
  });

  it('admits the live token writing nothing: that is for whoever serves the tool', () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'portátil' });

    expect(h.core.admitAgent(token.value)).toEqual({ id: juan.id, name: 'Juan' });

    expect(h.core.listInvocations()).toEqual([]);
    expect(h.core.listTokens()[0]?.lastUsedAt).toBe('2026-08-11T09:00:00.000Z');
  });

  it('entering the web with a revoked token does not touch the MCP log', () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'portátil viejo' });
    h.core.revokeToken(token.id);

    // The log measures adoption by MCP person and tool; the web is neither of the
    // two, so its door stays mute.
    expect(h.core.authenticate(token.value)).toBeNull();

    expect(h.core.listInvocations()).toEqual([]);
  });

  it('keeps the denials across service restarts', () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'portátil viejo' });
    h.core.revokeToken(token.id);
    h.core.admitAgent(token.value);

    h.reopen();

    expect(h.core.listInvocations()).toMatchObject([{ outcome: 'denied', tool: null }]);
  });
});

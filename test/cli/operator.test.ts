import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/commands.js';
import { useCore } from '../support/with-core.js';

describe('operator CLI: registering users and tokens by hand', () => {
  const h = useCore();

  function run(...argv: string[]): string {
    const lines: string[] = [];
    runCli(h.core, argv, (line) => lines.push(line));
    return lines.join('\n');
  }

  it('registers a person, issues them a token and shows it exactly once', () => {
    run('people', 'add', 'Juan');

    const emitted = run('tokens', 'issue', 'Juan', 'agente de Juan');
    const token = /prz_[A-Za-z0-9_-]+/.exec(emitted)?.[0] ?? '';

    expect(h.core.authenticate(token)).toMatchObject({ name: 'Juan' });
    expect(run('tokens')).not.toContain(token);
    expect(run('tokens')).toContain('agente de Juan');
  });

  it('revokes a token with the identifier the CLI itself prints', () => {
    run('people', 'add', 'Juan');
    const emitted = run('tokens', 'issue', 'Juan', 'agente de Juan');
    const token = /prz_[A-Za-z0-9_-]+/.exec(emitted)?.[0] ?? '';
    const tokenId = /Identifier to revoke it: (\S+)/.exec(emitted)?.[1] ?? '';

    run('tokens', 'revoke', tokenId);

    expect(h.core.authenticate(token)).toBeNull();
  });

  it('grants and revokes the consolidator role by the person name', () => {
    run('people', 'add', 'Marta');
    const marta = h.core.listPeople()[0];

    run('roles', 'grant', 'Marta', 'consolidator');
    expect(h.core.hasRole(marta?.id ?? '', 'consolidator')).toBe(true);
    expect(run('people')).toContain('consolidator');

    run('roles', 'revoke', 'Marta', 'consolidator');
    expect(h.core.hasRole(marta?.id ?? '', 'consolidator')).toBe(false);
  });

  it('grants the triage role to several people and revokes it from just one', () => {
    run('people', 'add', 'Marta');
    run('people', 'add', 'Ana');
    const marta = h.core.resolvePerson('Marta');
    const ana = h.core.resolvePerson('Ana');

    run('roles', 'grant', 'Marta', 'triager');
    run('roles', 'grant', 'Ana', 'triager');
    expect(h.core.canTriage(marta.id)).toBe(true);
    expect(h.core.canTriage(ana.id)).toBe(true);

    // Revoking it from one does not revoke it from the other: triage belongs to nobody exclusively.
    run('roles', 'revoke', 'Ana', 'triager');
    expect(h.core.canTriage(ana.id)).toBe(false);
    expect(h.core.canTriage(marta.id)).toBe(true);
  });

  it('names the triage role among those it can grant', () => {
    expect(run('help')).toContain('triager');
  });

  it('registers an alias by the person name and lists it', () => {
    run('people', 'add', 'Juan Pérez');

    run('alias', 'add', 'Juan Pérez', 'juan.perez@ejemplo.es');

    expect(h.core.listAliases()).toMatchObject([
      { alias: 'juan.perez@ejemplo.es', person: { name: 'Juan Pérez' } },
    ]);
    expect(run('alias')).toContain('«juan.perez@ejemplo.es» → Juan Pérez');
  });

  it('corrects an alias with the identifier the CLI itself prints', () => {
    run('people', 'add', 'Luis Ortega');
    run('people', 'add', 'Lucía Ortega');
    run('alias', 'add', 'Luis Ortega', 'Lucía');
    const id = /^(\S+)/m.exec(run('alias'))?.[1] ?? '';

    run('alias', 'edit', id, 'Lucía Ortega', 'Lucía');

    expect(h.core.listAliases()).toMatchObject([
      { alias: 'Lucía', person: { name: 'Lucía Ortega' } },
    ]);
  });

  it('removes an alias', () => {
    run('people', 'add', 'Juan Pérez');
    run('alias', 'add', 'Juan Pérez', 'Juan P.');
    const id = /^(\S+)/m.exec(run('alias'))?.[1] ?? '';

    run('alias', 'remove', id);

    expect(h.core.listAliases()).toEqual([]);
    expect(run('alias')).toContain('No aliases registered');
  });

  it('names aliases among what it can administer', () => {
    expect(run('help')).toContain('alias');
  });

  it('shows the MCP invocation log', () => {
    run('people', 'add', 'Juan');
    const juan = h.core.listPeople()[0];
    h.core.recordInvocation({ actor: juan?.id ?? '', tool: 'whoami', outcome: 'handled' });

    expect(run('invocations')).toContain('Juan');
    expect(run('invocations')).toContain('whoami');
  });

  it('shows a revoked token denial without passing it off as a query', () => {
    run('people', 'add', 'Juan');
    const emitted = run('tokens', 'issue', 'Juan', 'portátil viejo');
    const token = /prz_[A-Za-z0-9_-]+/.exec(emitted)?.[0] ?? '';
    const tokenId = /Identifier to revoke it: (\S+)/.exec(emitted)?.[1] ?? '';
    run('tokens', 'revoke', tokenId);
    h.core.admitAgent(token);

    const shown = run('invocations');

    expect(shown).toContain('Juan');
    expect(shown).toContain('denied');
    expect(shown).toContain('Revoked token («portátil viejo»)');
    // Whoever operates has to see at a glance that nothing was ever requested there.
    expect(shown).toContain('no tool');
  });

  it('says so when the command does not exist', () => {
    expect(() => run('inventado')).toThrow('Unknown command');
  });

  it('says so when the person does not exist', () => {
    expect(() => run('tokens', 'issue', 'Nadie', 'portátil')).toThrow('No person answers');
  });
});

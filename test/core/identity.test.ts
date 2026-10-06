import { describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('identity: people and hand-issued tokens', () => {
  const h = useCore();

  it('issues a token that identifies its person', () => {
    const juan = h.core.addPerson({ name: 'Juan' });

    const token = h.core.issueToken({ person: juan.id, label: 'portátil de Juan' });

    expect(token.value).toMatch(/\S{20,}/);
    expect(h.core.authenticate(token.value)).toEqual({ id: juan.id, name: 'Juan' });
  });

  it('does not recognize a nonexistent token', () => {
    expect(h.core.authenticate('token-que-nadie-emitió')).toBeNull();
  });

  it('stops recognizing a revoked token', () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'portátil' });

    h.core.revokeToken(token.id);

    expect(h.core.authenticate(token.value)).toBeNull();
  });

  it('lists each person tokens without exposing their value', () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const token = h.core.issueToken({ person: juan.id, label: 'portátil' });

    const listed = h.core.listTokens();

    expect(listed).toEqual([
      {
        id: token.id,
        person: { id: juan.id, name: 'Juan' },
        label: 'portátil',
        issuedAt: '2026-08-11T09:00:00.000Z',
        revokedAt: null,
        lastUsedAt: null,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain(token.value);
  });

  it('grants and revokes the consolidator role, which several people can hold', () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    const ana = h.core.addPerson({ name: 'Ana' });

    h.core.grantRole(marta.id, 'consolidator');
    h.core.grantRole(ana.id, 'consolidator');

    expect(h.core.listPeople().filter((p) => p.roles.includes('consolidator')).map((p) => p.name)).toEqual([
      'Ana',
      'Marta',
    ]);

    h.core.revokeRole(ana.id, 'consolidator');
    expect(h.core.hasRole(ana.id, 'consolidator')).toBe(false);
    expect(h.core.hasRole(marta.id, 'consolidator')).toBe(true);
  });
});

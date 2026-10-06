import { randomUUID } from 'node:crypto';
import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { notFound, requireText } from './errors.js';
import { rolesOf } from './identity.js';
import type { Person, PersonRef } from './types.js';

interface PersonRow {
  id: string;
  name: string;
  created_at: string;
}

export function addPerson(ctx: CoreContext, input: { name: string }): Person {
  const name = requireText(input.name, 'name');
  const id = randomUUID();
  ctx.db
    .prepare('insert into people (id, name, created_at) values (?, ?, ?)')
    .run(id, name, nowIso(ctx));
  return { id, name, roles: [], createdAt: nowIso(ctx) };
}

export function listPeople(ctx: CoreContext): Person[] {
  const rows = ctx.db.prepare('select * from people order by name').all() as PersonRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    roles: rolesOf(ctx, row.id),
    createdAt: row.created_at,
  }));
}

export function findPerson(ctx: CoreContext, id: string): PersonRef | null {
  const row = ctx.db.prepare('select id, name from people where id = ?').get(id) as
    | Pick<PersonRow, 'id' | 'name'>
    | undefined;
  return row ? { id: row.id, name: row.name } : null;
}

/**
 * Resolves what a human typed — an identifier or the exact name — to one person.
 * Names are unique and identifiers are UUIDs, so at most one person can answer.
 */
export function resolvePerson(ctx: CoreContext, reference: string): PersonRef {
  const wanted = requireText(reference, 'person');
  const row = ctx.db
    .prepare('select id, name from people where id = ? or name = ?')
    .get(wanted, wanted) as Pick<PersonRow, 'id' | 'name'> | undefined;
  if (!row) {
    throw notFound(`No person answers to «${wanted}».`);
  }
  return { id: row.id, name: row.name };
}

export function requirePerson(ctx: CoreContext, id: string, field = 'person'): PersonRef {
  const person = findPerson(ctx, id);
  if (!person) {
    throw notFound(`No such ${field}.`);
  }
  return person;
}

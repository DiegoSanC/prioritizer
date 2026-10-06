import { randomUUID } from 'node:crypto';
import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { notFound, requireText, validationError } from './errors.js';
import { requirePerson } from './people.js';
import type { PersonRef } from './types.js';

/**
 * The correspondence between a person and a name a transcription tool attributes work to.
 *
 * A transcription tool labels speakers, not people: the label carries no identifier, a
 * human can relabel it after the fact, and the same person is «Juan Pérez» in one meeting
 * and «juan.perez@ejemplo.es» in the next. So a person holds as many aliases as the tool
 * has ways of naming them, and every one of them is written by the operator — nothing here
 * is ever derived from a transcript.
 */
export interface PersonAlias {
  id: string;
  person: PersonRef;
  /** The name in the transcript, exactly as the operator wrote it. */
  alias: string;
  createdAt: string;
}

interface AliasRow {
  id: string;
  alias: string;
  created_at: string;
  person_id: string;
  person_name: string;
}

const SELECT_ALIAS = `
  select a.id, a.alias, a.created_at, p.id as person_id, p.name as person_name
    from person_aliases a join people p on p.id = a.person_id
`;

/**
 * What two names have to share to be the same name.
 *
 * Deliberately shallow: Unicode form, whitespace and case, and nothing else. Each of the
 * three is a difference that cannot possibly mean a different human — «é» composed or
 * decomposed renders identically, a double space is invisible, and nobody is a different
 * person in lower case. Anything beyond that starts merging names that are genuinely
 * different: strip the accents and «Peña» answers for «Pena», take the first word and
 * every Juan in the organization answers for one of them. The cost of matching too little is
 * that the operator writes one more alias — a line of typing, and the triage assigns the
 * responsable in the meantime. The cost of matching too much is somebody else's work
 * silently landing on the wrong person, which nobody is going to notice.
 *
 * `ingestKey` normalizes an item's text the same three ways. That is a coincidence of two
 * separate decisions, not a shared rule: one answers "is this the same action", this one
 * answers "is this the same name", and either may move without the other.
 */
export function aliasKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function addAlias(ctx: CoreContext, input: { person: string; alias: string }): PersonAlias {
  const person = requirePerson(ctx, input.person, 'alias person');
  const alias = requireText(input.alias, 'transcript name');
  const id = randomUUID();
  const createdAt = nowIso(ctx);

  refuseCollision(ctx, alias, null);
  ctx.db
    .prepare(
      'insert into person_aliases (id, person_id, alias, alias_key, created_at) values (?, ?, ?, ?, ?)',
    )
    .run(id, person.id, alias, aliasKey(alias), createdAt);

  return { id, person, alias, createdAt };
}

/**
 * Corrects an alias whole: both the name and who it answers for. A mistyped name and a
 * name pointed at the wrong person are the same mistake from the operator's side — the
 * pair says something untrue — and stating the pair again is the shortest way to fix it.
 */
export function updateAlias(
  ctx: CoreContext,
  id: string,
  input: { person: string; alias: string },
): PersonAlias {
  const existing = getAlias(ctx, id);
  const person = requirePerson(ctx, input.person, 'alias person');
  const alias = requireText(input.alias, 'transcript name');

  refuseCollision(ctx, alias, existing.id);
  ctx.db
    .prepare('update person_aliases set person_id = ?, alias = ?, alias_key = ? where id = ?')
    .run(person.id, alias, aliasKey(alias), existing.id);

  return { ...existing, person, alias };
}

export function removeAlias(ctx: CoreContext, id: string): void {
  const result = ctx.db.prepare('delete from person_aliases where id = ?').run(id);
  if (result.changes === 0) {
    throw notFound('No existe el alias indicado.');
  }
}

export function listAliases(ctx: CoreContext): PersonAlias[] {
  const rows = ctx.db.prepare(`${SELECT_ALIAS} order by p.name, a.alias`).all() as AliasRow[];
  return rows.map(toAlias);
}

function getAlias(ctx: CoreContext, id: string): PersonAlias {
  const row = ctx.db.prepare(`${SELECT_ALIAS} where a.id = ?`).get(id) as AliasRow | undefined;
  if (!row) {
    throw notFound('No existe el alias indicado.');
  }
  return toAlias(row);
}

/**
 * The person a transcription tool meant by that name, or null when the table does not say.
 *
 * Null is a perfectly good answer and the common one: an unidentified speaker, a
 * collective, somebody from outside the organization. The caller leaves the action without
 * a responsable and the triage assigns one — never invent a person, and never fall back to
 * matching the name against the people themselves, which is the homonym trap this table
 * exists to avoid.
 */
export function resolveAlias(ctx: CoreContext, name: string): PersonRef | null {
  const key = aliasKey(name);
  if (key === '') return null;
  const row = ctx.db
    .prepare(
      `select p.id, p.name from person_aliases a join people p on p.id = a.person_id
        where a.alias_key = ?`,
    )
    .get(key) as PersonRef | undefined;
  return row ?? null;
}

/**
 * Refuses a name already spoken for. The unique index would refuse it anyway, with an
 * SQLite message; saying who holds it is what lets the operator fix it.
 *
 * `exceptId` is the alias being corrected, which must not collide with itself — a
 * correction that only repoints the person keeps the name it already holds. `is not`
 * rather than `<>` so that the null a fresh alias passes reads as "collides with any row"
 * instead of as SQL's null, which would compare false against every id and let anything
 * through.
 */
function refuseCollision(ctx: CoreContext, alias: string, exceptId: string | null): void {
  const row = ctx.db
    .prepare(
      `select p.name from person_aliases a join people p on p.id = a.person_id
        where a.alias_key = ? and a.id is not ?`,
    )
    .get(aliasKey(alias), exceptId) as { name: string } | undefined;
  if (row) {
    throw validationError(
      `The name «${alias}» is already an alias of ${row.name}: one transcript name cannot ` +
        'answer for two people.',
    );
  }
}

function toAlias(row: AliasRow): PersonAlias {
  return {
    id: row.id,
    person: { id: row.person_id, name: row.person_name },
    alias: row.alias,
    createdAt: row.created_at,
  };
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { notFound, requireText } from './errors.js';
import { recordDenial } from './invocations.js';
import { requirePerson } from './people.js';
import type { PersonRef, Role } from './types.js';

export interface IssuedToken {
  id: string;
  /** The only time the plaintext exists. The store keeps a hash. */
  value: string;
  person: PersonRef;
  label: string;
  issuedAt: string;
}

export interface TokenSummary {
  id: string;
  person: PersonRef;
  label: string;
  issuedAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function hashToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function issueToken(ctx: CoreContext, input: { person: string; label: string }): IssuedToken {
  const person = requirePerson(ctx, input.person);
  const label = requireText(input.label, 'label');
  const id = randomUUID();
  const value = `prz_${randomBytes(32).toString('base64url')}`;
  const issuedAt = nowIso(ctx);

  ctx.db
    .prepare(
      `insert into tokens (id, person_id, label, token_hash, issued_at) values (?, ?, ?, ?, ?)`,
    )
    .run(id, person.id, label, hashToken(value), issuedAt);

  return { id, value, person, label, issuedAt };
}

export function revokeToken(ctx: CoreContext, tokenId: string): void {
  const result = ctx.db
    .prepare('update tokens set revoked_at = ? where id = ? and revoked_at is null')
    .run(nowIso(ctx), tokenId);
  if (result.changes === 0) {
    throw notFound('No active token with that identifier.');
  }
}

export function listTokens(ctx: CoreContext): TokenSummary[] {
  const rows = ctx.db
    .prepare(
      `select t.id, t.label, t.issued_at, t.revoked_at, t.last_used_at, p.id as person_id, p.name as person_name
         from tokens t join people p on p.id = t.person_id
        order by t.issued_at, t.rowid`,
    )
    .all() as {
    id: string;
    label: string;
    issued_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    person_id: string;
    person_name: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    person: { id: row.person_id, name: row.person_name },
    label: row.label,
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  }));
}

/** A token as the store knows it, whether or not it still opens anything. */
interface Bearer {
  tokenId: string;
  person: PersonRef;
  label: string;
  revoked: boolean;
}

function findBearer(ctx: CoreContext, token: string): Bearer | null {
  if (!token) return null;
  const row = ctx.db
    .prepare(
      `select t.id, t.label, t.revoked_at, p.id as person_id, p.name as person_name
         from tokens t join people p on p.id = t.person_id
        where t.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | { id: string; label: string; revoked_at: string | null; person_id: string; person_name: string }
    | undefined;
  if (!row) return null;

  return {
    tokenId: row.id,
    person: { id: row.person_id, name: row.person_name },
    label: row.label,
    revoked: row.revoked_at !== null,
  };
}

/** Resolves a bearer token to its person, or null when unknown or revoked. */
export function authenticate(ctx: CoreContext, token: string): PersonRef | null {
  const bearer = findBearer(ctx, token);
  if (!bearer || bearer.revoked) return null;
  return touch(ctx, bearer);
}

/**
 * The MCP door, and the one place that decides what a rejected call is worth recording.
 *
 * It admits exactly what `authenticate` admits. The difference is the trace it leaves
 * when it turns away a *revoked* token: that person is known, and without the trace a
 * rotated credential is indistinguishable from a dev who stopped asking — which is
 * precisely what the adoption metrics read off this log. An *unknown* token leaves nothing:
 * there is nobody to attribute it to, and anyone who reaches the endpoint could
 * otherwise fill the log with noise.
 *
 * The label travels into the detail so the operator can tell which credential an agent
 * is still carrying — the log is the operator's own surface, and they issued the label.
 */
export function admitAgent(ctx: CoreContext, token: string): PersonRef | null {
  const bearer = findBearer(ctx, token);
  if (!bearer) return null;
  if (bearer.revoked) {
    // Deliberately not swallowed: if this write fails the store is broken, and the edge
    // turning that into a 503 is the honest answer. Reporting 401 while silently losing
    // the row would reintroduce the blind spot this door exists to close.
    recordDenial(ctx, { person: bearer.person, detail: `Revoked token («${bearer.label}»).` });
    return null;
  }
  return touch(ctx, bearer);
}

function touch(ctx: CoreContext, bearer: Bearer): PersonRef {
  ctx.db.prepare('update tokens set last_used_at = ? where id = ?').run(nowIso(ctx), bearer.tokenId);
  return bearer.person;
}

export function grantRole(ctx: CoreContext, personId: string, role: Role): void {
  requirePerson(ctx, personId);
  ctx.db
    .prepare('insert or ignore into person_roles (person_id, role, granted_at) values (?, ?, ?)')
    .run(personId, role, nowIso(ctx));
}

export function revokeRole(ctx: CoreContext, personId: string, role: Role): void {
  ctx.db.prepare('delete from person_roles where person_id = ? and role = ?').run(personId, role);
}

export function hasRole(ctx: CoreContext, personId: string, role: Role): boolean {
  const row = ctx.db
    .prepare('select 1 as present from person_roles where person_id = ? and role = ?')
    .get(personId, role) as { present: number } | undefined;
  return row !== undefined;
}

export function rolesOf(ctx: CoreContext, personId: string): Role[] {
  const rows = ctx.db
    .prepare('select role from person_roles where person_id = ? order by role')
    .all(personId) as { role: Role }[];
  return rows.map((row) => row.role);
}

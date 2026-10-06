import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { notFound, requireText, unauthorized, validationError } from './errors.js';
import { recordTransition } from './actions.js';
import { orderedActions } from './draft.js';
import { hasRole } from './identity.js';
import { requirePerson } from './people.js';
import type { PersonRef } from './types.js';

export interface ConsolidationEntry {
  position: number;
  actionId: string;
  /** Frozen at consolidation time: the snapshot never changes when the action does. */
  text: string;
  initiative: string;
  assignee: PersonRef | null;
}

export interface ConsolidationSignature {
  version: number;
  at: string;
  by: PersonRef;
  reason: string;
}

export interface Consolidation extends ConsolidationSignature {
  entries: ConsolidationEntry[];
}

export interface ConsolidateInput {
  actor: string;
  reason: string;
}

/**
 * Whether a person may sign the hierarchy. Any surface asks this instead of restating the
 * rule: it is the very predicate `consolidate` consults, so what a screen offers and what
 * the core allows cannot drift apart.
 *
 * Granted to as many people as needed: one absence must not be able to freeze the system.
 */
export function canConsolidate(ctx: CoreContext, personId: string): boolean {
  return hasRole(ctx, personId, 'consolidator');
}

/**
 * Turns the draft into the consolidated hierarchy: a new immutable version, signed
 * with who / when / why. Any consolidador may do it unilaterally — the consensus is
 * a human ritual outside the tool, so there is no approval flow to block on.
 */
export function consolidate(ctx: CoreContext, input: ConsolidateInput): Consolidation {
  const actor = requirePerson(ctx, input.actor, 'consolidating person');
  if (!canConsolidate(ctx, actor.id)) {
    throw unauthorized('Only someone with the consolidator role can consolidate the hierarchy.');
  }
  const reason = requireText(input.reason, 'consolidation reason');

  const entries = orderedActions(ctx);
  const at = nowIso(ctx);

  const write = ctx.db.transaction(() => {
    const version = nextVersion(ctx);
    ctx.db
      .prepare(
        'insert into consolidations (version, consolidated_at, consolidated_by, reason) values (?, ?, ?, ?)',
      )
      .run(version, at, actor.id, reason);

    const insert = ctx.db.prepare(
      `insert into consolidation_entries (version, position, action_id, text, initiative, assignee_id)
       values (?, ?, ?, ?, ?, ?)`,
    );
    entries.forEach((action, index) => {
      insert.run(version, index + 1, action.id, action.text, action.initiative, action.assignee?.id ?? null);
      if (action.status === 'accepted') {
        ctx.db.prepare(`update actions set status = 'prioritized' where id = ?`).run(action.id);
        recordTransition(ctx, {
          actionId: action.id,
          from: 'accepted',
          to: 'prioritized',
          by: actor.id,
          note: `Consolidation v${version}`,
        });
      }
    });
    return version;
  });

  const version = write();
  return getConsolidation(ctx, version) as Consolidation;
}

function nextVersion(ctx: CoreContext): number {
  const row = ctx.db.prepare('select max(version) as latest from consolidations').get() as {
    latest: number | null;
  };
  return (row.latest ?? 0) + 1;
}

export function getConsolidation(ctx: CoreContext, version: number): Consolidation | null {
  const row = ctx.db
    .prepare(
      `select c.version, c.consolidated_at, c.reason, p.id as by_id, p.name as by_name
         from consolidations c join people p on p.id = c.consolidated_by
        where c.version = ?`,
    )
    .get(version) as SignatureRow | undefined;
  if (!row) return null;
  return { ...toSignature(row), entries: entriesOf(ctx, version) };
}

/** For surfaces that address one version and have nothing to show if it is not there. */
export function getConsolidationOrFail(ctx: CoreContext, version: number): Consolidation {
  if (!Number.isInteger(version)) {
    throw validationError('A consolidation version is an integer.');
  }
  const consolidation = getConsolidation(ctx, version);
  if (!consolidation) {
    throw notFound(`No such consolidation v${version}.`);
  }
  return consolidation;
}

/** The version that was in force at an instant: the last one signed at or before it. */
export function consolidationInForceAt(ctx: CoreContext, instant: string): Consolidation | null {
  const row = ctx.db
    .prepare(
      `select version from consolidations
        where consolidated_at <= ?
        order by consolidated_at desc, version desc
        limit 1`,
    )
    .get(instant) as { version: number } | undefined;
  return row ? getConsolidation(ctx, row.version) : null;
}

export function currentConsolidation(ctx: CoreContext): Consolidation | null {
  const row = ctx.db.prepare('select max(version) as latest from consolidations').get() as {
    latest: number | null;
  };
  return row.latest === null ? null : getConsolidation(ctx, row.latest);
}

export function listConsolidations(ctx: CoreContext): ConsolidationSignature[] {
  const rows = ctx.db
    .prepare(
      `select c.version, c.consolidated_at, c.reason, p.id as by_id, p.name as by_name
         from consolidations c join people p on p.id = c.consolidated_by
        order by c.version desc`,
    )
    .all() as SignatureRow[];
  return rows.map(toSignature);
}

interface SignatureRow {
  version: number;
  consolidated_at: string;
  reason: string;
  by_id: string;
  by_name: string;
}

function toSignature(row: SignatureRow): ConsolidationSignature {
  return {
    version: row.version,
    at: row.consolidated_at,
    by: { id: row.by_id, name: row.by_name },
    reason: row.reason,
  };
}

function entriesOf(ctx: CoreContext, version: number): ConsolidationEntry[] {
  const rows = ctx.db
    .prepare(
      `select e.position, e.action_id, e.text, e.initiative, e.assignee_id, p.name as assignee_name
         from consolidation_entries e
         left join people p on p.id = e.assignee_id
        where e.version = ? order by e.position`,
    )
    .all(version) as {
    position: number;
    action_id: string;
    text: string;
    initiative: string;
    assignee_id: string | null;
    assignee_name: string | null;
  }[];

  return rows.map((row) => ({
    position: row.position,
    actionId: row.action_id,
    text: row.text,
    initiative: row.initiative,
    assignee:
      row.assignee_id && row.assignee_name ? { id: row.assignee_id, name: row.assignee_name } : null,
  }));
}

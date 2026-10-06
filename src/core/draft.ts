import type { CoreContext } from './context.js';
import { invalidTransition, notFound, validationError } from './errors.js';
import { countByStatus, listActions, recordTransition, toAction, type ActionRow } from './actions.js';
import { requirePerson } from './people.js';
import { UNPRIORITIZED_STATUSES, type Action } from './types.js';

export interface Draft {
  /** The proposed global order. Consolidating freezes exactly this list. */
  ordered: Action[];
  /** Accepted actions with no position yet — the draft's "unprioritized" section. */
  unordered: Action[];
  /** Registradas + aceptadas, whether or not they hold a position. */
  unprioritizedCount: number;
  pendingTriageCount: number;
}

export type Direction = 'up' | 'down';

/** Only actions that passed triage and are still live may hold a position. */
export const DRAFTABLE = ['accepted', 'prioritized'] as const;

export function getDraft(ctx: CoreContext): Draft {
  return {
    ordered: orderedActions(ctx),
    unordered: listActions(ctx, { status: 'accepted' }).filter((action) => !hasPosition(ctx, action.id)),
    unprioritizedCount: countByStatus(ctx, UNPRIORITIZED_STATUSES),
    pendingTriageCount: countByStatus(ctx, ['registered']),
  };
}

export function orderedActions(ctx: CoreContext): Action[] {
  const rows = ctx.db
    .prepare(
      `select a.*, assignee.name as assignee_name, completer.name as completed_by_name
         from draft_positions d
         join actions a on a.id = d.action_id
         left join people assignee  on assignee.id  = a.assignee_id
         left join people completer on completer.id = a.completed_by
        where a.status in (${DRAFTABLE.map(() => '?').join(', ')})
        order by d.position`,
    )
    .all(...DRAFTABLE) as ActionRow[];
  return rows.map(toAction);
}

export function orderedIds(ctx: CoreContext): string[] {
  return orderedActions(ctx).map((action) => action.id);
}

/**
 * Where an action sits in the proposed order as it reads today, or null if it holds no
 * position. It is the rank among the actions actually shown, not the stored number:
 * dropping one out of the flow leaves a gap in the column that nobody ever sees. That is
 * why it walks the whole order rather than reading one row — at a hierarchy a person can
 * hold in their head, being right is worth more than being direct.
 */
export function positionOf(ctx: CoreContext, actionId: string): number | null {
  const at = orderedIds(ctx).indexOf(actionId);
  return at === -1 ? null : at + 1;
}

export function setDraftOrder(ctx: CoreContext, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw validationError('The proposed order contains repeated actions.');
    }
    seen.add(id);
    requireDraftable(ctx, id);
  }
  requirePrioritizedIncluded(ctx, seen);

  const write = ctx.db.transaction(() => {
    ctx.db.prepare('delete from draft_positions').run();
    const insert = ctx.db.prepare('insert into draft_positions (action_id, position) values (?, ?)');
    ids.forEach((id, index) => insert.run(id, index + 1));
  });
  write();
}

export function placeInDraft(ctx: CoreContext, actionId: string): void {
  requireDraftable(ctx, actionId);
  const current = orderedIds(ctx).filter((id) => id !== actionId);
  setDraftOrder(ctx, [...current, actionId]);
}

/**
 * Takes an action out of the proposed order. One already consolidated goes back to
 * `aceptada`: `priorizada` means "is in the consolidated hierarchy", so leaving it there
 * while it sits in no order would hide it from both the draft's "unprioritized" section
 * and the agent's — a live action nobody could see.
 */
export function removeFromDraft(ctx: CoreContext, actionId: string, actor: string): void {
  const who = requirePerson(ctx, actor, 'reordering person');
  const row = ctx.db.prepare('select status from actions where id = ?').get(actionId) as
    | { status: string }
    | undefined;

  // The state gives way first, so the order is only ever set while the invariant holds:
  // this action is on its way out of the hierarchy, and stops being `priorizada` for it.
  const write = ctx.db.transaction(() => {
    if (row?.status === 'prioritized') {
      ctx.db.prepare(`update actions set status = 'accepted' where id = ?`).run(actionId);
      recordTransition(ctx, {
        actionId,
        from: 'prioritized',
        to: 'accepted',
        by: who.id,
        note: 'Sacada del orden del draft',
      });
    }
    setDraftOrder(
      ctx,
      orderedIds(ctx).filter((id) => id !== actionId),
    );
  });
  write();
}

export function moveInDraft(
  ctx: CoreContext,
  actionId: string,
  direction: Direction,
): void {
  const ids = orderedIds(ctx);
  const from = ids.indexOf(actionId);
  if (from === -1) {
    throw notFound('The action is not in the draft order.');
  }
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return;

  const reordered = [...ids];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved as string);
  setDraftOrder(ctx, reordered);
}

/** Drops a position when an action leaves the live flow (rejected, deferred, completed…). */
export function dropFromDraft(ctx: CoreContext, actionId: string): void {
  ctx.db.prepare('delete from draft_positions where action_id = ?').run(actionId);
}

function hasPosition(ctx: CoreContext, actionId: string): boolean {
  const row = ctx.db
    .prepare('select 1 as present from draft_positions where action_id = ?')
    .get(actionId) as { present: number } | undefined;
  return row !== undefined;
}

/**
 * A `priorizada` action is always in the proposed order — that is what the state means.
 * A partial order would leave one holding no position: gone from the draft, gone from the
 * next consolidation, and still counted as prioritised by nobody's decision.
 */
function requirePrioritizedIncluded(ctx: CoreContext, ids: ReadonlySet<string>): void {
  const rows = ctx.db.prepare(`select id from actions where status = 'prioritized'`).all() as {
    id: string;
  }[];
  const missing = rows.filter((row) => !ids.has(row.id));
  if (missing.length > 0) {
    throw validationError(
      `The proposed order leaves out ${missing.length} already prioritized action(s).`,
    );
  }
}

/** Whether an action belongs in the draft at all — the same door for ordering and for talking about it. */
export function requireDraftable(ctx: CoreContext, actionId: string): void {
  const row = ctx.db.prepare('select status from actions where id = ?').get(actionId) as
    | { status: string }
    | undefined;
  if (!row) {
    throw notFound('No such action.');
  }
  if (!(DRAFTABLE as readonly string[]).includes(row.status)) {
    throw invalidTransition(
      `Only accepted actions enter the draft; this one is in status ${row.status}.`,
    );
  }
}

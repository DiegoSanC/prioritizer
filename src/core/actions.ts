import { createHash, randomUUID } from 'node:crypto';
import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { notFound, requireText } from './errors.js';
import { requirePerson } from './people.js';
import { ACTIVE_STATUSES } from './types.js';
import type {
  Action,
  ActionDetail,
  ActionOrigin,
  ActionStatus,
  RegisterActionInput,
  SourceReference,
  Transition,
} from './types.js';

export interface ActionRow {
  id: string;
  text: string;
  initiative: string;
  assignee_id: string | null;
  assignee_name: string | null;
  status: ActionStatus;
  origin_kind: string;
  duplicate_of: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  evidence_comment: string | null;
  evidence_links: string | null;
  created_at: string;
  created_by: string;
  source_tool?: string | null;
  source_id?: string | null;
  source_meeting_date?: string | null;
  source_meeting_title?: string | null;
}

const SELECT_ACTION = `
  select a.*,
         assignee.name  as assignee_name,
         completer.name as completed_by_name
    from actions a
    left join people assignee  on assignee.id  = a.assignee_id
    left join people completer on completer.id = a.completed_by
`;

export function registerAction(ctx: CoreContext, input: RegisterActionInput): Action {
  const text = requireText(input.text, 'text');
  const initiative = requireText(input.initiative, 'initiative');
  const actor = requirePerson(ctx, input.actor, 'registering person');
  if (input.assignee) {
    requirePerson(ctx, input.assignee, 'assignee');
  }
  const source = input.source ?? null;

  const id = randomUUID();
  const at = nowIso(ctx);
  ctx.db
    .prepare(
      `insert into actions (id, text, initiative, assignee_id, status, origin_kind,
                            source_tool, source_id, source_meeting_date, source_meeting_title,
                            source_item_hash, created_at, created_by)
       values (?, ?, ?, ?, 'registered', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      text,
      initiative,
      input.assignee ?? null,
      source ? 'ingested' : 'manual',
      source?.tool ?? null,
      source?.sourceId ?? null,
      source?.meetingDate ?? null,
      source?.meetingTitle ?? null,
      // Derived here and nowhere else, so the stored key can never disagree with the
      // stored text: the two are written by the same statement or not at all.
      source ? ingestKey(text) : null,
      at,
      actor.id,
    );
  recordTransition(ctx, { actionId: id, from: null, to: 'registered', by: actor.id, note: null });

  return getActionOrFail(ctx, id);
}

/**
 * The digest half of an ingested item's idempotency key: its text, normalized so that
 * whitespace, line endings and casing cannot pass for a change.
 *
 * The whole key is the meeting plus this digest, and that pairing is a deliberate choice.
 * The id a transcription tool hands out is the meeting's, not the item's, and a summary
 * can be regenerated under that same id — so keying on the meeting alone would lose for
 * good every action a later regeneration adds. Keying on the text as well errs the other
 * way: a reworded item comes in as a new action and both show in the inbox. That is the
 * error worth making, because the spec already sends duplicates to a human via the
 * `duplicada` exit, whereas an action dropped in silence leaves no trace anywhere.
 */
export function ingestKey(text: string): string {
  const normalized = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Whether this very item of this very meeting was ingested before. The unique index on
 * the same three columns is what makes the answer binding rather than advisory.
 */
export function alreadyIngested(
  ctx: CoreContext,
  source: SourceReference,
  text: string,
): boolean {
  const row = ctx.db
    .prepare(
      `select 1 as present from actions
        where source_tool = ? and source_id = ? and source_item_hash = ?`,
    )
    .get(source.tool, source.sourceId, ingestKey(text)) as { present: number } | undefined;
  return row !== undefined;
}

export interface ListActionsFilter {
  status?: ActionStatus | ActionStatus[];
  assignee?: string;
}

export function listActions(ctx: CoreContext, filter: ListActionsFilter = {}): Action[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    clauses.push(`a.status in (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }
  if (filter.assignee) {
    clauses.push('a.assignee_id = ?');
    params.push(filter.assignee);
  }

  const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
  const rows = ctx.db
    .prepare(`${SELECT_ACTION} ${where} order by a.created_at, a.rowid`)
    .all(...params) as ActionRow[];
  return rows.map(toAction);
}

export function getAction(ctx: CoreContext, id: string): ActionDetail | null {
  const row = ctx.db.prepare(`${SELECT_ACTION} where a.id = ?`).get(id) as ActionRow | undefined;
  if (!row) return null;
  return { ...toAction(row), transitions: listTransitions(ctx, id) };
}

export function getActionOrFail(ctx: CoreContext, id: string): ActionDetail {
  const action = getAction(ctx, id);
  if (!action) {
    throw notFound('No such action.');
  }
  return action;
}

export function countByStatus(ctx: CoreContext, statuses: readonly ActionStatus[]): number {
  const row = ctx.db
    .prepare(
      `select count(*) as total from actions where status in (${statuses.map(() => '?').join(', ')})`,
    )
    .get(...statuses) as { total: number };
  return row.total;
}

/**
 * Of the given actions, the ones still in the active hierarchy. A consolidated snapshot
 * is frozen, so what has left the flow since — completed, above all — is still named in
 * it; this is what tells apart "the hierarchy says so" from "it is still live work".
 */
export function activeAmong(ctx: CoreContext, ids: readonly string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = ctx.db
    .prepare(
      `select id from actions
        where id in (${ids.map(() => '?').join(', ')})
          and status in (${ACTIVE_STATUSES.map(() => '?').join(', ')})`,
    )
    .all(...ids, ...ACTIVE_STATUSES) as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

export function recordTransition(
  ctx: CoreContext,
  input: {
    actionId: string;
    from: ActionStatus | null;
    to: ActionStatus;
    by: string;
    note: string | null;
  },
): void {
  ctx.db
    .prepare(
      `insert into action_transitions (action_id, from_status, to_status, at, by, note)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.actionId, input.from, input.to, nowIso(ctx), input.by, input.note);
}

export function listTransitions(ctx: CoreContext, actionId: string): Transition[] {
  const rows = ctx.db
    .prepare(
      `select from_status, to_status, at, by, note
         from action_transitions where action_id = ? order by id`,
    )
    .all(actionId) as {
    from_status: ActionStatus | null;
    to_status: ActionStatus;
    at: string;
    by: string;
    note: string | null;
  }[];
  return rows.map((row) => ({
    from: row.from_status,
    to: row.to_status,
    at: row.at,
    by: row.by,
    note: row.note,
  }));
}

export function toAction(row: ActionRow): Action {
  return {
    id: row.id,
    text: row.text,
    initiative: row.initiative,
    assignee:
      row.assignee_id && row.assignee_name ? { id: row.assignee_id, name: row.assignee_name } : null,
    status: row.status,
    origin: toOrigin(row),
    createdAt: row.created_at,
    createdBy: row.created_by,
    duplicateOf: row.duplicate_of,
    completedAt: row.completed_at,
    completedBy:
      row.completed_by && row.completed_by_name
        ? { id: row.completed_by, name: row.completed_by_name }
        : null,
    evidence:
      row.completed_at === null
        ? null
        : {
            comment: row.evidence_comment,
            links: row.evidence_links ? (JSON.parse(row.evidence_links) as string[]) : [],
          },
  };
}

function toOrigin(row: ActionRow): ActionOrigin {
  if (row.origin_kind !== 'ingested' || !row.source_tool || !row.source_id) {
    return { kind: 'manual' };
  }
  return {
    kind: 'ingested',
    source: {
      tool: row.source_tool,
      sourceId: row.source_id,
      meetingDate: row.source_meeting_date ?? null,
      meetingTitle: row.source_meeting_title ?? null,
    },
  };
}

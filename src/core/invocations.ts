import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { requireText } from './errors.js';
import { requirePerson } from './people.js';
import type { PersonRef } from './types.js';

/** Whether the invocation the agent got to make was answered, or failed while serving it. */
export type ServedOutcome = 'handled' | 'failed';

/**
 * How an invocation ended, as the log tells it. `denegada` is the call the agent never
 * got to make: the door turned it away, so it names no tool.
 *
 * Not `rechazada`, which this domain already spends on an action a person rejected in
 * triage — one word with two persisted meanings would be ambiguous in the very log the
 * operator reads. Rows written before this value existed are all served invocations, so
 * they keep their meaning untouched and there is nothing to backfill: a denial that was
 * never recorded cannot be reconstructed after the fact.
 */
export type InvocationOutcome = ServedOutcome | 'denied';

export interface Invocation {
  at: string;
  person: PersonRef;
  /** The tool the agent named — null when the call was rejected before naming one. */
  tool: string | null;
  outcome: InvocationOutcome;
  /** Why it did not go through. Written for the operator, not for the agent. */
  detail: string | null;
}

export interface RecordInvocationInput {
  actor: string;
  tool: string;
  outcome: ServedOutcome;
  detail?: string | null;
}

export function recordInvocation(ctx: CoreContext, input: RecordInvocationInput): void {
  const person = requirePerson(ctx, input.actor);
  const tool = requireText(input.tool, 'tool');
  insertInvocation(ctx, {
    personId: person.id,
    tool,
    outcome: input.outcome,
    detail: input.detail ?? null,
  });
}

/**
 * A call turned away at the door, kept in the same log as the ones that got through so
 * adoption reads as one chronology per person. It carries no tool because none was ever
 * named — see `admitAgent` in `identity.ts` for why this is recorded at all.
 */
export function recordDenial(ctx: CoreContext, input: { person: PersonRef; detail: string }): void {
  insertInvocation(ctx, {
    personId: input.person.id,
    tool: null,
    outcome: 'denied',
    detail: input.detail,
  });
}

// Named fields, not positionals: `tool` and `detail` are both nullable strings, and
// swapping them would type-check happily.
function insertInvocation(
  ctx: CoreContext,
  row: { personId: string; tool: string | null; outcome: InvocationOutcome; detail: string | null },
): void {
  ctx.db
    .prepare('insert into invocations (at, person_id, tool, outcome, detail) values (?, ?, ?, ?, ?)')
    .run(nowIso(ctx), row.personId, row.tool, row.outcome, row.detail);
}

export function listInvocations(ctx: CoreContext): Invocation[] {
  const rows = ctx.db
    .prepare(
      `select i.at, i.tool, i.outcome, i.detail, p.id as person_id, p.name as person_name
         from invocations i join people p on p.id = i.person_id
        order by i.at, i.id`,
    )
    .all() as {
    at: string;
    tool: string | null;
    outcome: InvocationOutcome;
    detail: string | null;
    person_id: string;
    person_name: string;
  }[];

  return rows.map((row) => ({
    at: row.at,
    person: { id: row.person_id, name: row.person_name },
    tool: row.tool,
    outcome: row.outcome,
    detail: row.detail,
  }));
}

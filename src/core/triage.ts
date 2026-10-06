import type { CoreContext } from './context.js';
import { invalidTransition, requireText, unauthorized, validationError } from './errors.js';
import { getActionOrFail, recordTransition } from './actions.js';
import { dropFromDraft } from './draft.js';
import { hasRole } from './identity.js';
import { requirePerson } from './people.js';
import type { Action, ActionDetail, ActionStatus, PersonRef } from './types.js';

export interface TriageInput {
  actor: string;
  note?: string | null;
}

export interface AcceptInput extends TriageInput {
  initiative?: string;
  assignee?: string | null;
}

/**
 * Accepting is only ever a decision on the inbox. The three exits (rechazar, aplazar,
 * duplicada) are also reachable from `aceptada`: without that correction path a
 * mistakenly accepted action could never leave the flow, and it would inflate the
 * "unprioritized" signal — and trip the staleness rule — for good.
 */
const TRIAGE_EXIT_FROM: readonly ActionStatus[] = ['registered', 'accepted'];

function requireStatusIn(action: ActionDetail, allowed: readonly ActionStatus[]): void {
  if (!allowed.includes(action.status)) {
    throw invalidTransition(`The action already left the inbox: it is in status ${action.status}.`);
  }
}

/**
 * Whether a person may decide on the inbox. Any surface asks this instead of restating the
 * rule: it is the very predicate the door below consults, so what a screen offers and what
 * the core allows cannot drift apart — hiding without closing, or closing without hiding,
 * would each be a different kind of lie.
 *
 * Granted to as many people as needed: the triage is not one person's job, and one absence
 * must not be able to stop the inbox.
 */
export function canTriage(ctx: CoreContext, personId: string): boolean {
  return hasRole(ctx, personId, 'triager');
}

/**
 * The triage door: who is asking, and whether they were granted the decision. Every entry
 * point below opens it first, before reading or writing anything — whoever may not decide
 * learns nothing about the action, and a refusal never leaves half a decision behind.
 */
function requireTriager(ctx: CoreContext, reference: string): PersonRef {
  const actor = requirePerson(ctx, reference, 'triaging person');
  if (!canTriage(ctx, actor.id)) {
    throw unauthorized('Only someone with the triager role can triage the inbox.');
  }
  return actor;
}

/**
 * The one write every triage decision ends in. It takes the actor already through the
 * door — not the reference — so no decision can reach the store without having passed it.
 */
function transition(
  ctx: CoreContext,
  actionId: string,
  to: ActionStatus,
  actor: PersonRef,
  input: TriageInput,
): Action {
  const action = getActionOrFail(ctx, actionId);
  requireStatusIn(action, TRIAGE_EXIT_FROM);

  ctx.db.prepare('update actions set status = ? where id = ?').run(to, actionId);
  if (to !== 'accepted') {
    dropFromDraft(ctx, actionId);
  }
  recordTransition(ctx, {
    actionId,
    from: action.status,
    to,
    by: actor.id,
    note: input.note?.trim() || null,
  });

  return getActionOrFail(ctx, actionId);
}

export function acceptAction(ctx: CoreContext, actionId: string, input: AcceptInput): Action {
  const actor = requireTriager(ctx, input.actor);
  const action = getActionOrFail(ctx, actionId);
  requireStatusIn(action, ['registered']);

  if (input.initiative !== undefined) {
    const initiative = requireText(input.initiative, 'initiative');
    ctx.db.prepare('update actions set initiative = ? where id = ?').run(initiative, actionId);
  }
  if (input.assignee !== undefined) {
    if (input.assignee) requirePerson(ctx, input.assignee, 'assignee');
    ctx.db.prepare('update actions set assignee_id = ? where id = ?').run(input.assignee || null, actionId);
  }

  return transition(ctx, actionId, 'accepted', actor, input);
}

export function rejectAction(ctx: CoreContext, actionId: string, input: TriageInput): Action {
  return transition(ctx, actionId, 'rejected', requireTriager(ctx, input.actor), input);
}

export function deferAction(ctx: CoreContext, actionId: string, input: TriageInput): Action {
  return transition(ctx, actionId, 'deferred', requireTriager(ctx, input.actor), input);
}

/**
 * Marks an action as a duplicate of an existing one and keeps the reference, so the
 * "unprioritized" signal is not inflated by repeats. Dedup is human, never automatic.
 */
export function markDuplicate(
  ctx: CoreContext,
  actionId: string,
  input: TriageInput & { duplicateOf: string },
): Action {
  const actor = requireTriager(ctx, input.actor);
  if (input.duplicateOf === actionId) {
    throw validationError('An action cannot be a duplicate of itself.');
  }
  const original = getActionOrFail(ctx, input.duplicateOf);
  if (original.status === 'duplicate') {
    throw validationError('The chosen action is itself a duplicate; merge against the original.');
  }

  ctx.db.prepare('update actions set duplicate_of = ? where id = ?').run(input.duplicateOf, actionId);
  return transition(ctx, actionId, 'duplicate', actor, input);
}

/**
 * Brings a deferred action back into the inbox — behind the same door as the rest.
 * Reactivating undoes a deferral, puts the action back into "unprioritized" and asks the
 * triage for a decision it had already taken: leaving it open would let anyone reopen at
 * will what only a triador could close.
 */
export function reactivateAction(ctx: CoreContext, actionId: string, input: TriageInput): Action {
  const actor = requireTriager(ctx, input.actor);
  const action = getActionOrFail(ctx, actionId);
  if (action.status !== 'deferred') {
    throw invalidTransition('Only deferred actions can be reactivated.');
  }

  ctx.db.prepare(`update actions set status = 'registered' where id = ?`).run(actionId);
  recordTransition(ctx, {
    actionId,
    from: 'deferred',
    to: 'registered',
    by: actor.id,
    note: input.note?.trim() || null,
  });

  return getActionOrFail(ctx, actionId);
}

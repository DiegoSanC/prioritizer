import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { getActionOrFail, recordTransition } from './actions.js';
import { dropFromDraft } from './draft.js';
import { invalidTransition, unauthorized, validationError } from './errors.js';
import { requirePerson } from './people.js';
import { ACTIVE_STATUSES, type ActionStatus, type CompletedAction } from './types.js';

export interface CompleteInput {
  actor: string;
  /** Optional evidence: what was done and where it can be seen. */
  comment?: string | null;
  links?: string[] | null;
}

/**
 * Whether an action can still be closed. Adapters ask this instead of restating it: the
 * rule that decides has exactly one home, and it is this one.
 *
 * Every live state qualifies, `registrada` included — a deliberate deviation from the
 * spec's diagram, in the same spirit as `TRIAGE_EXIT_FROM`. Both the registradas and the
 * aceptadas of a person already reach their agent in the "unprioritized" block, so
 * refusing to close one would show a dev work they cannot report done: the action would
 * sit in the inbox for good, inflating that same signal, and the evidence would be lost.
 * What is recorded says so — the transition keeps the state it was closed from.
 */
export function canComplete(status: ActionStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Closes an action: it leaves the active hierarchy and stays in the history with its
 * evidence, date and author. One operation for both channels — the web and the agent —
 * because the same closing must not be able to mean two different things.
 */
export function completeAction(
  ctx: CoreContext,
  actionId: string,
  input: CompleteInput,
): CompletedAction {
  const action = getActionOrFail(ctx, actionId);
  if (!canComplete(action.status)) {
    throw invalidTransition(
      `Only live actions can be completed; this one is in status ${action.status}.`,
    );
  }
  const actor = requirePerson(ctx, input.actor, 'completing person');
  const comment = (input.comment ?? '').trim() || null;
  const links = (input.links ?? [])
    .map((link) => link.trim())
    .filter((link) => link !== '')
    .map(requireLink);

  const write = ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `update actions
            set status = 'completed', completed_at = ?, completed_by = ?,
                evidence_comment = ?, evidence_links = ?
          where id = ?`,
      )
      .run(nowIso(ctx), actor.id, comment, JSON.stringify(links), actionId);
    // A completed action holds no position: `priorizada` means "is in the hierarchy",
    // and what is done is no longer part of the order anyone is proposing.
    dropFromDraft(ctx, actionId);
    recordTransition(ctx, {
      actionId,
      from: action.status,
      to: 'completed',
      by: actor.id,
      note: null,
    });
  });
  write();

  // The write above set the three closing fields together, which is what the narrower
  // type states; adapters report a closing without inventing defaults for any of them.
  return getActionOrFail(ctx, actionId) as CompletedAction;
}

/**
 * The same closing, restricted to work of one's own — what the dev's agent does.
 *
 * `get_priorities` only ever shows an agent the actions of its own responsable, so an id
 * from outside that slice is one nobody ever showed it: made up, or overheard. This is the
 * only unsupervised write in the system and closing has no undo, so the agent channel is
 * held to the slice it can read. Closing on behalf of somebody else stays available through
 * `completeAction`, which is what the web offers on purpose: there a human is looking at
 * the whole hierarchy, and Marta closing for a dev who never will is a product affordance.
 *
 * An action with no responsable is nobody's own, and no agent is ever shown one either.
 */
export function completeOwnAction(
  ctx: CoreContext,
  actionId: string,
  input: CompleteInput,
): CompletedAction {
  const action = getActionOrFail(ctx, actionId);
  const actor = requirePerson(ctx, input.actor, 'completing person');
  if (action.assignee?.id !== actor.id) {
    throw unauthorized('You can only complete actions you are the assignee of.');
  }
  return completeAction(ctx, actionId, input);
}

/**
 * Evidence links are meant to be followed by whoever audits the trace later, so a line
 * of prose in that field would be evidence nobody can check. The link is evidence and
 * never an integration: nothing is ever fetched from it or synced back.
 */
function requireLink(link: string): string {
  const parsed = URL.canParse(link) ? new URL(link) : null;
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw validationError(`The evidence link is not a valid URL: ${link}`);
  }
  return link;
}

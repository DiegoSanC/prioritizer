import type { CoreContext } from './context.js';
import { nowIso } from './context.js';
import { requireText } from './errors.js';
import { DRAFTABLE, positionOf, requireDraftable } from './draft.js';
import { requirePerson } from './people.js';
import type { PersonRef } from './types.js';

/**
 * A light remark a stakeholder leaves on an action of the draft, so the negotiation
 * happens in the tool instead of in parallel channels.
 *
 * There is one anchor and only one — the action — because "commenting on the position"
 * and "commenting on the action" are the same act with different words: a position is
 * not a thing of its own, it is where an action sits. What does change with the order is
 * whether a positional remark still makes sense, so the position at writing time travels
 * with the comment; that is context, not a second anchor.
 *
 * A comment resolves nothing, blocks nothing and is never answered: nobody has to close
 * one before the hierarchy can be consolidated.
 */
export interface DraftComment {
  author: PersonRef;
  at: string;
  text: string;
  /** The position the action held when this was written; null if it held none. */
  positionThen: number | null;
}

/** The draft's discussion, by action. Absent means nobody has said anything about it. */
export type DraftComments = Record<string, DraftComment[]>;

export interface CommentInput {
  actor: string;
  text: string;
}

export function commentInDraft(
  ctx: CoreContext,
  actionId: string,
  input: CommentInput,
): DraftComment {
  // What can be talked about is what is in the draft — the surface the discussion is
  // about. This is a scope, not a gate: it turns nobody away, it says where they are.
  requireDraftable(ctx, actionId);
  const author = requirePerson(ctx, input.actor, 'commenting person');
  const text = requireText(input.text, 'comment');
  const at = nowIso(ctx);
  const positionThen = positionOf(ctx, actionId);

  ctx.db
    .prepare(
      `insert into draft_comments (action_id, author_id, at, text, position_then)
       values (?, ?, ?, ?, ?)`,
    )
    .run(actionId, author.id, at, text, positionThen);

  return { author, at, text, positionThen };
}

/**
 * The discussion over the actions that are in the draft right now. What was said about
 * one that has since left it — closed, rejected, merged — stays written down but stops
 * being part of this reading: the draft is what is still being argued over.
 */
export function draftComments(ctx: CoreContext): DraftComments {
  const rows = ctx.db
    .prepare(
      `select c.action_id, c.at, c.text, c.position_then, p.id as author_id, p.name as author_name
         from draft_comments c
         join people p on p.id = c.author_id
         join actions a on a.id = c.action_id
        where a.status in (${DRAFTABLE.map(() => '?').join(', ')})
        order by c.id`,
    )
    .all(...DRAFTABLE) as CommentRow[];

  const byAction: DraftComments = {};
  for (const row of rows) {
    (byAction[row.action_id] ??= []).push({
      author: { id: row.author_id, name: row.author_name },
      at: row.at,
      text: row.text,
      positionThen: row.position_then,
    });
  }
  return byAction;
}

interface CommentRow {
  action_id: string;
  at: string;
  text: string;
  position_then: number | null;
  author_id: string;
  author_name: string;
}

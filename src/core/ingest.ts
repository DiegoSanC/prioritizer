import { alreadyIngested, registerAction } from './actions.js';
import { aliasKey, resolveAlias } from './aliases.js';
import type { CoreContext } from './context.js';
import { requireText } from './errors.js';
import { requirePerson } from './people.js';
import type { Action, SourceReference } from './types.js';

/**
 * The initiative every ingested action starts under. A transcription tool has no concept
 * of one — no project, no folder, no tag in its schema — and the core refuses an empty
 * initiative, so deriving one from the meeting title would dress a guess up as a decision.
 * Accepting an action from the inbox is where an initiative gets set (historia 7), which
 * makes this the honest placeholder: visibly unclassified, and corrected by a human.
 */
export const UNCLASSIFIED_INITIATIVE = 'Sin clasificar';

/**
 * One action item as an adapter extracted it. No shape of any source survives past this
 * type: the core ingests normalized items and knows nothing about who produced them.
 */
export interface IngestedItem {
  /** What has to be done, as the source worded it. */
  text: string;
  /**
   * The name the source attributed the item to, verbatim, or null if it attributed none.
   * It is a speaker label, not a person: it carries no email, a human can relabel it after
   * the fact, and it names collectives and outsiders as readily as colleagues. Turning one
   * into a responsable is what the alias table exists for — see `ingestActions`, which is
   * the single place that decides an ingested action's responsable.
   */
  attributedTo: string | null;
  source: SourceReference;
}

export interface IngestInput {
  /** Who signs the ingested actions. Every transition records an author, this one too. */
  actor: string;
  items: readonly IngestedItem[];
}

/**
 * What one pass did. The three assignee counts partition `registered` exactly — every
 * action that entered either got a responsable, or named somebody the table did not know,
 * or was attributed to nobody at all. They add up on purpose: a summary whose numbers do
 * not reach the total leaves the operator wondering which actions it forgot to mention.
 */
export interface IngestOutcome {
  /** The actions this pass added to the inbox. */
  registered: Action[];
  /** Items already ingested under the same key: re-running the pass is a no-op for them. */
  alreadySeen: number;
  /** Items whose attributed name the alias table turned into a responsable. */
  resolvedAssignee: number;
  /** Items that named somebody the alias table could not turn into a responsable. */
  unresolvedAssignee: number;
  /**
   * The distinct names behind that count, in the order they came. The count says how much
   * of the pass landed without a responsable; these say which alias is missing, which is
   * the only way the operator learns what to write. Some of them never should be written —
   * a collective, an outsider, an unidentified speaker — and that too is theirs to judge.
   */
  unresolvedNames: string[];
  /** Items the meeting attributed to nobody. No alias would have helped; the triage assigns. */
  unattributed: number;
}

/**
 * Turns extracted items into actions in the inbox, once each.
 *
 * Everything goes through `registerAction` — no bulk insert, however many items arrive.
 * A row written behind its back would have no `registrada` transition, and the staleness
 * rule and the whole history are read off those transitions.
 */
export function ingestActions(ctx: CoreContext, input: IngestInput): IngestOutcome {
  const actor = requirePerson(ctx, input.actor, 'ingest signing person');
  const registered: Action[] = [];
  let alreadySeen = 0;
  let resolvedAssignee = 0;
  let unresolvedAssignee = 0;
  let unattributed = 0;
  const unresolvedNames: string[] = [];
  /** Names already reported, by the same key the alias table compares on — see below. */
  const reported = new Set<string>();

  for (const item of input.items) {
    // Without a tool and an id there is no key, and without a key the next pass would
    // register the item all over again. Refusing beats ingesting something unrepeatable.
    const source: SourceReference = {
      tool: requireText(item.source.tool, 'source tool'),
      sourceId: requireText(item.source.sourceId, 'source id'),
      meetingDate: item.source.meetingDate,
      meetingTitle: item.source.meetingTitle,
    };

    if (alreadyIngested(ctx, source, item.text)) {
      alreadySeen += 1;
      continue;
    }

    // THE RESPONSABLE OF AN INGESTED ACTION IS DECIDED HERE, AND NOWHERE ELSE.
    //
    // The alias table is the only thing that turns an attributed name into a person, and
    // it says nothing unless the operator wrote the row. Matching the label against the
    // people themselves would hand somebody else's work to a homonym, and a collective or
    // an outsider has no person to be handed to at all. So a name the table does not know
    // leaves the action sin responsable — the documented fallback, assigned in the triage.
    //
    // Resolved once, here, and never revisited: a transcription tool lets a human relabel
    // a speaker after the fact, so an action re-resolved later could change hands on its
    // own, over the top of whatever the triage decided. What the pass could not resolve
    // comes back by name, which is what tells the operator which alias is missing.
    const assignee = item.attributedTo === null ? null : resolveAlias(ctx, item.attributedTo);
    if (item.attributedTo === null) {
      unattributed += 1;
    } else if (assignee !== null) {
      resolvedAssignee += 1;
    } else {
      unresolvedAssignee += 1;
      // Reported once per name the alias table would treat as one — two casings of the
      // same name are one missing alias, and offering the operator both would have them
      // write the second only to be told it is already taken.
      const key = aliasKey(item.attributedTo);
      if (!reported.has(key)) {
        reported.add(key);
        unresolvedNames.push(item.attributedTo);
      }
    }

    registered.push(
      registerAction(ctx, {
        text: item.text,
        initiative: UNCLASSIFIED_INITIATIVE,
        assignee: assignee?.id ?? null,
        actor: actor.id,
        source,
      }),
    );
  }

  return {
    registered,
    alreadySeen,
    resolvedAssignee,
    unresolvedAssignee,
    unresolvedNames,
    unattributed,
  };
}

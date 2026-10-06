import type { CoreContext } from './context.js';
import { activeAmong, listActions } from './actions.js';
import {
  currentConsolidation,
  type ConsolidationEntry,
  type ConsolidationSignature,
} from './consolidations.js';
import { requirePerson } from './people.js';
import { stalenessSignal, type StalenessSignal } from './staleness.js';
import { UNPRIORITIZED_STATUSES } from './types.js';

/**
 * The consolidated hierarchy in force, read as live work rather than as history: the
 * snapshot that rules today, crossed with what is still alive. It is not the snapshot as
 * it was signed — that reading is `currentConsolidation` — because a frozen snapshot goes
 * on naming actions that were closed since, and showing one of those as a live priority
 * would be a lie on the very surfaces that exist to settle disputes.
 */
export interface CurrentHierarchy {
  /** Who signed the consolidation in force, when and why. Null when nobody consolidated yet. */
  consolidation: ConsolidationSignature | null;
  /**
   * Since when this reading has fallen behind the accepted work, or null while it has not.
   * It travels next to the signature and not inside it because it is a fact about today,
   * not about the day somebody signed — and it fires even before the first consolidation.
   */
  staleness: StalenessSignal | null;
  /** The order in force, positions exactly as signed: they are never renumbered. */
  ordered: ConsolidationEntry[];
  /** What the snapshot names and is no longer live, in the order it was signed. */
  gone: ConsolidationEntry[];
}

/** The whole hierarchy in force, for everyone — the per-person slice is `prioritiesFor`. */
export function currentHierarchy(ctx: CoreContext): CurrentHierarchy {
  const staleness = stalenessSignal(ctx);
  const consolidation = currentConsolidation(ctx);
  if (!consolidation) {
    return { consolidation: null, staleness, ordered: [], gone: [] };
  }
  const { entries, ...signature } = consolidation;
  const stillActive = activeAmong(ctx, entries.map((entry) => entry.actionId));
  return {
    consolidation: signature,
    staleness,
    ordered: entries.filter((entry) => stillActive.has(entry.actionId)),
    gone: entries.filter((entry) => !stillActive.has(entry.actionId)),
  };
}

/**
 * The three answers to "what do I attack first?" that must never be read as one another:
 * nobody has ever consolidated (the system has not started), there is a hierarchy in force
 * and nothing of yours is pending (a legitimate empty), or you do have pending work.
 */
export type PrioritiesSituation = 'never_consolidated' | 'no_pending' | 'has_pending';

/** An action as the agent sees it: just enough to act on it and to name it back. */
export interface ActionRef {
  actionId: string;
  text: string;
  initiative: string;
}

export interface PriorityEntry extends ActionRef {
  /** Position in the single global hierarchy, never renumbered per person. */
  position: number;
}

export interface Priorities {
  situation: PrioritiesSituation;
  /** Who consolidated the hierarchy in force, when and why. Null only when never consolidated. */
  consolidation: ConsolidationSignature | null;
  /**
   * Since when the hierarchy this answer is drawn from has fallen behind, or null. It is
   * orthogonal to `situation`: somebody with nothing of their own pending still has to be
   * able to warn that what everyone is reading is out of date.
   */
  staleness: StalenessSignal | null;
  /** Named like `Draft.ordered`: both are the global order, one proposed and one in force. */
  ordered: PriorityEntry[];
  /** The separate block the agent raises its hand about instead of inventing a priority. */
  unprioritized: ActionRef[];
}

/**
 * One person's slice of the consolidated hierarchy in force — the only hierarchy a dev
 * agent ever reads — plus whatever of theirs nobody has ordered yet.
 */
export function prioritiesFor(ctx: CoreContext, personId: string): Priorities {
  const person = requirePerson(ctx, personId, 'assignee');
  // One and the same reading as the published page's, sliced by responsable: if the agent
  // and the page crossed the snapshot with live work each on its own, the degraded mode
  // could contradict the live one on the day it is needed.
  const hierarchy = currentHierarchy(ctx);
  const named = new Set(
    [...hierarchy.ordered, ...hierarchy.gone].map((entry) => entry.actionId),
  );
  // The two blocks are disjoint by construction: what the hierarchy in force already
  // orders is never also reported as unordered, so no action is counted twice.
  const unprioritized = listActions(ctx, {
    status: [...UNPRIORITIZED_STATUSES],
    assignee: person.id,
  })
    .filter((action) => !named.has(action.id))
    .map((action) => ({
      actionId: action.id,
      text: action.text,
      initiative: action.initiative,
    }));

  if (!hierarchy.consolidation) {
    return {
      situation: 'never_consolidated',
      consolidation: null,
      staleness: hierarchy.staleness,
      ordered: [],
      unprioritized,
    };
  }

  const ordered = hierarchy.ordered
    .filter((entry) => entry.assignee?.id === person.id)
    .map((entry) => ({
      position: entry.position,
      actionId: entry.actionId,
      text: entry.text,
      initiative: entry.initiative,
    }));

  return {
    situation: ordered.length === 0 && unprioritized.length === 0 ? 'no_pending' : 'has_pending',
    consolidation: hierarchy.consolidation,
    staleness: hierarchy.staleness,
    ordered,
    unprioritized,
  };
}

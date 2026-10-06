import type { CoreContext } from './context.js';
import { getActionOrFail } from './actions.js';
import {
  consolidationInForceAt,
  getConsolidationOrFail,
  listConsolidations,
  type Consolidation,
  type ConsolidationEntry,
  type ConsolidationSignature,
} from './consolidations.js';
import { requireText, validationError } from './errors.js';

/**
 * The history of the hierarchy, read off the sequence of signed snapshots. Nothing here
 * is stored: every answer is derived from consolidations that were already immutable.
 */

export interface HistoryVersion {
  signature: ConsolidationSignature;
  /** The version signed right before this one; null for the first one ever. */
  previous: number | null;
}

/** What one version did to one action, relative to the other version compared. */
export type ChangeKind = 'enters' | 'leaves' | 'rises' | 'falls' | 'stays';

export interface EntryChange {
  actionId: string;
  kind: ChangeKind;
  /** The entry as the earlier version froze it; null when the action entered. */
  before: ConsolidationEntry | null;
  /** The entry as the later version froze it; null when the action left. */
  after: ConsolidationEntry | null;
  /**
   * True when each version named the same action differently — a different wording,
   * initiative or assignee — and not just put it somewhere else.
   */
  namingChanged: boolean;
}

export interface ConsolidationDiff {
  from: ConsolidationSignature;
  to: ConsolidationSignature;
  /** In reading order of the later version; what left comes last, in its old order. */
  changes: EntryChange[];
}

/** The whole sequence, newest first, each version knowing the one it succeeded. */
export function consolidationHistory(ctx: CoreContext): HistoryVersion[] {
  const signatures = listConsolidations(ctx);
  return signatures.map((signature, index) => ({
    signature,
    previous: signatures[index + 1]?.version ?? null,
  }));
}

/**
 * What changed between two consolidations, derived from the two snapshots alone:
 * who entered, who left and who moved. It always reads `from` → `to` in the order
 * asked for, so comparing backwards is a legitimate question, not an error.
 */
export function diffConsolidations(
  ctx: CoreContext,
  from: number,
  to: number,
): ConsolidationDiff {
  const { entries: before, ...fromSignature } = getConsolidationOrFail(ctx, from);
  const { entries: after, ...toSignature } = getConsolidationOrFail(ctx, to);

  return { from: fromSignature, to: toSignature, changes: compareEntries(before, after) };
}

/**
 * What one order did to another, action by action: the whole comparison, and the only
 * place it is worked out. Reading a pair of versions and following one action across the
 * whole sequence are the same question asked twice, so they cannot answer differently.
 */
function compareEntries(
  before: ConsolidationEntry[],
  after: ConsolidationEntry[],
): EntryChange[] {
  const earlier = new Map(before.map((entry) => [entry.actionId, entry]));
  const present = new Set(after.map((entry) => entry.actionId));

  const moved: EntryChange[] = after.map((entry) => {
    const was = earlier.get(entry.actionId) ?? null;
    return {
      actionId: entry.actionId,
      kind: kindOf(was, entry),
      before: was,
      after: entry,
      namingChanged: was !== null && !sameNaming(was, entry),
    };
  });
  const gone: EntryChange[] = before
    .filter((entry) => !present.has(entry.actionId))
    .map((entry) => ({
      actionId: entry.actionId,
      kind: 'leaves',
      before: entry,
      after: null,
      namingChanged: false,
    }));

  return [...moved, ...gone];
}

/**
 * One move of one action, placed in the version of the history that made it: what changed
 * for this action, who signed it, when and why. `previous` is the version it is read
 * against — the one that froze `before` — so a step is exactly the pair `previous → this`
 * of `diffConsolidations`, narrowed to one action.
 */
export interface ActionChange extends EntryChange, HistoryVersion {}

/**
 * The whole trajectory of one action through the sequence of consolidations — when it
 * entered, when it left, when it was reordered — newest first, like the sequence itself.
 *
 * The "why" of each move is the reason of the consolidation that made it. There is no
 * per-action motive: that would be a new datum written at every reorder, and the trace
 * is worth having precisely because it costs nothing to keep.
 *
 * A position is a rank in the one global order, so rising is rising however it happened:
 * an action climbs when whoever was above it is closed as much as when somebody reorders
 * it. Both are the same news for whoever has to do it, and the reason of that very
 * consolidation is what says which of the two it was.
 */
export function changesFor(ctx: CoreContext, actionId: string): ActionChange[] {
  // An action nobody ever consolidated has an empty trajectory; one that does not exist
  // has no trajectory at all, and saying so is the difference between the two answers.
  getActionOrFail(ctx, actionId);

  const trail: ActionChange[] = [];
  let before: ConsolidationEntry[] = [];
  let previous: number | null = null;

  for (const signature of oldestFirst(listConsolidations(ctx))) {
    const { entries: after } = getConsolidationOrFail(ctx, signature.version);
    const change = compareEntries(before, after).find(
      (candidate) => candidate.actionId === actionId,
    );
    if (change && movedOrRenamed(change)) {
      trail.push({ ...change, signature, previous });
    }
    before = after;
    previous = signature.version;
  }

  return trail.reverse();
}

function oldestFirst(signatures: ConsolidationSignature[]): ConsolidationSignature[] {
  return [...signatures].reverse();
}

/**
 * Whether a version did anything to this action. Being signed again in the same place and
 * with the same words is not something that happened to it — the trajectory would fill up
 * with every consolidation and stop answering the question it was asked. Being re-frozen
 * where it stood but under another initiative or another assignee is: same seat, different
 * action to whoever has to do it.
 */
function movedOrRenamed(change: EntryChange): boolean {
  return change.kind !== 'stays' || change.namingChanged;
}

/** How a snapshot names an action: everything it says about it except its place. */
function sameNaming(before: ConsolidationEntry, after: ConsolidationEntry): boolean {
  return (
    before.text === after.text &&
    before.initiative === after.initiative &&
    (before.assignee?.id ?? null) === (after.assignee?.id ?? null)
  );
}

function kindOf(before: ConsolidationEntry | null, after: ConsolidationEntry): ChangeKind {
  if (!before) return 'enters';
  if (after.position < before.position) return 'rises';
  if (after.position > before.position) return 'falls';
  return 'stays';
}

/**
 * The hierarchy that was in force on a given date, exactly as it was signed: the
 * snapshot comes back whole, naming what it named then. It is not the hierarchy
 * filtered by what is still live today — that reading is `prioritiesFor`.
 */
export function consolidationAt(ctx: CoreContext, when: string): Consolidation | null {
  return consolidationInForceAt(ctx, toInstant(when));
}

/**
 * A bare date means the whole day, so it answers with the hierarchy that closed that
 * day instead of silently dropping a consolidation signed that same morning. A full
 * ISO instant asks for that exact moment.
 */
function toInstant(when: string): string {
  const text = requireText(when, 'date');
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59.999Z` : text;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError(`The date «${text}» is not understood. Use YYYY-MM-DD or an ISO instant.`);
  }
  return parsed.toISOString();
}

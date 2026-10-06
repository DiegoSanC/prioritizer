import type DatabaseType from 'better-sqlite3';
import { resolveConfig, type CoreConfig } from './config.js';
import { systemClock, type Clock, type CoreContext } from './context.js';
import { openDatabase } from './db.js';
import * as actions from './actions.js';
import * as aliases from './aliases.js';
import * as comments from './comments.js';
import * as completion from './completion.js';
import * as consolidations from './consolidations.js';
import * as draft from './draft.js';
import * as history from './history.js';
import * as identity from './identity.js';
import * as ingest from './ingest.js';
import * as invocations from './invocations.js';
import * as people from './people.js';
import * as priorities from './priorities.js';
import * as triage from './triage.js';
import { UNPRIORITIZED_STATUSES } from './types.js';
import type {
  Action,
  ActionDetail,
  CompletedAction,
  Person,
  PersonRef,
  RegisterActionInput,
  Role,
} from './types.js';

export type { IssuedToken, TokenSummary } from './identity.js';
export type {
  Invocation,
  InvocationOutcome,
  RecordInvocationInput,
  ServedOutcome,
} from './invocations.js';
export type { Draft, Direction } from './draft.js';
export type { PersonAlias } from './aliases.js';
export type { IngestedItem, IngestInput, IngestOutcome } from './ingest.js';
export { UNCLASSIFIED_INITIATIVE } from './ingest.js';
export type { CommentInput, DraftComment, DraftComments } from './comments.js';
export type { CompleteInput } from './completion.js';
export { canComplete } from './completion.js';
export type {
  Consolidation,
  ConsolidationEntry,
  ConsolidationSignature,
} from './consolidations.js';
export type {
  ActionChange,
  ChangeKind,
  ConsolidationDiff,
  EntryChange,
  HistoryVersion,
} from './history.js';
export type {
  ActionRef,
  CurrentHierarchy,
  Priorities,
  PrioritiesSituation,
  PriorityEntry,
} from './priorities.js';
export type { StalenessSignal } from './staleness.js';

export * from './types.js';
export { DomainError } from './errors.js';
export type { CoreConfig } from './config.js';
export { DEFAULT_DB_PATH } from './db.js';
export type { Clock } from './context.js';

export interface OpenCoreOptions {
  dbPath: string;
  clock?: Clock;
  config?: Partial<CoreConfig>;
}

/**
 * The application core — the single seam of the system. The web, the published page,
 * the MCP server and the ingestion adapter are thin adapters that call this and hold
 * no domain logic of their own.
 */
export class Core {
  private readonly ctx: CoreContext;

  constructor(ctx: CoreContext) {
    this.ctx = ctx;
  }

  // --- People -------------------------------------------------------------

  addPerson(input: { name: string }): Person {
    return people.addPerson(this.ctx, input);
  }

  listPeople(): Person[] {
    return people.listPeople(this.ctx);
  }

  /** Resolves an identifier or an exact name to one person, for surfaces humans type into. */
  resolvePerson(reference: string): PersonRef {
    return people.resolvePerson(this.ctx, reference);
  }

  // --- Aliases: which names in a transcript answer for which person ---------

  /**
   * Records that a transcription tool calling somebody by this name means this person.
   * The operator writes it; nothing in the system ever derives one from a transcript,
   * because a speaker label can be corrected after the fact and an alias that moved on
   * its own would start assigning work to whoever the tool renamed the speaker to.
   */
  addAlias(input: { person: string; alias: string }): aliases.PersonAlias {
    return aliases.addAlias(this.ctx, input);
  }

  /** Corrects an alias whole — the name, who it answers for, or both. */
  updateAlias(id: string, input: { person: string; alias: string }): aliases.PersonAlias {
    return aliases.updateAlias(this.ctx, id, input);
  }

  removeAlias(id: string): void {
    aliases.removeAlias(this.ctx, id);
  }

  listAliases(): aliases.PersonAlias[] {
    return aliases.listAliases(this.ctx);
  }

  // --- Identity: tokens and roles, issued by hand by the operator -----------

  issueToken(input: { person: string; label: string }): identity.IssuedToken {
    return identity.issueToken(this.ctx, input);
  }

  revokeToken(tokenId: string): void {
    identity.revokeToken(this.ctx, tokenId);
  }

  listTokens(): identity.TokenSummary[] {
    return identity.listTokens(this.ctx);
  }

  /** Resolves a token to its person for any surface that just needs to know who is asking. */
  authenticate(token: string): PersonRef | null {
    return identity.authenticate(this.ctx, token);
  }

  /**
   * The MCP door: the same verdict as `authenticate`, except that turning away a revoked
   * token is written to the invocation log. Only the MCP edge belongs here — the web's
   * visits are not what that log measures. See `admitAgent` in `identity.ts` for why.
   */
  admitAgent(token: string): PersonRef | null {
    return identity.admitAgent(this.ctx, token);
  }

  grantRole(personId: string, role: Role): void {
    identity.grantRole(this.ctx, personId, role);
  }

  revokeRole(personId: string, role: Role): void {
    identity.revokeRole(this.ctx, personId, role);
  }

  hasRole(personId: string, role: Role): boolean {
    return identity.hasRole(this.ctx, personId, role);
  }

  rolesOf(personId: string): Role[] {
    return identity.rolesOf(this.ctx, personId);
  }

  // --- Invocation log -------------------------------------------------------

  /** Every call an agent makes through the MCP lands here: who, what and when. */
  recordInvocation(input: invocations.RecordInvocationInput): void {
    invocations.recordInvocation(this.ctx, input);
  }

  listInvocations(): invocations.Invocation[] {
    return invocations.listInvocations(this.ctx);
  }

  // --- Actions ------------------------------------------------------------

  registerAction(input: RegisterActionInput): Action {
    return actions.registerAction(this.ctx, input);
  }

  /**
   * Puts extracted action items into the inbox, once each. The adapter that reads a
   * transcription tool hands normalized items here and holds no rule of its own: what an
   * ingested action starts as, who signs it and what counts as "already seen" are decided
   * in `ingest.ts`, next to everything else the inbox obeys.
   */
  ingestActions(input: ingest.IngestInput): ingest.IngestOutcome {
    return ingest.ingestActions(this.ctx, input);
  }

  listActions(filter?: actions.ListActionsFilter): Action[] {
    return actions.listActions(this.ctx, filter);
  }

  getAction(id: string): ActionDetail | null {
    return actions.getAction(this.ctx, id);
  }

  /** For surfaces that address one action and have nothing to show if it is not there. */
  getActionOrFail(id: string): ActionDetail {
    return actions.getActionOrFail(this.ctx, id);
  }

  /** "Unprioritized" = registered (pending triage) + accepted (pending consolidation). */
  unprioritizedCount(): number {
    return actions.countByStatus(this.ctx, UNPRIORITIZED_STATUSES);
  }

  /** What one person must attack first, according to the consolidation in force. */
  prioritiesFor(personId: string): priorities.Priorities {
    return priorities.prioritiesFor(this.ctx, personId);
  }

  /**
   * The hierarchy in force for everyone: the snapshot that rules today, crossed with what
   * is still live. The reading the published page and any org-wide surface need — the
   * signed snapshot untouched is `currentConsolidation`.
   */
  currentHierarchy(): priorities.CurrentHierarchy {
    return priorities.currentHierarchy(this.ctx);
  }

  // --- Triage --------------------------------------------------------------

  /**
   * Whether a person may decide on the inbox — the same predicate the triage calls below
   * consult. A surface asks it to know what to offer; see `canTriage` in `triage.ts`.
   */
  canTriage(personId: string): boolean {
    return triage.canTriage(this.ctx, personId);
  }

  acceptAction(id: string, input: triage.AcceptInput): Action {
    return triage.acceptAction(this.ctx, id, input);
  }

  rejectAction(id: string, input: triage.TriageInput): Action {
    return triage.rejectAction(this.ctx, id, input);
  }

  deferAction(id: string, input: triage.TriageInput): Action {
    return triage.deferAction(this.ctx, id, input);
  }

  reactivateAction(id: string, input: triage.TriageInput): Action {
    return triage.reactivateAction(this.ctx, id, input);
  }

  markDuplicate(id: string, input: triage.TriageInput & { duplicateOf: string }): Action {
    return triage.markDuplicate(this.ctx, id, input);
  }

  // --- Completion -----------------------------------------------------------

  /**
   * Closes an action with optional evidence. The same call serves the dev's agent and
   * the web: the effect is one and the same because the rule lives only here.
   */
  completeAction(id: string, input: completion.CompleteInput): CompletedAction {
    return completion.completeAction(this.ctx, id, input);
  }

  /**
   * The agent's half of the closing: a dev reports done what was theirs to do. Narrower
   * than `completeAction` on purpose — see `completeOwnAction` for why the agent channel
   * is held to the same slice it can read.
   */
  completeOwnAction(id: string, input: completion.CompleteInput): CompletedAction {
    return completion.completeOwnAction(this.ctx, id, input);
  }

  // --- Draft hierarchy ------------------------------------------------------

  getDraft(): draft.Draft {
    return draft.getDraft(this.ctx);
  }

  setDraftOrder(orderedIds: string[]): void {
    draft.setDraftOrder(this.ctx, orderedIds);
  }

  placeInDraft(id: string): void {
    draft.placeInDraft(this.ctx, id);
  }

  removeFromDraft(id: string, actor: string): void {
    draft.removeFromDraft(this.ctx, id, actor);
  }

  moveInDraft(id: string, direction: draft.Direction): void {
    draft.moveInDraft(this.ctx, id, direction);
  }

  // --- The draft's discussion ------------------------------------------------

  /**
   * Leaves a light comment on an action of the draft. Anyone the system knows may do it:
   * the point is that the negotiation happens here and not in a parallel channel, and a
   * surface only some voices can reach would send the rest straight back to that channel.
   */
  commentInDraft(id: string, input: comments.CommentInput): comments.DraftComment {
    return comments.commentInDraft(this.ctx, id, input);
  }

  /**
   * What has been said about the draft, by action. A reading and nothing else — no state
   * is derived from it and `consolidate` never asks.
   */
  draftComments(): comments.DraftComments {
    return comments.draftComments(this.ctx);
  }

  // --- Consolidation --------------------------------------------------------

  /**
   * Whether a person may sign the hierarchy — the same predicate `consolidate` consults.
   * A surface asks it to know what to offer; see `canConsolidate` in `consolidations.ts`.
   */
  canConsolidate(personId: string): boolean {
    return consolidations.canConsolidate(this.ctx, personId);
  }

  consolidate(input: consolidations.ConsolidateInput): consolidations.Consolidation {
    return consolidations.consolidate(this.ctx, input);
  }

  /** The consolidated hierarchy in force — the only one the dev agents ever read. */
  currentConsolidation(): consolidations.Consolidation | null {
    return consolidations.currentConsolidation(this.ctx);
  }

  getConsolidation(version: number): consolidations.Consolidation | null {
    return consolidations.getConsolidation(this.ctx, version);
  }

  /** For surfaces that address one version and have nothing to show if it is not there. */
  getConsolidationOrFail(version: number): consolidations.Consolidation {
    return consolidations.getConsolidationOrFail(this.ctx, version);
  }

  listConsolidations(): consolidations.ConsolidationSignature[] {
    return consolidations.listConsolidations(this.ctx);
  }

  // --- History, derived from the sequence of snapshots -----------------------

  /** The sequence of consolidations, newest first, each knowing the one it succeeded. */
  consolidationHistory(): history.HistoryVersion[] {
    return history.consolidationHistory(this.ctx);
  }

  /**
   * The hierarchy that was in force on a given date ("a fecha X"), whole and as it was
   * signed. A bare `AAAA-MM-DD` asks for that day; a full ISO instant asks for that moment.
   */
  consolidationAt(when: string): consolidations.Consolidation | null {
    return history.consolidationAt(this.ctx, when);
  }

  /** What changed between two consolidations: entries, exits and position changes. */
  diffConsolidations(from: number, to: number): history.ConsolidationDiff {
    return history.diffConsolidations(this.ctx, from, to);
  }

  /**
   * The trajectory of one action across the sequence of consolidations: when it entered,
   * when it left and when it was reordered, each move carrying the firma that made it.
   */
  changesFor(actionId: string): history.ActionChange[] {
    return history.changesFor(this.ctx, actionId);
  }

  // --- Lifecycle ----------------------------------------------------------

  get database(): DatabaseType.Database {
    return this.ctx.db;
  }

  close(): void {
    this.ctx.db.close();
  }
}

/**
 * The core as the web is allowed to see it. The two doors of the system stay apart by
 * type and not by comment: the web authenticates silently with `authenticate`, while
 * `admitAgent` — which writes a `denegada` to the invocation log — and `recordInvocation`
 * belong to the MCP edge alone, because that log measures adoption per agent call and a
 * browser visit is not one. `database` goes with them: no adapter reaches past this API.
 */
export type WebCore = Omit<Core, 'admitAgent' | 'recordInvocation' | 'database'>;

export function openCore(options: OpenCoreOptions): Core {
  const ctx: CoreContext = {
    db: openDatabase(options.dbPath),
    clock: options.clock ?? systemClock,
    config: resolveConfig(options.config),
  };
  return new Core(ctx);
}

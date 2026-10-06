/**
 * The action lifecycle, verbatim from the spec. "Sin priorizar" is defined as
 * `registrada` + `aceptada`, exclusively.
 */
export type ActionStatus =
  | 'registered'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'duplicate'
  | 'prioritized'
  | 'completed';

export const UNPRIORITIZED_STATUSES: readonly ActionStatus[] = ['registered', 'accepted'];

/** Statuses that keep an action in the active hierarchy (draft or consolidated). */
export const ACTIVE_STATUSES: readonly ActionStatus[] = ['registered', 'accepted', 'prioritized'];

export interface PersonRef {
  id: string;
  name: string;
}

export interface Person extends PersonRef {
  roles: Role[];
  createdAt: string;
}

/**
 * Who may do what. `triador` decides on the inbox and `consolidador` signs the hierarchy;
 * both are granted to as many people as needed, so neither decision has a single owner to
 * wait for. The names follow the verb, as the domain says them: who triages, who consolidates.
 */
export type Role = 'triager' | 'consolidator' | 'operator';

export const ROLES: readonly Role[] = ['triager', 'consolidator', 'operator'];

/** Lineage of the meeting an action came from. Seeds the v2 organizational memory. */
export interface SourceReference {
  tool: string;
  sourceId: string;
  meetingDate: string | null;
  meetingTitle: string | null;
}

export type ActionOrigin =
  | { kind: 'manual' }
  | { kind: 'ingested'; source: SourceReference };

export interface Transition {
  from: ActionStatus | null;
  to: ActionStatus;
  at: string;
  by: string;
  note: string | null;
}

export interface Evidence {
  comment: string | null;
  links: string[];
}

export interface Action {
  id: string;
  text: string;
  initiative: string;
  assignee: PersonRef | null;
  status: ActionStatus;
  origin: ActionOrigin;
  createdAt: string;
  createdBy: string;
  /** Set when the action was merged into another via the `duplicada` triage exit. */
  duplicateOf: string | null;
  completedAt: string | null;
  completedBy: PersonRef | null;
  evidence: Evidence | null;
}

export interface ActionDetail extends Action {
  transitions: Transition[];
}

/**
 * An action after it was closed. The three fields a closing writes are set together or not
 * at all, so once it succeeded they are all there; saying so in the type is what lets an
 * adapter report a closing back without inventing fallbacks for values that cannot be missing.
 */
export interface CompletedAction extends Action {
  completedAt: string;
  completedBy: PersonRef;
  evidence: Evidence;
}

export interface RegisterActionInput {
  text: string;
  initiative: string;
  assignee?: string | null;
  actor: string;
  /**
   * The meeting this action was ingested from. Absent means somebody typed it: there is
   * one way into the store and the origin is what tells the two apart, never two paths.
   */
  source?: SourceReference;
}

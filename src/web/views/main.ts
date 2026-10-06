import { html, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import { echoed, type Refusable } from '../refusal.js';
import {
  assigneeName,
  consolidationSignature,
  evidenceDetail,
  formatDateTime,
  originLabel,
  peopleSelect,
  refusalNotice,
  stalenessBanner,
} from './fragments.js';
import type {
  Action,
  CurrentHierarchy,
  Draft,
  DraftComment,
  DraftComments,
  Person,
  PersonRef,
  WebCore,
} from '../../core/index.js';

/** The forms of this page, so each objection is painted where it was raised. */
export const REGISTER_SOURCE = 'register';
export const CONSOLIDATE_SOURCE = 'consolidate';
export const triageSource = (actionId: string): string => `triage:${actionId}`;
export const discussionSource = (actionId: string): string => `comment:${actionId}`;

export interface MainViewModel extends Refusable {
  actor: PersonRef;
  people: Person[];
  draft: Draft;
  comments: DraftComments;
  inbox: Action[];
  deferred: Action[];
  completed: Action[];
  /**
   * The very same reading the published page renders. Both screens answer "what is in
   * force, and can it still be trusted?", so they take it from one place: a summary here
   * and a banner there that disagreed would be worse than either of them missing.
   */
  hierarchy: CurrentHierarchy;
  /** Whether this reader may decide on the inbox: the core's answer, never re-derived here. */
  canTriage: boolean;
  canConsolidate: boolean;
}

/**
 * Everything the main screen shows, read in one place and with a name. Nine readings of
 * the core and not one derivation: what the screen may offer is the core's own answer
 * (`canTriage`, `canConsolidate`), and what is in force is the reading `/published`
 * renders — see `hierarchy`.
 */
export function mainPage(core: WebCore, actor: PersonRef): MainViewModel {
  return {
    actor,
    people: core.listPeople(),
    draft: core.getDraft(),
    comments: core.draftComments(),
    inbox: core.listActions({ status: 'registered' }),
    deferred: core.listActions({ status: 'deferred' }),
    completed: core.listActions({ status: 'completed' }),
    hierarchy: core.currentHierarchy(),
    canTriage: core.canTriage(actor.id),
    canConsolidate: core.canConsolidate(actor.id),
  };
}

export function renderMain(model: MainViewModel): SafeHtml {
  return layout(
    'Hierarchy',
    { actor: model.actor, active: '/' },
    html`
      ${refusalNotice(model.refusal)}
      ${stalenessBanner(model.hierarchy.staleness)}
      ${currentSummary(model.hierarchy)}
      ${draftSection(model)}
      ${consolidateForm(model)}
      ${unprioritizedSection(model)}
      ${inboxSection(model)}
      ${registerForm(model)}
      ${deferredSection(model)}
      ${completedSection(model.completed)}
    `,
  );
}

function draftSection(model: MainViewModel): SafeHtml {
  const { ordered } = model.draft;
  return html`
    <h2>Draft hierarchy · ${ordered.length} ordered actions</h2>
    <p class="hint">
      The proposed global order. It becomes the hierarchy agents read once consolidated.
    </p>
    <div class="card">
      ${ordered.length === 0
        ? html`<p class="muted">No action has been ordered yet.</p>`
        : html`<ol class="hierarchy">
            ${ordered.map(
              (action) => html`
                <li>
                  <div class="grow">
                    <div>${action.text}</div>
                    <div class="muted">
                      ${action.initiative} ·
                      ${assigneeName(action.assignee)} ·
                      <span class="badge">${action.status}</span>
                    </div>
                    ${discussion(action, model)}
                  </div>
                  <form method="post" action="/draft/${action.id}/up">
                    <button type="submit" title="Move up">↑</button>
                    <button type="submit" formaction="/draft/${action.id}/down" title="Move down">↓</button>
                    <button type="submit" formaction="/draft/${action.id}/remove" title="Remove from the order">
                      Remove
                    </button>
                  </form>
                  ${trajectoryLink(action)}
                  ${completeLink(action)}
                </li>
              `,
            )}
          </ol>`}
    </div>
  `;
}

/**
 * What has been said about one action of the draft, and the box to say the next thing.
 * The same block wherever the action shows, ordered or not: an action is discussed for
 * being in the draft, not for having a position.
 *
 * Nothing here counts, closes or answers anything — there is no pending tally and no
 * comment to settle before consolidating. Talking is the whole feature.
 */
function discussion(action: Action, model: MainViewModel): SafeHtml {
  const typed = echoed(model.refusal, discussionSource(action.id));
  return html`
    ${(model.comments[action.id] ?? []).map(
      (comment) => html`
        <div class="comment">
          <div>${comment.text}</div>
          <div class="muted">
            ${comment.author.name} · ${formatDateTime(comment.at)} · ${positionThenLabel(comment)}
          </div>
        </div>
      `,
    )}
    <form class="discuss" method="post" action="/draft/${action.id}/comment">
      <input
        type="text"
        name="comment"
        value="${typed['comment'] ?? ''}"
        required
        aria-label="Comment on «${action.text}»"
        placeholder="Comment on this action or its position"
      />
      <button type="submit">Comment</button>
    </form>
  `;
}

/**
 * Where the action sat when the remark was written. Without it a complaint about the
 * position stops meaning anything the moment somebody reorders.
 */
function positionThenLabel(comment: DraftComment): string {
  return comment.positionThen === null
    ? 'then unpositioned'
    : `then at position ${comment.positionThen}`;
}

function currentSummary(hierarchy: CurrentHierarchy): SafeHtml {
  const { consolidation, ordered, gone } = hierarchy;
  if (!consolidation) {
    return html`<div class="card">
      <strong>Never consolidated.</strong>
      <p class="muted">
        Developers' agents will see no priority until the first consolidation.
      </p>
    </div>`;
  }
  return html`<div class="card">
    <strong>Hierarchy in force: v${consolidation.version}</strong>
    ${consolidationSignature(consolidation, ordered.length + gone.length)}
  </div>`;
}

function consolidateForm(model: MainViewModel): SafeHtml {
  if (!model.canConsolidate) {
    return html`<p class="hint">
      Consolidating requires the <code>consolidator</code> role. Ask the operator for it.
    </p>`;
  }
  const typed = echoed(model.refusal, CONSOLIDATE_SOURCE);
  return html`
    <div class="card">
      <form method="post" action="/consolidate">
        <div class="field">
          <label for="reason">Consolidation reason (required)</label>
          <input
            type="text"
            id="reason"
            name="reason"
            value="${typed['reason'] ?? ''}"
            required
            placeholder="Why this order and not another"
          />
        </div>
        <button class="primary" type="submit">Consolidate</button>
        <span class="muted">
          It freezes the current order as a new, signed, immutable version.
        </span>
      </form>
    </div>
  `;
}

function unprioritizedSection(model: MainViewModel): SafeHtml {
  const { unordered, unprioritizedCount, pendingTriageCount } = model.draft;
  return html`
    <h2>Unprioritized · ${unprioritizedCount}</h2>
    <p class="hint">
      ${unordered.length} accepted without a position in the order and ${pendingTriageCount} pending triage.
      Only the registered and the accepted count as unprioritized.
    </p>
    <div class="card">
      ${unordered.length === 0
        ? html`<p class="muted">Every accepted action has a position.</p>`
        : html`<table>
            <tbody>
              ${unordered.map(
                (action) => html`
                  <tr>
                    <td class="grow">
                      ${action.text}
                      <div class="muted">${action.initiative} · ${assigneeName(action.assignee)}</div>
                      ${discussion(action, model)}
                    </td>
                    <td>
                      <form method="post" action="/draft/${action.id}/prioritize">
                        <button type="submit">Prioritize</button>
                      </form>
                    </td>
                    <td>${trajectoryLink(action)}</td>
                    <td>${completeLink(action)}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>`}
    </div>
  `;
}

function registerForm(model: MainViewModel): SafeHtml {
  const typed = echoed(model.refusal, REGISTER_SOURCE);
  return html`
    <h2>Register an action</h2>
    <div class="card">
      <form method="post" action="/actions">
        <div class="field">
          <label for="text">Action</label>
          <input
            type="text"
            id="text"
            name="text"
            value="${typed['text'] ?? ''}"
            required
            placeholder="What needs to be done"
          />
        </div>
        <div class="row">
          <div class="field">
            <label for="initiative">Initiative</label>
            <input
              type="text"
              id="initiative"
              name="initiative"
              value="${typed['initiative'] ?? ''}"
              required
              placeholder="Which initiative it belongs to"
            />
          </div>
          <div class="field">
            <label for="assignee">Assignee (optional)</label>
            ${peopleSelect('assignee', model.people, typed['assignee'] ?? null)}
          </div>
        </div>
        <button class="primary" type="submit">Register</button>
      </form>
    </div>
  `;
}

/**
 * The inbox is readable by anyone signed in — what is pending is not a secret, and the
 * count is the signal adoption is measured on. Deciding is another matter: the
 * decision forms only show to whoever the core would let decide.
 */
function inboxSection(model: MainViewModel): SafeHtml {
  return html`
    <h2>Triage inbox · ${model.inbox.length} untriaged</h2>
    <p class="hint">
      ${model.canTriage
        ? html`Actions in status <code>registered</code>. Accept (correcting initiative and
            assignee), reject, defer or merge with an existing action.`
        : html`Actions in status <code>registered</code>. Deciding them requires the
            <code>triager</code> role. Ask the operator for it.`}
    </p>
    ${model.inbox.length === 0
      ? html`<div class="card"><p class="muted">The inbox is empty.</p></div>`
      : model.inbox.map((action) => triageCard(action, model))}
  `;
}

function triageCard(action: Action, model: MainViewModel): SafeHtml {
  const heading = html`
    <div class="row" style="align-items:baseline">
      <strong class="grow">${action.text}</strong>
      ${originLabel(action)}
    </div>
  `;
  if (!model.canTriage) {
    return html`<div class="card">
      ${heading}
      <div class="muted">${action.initiative} · ${assigneeName(action.assignee)}</div>
    </div>`;
  }

  const mergeTargets = model.inbox.filter((other) => other.id !== action.id);
  // What was typed wins over what the action says: the reader was correcting the action
  // when the core refused, and painting the old values back would undo the correction.
  const typed = echoed(model.refusal, triageSource(action.id));
  const duplicateOf = typed['duplicateOf'] ?? '';
  return html`
    <div class="card">
      ${heading}
      <form method="post" action="/actions/${action.id}/accept">
        <div class="row">
          <div class="field">
            <label>Initiative</label>
            <input
              type="text"
              name="initiative"
              value="${typed['initiative'] ?? action.initiative}"
              required
            />
          </div>
          <div class="field">
            <label>Assignee</label>
            ${peopleSelect(
              'assignee',
              model.people,
              typed['assignee'] ?? action.assignee?.id ?? null,
            )}
          </div>
          <div class="field">
            <label>Note (when rejecting or deferring)</label>
            <input type="text" name="note" value="${typed['note'] ?? ''}" placeholder="Optional" />
          </div>
        </div>
        <div class="row" style="align-items:flex-end">
          <div class="field" style="flex:2 1 320px">
            <label>Duplicate of</label>
            <select name="duplicateOf">
              <option value="">— choose the original action —</option>
              ${mergeTargets.map(
                (other) =>
                  html`<option value="${other.id}" ${other.id === duplicateOf ? html`selected` : ''}>
                    ${other.text}
                  </option>`,
              )}
            </select>
          </div>
          <div class="field" style="flex:3 1 320px; display:flex; gap:8px; flex-wrap:wrap">
            <button class="primary" type="submit">Accept</button>
            <button type="submit" formaction="/actions/${action.id}/reject">Reject</button>
            <button type="submit" formaction="/actions/${action.id}/defer">Defer</button>
            <button type="submit" formaction="/actions/${action.id}/duplicate">Mark duplicate</button>
          </div>
        </div>
      </form>
    </div>
  `;
}

/**
 * Reactivating is a triage decision like the rest — it puts the action back in the inbox
 * and back into "unprioritized" — so the button follows the same door as the four exits.
 */
function deferredSection(model: MainViewModel): SafeHtml {
  const { deferred } = model;
  if (deferred.length === 0) return html``;
  return html`
    <h2>Deferred · ${deferred.length}</h2>
    <p class="hint">They raise no warnings and do not count as unprioritized. Reactivable when the time comes.</p>
    <div class="card">
      <table>
        <tbody>
          ${deferred.map(
            (action) => html`
              <tr>
                <td class="grow">${action.text}<div class="muted">${action.initiative}</div></td>
                <td>
                  ${model.canTriage
                    ? html`<form method="post" action="/actions/${action.id}/reactivate">
                        <button type="submit">Reactivate</button>
                      </form>`
                    : ''}
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

/** How many closings the main screen shows before it would start being a history page. */
const RECENT_COMPLETIONS = 10;

/** What stays after an action leaves the active hierarchy: the trace, with its evidence. */
function completedSection(completed: Action[]): SafeHtml {
  if (completed.length === 0) return html``;
  const recent = [...completed]
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, RECENT_COMPLETIONS);
  return html`
    <h2>Completed · ${completed.length}</h2>
    <p class="hint">
      Out of the active hierarchy, in the history: who closed it, when, and with what evidence.
      ${completed.length > recent.length
        ? html`Showing the last ${RECENT_COMPLETIONS}.`
        : ''}
    </p>
    <div class="card">
      <table>
        <tbody>
          ${recent.map(
            (action) => html`
              <tr>
                <td class="grow">
                  ${action.text}
                  <div class="muted">
                    ${action.initiative} · closed by ${action.completedBy?.name ?? 'somebody'}
                    on ${formatDateTime(action.completedAt ?? '')}
                  </div>
                  ${evidenceDetail(action)}
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

/** Takes the reader to the evidence form; the core decides whether the closing is allowed. */
function completeLink(action: Action): SafeHtml {
  return html`<a href="/actions/${action.id}/complete">Complete</a>`;
}

/**
 * The way from an action to its own history. It hangs here and not only off the historial
 * because this is the screen where somebody finds their action lower than they left it, and
 * being sent to look for it version by version is the parallel-channel argument all over again.
 */
function trajectoryLink(action: Action): SafeHtml {
  return html`<a href="/history?action=${action.id}">Trajectory</a>`;
}

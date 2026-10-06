import { html, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import { echoed, type Refusable } from '../refusal.js';
import {
  assigneeName,
  evidenceDetail,
  formatDateTime,
  originLabel,
  refusalNotice,
} from './fragments.js';
import { canComplete, type Action, type PersonRef, type WebCore } from '../../core/index.js';

/** The evidence form, so its objection is painted where it was raised. */
export const COMPLETE_SOURCE = 'complete';

export interface CompleteViewModel extends Refusable {
  actor: PersonRef;
  action: Action;
  /** Whether the core would take a closing for this action: its answer, never re-derived. */
  canComplete: boolean;
}

/**
 * The action this page is about. It refuses outright when the identifier names nothing —
 * there is no page to show without an action, so the shell answers with the objection.
 */
export function completePage(core: WebCore, actor: PersonRef, id: string): CompleteViewModel {
  const action = core.getActionOrFail(id);
  return { actor, action, canComplete: canComplete(action.status) };
}

/**
 * The web's half of the same closing the agent does: it collects the evidence and hands
 * it to the core. Which actions may be closed is the core's rule, so this page offers
 * the form and lets the core refuse — it never decides for itself.
 */
export function renderComplete(model: CompleteViewModel): SafeHtml {
  const { action } = model;
  return layout(
    'Complete action',
    { actor: model.actor, active: '/' },
    html`
      <h2>Complete an action</h2>
      ${refusalNotice(model.refusal)}
      <div class="card">
        <div class="row" style="align-items:baseline">
          <strong class="grow">${action.text}</strong>
          ${originLabel(action)}
        </div>
        <div class="muted">
          ${action.initiative} · ${assigneeName(action.assignee)} ·
          <span class="badge">${action.status}</span>
        </div>
      </div>
      ${model.canComplete ? evidenceForm(model) : closedAlready(action)}
    `,
  );
}

function evidenceForm(model: CompleteViewModel): SafeHtml {
  const { action } = model;
  const typed = echoed(model.refusal, COMPLETE_SOURCE);
  return html`
    <div class="card">
      <form method="post" action="/actions/${action.id}/complete">
        <div class="field">
          <label for="comment">Comment (optional)</label>
          <input
            type="text"
            id="comment"
            name="comment"
            value="${typed['comment'] ?? ''}"
            placeholder="What was done"
          />
        </div>
        <div class="field">
          <label for="links">Links (optional, one per line)</label>
          <textarea id="links" name="links" rows="3" placeholder="https://…">
${typed['links'] ?? ''}</textarea
          >
        </div>
        <button class="primary" type="submit">Mark completed</button>
        <span class="muted">
          It leaves the active hierarchy and remains in the history with its evidence.
        </span>
      </form>
    </div>
    <p class="hint"><a href="/">Back to the hierarchy</a></p>
  `;
}

/** Whatever the core refuses to close: already completed, or long out of the flow. */
function closedAlready(action: Action): SafeHtml {
  return html`
    <div class="card">
      ${action.completedAt === null
        ? html`<strong>This action can no longer be completed.</strong>
            <div class="muted">It left the flow: it is in status ${action.status}.</div>`
        : html`<strong>It was already completed.</strong>
            <div class="muted">
              By ${action.completedBy?.name ?? 'somebody'} on ${formatDateTime(action.completedAt)}
            </div>
            ${evidenceDetail(action)}`}
    </div>
    <p class="hint"><a href="/">Back to the hierarchy</a></p>
  `;
}

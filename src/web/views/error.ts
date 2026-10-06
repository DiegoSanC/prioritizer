import { html, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import type { Refusal } from '../refusal.js';
import { refusalNotice } from './fragments.js';
import type { PersonRef } from '../../core/index.js';

export interface ErrorViewModel {
  /** Null when the refusal happened on a page read with no session. */
  actor: PersonRef | null;
  refusal: Refusal;
}

/**
 * The page there is no page for: an identifier in the URL that names nothing, so there is
 * nothing to present and no form to repaint. It has no presenter — nothing is read — but
 * it does get the layout and the nav, because the objection alone on a bare screen leaves
 * the reader with no way back.
 */
export function renderError(model: ErrorViewModel): SafeHtml {
  return layout(
    'No se puede mostrar',
    model.actor ? { actor: model.actor, active: '' } : null,
    html`
      <h2>This page cannot be shown</h2>
      ${refusalNotice(model.refusal)}
      <p class="hint"><a href="/">Back to the hierarchy</a></p>
    `,
  );
}

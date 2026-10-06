import { html, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import type { Refusable } from '../refusal.js';
import { refusalNotice } from './fragments.js';

/** The form of this page, so its objection is painted where it was raised. */
export const LOGIN_SOURCE = 'login';

export interface LoginViewModel extends Refusable {}

/**
 * The one page with nothing to read: the door asks the core no question until somebody
 * pushes a token through it. It has a presenter all the same, so every page is composed
 * the same way and none of them is a special case of the shell.
 */
export function loginPage(): LoginViewModel {
  return {};
}

/**
 * The token field is the only one on the web that is not echoed back on a repaint: a
 * credential typed once does not get painted into the page that just refused it.
 */
export function renderLogin(model: LoginViewModel): SafeHtml {
  return layout(
    'Log in',
    { actor: null, active: '/login' },
    html`
      <h2>Log in</h2>
      <p class="hint">Paste the personal token the operator issued you.</p>
      ${refusalNotice(model.refusal)}
      <div class="card">
        <form method="post" action="/login">
          <div class="field">
            <label for="token">Token</label>
            <input type="text" id="token" name="token" required autocomplete="off" />
          </div>
          <button class="primary" type="submit">Log in</button>
        </form>
      </div>
    `,
  );
}

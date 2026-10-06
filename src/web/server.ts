import type { WebCore } from '../core/index.js';
import { buildShell, type WebHandler } from './shell.js';
import { LOGIN_SOURCE, loginPage, renderLogin } from './views/login.js';
import { historyPage, renderHistory } from './views/history.js';
import {
  CONSOLIDATE_SOURCE,
  discussionSource,
  mainPage,
  REGISTER_SOURCE,
  renderMain,
  triageSource,
} from './views/main.js';
import { COMPLETE_SOURCE, completePage, renderComplete } from './views/complete.js';
import { publishedPage, renderPublished } from './views/published.js';

export type { WebHandler } from './shell.js';

/**
 * The web, whole: a table of routes over the shell. Every line is the same three moves —
 * the shell says who is asking, a presenter reads, a view renders — and every write names
 * the page that will show its objection if the core refuses.
 *
 * It takes a `WebCore` and not a `Core`: the browser's door is `authenticate`, and the
 * MCP's — `admitAgent`, which writes a `denegada` to the invocation log — is not reachable
 * from here. The rule used to be a comment; now it does not compile.
 */
export function createWebApp(core: WebCore): WebHandler {
  const { page, publicPage, action, publicAction, handler } = buildShell(core);

  const entrar = publicPage('/login', () => loginPage(), renderLogin, { whenSignedIn: '/' });
  const main = page('/', ({ actor }) => mainPage(core, actor), renderMain);
  const completar = page(
    '/actions/:id/complete',
    ({ actor, params }) => completePage(core, actor, params['id'] ?? ''),
    renderComplete,
  );
  page('/history', ({ actor, query }) => historyPage(core, actor, query), renderHistory);

  /**
   * The one surface served with no session at all, to whoever in the organization reaches
   * the URL: it never reads the cookie, there is no actor and there is nothing to write.
   * The visit is not logged either — the invocation log measures adoption per person and
   * per MCP tool, and here there is neither person nor invocation.
   */
  publicPage('/published', () => publishedPage(core), renderPublished, { noStore: true });

  publicAction(
    '/login',
    ({ form, session }) => {
      const token = (form.get('token') ?? '').trim();
      if (!core.authenticate(token)) {
        // Not a rule of the domain: the door simply did not open, and it says so with the
        // 401 it has always answered with, on the login page and with no token echoed back.
        return {
          source: LOGIN_SOURCE,
          code: 'unauthenticated',
          message: 'Invalid or revoked token.',
          values: {},
        };
      }
      session.start(token);
    },
    { onRefusal: entrar, source: () => LOGIN_SOURCE },
  );

  // Closing a session asks the core nothing, so it cannot be refused — it names the login
  // page all the same, because every write on this table says where its objection would go.
  publicAction('/logout', ({ session }) => session.end(), { onRefusal: entrar, to: '/login' });

  action(
    '/consolidate',
    ({ actor, form }) => core.consolidate({ actor: actor.id, reason: form.get('reason') ?? '' }),
    { onRefusal: main, source: () => CONSOLIDATE_SOURCE },
  );

  action('/draft/:id/up', ({ params }) => core.moveInDraft(params['id'] ?? '', 'up'), {
    onRefusal: main,
  });
  action('/draft/:id/down', ({ params }) => core.moveInDraft(params['id'] ?? '', 'down'), {
    onRefusal: main,
  });
  action('/draft/:id/prioritize', ({ params }) => core.placeInDraft(params['id'] ?? ''), {
    onRefusal: main,
  });
  action('/draft/:id/remove', ({ actor, params }) => core.removeFromDraft(params['id'] ?? '', actor.id), {
    onRefusal: main,
  });

  /**
   * The discussion over the draft. Any signed-in person may leave one — who counts as a
   * stakeholder is the core's call, and it turns nobody away — and nothing is gated on it.
   */
  action(
    '/draft/:id/comment',
    ({ actor, params, form }) =>
      core.commentInDraft(params['id'] ?? '', {
        actor: actor.id,
        text: form.get('comment') ?? '',
      }),
    { onRefusal: main, source: ({ id }) => discussionSource(id ?? '') },
  );

  action(
    '/actions',
    ({ actor, form }) =>
      core.registerAction({
        text: form.get('text') ?? '',
        initiative: form.get('initiative') ?? '',
        assignee: form.get('assignee') || null,
        actor: actor.id,
      }),
    { onRefusal: main, source: () => REGISTER_SOURCE },
  );

  // The four exits of the triage and the way back in are one form with four buttons, so
  // they are one source too: whichever refuses, the card that refused echoes what was typed.
  const fromTriageCard = {
    onRefusal: main,
    source: ({ id }: Record<string, string>) => triageSource(id ?? ''),
  };

  action(
    '/actions/:id/accept',
    ({ actor, params, form }) =>
      core.acceptAction(params['id'] ?? '', {
        actor: actor.id,
        initiative: form.get('initiative') ?? undefined,
        assignee: form.get('assignee') || null,
      }),
    fromTriageCard,
  );
  action(
    '/actions/:id/reject',
    ({ actor, params, form }) =>
      core.rejectAction(params['id'] ?? '', { actor: actor.id, note: form.get('note') }),
    fromTriageCard,
  );
  action(
    '/actions/:id/defer',
    ({ actor, params, form }) =>
      core.deferAction(params['id'] ?? '', { actor: actor.id, note: form.get('note') }),
    fromTriageCard,
  );
  action(
    '/actions/:id/duplicate',
    ({ actor, params, form }) =>
      core.markDuplicate(params['id'] ?? '', {
        actor: actor.id,
        duplicateOf: form.get('duplicateOf') ?? '',
        note: form.get('note'),
      }),
    fromTriageCard,
  );
  /**
   * Reactivating is a triage decision like the rest — it puts the action back in the inbox
   * and back into "unprioritized" — so it goes through the same door as the four exits.
   */
  action(
    '/actions/:id/reactivate',
    ({ actor, params }) => core.reactivateAction(params['id'] ?? '', { actor: actor.id }),
    fromTriageCard,
  );

  action(
    '/actions/:id/complete',
    ({ actor, params, form }) =>
      core.completeAction(params['id'] ?? '', {
        actor: actor.id,
        comment: form.get('comment'),
        // One link per line is how the form carries them; what counts as a valid link,
        // and what to do with the blanks, is the core's call.
        links: (form.get('links') ?? '').split(/\r?\n/),
      }),
    // The refusal belongs on the page the evidence was typed into, not on the main screen.
    { onRefusal: completar, source: () => COMPLETE_SOURCE },
  );

  return handler;
}

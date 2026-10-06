import type { IncomingMessage, ServerResponse } from 'node:http';
import { DomainError, type PersonRef, type WebCore } from '../core/index.js';
import type { SafeHtml } from './html.js';
import { readFormBody, redirect, sendHtml, sendText } from './http.js';
import { Router, type RouteContext } from './router.js';
import { currentActor, endSession, startSession } from './session.js';
import { renderError } from './views/error.js';
import {
  refusalFrom,
  statusFor,
  typedValues,
  type Refusable,
  type Refusal,
} from './refusal.js';

export type WebHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** What a page's presenter is handed: who is asking, and the request's own words. */
export interface PageContext {
  actor: PersonRef;
  params: Record<string, string>;
  query: URLSearchParams;
}

/** What an action is handed: it signs a write and returns nothing to paint. */
export interface ActionContext {
  actor: PersonRef;
  params: Record<string, string>;
  form: URLSearchParams;
}

/**
 * An action taken with no session: only the two that open and close one. It is handed no
 * actor — there is none yet, or there is about to be none — and no route parameters,
 * because a door has nothing to address.
 */
export interface PublicActionContext {
  form: URLSearchParams;
  session: SessionPort;
}

/** The browser session, which is the only piece of the response an action may touch. */
export interface SessionPort {
  start(token: string): void;
  end(): void;
}

/** Re-presents a page with the objection visible on it. Registering a page returns one. */
export type Repaint = (ctx: RouteContext, refusal: Refusal | null) => void;

export interface PublicPageOptions {
  /** Where a reader who already has a session belongs; absent means the cookie is never read. */
  whenSignedIn?: string;
  /** The published page is only worth anything if it is the latest one. */
  noStore?: boolean;
}

export interface ActionOptions {
  /** The page that re-presents itself with the objection. Explicit, one per action. */
  onRefusal: Repaint;
  /** Which form refused, so only that one echoes back what was typed. Defaults to the route. */
  source?: (params: Record<string, string>) => string;
  /** Where the browser goes when the write goes through. */
  to?: string;
}

/**
 * The shell of the web: everything that is true of every route — who is asking, what to
 * do when the core refuses, and which status says so — lives here and not in the routes.
 * `server.ts` is left holding the table of routes, and each page holds its own reading.
 *
 * Modelled on the MCP's tool registry (`mcp/tools.ts`), where logging, the error taxonomy
 * and the shaping of results sit outside the tool bodies so no tool can forget them.
 */
export interface Shell {
  /** A page behind the session. Returns the repaint an action names in `onRefusal`. */
  page<M extends Refusable>(
    path: string,
    present: (ctx: PageContext) => M,
    render: (model: M) => SafeHtml,
  ): Repaint;
  /** A page read with no session at all: it asks nothing of the request but the request. */
  publicPage<M extends Refusable>(
    path: string,
    present: () => M,
    render: (model: M) => SafeHtml,
    options?: PublicPageOptions,
  ): Repaint;
  /**
   * A write behind the session. The act hands the write to the core and returns nothing:
   * whether it is allowed is the core's answer, and its refusal comes back as an exception.
   */
  action(path: string, act: (ctx: ActionContext) => void, options: ActionOptions): void;
  /**
   * A write with no session: opening one and closing one. Its act may *return* a refusal,
   * because a token that does not open the door breaks no rule of the domain.
   */
  publicAction(
    path: string,
    act: (ctx: PublicActionContext) => Refusal | void,
    options: ActionOptions,
  ): void;
  handler: WebHandler;
}

export function buildShell(core: WebCore): Shell {
  const router = new Router();

  const page = <M extends Refusable>(
    path: string,
    present: (ctx: PageContext) => M,
    render: (model: M) => SafeHtml,
  ): Repaint => {
    const repaint: Repaint = (ctx, refusal) => {
      const actor = currentActor(core, ctx.req);
      if (!actor) {
        redirect(ctx.res, '/login');
        return;
      }
      sendPage(ctx, refusal, {
        path,
        actor,
        present: () => present({ actor, params: ctx.params, query: ctx.query }),
        render,
      });
    };
    router.get(path, (ctx) => repaint(ctx, null));
    return repaint;
  };

  const publicPage = <M extends Refusable>(
    path: string,
    present: () => M,
    render: (model: M) => SafeHtml,
    options: PublicPageOptions = {},
  ): Repaint => {
    const repaint: Repaint = (ctx, refusal) => {
      if (options.noStore) {
        // No intermediary may keep an old consolidation alive after a new one is signed.
        ctx.res.setHeader('cache-control', 'no-store');
      }
      sendPage(ctx, refusal, { path, actor: null, present, render });
    };
    router.get(path, (ctx) => {
      // Only whoever came here to read is sent on: a repaint answers the request that was
      // refused, and bouncing it on the strength of an old cookie would swallow the refusal.
      if (options.whenSignedIn && currentActor(core, ctx.req)) {
        redirect(ctx.res, options.whenSignedIn);
        return;
      }
      repaint(ctx, null);
    });
    return repaint;
  };

  /** What it takes to paint one page: where it lives, who is reading, and its two halves. */
  interface Painting<M extends Refusable> {
    path: string;
    actor: PersonRef | null;
    present: () => M;
    render: (model: M) => SafeHtml;
  }

  /** Presents a page and sends it — with the objection it was given, or the one it raised. */
  function sendPage<M extends Refusable>(
    ctx: RouteContext,
    injected: Refusal | null,
    { path, actor, present, render }: Painting<M>,
  ): void {
    let model: M;
    try {
      model = present();
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      // The page cannot be presented at all — an identifier in the URL that names nothing.
      // There is no form to repaint, so the objection gets the layout and the nav anyway,
      // and never the bare line of text that used to leave the reader with no way back.
      const refusal = refusalFrom(error, path);
      sendHtml(ctx.res, renderError({ actor, refusal }), statusFor(refusal.code));
      return;
    }
    const refusal = injected ?? model.refusal ?? null;
    sendHtml(
      ctx.res,
      render({ ...model, refusal }),
      // The repaint answers with the error status and the whole page: the reader keeps the
      // forms, the other answers and what they typed, and the wire still says it went wrong.
      refusal ? statusFor(refusal.code) : 200,
    );
  }

  const action = (path: string, act: (ctx: ActionContext) => void, options: ActionOptions): void => {
    router.post(path, async (ctx) => {
      const actor = currentActor(core, ctx.req);
      if (!actor) {
        redirect(ctx.res, '/login');
        return;
      }
      const form = await readFormBody(ctx.req);
      settle(ctx, path, form, options, () => {
        act({ actor, params: ctx.params, form });
      });
    });
  };

  const publicAction = (
    path: string,
    act: (ctx: PublicActionContext) => Refusal | void,
    options: ActionOptions,
  ): void => {
    router.post(path, async (ctx) => {
      const form = await readFormBody(ctx.req);
      const session: SessionPort = {
        start: (token) => startSession(ctx.res, token),
        end: () => endSession(ctx.res),
      };
      settle(ctx, path, form, options, () => act({ form, session }));
    });
  };

  /** Runs a write and answers: a redirect when it went through, its page when it did not. */
  function settle(
    ctx: RouteContext,
    path: string,
    form: URLSearchParams,
    { onRefusal, source, to = '/' }: ActionOptions,
    act: () => Refusal | void,
  ): void {
    let refusal: Refusal | void;
    try {
      refusal = act();
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      refusal = refusalFrom(error, source ? source(ctx.params) : path, typedValues(form));
    }
    if (refusal) {
      onRefusal(ctx, refusal);
      return;
    }
    redirect(ctx.res, to);
  }

  const handler: WebHandler = (req, res) => {
    void dispatch(req, res);
  };

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = router.match(req.method ?? 'GET', url.pathname);
    if (!match) {
      sendText(res, 'No encontrado', 404);
      return;
    }
    try {
      await match.handler({ req, res, params: match.params, query: url.searchParams });
    } catch {
      // Every refusal the system means to raise is answered by its page; whatever reaches
      // here is a fault of ours, and says so.
      sendText(res, 'Error interno del servicio', 500);
    }
  }

  return { page, publicPage, action, publicAction, handler };
}

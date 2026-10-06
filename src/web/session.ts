import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PersonRef, WebCore } from '../core/index.js';
import { clearCookie, parseCookies, setCookie } from './http.js';

const COOKIE = 'prioritizer_session';
const MAX_AGE_SECONDS = 30 * 24 * 3600;

/**
 * Web sessions ride on the same personal tokens the operator issues for the MCP —
 * the product web is a write surface, so it needs an identified actor for every
 * transition. The published page needs no session at all.
 */
export function currentActor(core: WebCore, req: IncomingMessage): PersonRef | null {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  return core.authenticate(token);
}

export function startSession(res: ServerResponse, token: string): void {
  setCookie(res, COOKIE, token, MAX_AGE_SECONDS);
}

export function endSession(res: ServerResponse): void {
  clearCookie(res, COOKIE);
}

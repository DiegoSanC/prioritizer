import type { DomainError } from '../core/index.js';

/**
 * A rechazo: the objection the core (or the login door) raises, on its way back to the
 * page the reader was using. One mechanism for the whole web, because the three places
 * that used to answer a refusal each answered it differently — and the one that lost the
 * typing lost the forms with it.
 *
 * There are exactly three producers, and no fourth:
 *
 * 1. The shell catches a `DomainError` — from an action, or from a presenter that cannot
 *    even present its page — and turns it into one with `refusalFrom`.
 * 2. An action returns one: `/login`, whose bad token is not a domain rule but the web's
 *    own door, and still answers 401.
 * 3. A presenter fills it in itself: `/history`, whose questions travel in the URL and
 *    are refused at presentation time.
 */
export interface Refusal {
  /** Which form or question refused, so only that one echoes back what was typed. */
  source: string;
  code: RefusalCode;
  /** The core's own words. No surface rewrites a rule it does not own. */
  message: string;
  /** What was typed, so the repaint gives it back instead of emptying the page. */
  values: Record<string, string>;
}

/**
 * The core's taxonomy plus the one refusal the web owns: a token that is not valid or has
 * been revoked. It lives here and not in `DomainErrorCode` because no rule of the domain
 * was broken — the door simply did not open.
 */
export type RefusalCode = DomainError['code'] | 'unauthenticated';

/** Every ViewModel of the web: any page can be repainted carrying an objection. */
export interface Refusable {
  refusal?: Refusal | null;
}

/** The web's half of the core's vocabulary: one status per code, and no default. */
export function statusFor(code: RefusalCode): number {
  switch (code) {
    case 'validation':
    case 'invalid_transition':
      return 400;
    case 'not_found':
      return 404;
    case 'unauthorized':
      return 403;
    case 'conflict':
      return 409;
    case 'unauthenticated':
      return 401;
  }
}

/** The core refused: its code and its words travel unchanged, with what was typed. */
export function refusalFrom(
  error: DomainError,
  source: string,
  values: Record<string, string> = {},
): Refusal {
  return { source, code: error.code, message: error.message, values };
}

/** Everything a form said, in the shape a repaint reads it back from. */
export function typedValues(form: URLSearchParams): Record<string, string> {
  return Object.fromEntries(form);
}

/**
 * What this form should paint back into its fields. Empty for every form but the one that
 * refused: a page repaints whole, and the fields nobody touched keep what they showed.
 */
export function echoed(refusal: Refusal | null | undefined, source: string): Record<string, string> {
  return refusal && refusal.source === source ? refusal.values : {};
}

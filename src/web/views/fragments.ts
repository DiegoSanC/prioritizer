/**
 * The vocabulary shared by every surface of the web: the fragments more than one page
 * paints, and the formats they all read dates in. They live apart from any page because
 * two screens wording the same thing differently is the argument these screens exist to
 * settle — and because a page should be editable without risking the words of the rest.
 *
 * Nothing here decides anything: every fragment renders what the core already answered.
 */

import { html, type SafeHtml } from '../html.js';
import type { Refusal } from '../refusal.js';
import type {
  Action,
  ConsolidationSignature,
  Person,
  PersonRef,
  StalenessSignal,
} from '../../core/index.js';

/**
 * The objection a page was repainted with, in the same place and the same words on every
 * surface. What was typed goes back into the fields it came from — see `echoed` — and this
 * says why the page came back at all.
 */
export function refusalNotice(refusal: Refusal | null | undefined): SafeHtml {
  if (!refusal) return html``;
  return html`<div class="error">${refusal.message}</div>`;
}

/**
 * Who signed a consolidation, when, how big it was and why — its whole firma, in the same
 * words on every surface. The count travels apart because a signature is legible without
 * the entries, and the published page holds them split in two lists.
 */
export function consolidationSignature(
  signature: ConsolidationSignature,
  actionCount: number,
): SafeHtml {
  return html`
    <div class="muted">
      Consolidated by ${signature.by.name} on ${formatDateTime(signature.at)} ·
      ${actionCount} actions
    </div>
    <div class="muted">Reason: ${signature.reason}</div>
  `;
}

/** An unassigned action is named that way everywhere, in the same words. */
export function assigneeName(assignee: PersonRef | null): string {
  return assignee?.name ?? 'unassigned';
}

/**
 * The staleness warning, in one place for both pages that paint it. Whoever is looking at
 * the product web and whoever is looking at the published page are usually arguing with
 * each other; two wordings of the same warning, or two dates, would turn a signal meant to
 * settle that argument into one more thing to argue about.
 *
 * Nothing is decided here: whether the hierarchy is stale, and since when, is the core's
 * answer, and the date shown is the one it gives.
 */
export function stalenessBanner(staleness: StalenessSignal | null): SafeHtml {
  if (!staleness) return html``;
  return html`<div class="banner">
    Hierarchy stale since ${formatDate(staleness.since)}: there are accepted actions
    left unconsolidated for more than ${staleness.thresholdBusinessHours} business hours.
  </div>`;
}

/** The recorded evidence, shown wherever a completed action is listed. */
export function evidenceDetail(action: Action): SafeHtml {
  const evidence = action.evidence;
  if (!evidence || (evidence.comment === null && evidence.links.length === 0)) {
    return html`<div class="muted">No evidence.</div>`;
  }
  return html`
    ${evidence.comment ? html`<div class="comment">${evidence.comment}</div>` : ''}
    ${evidence.links.map((link) => html`<div><a href="${link}">${link}</a></div>`)}
  `;
}

export function peopleSelect(name: string, people: Person[], selected: string | null): SafeHtml {
  return html`
    <select name="${name}">
      <option value="">— unassigned —</option>
      ${people.map(
        (person) =>
          html`<option value="${person.id}" ${person.id === selected ? html`selected` : ''}>
            ${person.name}
          </option>`,
      )}
    </select>
  `;
}

export function originLabel(action: Action): SafeHtml {
  if (action.origin.kind === 'manual') {
    return html`<span class="badge">manual</span>`;
  }
  const { tool, meetingTitle, meetingDate } = action.origin.source;
  const detail = [meetingTitle, meetingDate ? formatDate(meetingDate) : null].filter(Boolean).join(' · ');
  return html`<span class="badge">${tool}</span>
    ${detail ? html`<span class="muted"> ${detail}</span>` : ''}`;
}

export function formatDateTime(iso: string): string {
  return `${iso.replace('T', ' ').slice(0, 16)} UTC`;
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

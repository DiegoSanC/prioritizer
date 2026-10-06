import { html, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import type { Refusable } from '../refusal.js';
import { assigneeName, consolidationSignature, stalenessBanner } from './fragments.js';
import type {
  ConsolidationEntry,
  ConsolidationSignature,
  CurrentHierarchy,
  WebCore,
} from '../../core/index.js';

export interface PublishedViewModel extends Refusable {
  /**
   * The very same reading the product web renders on its main screen. Both screens answer
   * "what is in force, and can it still be trusted?", and neither derives it, so neither
   * can contradict the other.
   */
  hierarchy: CurrentHierarchy;
}

/**
 * One reading and nothing else — not even who is asking, because nobody has to be. The
 * page exists as a presenter like the rest so that every page is composed the same way.
 */
export function publishedPage(core: WebCore): PublishedViewModel {
  return { hierarchy: core.currentHierarchy() };
}

/**
 * The page anyone in the organization opens without credentials: the consolidated
 * hierarchy in force and the signature that makes it authoritative. Its model is the
 * core's reading, whole and unchanged — the page derives nothing of its own.
 *
 * It carries no session, so everything on it is readable by whoever reaches the URL: the
 * texts of the actions, the initiatives and the names of the people responsable and of
 * whoever consolidated. That is the point — a dev has to find their own line here when
 * the MCP is down — and it is why nothing still under negotiation (the draft, the triage
 * inbox) and no product judgement (why an action left) ever reaches this page.
 */
export function renderPublished(model: PublishedViewModel): SafeHtml {
  const { consolidation, staleness, ordered, gone } = model.hierarchy;

  // The staleness warning goes above the signature and not under the order: whoever comes
  // here to settle a dispute has to know the hierarchy has fallen behind before believing
  // the order, and the same words as the product web say it — see `stalenessBanner`.
  return layout(
    'Hierarchy in force',
    null,
    html`
      <h2>Hierarchy in force</h2>
      <p class="hint">
        The last consolidated hierarchy, read-only, for anyone in the organization.
        It is the page to point at to settle a priority dispute, and the one to read if
        the MCP service is unavailable.
      </p>
      ${stalenessBanner(staleness)}
      ${consolidation === null ? neverConsolidated() : inForce(consolidation, ordered, gone)}
    `,
  );
}

/** Never consolidated is not an empty hierarchy: nobody has decided anything yet. */
function neverConsolidated(): SafeHtml {
  return html`
    <div class="card">
      <strong>No hierarchy has been consolidated yet.</strong>
      <p class="muted">
        Nobody has signed a global order yet, so there is no priority in force
        to publish. An empty page here does not mean there is no work.
      </p>
    </div>
  `;
}

function inForce(
  consolidation: ConsolidationSignature,
  ordered: ConsolidationEntry[],
  gone: ConsolidationEntry[],
): SafeHtml {
  return html`
    <div class="card">
      <strong>Consolidation v${consolidation.version}</strong>
      ${consolidationSignature(consolidation, ordered.length + gone.length)}
    </div>
    ${orderSection(ordered, gone.length)} ${goneSection(gone)}
  `;
}

function orderSection(ordered: ConsolidationEntry[], goneCount: number): SafeHtml {
  if (ordered.length === 0) {
    return html`
      <h2>In force · 0</h2>
      <div class="card">
        <p class="muted">
          ${goneCount === 0
            ? html`The consolidation in force was signed without ordering any action.`
            : html`The consolidation in force no longer has any live action: everything it
                ordered has left the hierarchy.`}
        </p>
      </div>
    `;
  }
  return html`
    <h2>In force · ${ordered.length}</h2>
    <p class="hint">
      Each action's number is its position in the global order, and it is never renumbered:
      if a number is missing, that action left the hierarchy and sits further down.
    </p>
    ${entryTable(ordered)}
  `;
}

/**
 * What the signed order still names and is no longer live: the answer a reader needs when
 * a position is missing. It says an action left, never how — the way out of the flow is a
 * product judgement, and this page is read without credentials.
 */
function goneSection(gone: ConsolidationEntry[]): SafeHtml {
  if (gone.length === 0) return html``;
  return html`
    <h2>Out of the hierarchy in force · ${gone.length}</h2>
    <p class="hint">
      The consolidation in force ordered them, but they are no longer live work. They stay here, with
      their position, so no gap in the order is left unexplained.
    </p>
    ${entryTable(gone)}
  `;
}

function entryTable(entries: ConsolidationEntry[]): SafeHtml {
  return html`
    <div class="card">
      <table>
        <tbody>
          ${entries.map(
            (entry) => html`
              <tr>
                <td class="pos">${entry.position}</td>
                <td class="grow">
                  <div>${entry.text}</div>
                  <div class="muted">${entry.initiative} · ${assigneeName(entry.assignee)}</div>
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

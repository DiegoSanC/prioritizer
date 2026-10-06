import { DomainError } from '../../core/index.js';
import { html, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import { echoed, refusalFrom, type Refusable, type Refusal } from '../refusal.js';
import {
  assigneeName,
  consolidationSignature,
  formatDate,
  formatDateTime,
  refusalNotice,
} from './fragments.js';
import type {
  Action,
  ActionChange,
  Consolidation,
  ConsolidationDiff,
  ConsolidationEntry,
  EntryChange,
  HistoryVersion,
  PersonRef,
  WebCore,
} from '../../core/index.js';

/**
 * The questions this page asks, each one the source of its own objection. They travel in
 * the URL and not in a body, so a question nobody can understand is refused while the page
 * is being presented — there is no write to refuse and nothing to redirect to.
 */
const DATE_SOURCE = 'date';
const VERSION_SOURCE = 'version';
const DIFF_SOURCE = 'compare';
const TRAJECTORY_SOURCE = 'action';

/** The hierarchy the page is showing, and which of the two questions brought it. */
export type ShownHierarchy =
  | { asked: 'date'; date: string; consolidation: Consolidation | null }
  | { asked: 'version'; consolidation: Consolidation };

/**
 * One action's trace through the snapshots, next to the action as it stands today. Two
 * readings on purpose: what the versions froze is not what the action says now, and the
 * page has to show both to answer "why did mine move" without pretending they are one.
 */
export interface ShownTrajectory {
  action: Action;
  changes: ActionChange[];
}

export interface HistoryViewModel extends Refusable {
  actor: PersonRef;
  /** The sequence of snapshots, newest first: the history is nothing else. */
  history: HistoryVersion[];
  shown: ShownHierarchy | null;
  diff: ConsolidationDiff | null;
  trajectory: ShownTrajectory | null;
}

/**
 * The page's questions are independent: one that cannot be understood must not wipe out
 * the answer to the others. Each is asked apart, and the first refusal is the one shown —
 * the page is repainted whole, with the objection in the core's own words, rather than
 * leaving the reader on a bare screen with no forms.
 */
export function historyPage(
  core: WebCore,
  actor: PersonRef,
  query: URLSearchParams,
): HistoryViewModel {
  const date = query.get('date');
  const version = query.get('version');
  const from = query.get('from');
  const to = query.get('to');
  const actionId = query.get('action');

  // One slot, two ways of asking for it: a version by name, or whatever was in force on a
  // date. The one that was asked is the one that owns the objection if it comes to that.
  const shown = ask(
    version ? VERSION_SOURCE : DATE_SOURCE,
    version ? { version } : { date: date ?? '' },
    (): ShownHierarchy | null => {
      if (version) {
        return { asked: 'version', consolidation: core.getConsolidationOrFail(Number(version)) };
      }
      if (date) {
        return { asked: 'date', date, consolidation: core.consolidationAt(date) };
      }
      return null;
    },
  );
  const diff = ask(DIFF_SOURCE, { from: from ?? '', to: to ?? '' }, () =>
    from && to ? core.diffConsolidations(Number(from), Number(to)) : null,
  );
  // Two different readings on purpose: the action as it stands today, and the trace it
  // left in the snapshots, which name it the way they named it back then.
  const trajectory = ask(TRAJECTORY_SOURCE, { action: actionId ?? '' }, () =>
    actionId ? { action: core.getActionOrFail(actionId), changes: core.changesFor(actionId) } : null,
  );

  return {
    actor,
    history: core.consolidationHistory(),
    shown: shown.value,
    diff: diff.value,
    trajectory: trajectory.value,
    refusal: shown.refusal ?? diff.refusal ?? trajectory.refusal,
  };
}

/** Asks one of the page's questions, keeping the core's own objection if it refuses. */
function ask<T>(
  source: string,
  values: Record<string, string>,
  question: () => T | null,
): { value: T | null; refusal: Refusal | null } {
  try {
    return { value: question(), refusal: null };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { value: null, refusal: refusalFrom(error, source, values) };
  }
}

export function renderHistory(model: HistoryViewModel): SafeHtml {
  return layout(
    'History',
    { actor: model.actor, active: '/history' },
    html`
      <h2>Consolidation history</h2>
      <p class="hint">
        Everything on this page comes from the signed snapshots: there is no record of the
        past other than the sequence of consolidations itself.
      </p>
      ${refusalNotice(model.refusal)}
      ${trajectorySection(model.trajectory)}
      ${asOfSection(model)}
      ${compareSection(model)}
      ${sequenceSection(model.history)}
    `,
  );
}

/**
 * The trajectory of the action the reader clicked on, first thing on the page: it is the
 * answer to what brought them here. It has no form of its own because nobody types an
 * identifier — every action named anywhere on this page links to its own trace.
 */
function trajectorySection(trajectory: ShownTrajectory | null): SafeHtml {
  if (!trajectory) return html``;
  const { action, changes } = trajectory;
  return html`
    <h2>When and why it changed position</h2>
    <p class="hint">
      The why of each move is the reason that consolidation was signed with: there is no
      separate per-action motive, and each line comes from comparing two snapshots.
    </p>
    <div class="card">
      <strong>${action.text}</strong>
      <div class="muted">
        Today: ${action.initiative} · ${assigneeName(action.assignee)} ·
        <span class="badge">${action.status}</span>
      </div>
      ${changes.length === 0
        ? html`<p class="muted">It has not entered any consolidation yet.</p>`
        : trajectoryTable(changes)}
    </div>
  `;
}

function trajectoryTable(changes: ActionChange[]): SafeHtml {
  return html`
    <table>
      <thead>
        <tr>
          <th>Version</th>
          <th>Date</th>
          <th>What happened</th>
          <th>Position</th>
          <th>Consolidated by</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        ${changes.map(trajectoryRow)}
      </tbody>
    </table>
  `;
}

function trajectoryRow(change: ActionChange): SafeHtml {
  const { signature, previous } = change;
  return html`
    <tr>
      <td><a href="/history?version=${signature.version}">v${signature.version}</a></td>
      <td class="muted">${formatDateTime(signature.at)}</td>
      <td>
        ${previous === null
          ? html`<span class="badge">${change.kind}</span>`
          : html`<a href="/history?from=${previous}&to=${signature.version}"
              ><span class="badge">${change.kind}</span></a
            >`}
      </td>
      <td style="white-space:nowrap">${positions(change)}</td>
      <td>${signature.by.name}</td>
      <td class="grow">
        ${signature.reason}${entryNaming(change)}${renamingNote(change, previous)}
      </td>
    </tr>
  `;
}

/**
 * The words a version took the action in under. Only on the way in: repeating them on
 * every move would drown the table, and while it stays in it is `renamingNote` that says
 * they changed. Coming back after a spell outside is where this earns its place — an
 * action can leave, be triaged into another initiative and return under a different name,
 * and there is no earlier entry in that step to compare it against.
 */
function entryNaming(change: ActionChange): SafeHtml {
  if (change.kind !== 'enters') return html``;
  return frozenAs(change.signature.version, change.after);
}

function asOfSection(model: HistoryViewModel): SafeHtml {
  return html`
    <h2>Hierarchy as of a date</h2>
    <p class="hint">
      Which order was in force on a given day, as it was signed: it includes actions that were
      completed later, because the snapshot does not change when the action does. If that day
      had more than one consolidation the last one answers; to see a specific version, use
      its link in the table below.
    </p>
    <div class="card">
      <form method="get" action="/history">
        <div class="row" style="align-items:flex-end">
          <div class="field">
            <label for="date">Date</label>
            <input type="date" id="date" name="date" value="${askedDate(model)}" required />
          </div>
          <div class="field" style="flex:0 0 auto">
            <button class="primary" type="submit">Look up</button>
          </div>
        </div>
      </form>
    </div>
    ${model.shown ? shownResult(model.shown) : ''}
  `;
}

function shownResult(shown: ShownHierarchy): SafeHtml {
  if (shown.asked === 'version') {
    const { consolidation } = shown;
    return hierarchyCard(
      html`Hierarchy v${consolidation.version}, as it was signed`,
      consolidation,
    );
  }
  const { consolidation } = shown;
  if (!consolidation) {
    return html`<div class="card">
      <strong>On ${formatDate(shown.date)} no hierarchy had been consolidated.</strong>
      <p class="muted">Nobody had consolidated yet on that date.</p>
    </div>`;
  }
  return hierarchyCard(
    html`On ${formatDate(shown.date)} the one in force was v${consolidation.version}`,
    consolidation,
  );
}

/** A frozen hierarchy, whole: its signature and the order it named, in its own words. */
function hierarchyCard(heading: SafeHtml, consolidation: Consolidation): SafeHtml {
  return html`
    <div class="card">
      <strong>${heading}</strong>
      ${consolidationSignature(consolidation, consolidation.entries.length)}
      <ol class="hierarchy">
        ${consolidation.entries.map((entry) => html`<li>${entryLine(entry)}</li>`)}
      </ol>
    </div>
  `;
}

function compareSection(model: HistoryViewModel): SafeHtml {
  if (model.history.length < 2) {
    return html``;
  }
  return html`
    <h2>What changed between two consolidations</h2>
    <div class="card">
      <form method="get" action="/history">
        <div class="row" style="align-items:flex-end">
          <div class="field">
            <label for="from">From</label>
            ${versionSelect('from', model.history, model.diff?.from.version ?? null)}
          </div>
          <div class="field">
            <label for="to">To</label>
            ${versionSelect('to', model.history, model.diff?.to.version ?? null)}
          </div>
          <div class="field" style="flex:0 0 auto">
            <button class="primary" type="submit">Compare</button>
          </div>
        </div>
      </form>
    </div>
    ${model.diff ? diffResult(model.diff) : ''}
  `;
}

function diffResult(diff: ConsolidationDiff): SafeHtml {
  return html`
    <div class="card">
      <strong>From v${diff.from.version} to v${diff.to.version}</strong>
      <div class="muted">
        v${diff.from.version}: ${diff.from.by.name} · ${formatDateTime(diff.from.at)} ·
        ${diff.from.reason}
      </div>
      <div class="muted">
        v${diff.to.version}: ${diff.to.by.name} · ${formatDateTime(diff.to.at)} · ${diff.to.reason}
      </div>
      <table>
        <tbody>
          ${diff.changes.map(
            (change) => html`
              <tr>
                <td style="width:1%"><span class="badge">${change.kind}</span></td>
                <td style="width:1%; white-space:nowrap">${positions(change)}</td>
                <td class="grow">
                  ${entryLine(change.after ?? change.before)}
                  ${renamingNote(change, diff.from.version)}
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * The same action, named differently by each version: both namings, side by side. Which
 * version froze the earlier naming travels in, because a trajectory reads each step
 * against the one before it and a diff reads it against whichever was asked for.
 */
function renamingNote(change: EntryChange, frozenBy: number | null): SafeHtml {
  return change.namingChanged ? frozenAs(frozenBy, change.before) : html``;
}

/** A version's own words for an action — the ones no later version can change. */
function frozenAs(version: number | null, entry: ConsolidationEntry | null): SafeHtml {
  if (version === null || !entry) return html``;
  return html`<div class="muted">
    v${version} froze it as: ${entry.text} · ${entry.initiative} ·
    ${assigneeName(entry.assignee)}
  </div>`;
}

function positions(change: EntryChange): SafeHtml {
  const from = change.before ? String(change.before.position) : '—';
  const to = change.after ? String(change.after.position) : '—';
  return html`<span class="muted">${from} → ${to}</span>`;
}

function sequenceSection(history: HistoryVersion[]): SafeHtml {
  if (history.length === 0) {
    return html`
      <h2>Consolidations · 0</h2>
      <div class="card"><p class="muted">No hierarchy has been consolidated yet.</p></div>
    `;
  }
  return html`
    <h2>Consolidations · ${history.length}</h2>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Date</th>
            <th>Author</th>
            <th>Reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${history.map(historyRow)}
        </tbody>
      </table>
    </div>
  `;
}

function historyRow({ signature, previous }: HistoryVersion): SafeHtml {
  return html`
    <tr>
      <td><a href="/history?version=${signature.version}">v${signature.version}</a></td>
      <td class="muted">${formatDateTime(signature.at)}</td>
      <td>${signature.by.name}</td>
      <td class="grow">${signature.reason}</td>
      <td>
        ${previous === null
          ? html`<span class="muted">first consolidation</span>`
          : html`<a href="/history?from=${previous}&to=${signature.version}">what changed</a>`}
      </td>
    </tr>
  `;
}

/**
 * An action as one version named it, and the way into its own trajectory: wherever this
 * page names an action, clicking it answers "and this one, when and why did it move".
 */
function entryLine(entry: ConsolidationEntry | null): SafeHtml {
  if (!entry) return html``;
  return html`
    <div class="grow">
      <div><a href="/history?action=${entry.actionId}">${entry.text}</a></div>
      <div class="muted">${entry.initiative} · ${assigneeName(entry.assignee)}</div>
    </div>
  `;
}

function versionSelect(name: string, history: HistoryVersion[], selected: number | null): SafeHtml {
  return html`
    <select id="${name}" name="${name}" required>
      ${history.map(
        ({ signature }) =>
          html`<option value="${signature.version}" ${signature.version === selected ? html`selected` : ''}>
            v${signature.version} · ${formatDate(signature.at)}
          </option>`,
      )}
    </select>
  `;
}

/**
 * Keeps the date the reader asked for in the field, so the question stays visible —
 * whether it was understood or refused.
 */
function askedDate(model: HistoryViewModel): string {
  if (model.shown?.asked === 'date') return formatDate(model.shown.date);
  return echoed(model.refusal, DATE_SOURCE)['date'] ?? '';
}

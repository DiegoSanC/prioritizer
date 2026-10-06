import type { Core, IngestedItem, IngestOutcome } from '../core/index.js';
import { extractActionItems } from './action-items.js';
import {
  FIREFLIES_TOOL,
  MAX_PAGE_SIZE,
  meetingDateOf,
  readResponse,
  type FirefliesError,
  type FirefliesTransport,
  type FirefliesTranscript,
} from './fireflies.js';

/**
 * The ingest adapter: reads the action items a transcription tool already produced and
 * hands them to the core, once each. It holds no rule of its own — what an ingested
 * action becomes is decided in `core/ingest.ts` — and it never reads a raw transcript.
 *
 * Nothing here has ever run against the real Fireflies API. There are no credentials, so
 * the whole chain has only been exercised against the spike's synthetic fixtures.
 */

/**
 * The source answered, but not with anything readable. Thrown rather than returned so a
 * failed pass cannot be mistaken for a quiet one: the spec makes exactly this distinction
 * at the MCP edge, and the inbox deserves the same treatment.
 */
export class IngestFailure extends Error {
  readonly codes: string[];

  constructor(errors: FirefliesError[]) {
    const codes = errors.map((error) => error.code);
    super(
      codes.length === 0
        ? 'The ingest source returned no data and did not say why.'
        : `The ingest pass failed: ${errors
            .map((error) => `${error.code} — ${error.message}`)
            .join('; ')}`,
    );
    this.name = 'IngestFailure';
    this.codes = codes;
  }
}

/** A line the parser could not read, and the meeting it came from. */
export interface UnreadLine {
  sourceId: string;
  line: string;
}

/** What one pass did, with every gap in it named. */
export interface IngestPass {
  /** What the core made of the items: registered, already seen, unresolved names. */
  outcome: IngestOutcome;
  /** Meetings read, after discarding the ones the source repeated within the pass. */
  meetings: number;
  /** Slots that came back null or unusable. Any hole means the answer was partial. */
  holes: number;
  /** Errors the source reported alongside its data. Non-empty means the pass was not clean. */
  errors: FirefliesError[];
  /** Lines the parser did not understand. The only evidence of the real string format. */
  unread: UnreadLine[];
  /**
   * True when the pass stopped before reaching the end of the window: it never saw a short
   * page. Without this a truncated read — the page ceiling hit, or the source going quiet
   * halfway — would end up indistinguishable from a window that simply had few meetings.
   */
  truncated: boolean;
}

/** Whether a pass can be trusted as complete. A false here is not a pass with less in it. */
export function isCleanPass(pass: IngestPass): boolean {
  return pass.errors.length === 0 && pass.holes === 0 && !pass.truncated;
}

/** The window a pass reads, by transcript creation date — the only window Fireflies offers. */
export interface IngestWindow {
  fromDate: string;
  toDate: string;
}

export interface IngestOptions extends IngestWindow {
  /** Who signs the ingested actions. */
  actor: string;
  transport: FirefliesTransport;
  pageSize?: number;
}

/**
 * How wide a window to read when the operator names none.
 *
 * Fireflies offers no "modified since" filter and no webhook for a regenerated summary, so
 * a pass can only ask by creation date and re-reading is the only way to catch anything at
 * all. A week is wide enough that a skipped day costs nothing, and the overlap is free:
 * whatever was ingested before is recognized and skipped.
 */
const DEFAULT_WINDOW_DAYS = 7;

export function defaultWindow(now: Date): IngestWindow {
  return {
    fromDate: new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString(),
    toDate: now.toISOString(),
  };
}

/**
 * A ceiling on how many pages one pass will ask for. Fireflies' free plan allows 50
 * requests a day, so an unbounded loop over a paginator that never says "last page" would
 * spend the day's quota in a minute. Twenty pages is a thousand meetings in one window,
 * far past anything a pilot produces.
 */
const MAX_PAGES = 20;

export async function runIngest(core: Core, options: IngestOptions): Promise<IngestPass> {
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE;
  const errors: FirefliesError[] = [];
  let holes = 0;

  /**
   * Meetings by id. Paginating by offset means a meeting can arrive twice when new
   * material shifts the indexes between two pages, so the pass deduplicates as it reads
   * instead of trusting the source not to repeat itself.
   */
  const meetings = new Map<string, FirefliesTranscript>();

  /** Set only by a short page, which is the one thing that means "the window ends here". */
  let exhausted = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await options.transport({
      fromDate: options.fromDate,
      toDate: options.toDate,
      limit: pageSize,
      skip: page * pageSize,
    });
    const reading = readResponse(response);
    holes += reading.holes;
    errors.push(...reading.errors);

    if (response.data === null) {
      // Nothing at all came back. If this was the first page the pass never happened,
      // and reporting it as an empty window would be the lie the spec forbids.
      if (page === 0) throw new IngestFailure(reading.errors);
      break;
    }

    for (const transcript of reading.transcripts) {
      if (!meetings.has(transcript.id)) meetings.set(transcript.id, transcript);
    }

    // A short page is the end of the window, and the only clean way out of this loop.
    if (reading.slots < pageSize) {
      exhausted = true;
      break;
    }
    // Stopping because the source is answering badly leaves the window unread: paging on
    // would only spend quota on more of the same, and the pass says so through `truncated`.
    if (reading.errors.length > 0) break;
  }

  const items: IngestedItem[] = [];
  const unread: UnreadLine[] = [];
  for (const transcript of meetings.values()) {
    const source = {
      tool: FIREFLIES_TOOL,
      sourceId: transcript.id,
      meetingDate: meetingDateOf(transcript),
      meetingTitle: transcript.title,
    };
    const extraction = extractActionItems(transcript.summary?.action_items ?? null);
    for (const item of extraction.items) {
      items.push({ text: item.text, attributedTo: item.attributedTo, source });
    }
    for (const line of extraction.unread) {
      unread.push({ sourceId: transcript.id, line });
    }
  }

  return {
    outcome: core.ingestActions({ actor: options.actor, items }),
    meetings: meetings.size,
    holes,
    errors,
    unread,
    truncated: !exhausted,
  };
}

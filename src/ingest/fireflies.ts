/**
 * Everything about talking to Fireflies: the shape of what it answers, how the answer is
 * read, and the seam through which the request travels.
 *
 * The types below mirror the schema as it is PUBLISHED at docs.fireflies.ai (consulted
 * 2026-08-12), not a schema observed on the wire. Nobody has run this against a real
 * account: there are no credentials. See docs/spikes/2026-08-12-spike-de-ingesta.md and
 * docs/adr/0001-fireflies-como-fuente-unica-de-ingesta.md before trusting any of it.
 */

/** The name this tool goes by in an action's lineage. It never comes from the API. */
export const FIREFLIES_TOOL = 'fireflies';

/** Fireflies' single GraphQL endpoint. */
const FIREFLIES_ENDPOINT = 'https://api.fireflies.ai/graphql';

/** The most transcripts one `transcripts` query may return, per Fireflies' own docs. */
export const MAX_PAGE_SIZE = 50;

/**
 * Fireflies `Summary`. Note `action_items`: the docs describe it as "A list of action
 * items" but type it as a plain nullable String. That mismatch is the whole reason
 * `action-items.ts` exists.
 */
export interface FirefliesSummary {
  action_items: string | null;
}

/**
 * The subset of Fireflies `Transcript` the adapter asks for, and no more.
 *
 * Raw sentences are deliberately absent: consuming a raw transcript is a No-Go of the
 * spec, and the surest way not to do it by accident is never to request it. The rest of
 * the schema — attendees, speakers, participants, the other summary fields — is absent for
 * a duller reason: nothing reads it. The spike documents the whole schema and the fixtures
 * carry it, so whoever needs a field adds it here and to the query together.
 */
export interface FirefliesTranscript {
  id: string;
  title: string | null;
  /** ISO 8601 DateTime. */
  dateString: string | null;
  /** Milliseconds since epoch. */
  date: number | null;
  summary: FirefliesSummary | null;
}

/** A GraphQL error entry, in the shape Fireflies documents. */
export interface FirefliesError {
  message: string;
  friendly?: boolean;
  code: string;
  extensions?: {
    helpUrls?: string[];
    code?: string;
    status?: number;
  };
  path?: (string | number)[];
}

/**
 * A whole GraphQL response. `data` and `errors` can both be present at once, and a list
 * element can be null while its sibling is fine — that is normal GraphQL, not corruption.
 */
export interface FirefliesTranscriptsResponse {
  data: { transcripts: (FirefliesTranscript | null)[] } | null;
  errors?: FirefliesError[];
}

/** One page of the `transcripts` query. Fireflies paginates by offset, not by cursor. */
export interface TranscriptsQuery {
  fromDate: string;
  toDate: string;
  limit: number;
  skip: number;
}

/**
 * How a pass reaches Fireflies. Injected so the adapter can be exercised end to end
 * against the recorded fixtures without a network, a credential or a live account.
 */
export type FirefliesTransport = (
  query: TranscriptsQuery,
) => Promise<FirefliesTranscriptsResponse>;

/** What one response actually yielded, gaps included. */
export interface ResponseReading {
  /** The transcripts that arrived intact and usable. */
  transcripts: FirefliesTranscript[];
  /** Slots that arrived null or without an id. Any hole means the answer was partial. */
  holes: number;
  /** Errors that came alongside the data. Non-empty means the pass was not clean. */
  errors: FirefliesError[];
  /** How many slots the answer had at all, which is what says whether the page was full. */
  slots: number;
}

/**
 * Reads one response, keeping the partial-answer signals in plain sight.
 *
 * The holes and the errors travel next to the transcripts on purpose: a reader that
 * quietly filtered the nulls away would turn a broken pass into a pass with fewer
 * meetings, which is the failure the spike's D-1 warns against and the very thing the
 * spec forbids outright at the MCP edge.
 *
 * A transcript with no id counts as a hole rather than as data. Its id is the only half
 * of the idempotency key the source provides; without one, ingesting it would register it
 * again on every pass forever.
 */
export function readResponse(response: FirefliesTranscriptsResponse): ResponseReading {
  const slots = response.data?.transcripts ?? [];
  const transcripts = slots.filter(
    (slot): slot is FirefliesTranscript => slot !== null && (slot.id ?? '').trim() !== '',
  );
  return {
    transcripts,
    holes: slots.length - transcripts.length,
    errors: response.errors ?? [],
    slots: slots.length,
  };
}

/**
 * When the meeting happened, for the lineage. `dateString` is already the ISO 8601 the
 * lineage stores, `date` is the same instant in milliseconds, and both are optional —
 * a meeting with neither keeps a null date rather than an invented one.
 */
export function meetingDateOf(transcript: FirefliesTranscript): string | null {
  if (transcript.dateString !== null && transcript.dateString.trim() !== '') {
    return transcript.dateString;
  }
  if (transcript.date !== null) {
    // A number that is not an instant — out of range, NaN — makes `toISOString` throw, and
    // one unusable date must not take a whole pass down with it. No date is a date.
    const instant = new Date(transcript.date);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  }
  return null;
}

/**
 * The query: the already-structured action items, the lineage of the meeting they came
 * from, and nothing else. Above all no `sentences` — that is the raw transcript, and
 * consuming it is a No-Go of the spec.
 */
const TRANSCRIPTS_QUERY = `
  query Transcripts($fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int) {
    transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip) {
      id
      title
      dateString
      date
      summary { action_items }
    }
  }
`;

export interface HttpTransportOptions {
  apiKey: string;
  /** Overridable so a pass can be pointed at a stub while there is no real credential. */
  endpoint?: string;
}

/**
 * The real transport: one POST with a JSON body, which is all GraphQL is. No client
 * library — the spec's infrastructure budget does not stretch to one, and this is the
 * whole of what a GraphQL request needs.
 *
 * NEVER EXECUTED AGAINST THE REAL API. There are no Fireflies credentials, so this code
 * path has only ever been exercised against a local stub. Treat it as unverified.
 */
export function httpTransport(options: HttpTransportOptions): FirefliesTransport {
  const endpoint = options.endpoint ?? FIREFLIES_ENDPOINT;
  return async (variables) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: TRANSCRIPTS_QUERY, variables }),
    });
    // A non-200 has no GraphQL envelope to read, so it cannot be reported as data with
    // errors: it is a failure of the request itself and says so in its own terms.
    if (!response.ok) {
      throw new Error(
        `Fireflies answered ${response.status} ${response.statusText} to the transcripts query.`,
      );
    }
    return (await response.json()) as FirefliesTranscriptsResponse;
  };
}

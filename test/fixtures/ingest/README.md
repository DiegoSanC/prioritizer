# Ingest fixtures (Fireflies)

## Warning: these fixtures are SYNTHETIC

**None of these payloads is a real capture of the Fireflies API.** They were hand-built
against the schema published at `docs.fireflies.ai`, checked on 2026-08-12, during the
ingest spike. No data comes from real meetings.

The spike was done **without credentials**: there was no way to call the API. Each file
carries the warning in its own content (`_synthetic: true` and `_notice`), not only here,
precisely so that whoever opens one six months from now does not mistake a hypothesis for a
recording.

**What is faithful and what is not:**

- **Faithful**: the field names, their types, how they nest and what can be null. That
  comes from the published schema and can be cited.
- **Unverified**: the **internal format of the `action_items` string**. Fireflies does not
  publish a single example of its real value. The shape seen here (name in bold, items
  below, timestamp in parentheses) is a working hypothesis. That is why
  `05-hostile-formats.json` proposes several different shapes at once: the ingest
  adapter's parser must not marry any of them.

**They must be re-recorded** against real data as soon as there is an API key, and these
deleted. Until then, a test passing against these fixtures proves the adapter is robust,
**not** that it understands Fireflies.

## How they are used

`test/support/ingest-fixtures.ts` brings the types and the loader:

```ts
import { loadIngestFixture, readFixture } from '../support/ingest-fixtures.js';

const { transcripts, holes, errors } = readFixture(loadIngestFixture('01-typical-meeting.json'));
for (const transcript of transcripts) {
  // transcript.id, transcript.summary?.action_items, ...
}
```

`readFixture` returns the `holes` and the `errors` **next to** the transcripts on purpose:
a helper that silently filtered the nulls would turn a broken pass into a pass with fewer
meetings, which is exactly what the spike's unknown D-1 warns against.

Each file is a wrapper with two parts:

- the `_synthetic`, `_notice`, `_case`, `_query`, `_expected` and `_notes` fields, which are
  the mark and the documentation of the case;
- `response`, which is the only thing imitating the API: the GraphQL response as is, with
  its `data` and, where it applies, its `errors`.

`test/ingest/fixtures.test.ts` watches that they all stay marked synthetic and well formed.
If somebody adds a fixture without the notice, that test fails.

## What each one covers

| File | Case |
|---|---|
| `01-typical-meeting.json` | The happy case: several actions attributed to people of the organization. |
| `02-problematic-assignees.json` | No assignee, «Speaker 2», an email as a name, a partial name, a collective, an external person and the Fireflies bot as an attendee. |
| `03-useless-texts.json` | Empty string, «No action items were identified», «N/A», «TBD», a lone bullet, blank whitespace and a line that is not an action. |
| `04-missing-optional-fields.json` | Null `summary`, null `action_items`, no title, no attendees, and a meeting with no date through either path. |
| `05-hostile-formats.json` | CRLF, three bullet types, bold nested inside the text, an item split across two lines, items with no name heading, accents and curly quotes, a very long item and a surname with a particle. |
| `06-idempotency-first-run.json` | First pass, with the same meeting repeated **within the same response** (which is what triggers `skip` pagination). |
| `07-idempotency-second-run.json` | Second pass over an overlapping window: one identical meeting, one new, and one with the **regenerated summary** — same id, different content. |
| `08-partial-response-with-errors.json` | HTTP 200 with `data` and `errors` at once and one list element set to `null`. |
| `09-rate-limit-error.json` | `too_many_requests` (429), no data. |
| `10-empty-run.json` | Legitimate empty: there were no meetings. It is what must never be confused with `09-`, and the stop condition of the pagination loop. |

**Known hole**: there is no fixture with a full page of 50 transcripts, so the stop
condition of the `skip` loop can only be tested from the empty-page side.

## Before writing the adapter

Read `docs/spikes/2026-08-12-spike-de-ingesta.md`: it has the schema field by field, the
API unknowns ordered by impact (and which ones truly block) and what the ingest adapter was
going to find in the core. The choice of Fireflies over Granola is argued in
`docs/adr/0001-fireflies-como-fuente-unica-de-ingesta.md`.

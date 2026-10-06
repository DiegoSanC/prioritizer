/**
 * Turning one meeting's `action_items` string into items, and the single piece of this
 * adapter that is meant to be thrown away and rewritten.
 *
 * Fireflies types `Summary.action_items` as a plain String and publishes no example of its
 * value — not in the schema reference, not in the docs, not in the knowledge base. So the
 * shapes recognized below are a working hypothesis, not an observation, and the first real
 * payload will very likely contradict them. Everything else in the ingest — the lineage,
 * the idempotency key, the migration, the pass — is deliberately kept independent of this
 * file, so that recognizing the real format means editing here and nowhere else.
 *
 * The one rule that must survive any rewrite: a line that is not understood comes back as
 * residue. Losing it in silence would make the real format undiscoverable, because the
 * only evidence of what the string looks like is what the parser failed to read.
 */

export interface ExtractedItem {
  /** What has to be done, as the meeting worded it. */
  text: string;
  /** The name the meeting attributed it to, verbatim, or null when it attributed none. */
  attributedTo: string | null;
}

export interface Extraction {
  items: ExtractedItem[];
  /** Lines that were not understood, verbatim. Never empty in silence — see above. */
  unread: string[];
}

/**
 * A whole line that is nothing but one run of bold text: how the hypothesis says a name
 * heads its group.
 *
 * Anchored end to end, and the name itself may hold no asterisk. Both halves matter. An
 * item like "Validar el presupuesto con **Finanzas** antes de cerrar" contains bold in the
 * middle, and one like "**Finanzas** valida el presupuesto **antes del cierre**" opens and
 * closes with it: a laxer pattern reads either as a speaker heading and the sentence
 * around it disappears without a trace, which is the one outcome this parser may not have.
 */
const NAME_HEADING = /^\*\*([^*]+)\*\*$/;

/** The bullet shapes worth recognizing: -, *, •, –, —, "1.", "1)". */
const BULLET_MARK = String.raw`(?:[-*•–—]|\d+[.)])`;

/** A leading bullet with an item behind it. */
const BULLET = new RegExp(String.raw`^\s*${BULLET_MARK}\s+`);

/** A leading bullet with nothing behind it at all. */
const BARE_BULLET = new RegExp(String.raw`^\s*${BULLET_MARK}\s*$`);

/**
 * A trailing timestamp, e.g. "(06:20)" or "(1:02:33)". Fireflies stamps its summary notes
 * with marks into the transcript; the transcript is precisely what v1 does not store, so
 * the mark points nowhere and is dropped rather than carried into the inbox as noise.
 */
const TRAILING_TIMESTAMP = /\s*\(\d{1,2}:\d{2}(?::\d{2})?\)\s*$/;

/**
 * What the tool says when it found nothing. It is not documented what Fireflies actually
 * returns in that case — empty string, null, or a sentence — so all three are handled and
 * this is the sentence. Recognized as a whole: a meeting that says it has no actions has
 * none, and registering the sentence itself would put a sentence in the inbox.
 */
const NOTHING_FOUND = /^no action items\b/i;

export function extractActionItems(raw: string | null): Extraction {
  const items: ExtractedItem[] = [];
  const unread: string[] = [];

  const whole = (raw ?? '').trim();
  if (whole === '' || NOTHING_FOUND.test(whole)) {
    return { items, unread };
  }

  let attributedTo: string | null = null;
  /** The item an indented line would continue, or null when nothing is open. */
  let open: ExtractedItem | null = null;

  for (const line of whole.split(/\r\n|\r|\n/)) {
    if (line.trim() === '') continue;

    const heading = NAME_HEADING.exec(line.trim())?.[1]?.trim();
    if (heading) {
      attributedTo = heading;
      open = null;
      continue;
    }

    // An indented line right after an item is the tail of that item: the hypothesis wraps
    // long items over two lines, and reading the tail as its own action would register
    // half a sentence and lose the other half's meaning.
    if (open && /^\s+\S/.test(line) && !BULLET.test(line)) {
      open.text = strip(`${open.text} ${line.trim()}`);
      continue;
    }

    if (BARE_BULLET.test(line) || strip(line) === '') {
      unread.push(line.trim());
      open = null;
      continue;
    }

    open = { text: strip(line), attributedTo };
    items.push(open);
  }

  return { items, unread };
}

/** One line reduced to what has to be done: no bullet, no transcript mark, no padding. */
function strip(line: string): string {
  return line.replace(BULLET, '').replace(TRAILING_TIMESTAMP, '').trim();
}

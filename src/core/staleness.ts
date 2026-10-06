import type { CoreContext } from './context.js';

/**
 * The hierarchy has fallen behind the decisions already taken: there is accepted work
 * that nobody has consolidated for longer than the threshold, so what the devs read is
 * no longer what the stakeholders agreed. Null is the answer when it has not, and it is
 * an answer: every surface carries the field so that "not stale" can never be read as
 * "nobody looked".
 */
export interface StalenessSignal {
  /**
   * The instant the hierarchy crossed the threshold — since when it is stale. It is not
   * the day the oldest action was accepted: that day the hierarchy was still fresh, and
   * saying otherwise would date the problem before it existed.
   */
  since: string;
  /** What it was measured against, so every surface says the same number out loud. */
  thresholdBusinessHours: number;
}

/**
 * The one place the rule is evaluated. `currentHierarchy` and `prioritiesFor` carry its
 * answer, so the published page, the product web and the agent cannot disagree about
 * whether the hierarchy is stale, nor about since when.
 */
export function stalenessSignal(ctx: CoreContext): StalenessSignal | null {
  const oldest = oldestAcceptance(ctx);
  if (oldest === null) return null;

  const since = businessInstantAfter(
    new Date(oldest),
    ctx.config.stalenessThresholdBusinessHours,
  );
  if (since.getTime() > ctx.clock.now().getTime()) return null;

  return {
    since: since.toISOString(),
    thresholdBusinessHours: ctx.config.stalenessThresholdBusinessHours,
  };
}

/**
 * When the accepted action that has been waiting longest was accepted. `aceptada` is
 * exactly "triaged in and not consolidated" — consolidating turns it into `priorizada` —
 * so the status is the whole filter. The most recent acceptance of each action is the one
 * that counts: one pulled back out of the order starts waiting again from that moment.
 */
function oldestAcceptance(ctx: CoreContext): string | null {
  const row = ctx.db
    .prepare(
      `select min(accepted_at) as earliest from (
         select max(t.at) as accepted_at
           from action_transitions t
           join actions a on a.id = t.action_id
          where a.status = 'accepted' and t.to_status = 'accepted'
          group by t.action_id)`,
    )
    .get() as { earliest: string | null };
  return row.earliest;
}

const HOUR_MS = 3_600_000;

/**
 * The instant `businessHours` business hours after `from`. A business day is the whole
 * 24 hours of Monday to Friday and the weekend counts as nothing: there is no holiday
 * calendar and no office schedule, because the spec asks for neither and a hierarchy
 * consolidated once or twice a week does not need one.
 *
 * The answer always lands inside business time, so a threshold that runs out on Friday
 * night is only crossed when the week starts again — and "stale since day X"
 * never names a day on which nobody could have consolidated.
 */
function businessInstantAfter(from: Date, businessHours: number): Date {
  let cursor = businessInstant(from);
  let remaining = businessHours * HOUR_MS;

  while (remaining > 0) {
    const dayEnd = startOfNextDay(cursor);
    const available = dayEnd.getTime() - cursor.getTime();
    if (available > remaining) {
      return new Date(cursor.getTime() + remaining);
    }
    remaining -= available;
    cursor = businessInstant(dayEnd);
  }
  return cursor;
}

/** The instant itself, or the start of the following Monday if it falls on the weekend. */
function businessInstant(instant: Date): Date {
  let cursor = instant;
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor = startOfNextDay(cursor);
  }
  return cursor;
}

function startOfNextDay(instant: Date): Date {
  const next = new Date(instant);
  // Hour 24 is midnight of the following day, which rolls the month and the year for us
  // and is exact on an instant that is already midnight — no arithmetic on the date parts.
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

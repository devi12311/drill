import { CronExpressionParser } from "cron-parser";

/**
 * Cron schedules for monitoring jobs. Always interpreted in UTC — same choice
 * as HolmesGPT's own ScheduledHealthCheck CRD, and it keeps stored `nextRunAt`
 * values unambiguous when the server's timezone changes.
 *
 * Five fields (minute hour day-of-month month day-of-week). Seconds are
 * deliberately not accepted: an assessment costs real money and takes tens of
 * seconds, so per-second scheduling is never the right answer.
 */

export const SCHEDULE_PRESETS = [
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Daily at 06:00 UTC", expression: "0 6 * * *" },
  { label: "Weekdays at 06:00 UTC", expression: "0 6 * * 1-5" },
  { label: "Weekly, Monday 06:00 UTC", expression: "0 6 * * 1" },
] as const;

/**
 * A run costs roughly what one Holmes investigation costs. Hourly on one job is
 * ~720 runs/month, so the UI warns rather than silently letting someone spend
 * hundreds of dollars a month per job.
 */
export const HIGH_FREQUENCY_RUNS_PER_DAY = 12;

export class InvalidScheduleError extends Error {}

/** Throws {@link InvalidScheduleError} with a user-facing message. */
export function parseSchedule(expression: string) {
  const trimmed = expression.trim();
  if (!trimmed) throw new InvalidScheduleError("The schedule is empty");
  if (trimmed.split(/\s+/).length !== 5)
    throw new InvalidScheduleError(
      "A schedule needs exactly 5 fields: minute hour day-of-month month day-of-week (UTC)",
    );
  try {
    return CronExpressionParser.parse(trimmed, { tz: "UTC" });
  } catch (err) {
    throw new InvalidScheduleError(
      `Not a valid cron expression: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The next fire time strictly after `from`, or null for a manual-only job. */
export function nextRunAfter(
  expression: string | null,
  from: Date = new Date(),
): Date | null {
  if (!expression) return null;
  const interval = CronExpressionParser.parse(expression.trim(), {
    currentDate: from,
    tz: "UTC",
  });
  return interval.next().toDate();
}

/** Approximate runs per day — drives the cost warning in the job form. */
export function estimateRunsPerDay(expression: string): number {
  const interval = CronExpressionParser.parse(expression.trim(), {
    currentDate: new Date(Date.UTC(2026, 0, 1)),
    tz: "UTC",
  });
  const horizonDays = 7;
  const until = Date.UTC(2026, 0, 1 + horizonDays);
  let count = 0;
  while (count < 24 * 60 * horizonDays) {
    const next = interval.next().toDate().getTime();
    if (next >= until) break;
    count++;
  }
  return Math.round(count / horizonDays);
}

/** Validate and normalise a schedule from a request body. */
export function normaliseSchedule(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string")
    throw new InvalidScheduleError("The schedule must be a string");
  parseSchedule(raw);
  return raw.trim();
}

import { completeJson, ModelFormatError } from "@/lib/search/model";
import {
  narrativeSchema,
  type ReportNarrative,
  type ReportPeriod,
  type ReportStats,
} from "./_content";

/**
 * The written part of a report.
 *
 * The statistics are already computed when this runs. The model is given them
 * as read-only context and asked for the reading of them, never for a figure,
 * because a figure a model produced cannot be checked against anything.
 *
 * That instruction is then enforced rather than trusted. Every run of digits in
 * the returned prose has to appear somewhere in the statistics it was given, or
 * the narrative is rejected and asked for again. A second failure leaves the
 * report with its real numbers and an honest note where the prose would be,
 * which is a better outcome than printing a sentence nobody can verify.
 */

const MAX_TOKENS = 2_400;

const SYSTEM = [
  "You write the narrative for a Voice-of-Customer report about customer feedback.",
  "Every figure in the report is computed from the database and printed beside your text.",
  "Your job is to say what the figures mean. It is not to state them.",
  "",
  "Rules:",
  "1. Write only about the data below. Never invent a theme, a customer, a quote, a cause or a trend.",
  "2. Never write a numeral, a count, a percentage, a date or a ranking position. Write 'most feedback arrived through support tickets', not a number of them.",
  "3. Where a section is marked unavailable, say plainly in one sentence that it has not been produced yet, and move on. Do not speculate about what it would have shown.",
  "4. Quote only from the verbatim quotes supplied, and quote them exactly.",
  "5. Recommended actions must follow from the data supplied. Give between one and five, each with a short title and a reason.",
  "6. Plain prose. No markdown, no headings, no bullet characters. Two to four sentences per section.",
  "",
  "Reply with one JSON object and nothing else:",
  '{"headline":"...","summary":"...","themes":"...","sentiment":"...","quotes":"...","actions":[{"title":"...","rationale":"..."}]}',
].join("\n");

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDay(day: string): string {
  return DATE.format(new Date(`${day}T00:00:00.000Z`));
}

/** The facts the model is allowed to work from, and nothing beyond them. */
function buildPrompt(period: ReportPeriod, stats: ReportStats): string {
  const lines: string[] = [];

  lines.push(
    `Reporting period: ${formatDay(period.from)} to ${formatDay(period.to)}, a span of ${period.days} days.`,
  );
  lines.push(
    `Compared against the previous ${period.days} days: ${formatDay(period.previousFrom)} to ${formatDay(period.previousTo)}.`,
  );
  lines.push("");

  lines.push("VOLUME");
  lines.push(
    `${stats.volume.total} items this period against ${stats.volume.previousTotal} in the comparison period.`,
  );
  if (stats.volume.byChannel.length === 0) {
    lines.push("No feedback arrived through any channel in either period.");
  } else {
    lines.push("By channel, this period then the comparison period:");
    for (const row of stats.volume.byChannel) {
      lines.push(`- ${row.channel}: ${row.current} then ${row.previous}`);
    }
  }
  lines.push("");

  lines.push("SENTIMENT");
  if (!stats.sentiment.available) {
    lines.push(
      `UNAVAILABLE. Classification has not run for this workspace, so none of the ${stats.volume.total} items carries a sentiment. There is no distribution and no shift to describe.`,
    );
  } else {
    lines.push(
      `${stats.sentiment.classified} of ${stats.volume.total} items are classified. Shares are of the classified items only.`,
    );
    for (const slice of stats.sentiment.slices) {
      const current =
        slice.currentShare === null ? "no share" : `${(slice.currentShare * 100).toFixed(1)}%`;
      const shift =
        slice.shift === null
          ? "no comparison"
          : `${slice.shift >= 0 ? "up" : "down"} ${Math.abs(slice.shift).toFixed(1)} percentage points`;
      lines.push(`- ${slice.key}: ${slice.current} items, ${current}, ${shift}`);
    }
  }
  lines.push("");

  lines.push("THEMES");
  if (!stats.themes.available) {
    lines.push(
      `UNAVAILABLE. The workspace has ${stats.themes.themeCount} themes defined, but no feedback has been tagged with one yet, so there are no top themes to report.`,
    );
  } else {
    lines.push(
      `${stats.themes.taggedItems} items carry at least one theme. Counts are this period then the comparison period.`,
    );
    for (const theme of stats.themes.items) {
      lines.push(`- ${theme.name}: ${theme.current} then ${theme.previous}`);
    }
  }
  lines.push("");

  lines.push("VERBATIM QUOTES, real feedback items from this period");
  if (stats.quotes.length === 0) {
    lines.push("None. There is no feedback in this period.");
  } else {
    stats.quotes.forEach((quote, index) => {
      const who = quote.customerLabel ? `, ${quote.customerLabel}` : "";
      lines.push(`${index + 1}. "${quote.content}" (${quote.channel}${who})`);
    });
  }

  return lines.join("\n");
}

/** A number the statistics actually contain, in the forms a writer might use. */
function collectNumbers(value: number | null | undefined, into: Set<string>): void {
  if (value === null || value === undefined || !Number.isFinite(value)) return;

  const magnitude = Math.abs(value);
  for (const candidate of [Math.floor(magnitude), Math.round(magnitude), Math.ceil(magnitude)]) {
    into.add(String(candidate));
    into.add(String(candidate).padStart(2, "0"));
  }
  // One decimal place, since shares are quoted that way in the prompt.
  into.add(magnitude.toFixed(1).split(".")[1]);
}

/**
 * Every digit run the narrative is permitted to contain.
 *
 * Built from the statistics, the period, and the quotes, because a quoted line
 * may legitimately carry a number the customer wrote.
 */
function allowedDigits(period: ReportPeriod, stats: ReportStats): Set<string> {
  const allowed = new Set<string>();

  for (const day of [period.from, period.to, period.previousFrom, period.previousTo]) {
    for (const part of day.split("-")) {
      allowed.add(part);
      allowed.add(String(Number.parseInt(part, 10)));
    }
  }
  collectNumbers(period.days, allowed);

  collectNumbers(stats.volume.total, allowed);
  collectNumbers(stats.volume.previousTotal, allowed);
  collectNumbers(stats.volume.changePct, allowed);
  for (const row of stats.volume.byChannel) {
    collectNumbers(row.current, allowed);
    collectNumbers(row.previous, allowed);
  }

  collectNumbers(stats.sentiment.classified, allowed);
  collectNumbers(stats.sentiment.unclassified, allowed);
  collectNumbers(stats.sentiment.previousClassified, allowed);
  for (const slice of stats.sentiment.slices) {
    collectNumbers(slice.current, allowed);
    collectNumbers(slice.previous, allowed);
    collectNumbers(slice.currentShare === null ? null : slice.currentShare * 100, allowed);
    collectNumbers(slice.previousShare === null ? null : slice.previousShare * 100, allowed);
    collectNumbers(slice.shift, allowed);
  }

  collectNumbers(stats.themes.taggedItems, allowed);
  collectNumbers(stats.themes.themeCount, allowed);
  for (const theme of stats.themes.items) {
    collectNumbers(theme.current, allowed);
    collectNumbers(theme.previous, allowed);
  }

  for (const quote of stats.quotes) {
    for (const run of quote.content.match(/\d+/g) ?? []) allowed.add(run);
  }

  return allowed;
}

/** The first digit run in the narrative that the statistics cannot account for. */
function findInventedNumber(
  narrative: ReportNarrative,
  allowed: Set<string>,
): string | null {
  const texts = [
    narrative.headline,
    narrative.summary,
    narrative.themes,
    narrative.sentiment,
    narrative.quotes,
    ...narrative.actions.flatMap((action) => [action.title, action.rationale]),
  ];

  for (const text of texts) {
    for (const run of text.match(/\d+/g) ?? []) {
      if (!allowed.has(run)) return run;
    }
  }
  return null;
}

export type NarrativeResult = {
  narrative: ReportNarrative | null;
  /** Null when a narrative was produced. Otherwise why there is none. */
  issue: string | null;
};

/**
 * Asks for the narrative, checks it, and asks once more if it fails the check.
 *
 * A failure here never fails the report. The statistics are the report; the
 * prose is commentary on it, and commentary that cannot be verified is left
 * out with a note saying so.
 */
export async function writeNarrative(
  period: ReportPeriod,
  stats: ReportStats,
): Promise<NarrativeResult> {
  const prompt = buildPrompt(period, stats);
  const allowed = allowedDigits(period, stats);

  let lastIssue = "The narrative could not be written.";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reminder =
      attempt === 0
        ? ""
        : "\n\nYour previous reply was rejected because it contained a number. Write the whole narrative without a single numeral, spelled-out counts included.";

    let narrative: ReportNarrative;
    try {
      narrative = await completeJson({
        system: SYSTEM,
        prompt: `${prompt}${reminder}`,
        schema: narrativeSchema,
        maxTokens: MAX_TOKENS,
        temperature: 0.2,
        repairHint:
          "Reply with the JSON object only, with the keys headline, summary, themes, sentiment, quotes and actions.",
      });
    } catch (error) {
      if (error instanceof ModelFormatError) {
        lastIssue =
          "The model did not return a narrative in the expected shape. The figures below are unaffected.";
        continue;
      }
      throw error;
    }

    const invented = findInventedNumber(narrative, allowed);
    if (!invented) return { narrative, issue: null };

    lastIssue = `The model wrote a figure the data does not contain, so its narrative was rejected. The figures below are computed from the database and are unaffected.`;
  }

  return { narrative: null, issue: lastIssue };
}

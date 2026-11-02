import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type WindowInput = {
  source_timezone: string;
  target_timezone: string;
  working_hours: string;
  target_working_hours?: string;
  date: string;
  min_overlap_minutes: number;
};

const localDateTimeFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

function localParts(date: Date, timeZone: string): LocalDateTime {
  const parts = localDateTimeFormatter(timeZone).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function timezoneOffset(timestamp: number, timeZone: string): number {
  const parts = localParts(new Date(timestamp), timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - Math.floor(timestamp / 1000) * 1000;
}

function parseDate(date: string): Pick<LocalDateTime, "year" | "month" | "day"> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("date must use YYYY-MM-DD format");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return { year, month, day };
}

function parseClock(value: string): Pick<LocalDateTime, "hour" | "minute"> {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}; expected HH:MM`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time: ${value}`);
  return { hour, minute };
}

function localToInstant(parts: LocalDateTime, timeZone: string): Date {
  const expected = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let timestamp = expected - timezoneOffset(expected, timeZone);
  timestamp = expected - timezoneOffset(timestamp, timeZone);
  const actual = localParts(new Date(timestamp), timeZone);
  if (
    actual.year !== parts.year ||
    actual.month !== parts.month ||
    actual.day !== parts.day ||
    actual.hour !== parts.hour ||
    actual.minute !== parts.minute ||
    actual.second !== parts.second
  ) {
    throw new Error(`Local time does not exist in ${timeZone} due to a clock change`);
  }
  return new Date(timestamp);
}

function intervalFor(
  date: string,
  hours: string,
  timeZone: string,
): { start: Date; end: Date } {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(hours);
  if (!match) throw new Error(`Invalid working_hours: ${hours}; expected HH:MM-HH:MM`);
  const calendarDate = parseDate(date);
  const startTime = parseClock(match[1]);
  const endTime = parseClock(match[2]);
  const start = localToInstant({ ...calendarDate, ...startTime, second: 0 }, timeZone);
  const end = localToInstant({ ...calendarDate, ...endTime, second: 0 }, timeZone);
  if (end <= start) throw new Error("Working hours must end after they start on the same day");
  return { start, end };
}

function formatLocal(date: Date, timeZone: string, hourFormat: "12" | "24" = "12"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(hourFormat === "12" ? { hour12: true } : { hourCycle: "h23" }),
  }).format(date);
}

function displayTimezoneLabel(timeZone: string): string {
  return timeZone === "Africa/Johannesburg" ? "CAT" : timeZone;
}

export function convertWindow(input: WindowInput) {
  const source = intervalFor(input.date, input.working_hours, input.source_timezone);
  const target = input.target_working_hours
    ? intervalFor(input.date, input.target_working_hours, input.target_timezone)
    : undefined;
  const start = target && target.start > source.start ? target.start : source.start;
  const end = target && target.end < source.end ? target.end : source.end;
  const durationMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
  const qualifies = durationMinutes >= input.min_overlap_minutes && durationMinutes > 0;
  const overlap = qualifies
    ? {
        start_utc: start.toISOString(),
        end_utc: end.toISOString(),
        duration_minutes: durationMinutes,
        source_local: `${formatLocal(start, input.source_timezone)} – ${formatLocal(end, input.source_timezone)}`,
        target_local: `${formatLocal(start, input.target_timezone)} – ${formatLocal(end, input.target_timezone)}`,
      }
    : null;

  return {
    date: input.date,
    source_timezone: input.source_timezone,
    target_timezone: input.target_timezone,
    source_working_hours: input.working_hours,
    target_working_hours: input.target_working_hours ?? null,
    min_overlap_minutes: input.min_overlap_minutes,
    overlap,
  };
}

export function formatPitchTimes(input: {
  slots: string[];
  source_timezone: string;
  target_timezone: string;
  duration_minutes: number;
  hour_format: "12" | "24";
}) {
  return input.slots.map((slot) => {
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(slot);
    if (!match) throw new Error(`Invalid slot: ${slot}; expected YYYY-MM-DD HH:MM`);
    const date = parseDate(match[1]);
    const time = parseClock(match[2]);
    const start = localToInstant({ ...date, ...time, second: 0 }, input.source_timezone);
    const end = new Date(start.getTime() + input.duration_minutes * 60_000);
    return {
      source_local: `${formatLocal(start, input.source_timezone, input.hour_format)} (${displayTimezoneLabel(input.source_timezone)})`,
      target_local: `${formatLocal(start, input.target_timezone, input.hour_format)} (${displayTimezoneLabel(input.target_timezone)})`,
      target_end_local: `${formatLocal(end, input.target_timezone, input.hour_format)} (${displayTimezoneLabel(input.target_timezone)})`,
      start_utc: start.toISOString(),
    };
  });
}

const server = new McpServer({ name: "tmzn-scheduler", version: "1.0.0" });

server.registerTool(
  "convert_window",
  {
    description:
      "Find the overlap between local working hours in two timezones for a specific date, accounting for daylight saving time.",
    inputSchema: {
      source_timezone: z.string().describe("IANA sender timezone, such as Africa/Johannesburg"),
      target_timezone: z.string().describe("IANA client timezone, such as America/Chicago"),
      working_hours: z.string().describe("Sender hours in 24-hour HH:MM-HH:MM format"),
      target_working_hours: z
        .string()
        .optional()
        .describe("Optional client hours in 24-hour HH:MM-HH:MM format"),
      date: z.string().optional().describe("Local calendar date in YYYY-MM-DD format"),
      min_overlap_minutes: z.number().int().nonnegative().optional(),
    },
  },
  async ({ source_timezone, target_timezone, working_hours, target_working_hours, date, min_overlap_minutes }) => {
    try {
      const result = convertWindow({
        source_timezone,
        target_timezone,
        working_hours,
        target_working_hours,
        date: date ?? new Date().toISOString().slice(0, 10),
        min_overlap_minutes: min_overlap_minutes ?? 0,
      });
      const text = result.overlap
        ? `Overlap: ${result.overlap.duration_minutes} minutes\n${displayTimezoneLabel(source_timezone)}: ${result.overlap.source_local}\n${displayTimezoneLabel(target_timezone)}: ${result.overlap.target_local}\n\nJSON:\n${JSON.stringify(result, null, 2)}`
        : `No overlap of at least ${result.min_overlap_minutes} minutes was found.\n\nJSON:\n${JSON.stringify(result, null, 2)}`;
      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "format_pitch_times",
  {
    description:
      "Format proposed YYYY-MM-DD HH:MM slots as client-ready local meeting times alongside the sender's local time.",
    inputSchema: {
      slots: z.array(z.string()).describe("Proposed local slots, such as 2026-01-15 16:00"),
      target_timezone: z.string().describe("IANA client timezone, such as America/New_York"),
      source_timezone: z
        .string()
        .optional()
        .describe("IANA sender timezone; defaults to Africa/Johannesburg"),
      duration_minutes: z.number().int().positive().optional(),
      hour_format: z.enum(["12", "24"]).optional(),
    },
  },
  async ({ slots, target_timezone, source_timezone, duration_minutes, hour_format }) => {
    try {
      const formatted = formatPitchTimes({
        slots,
        target_timezone,
        source_timezone: source_timezone ?? "Africa/Johannesburg",
        duration_minutes: duration_minutes ?? 30,
        hour_format: hour_format ?? "12",
      });
      const lines = formatted.map(
        ({ source_local, target_local, target_end_local }) =>
          `- ${target_local} to ${target_end_local} (your time: ${source_local})`,
      );
      return {
        content: [
          {
            type: "text",
            text: `${lines.join("\n")}\n\nJSON:\n${JSON.stringify(formatted, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("TMZN Scheduler MCP server running on stdio");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
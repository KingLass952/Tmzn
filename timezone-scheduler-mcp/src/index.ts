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
  date?: string;
  min_overlap_minutes?: number;
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

export function dateInTimezone(now: Date, timeZone: string): string {
  const { year, month, day } = localParts(now, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDate(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
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
  const startMinutes = startTime.hour * 60 + startTime.minute;
  const endMinutes = endTime.hour * 60 + endTime.minute;
  const endDate = endMinutes <= startMinutes ? shiftDate(date, 1) : date;
  const end = localToInstant({ ...parseDate(endDate), ...endTime, second: 0 }, timeZone);
  return { start, end };
}

function formatLocal(date: Date, timeZone: string, hourFormat: "12" | "24" = "12"): string {
  const johannesburg = timeZone === "Africa/Johannesburg";
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(johannesburg ? {} : { timeZoneName: "short" as const }),
    ...(hourFormat === "12" ? { hour12: true } : { hourCycle: "h23" }),
  }).format(date);
  return johannesburg ? `${formatted} CAT` : formatted;
}

export function convertWindow(input: WindowInput) {
  const date = input.date ?? dateInTimezone(new Date(), input.source_timezone);
  const minOverlapMinutes = input.min_overlap_minutes ?? 0;
  const source = intervalFor(date, input.working_hours, input.source_timezone);
  const targetWorkingHours = input.target_working_hours ?? input.working_hours;
  const overlaps: Array<{
    target_date: string;
    start_utc: string;
    end_utc: string;
    duration_minutes: number;
    source_local: string;
    target_local: string;
  }> = [];

  for (let dayOffset = -2; dayOffset <= 2; dayOffset += 1) {
    const targetDate = shiftDate(date, dayOffset);
    let target: { start: Date; end: Date };
    try {
      target = intervalFor(targetDate, targetWorkingHours, input.target_timezone);
    } catch (error) {
      const isClockGap = error instanceof Error && error.message.startsWith("Local time does not exist");
      if (dayOffset !== 0 && isClockGap) continue;
      throw error;
    }

    const start = target.start > source.start ? target.start : source.start;
    const end = target.end < source.end ? target.end : source.end;
    const durationMinutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
    if (durationMinutes <= 0 || durationMinutes < minOverlapMinutes) continue;

    overlaps.push({
      target_date: targetDate,
      start_utc: start.toISOString(),
      end_utc: end.toISOString(),
      duration_minutes: durationMinutes,
      source_local: `${formatLocal(start, input.source_timezone)} – ${formatLocal(end, input.source_timezone)}`,
      target_local: `${formatLocal(start, input.target_timezone)} – ${formatLocal(end, input.target_timezone)}`,
    });
  }

  overlaps.sort((left, right) => left.start_utc.localeCompare(right.start_utc));
  const overlap = overlaps.reduce<(typeof overlaps)[number] | null>(
    (longest, candidate) =>
      longest === null || candidate.duration_minutes > longest.duration_minutes ? candidate : longest,
    null,
  );

  return {
    date,
    source_timezone: input.source_timezone,
    target_timezone: input.target_timezone,
    source_working_hours: input.working_hours,
    target_working_hours: targetWorkingHours,
    min_overlap_minutes: minOverlapMinutes,
    overlap,
    overlaps,
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
      source_local: formatLocal(start, input.source_timezone, input.hour_format),
      target_local: formatLocal(start, input.target_timezone, input.hour_format),
      target_end_local: formatLocal(end, input.target_timezone, input.hour_format),
      start_utc: start.toISOString(),
    };
  });
}

const server = new McpServer({ name: "tmzn-scheduler", version: "1.0.0" });

server.registerTool(
  "convert_window",
  {
    description:
      "Find every overlap between local working hours in two timezones, including overnight hours and neighboring calendar dates, accounting for daylight saving time. The overlap field contains the longest result.",
    inputSchema: {
      source_timezone: z.string().describe("IANA sender timezone, such as Africa/Johannesburg"),
      target_timezone: z.string().describe("IANA client timezone, such as America/Chicago"),
      working_hours: z.string().describe("Sender hours in 24-hour HH:MM-HH:MM format"),
      target_working_hours: z
        .string()
        .optional()
        .describe("Client hours in HH:MM-HH:MM format; defaults to working_hours"),
      date: z.string().optional().describe("Sender-local date in YYYY-MM-DD format; defaults to today there"),
      min_overlap_minutes: z.number().int().nonnegative().optional().describe("Minimum duration for each overlap; defaults to 0"),
    },
  },
  async ({ source_timezone, target_timezone, working_hours, target_working_hours, date, min_overlap_minutes }) => {
    try {
      const result = convertWindow({
        source_timezone,
        target_timezone,
        working_hours,
        target_working_hours,
        date,
        min_overlap_minutes,
      });
      const text = result.overlaps.length > 0
        ? `${result.overlaps.map((item) => `Overlap: ${item.duration_minutes} minutes\nSender: ${item.source_local}\nClient: ${item.target_local}`).join("\n\n")}\n\nJSON:\n${JSON.stringify(result, null, 2)}`
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
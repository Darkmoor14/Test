// Supabase Edge Function: calendar-feed
// ---------------------------------------------------------------
// One-way (app -> Apple Calendar) sync: a standard RFC5545 .ics feed
// that Apple Calendar (iPhone/iPad/Mac) can "subscribe" to, so events
// created on Acasă show up there too. Read-only from Apple's side --
// editing an event in Apple Calendar never writes back here. Apple
// re-polls a subscribed calendar on its own schedule (not instant).
//
// DEPLOYED WITH verify_jwt = false: Apple Calendar sends no session or
// anon-key headers at all when polling a subscribed URL, so the
// platform-level JWT gate has to be off. The per-staff `token` query
// param is the only authentication, matching get_or_create_calendar_
// feed_token()/regenerate_calendar_feed_token() in
// 20261025103110_calendar_feed_tokens.sql -- a leaked link only
// exposes one person's events and can be invalidated by regenerating.
//
// Visibility mirrors exactly what each person already sees on Acasă:
// an event with no attendees is public (everyone's feed gets it), an
// event with attendees only appears in the feeds of those listed --
// same rule the "De făcut" widget already uses.
//
// DEPLOY: via the Supabase MCP deploy_edge_function tool (project has
// no supabase/config.toml -- functions here are deployed that way,
// not via `supabase functions deploy`).
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CalendarEventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  reminder_minutes_before: number | null;
  recurrence_freq: "daily" | "weekly" | "monthly" | "yearly" | null;
  recurrence_interval: number | null;
  recurrence_days_of_week: number[] | null;
  recurrence_end_type: "date" | "count" | "never" | null;
  recurrence_end_date: string | null;
  recurrence_count: number | null;
  attendees: string[] | null;
  travel_time_minutes: number | null;
  url: string | null;
  updated_at?: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function formatUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

// All-day events are stored as a UTC instant like any other timestamp,
// but their calendar "date" has to be read back in the timezone they
// were entered in (Europe/Bucharest) -- naively taking the UTC date
// from a Bucharest midnight instant lands on the wrong day, since
// Bucharest is ahead of UTC.
function bucharestDateDigits(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

function addDaysToDateDigits(digits: string, days: number): string {
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}`;
}

// RFC5545 TEXT escaping -- backslash, semicolon, comma, then newlines.
function icalEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// RFC5545 requires CRLF line endings and folds any content line over
// 75 octets onto a continuation line starting with a single space.
// Apple Calendar is lenient about this in practice, but a feed other
// calendar apps might also subscribe to should be spec-correct.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

const DAY_CODES: Record<number, string> = { 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA", 7: "SU" };
const FREQ_CODES: Record<string, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };

function buildRRule(e: CalendarEventRow): string | null {
  if (!e.recurrence_freq) return null;
  const parts = [`FREQ=${FREQ_CODES[e.recurrence_freq]}`];
  if (e.recurrence_interval && e.recurrence_interval > 1) parts.push(`INTERVAL=${e.recurrence_interval}`);
  if (e.recurrence_freq === "weekly" && e.recurrence_days_of_week?.length) {
    parts.push(`BYDAY=${e.recurrence_days_of_week.map((d) => DAY_CODES[d]).filter(Boolean).join(",")}`);
  }
  if (e.recurrence_end_type === "date" && e.recurrence_end_date) {
    const until = new Date(`${e.recurrence_end_date}T23:59:59Z`);
    parts.push(`UNTIL=${formatUtc(until)}`);
  } else if (e.recurrence_end_type === "count" && e.recurrence_count) {
    parts.push(`COUNT=${e.recurrence_count}`);
  }
  return parts.join(";");
}

function buildVEvent(e: CalendarEventRow): string {
  const lines: string[] = [];
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${e.id}@insta-grup.ro`);
  lines.push(`DTSTAMP:${formatUtc(new Date())}`);

  if (e.all_day) {
    const startDigits = bucharestDateDigits(e.start_time);
    const endDigits = bucharestDateDigits(e.end_time || e.start_time);
    lines.push(`DTSTART;VALUE=DATE:${startDigits}`);
    // iCalendar all-day DTEND is exclusive (one day past the last day
    // actually shown) -- our end_time is the last inclusive day.
    lines.push(`DTEND;VALUE=DATE:${addDaysToDateDigits(endDigits, 1)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(new Date(e.start_time))}`);
    lines.push(`DTEND:${formatUtc(new Date(e.end_time || e.start_time))}`);
  }

  lines.push(foldLine(`SUMMARY:${icalEscape(e.title)}`));
  if (e.location) lines.push(foldLine(`LOCATION:${icalEscape(e.location)}`));
  if (e.url) lines.push(foldLine(`URL:${e.url.replace(/\r?\n/g, "")}`));

  // Real ATTENDEE properties expect a mailto: cal-address and carry
  // RSVP/invite semantics some clients act on -- not a fit for a
  // published feed where "attendee" can just as easily be a free-text
  // name (an outside client, a firm) with no email at all. Folded into
  // the description as plain text instead.
  const descParts: string[] = [];
  if (e.description) descParts.push(e.description);
  if (Array.isArray(e.attendees) && e.attendees.length) descParts.push(`Invitați: ${e.attendees.join(", ")}`);
  if (descParts.length) lines.push(foldLine(`DESCRIPTION:${icalEscape(descParts.join("\n"))}`));

  const rrule = buildRRule(e);
  if (rrule) lines.push(`RRULE:${rrule}`);

  if (e.reminder_minutes_before) {
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(foldLine(`DESCRIPTION:${icalEscape(e.title)}`));
    lines.push(`TRIGGER:-PT${e.reminder_minutes_before}M`);
    lines.push("END:VALARM");
  }
  if (e.travel_time_minutes) {
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push("DESCRIPTION:Timp de deplasare");
    lines.push(`TRIGGER:-PT${e.travel_time_minutes + (e.reminder_minutes_before || 0)}M`);
    lines.push("END:VALARM");
  }

  lines.push("STATUS:CONFIRMED");
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: tokenRow, error: tokenError } = await admin
    .from("calendar_feed_tokens")
    .select("email")
    .eq("token", token)
    .maybeSingle();
  if (tokenError || !tokenRow) {
    return new Response("Invalid or expired calendar link", { status: 404 });
  }
  const email = tokenRow.email as string;

  const { data: events, error: eventsError } = await admin
    .from("calendar_events")
    .select("*")
    .order("start_time", { ascending: true });
  if (eventsError) {
    console.error(eventsError);
    return new Response("Failed to load events", { status: 500 });
  }

  const visible = ((events || []) as CalendarEventRow[]).filter(
    (e) => !e.attendees || e.attendees.length === 0 || e.attendees.includes(email),
  );

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Insta Grup//Calendar Acasa//RO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Insta Grup \u2014 Acasa",
    "X-WR-TIMEZONE:Europe/Bucharest",
    ...visible.map(buildVEvent),
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=insta-grup-acasa.ics",
      "Cache-Control": "public, max-age=900",
    },
  });
});

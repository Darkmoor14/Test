// Supabase Edge Function: calendar-dav
// ---------------------------------------------------------------
// A real (if deliberately minimal) CalDAV server backing Acasă's
// calendar_events table — the two-way counterpart to calendar-feed
// (which is read-only: Apple Calendar can subscribe to it, but never
// write back). This one lets a phone's own Calendar app (iOS natively,
// Android via a third-party CalDAV client like DAVx⁵ — Android has no
// built-in CalDAV support) both READ and WRITE events, syncing in both
// directions with the PC admin panel.
//
// Protocol surface implemented (RFC 4791 calendaring extensions to
// RFC 4918 WebDAV), deliberately the smallest set real clients (iOS
// Calendar, DAVx⁵) actually exercise during discovery + sync, not the
// full spec:
//   OPTIONS   — capability advertisement
//   PROPFIND  — discovery chain: root -> principal -> calendar home ->
//               calendar collection (Depth 0) -> child event hrefs
//               (Depth 1)
//   REPORT    — calendar-multiget, calendar-query (treated as "all
//               visible events", no real time-range filtering), and
//               sync-collection (incremental sync via an opaque
//               timestamp token)
//   GET       — one event as a VCALENDAR/VEVENT, with an ETag
//   PUT       — create or update one event from a client-sent VEVENT
//   DELETE    — remove one event (logged to calendar_events_tombstones
//               so sync-collection can report it as gone)
//
// NOT implemented, deliberately, since the schema has no way to
// represent them: per-occurrence overrides of a recurring event (a
// VEVENT carrying RECURRENCE-ID is rejected with 403), real iTIP
// scheduling/RSVP for attendees (attendees stay plain text, same as
// the rest of this app), and true RFC-correct calendar-query time-range
// filtering (every REPORT just returns everything the user can see —
// fine at this app's scale, a real limitation at a much larger one).
//
// AUTH: HTTP Basic, reusing the exact same per-person token
// calendar-feed already uses (20261025103110_calendar_feed_tokens.sql)
// — username is the person's email, password is their feed token (same
// one shown in the "Sincronizează cu telefonul" sheet). No real
// Supabase account password is ever sent to a calendar client.
//
// Needs calendar_events.updated_at (20261027120000_calendar_events_
// updated_at.sql) for ETags/sync tokens, and calendar_events_
// tombstones (same migration) so deletions can be reported to
// sync-collection instead of silently vanishing with no trace.
//
// DEPLOYED WITH verify_jwt = false: CalDAV clients send HTTP Basic
// auth, never a Supabase session or anon-key header, so the platform-
// level JWT gate has to be off, same posture as calendar-feed.
//
// DEPLOY: via the Supabase MCP deploy_edge_function tool (project has
// no supabase/config.toml -- functions here are deployed that way, not
// via `supabase functions deploy`).
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// The function is reachable at .../functions/v1/calendar-dav/<rest> --
// everything below routes on <rest> (always starting with "/"),
// stripping whichever of these two prefixes the request actually used
// (direct function invocation includes "/functions/v1/calendar-dav";
// some proxies/local testing hit the function root directly).
const KNOWN_PREFIXES = ["/functions/v1/calendar-dav", "/calendar-dav"];
function davPath(pathname: string): string {
  for (const p of KNOWN_PREFIXES) {
    if (pathname === p) return "/";
    if (pathname.startsWith(p + "/")) return pathname.slice(p.length);
  }
  return pathname;
}

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
  created_by: string | null;
  updated_at: string;
}

// ================================================================
// Small shared helpers (dates, iCalendar text rules) -- the generation
// half mirrors supabase/functions/calendar-feed exactly, since both
// produce the same VEVENT shape; kept separate rather than imported
// since edge functions each deploy standalone.
// ================================================================
const pad2 = (n: number) => String(n).padStart(2, "0");

function formatUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

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

// Inverse of bucharestDateDigits -- a wall-clock time in Europe/Bucharest
// (what a client sends for a floating or TZID=Europe/Bucharest
// DTSTART/DTEND) to the UTC instant this app stores. Converges in one
// or two passes: guess UTC == the wall time, read back what that
// instant actually shows as in Bucharest, correct by the difference
// (handles the EET/EEST DST offset without a timezone database).
function bucharestWallTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Bucharest", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(guess);
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const hour = get("hour") === 24 ? 0 : get("hour");
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
    const diff = wanted - shown;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function icalEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icalUnescape(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

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
const DAY_CODES_REV: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const FREQ_CODES: Record<string, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };
const FREQ_CODES_REV: Record<string, string> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };

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

function etagFor(e: Pick<CalendarEventRow, "id" | "updated_at">): string {
  return `"${e.id}-${new Date(e.updated_at).getTime()}"`;
}

function buildVEvent(e: CalendarEventRow): string {
  const lines: string[] = [];
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${e.id}@insta-grup.ro`);
  lines.push(`DTSTAMP:${formatUtc(new Date())}`);
  lines.push(`LAST-MODIFIED:${formatUtc(new Date(e.updated_at))}`);

  if (e.all_day) {
    const startDigits = bucharestDateDigits(e.start_time);
    const endDigits = bucharestDateDigits(e.end_time || e.start_time);
    lines.push(`DTSTART;VALUE=DATE:${startDigits}`);
    lines.push(`DTEND;VALUE=DATE:${addDaysToDateDigits(endDigits, 1)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(new Date(e.start_time))}`);
    lines.push(`DTEND:${formatUtc(new Date(e.end_time || e.start_time))}`);
  }

  lines.push(foldLine(`SUMMARY:${icalEscape(e.title)}`));
  if (e.location) lines.push(foldLine(`LOCATION:${icalEscape(e.location)}`));
  if (e.url) lines.push(foldLine(`URL:${e.url.replace(/\r?\n/g, "")}`));

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

  lines.push("STATUS:CONFIRMED");
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

function buildVCalendar(vevents: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Insta Grup//Calendar Acasa CalDAV//RO",
    "CALSCALE:GREGORIAN",
    ...vevents,
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}

// ================================================================
// iCalendar PARSING -- the half calendar-feed never needed, since it
// only ever produced .ics text, never consumed it. Deliberately
// tolerant rather than spec-complete: unknown properties are ignored,
// not rejected.
// ================================================================
function unfoldIcs(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const raw of rawLines) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += raw.slice(1);
    } else if (raw.length) {
      lines.push(raw);
    }
  }
  return lines;
}

interface ParsedProp { name: string; params: Record<string, string>; value: string; }
function parseLine(line: string): ParsedProp | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

// A DTSTART/DTEND/etc value -> { iso, allDay }. Three shapes: UTC
// ("...Z"), a bare local date (VALUE=DATE, all-day), or a floating/
// TZID wall time (assumed Europe/Bucharest, same as every date this
// app has ever stored -- it has no multi-timezone concept anywhere).
function parseDateTimeValue(prop: ParsedProp): { iso: string; allDay: boolean } {
  const v = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4)), mo = Number(v.slice(4, 6)), d = Number(v.slice(6, 8));
    // Stored as a Bucharest-midnight instant, matching how the rest of
    // this app writes an all-day event's own start/end.
    const utc = bucharestWallTimeToUtc(y, mo, d, 0, 0, 0);
    return { iso: utc.toISOString(), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) throw new Error(`Unrecognized date-time value: ${v}`);
  const [, ys, mos, ds, hs, mis, ss, z] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds), h = Number(hs), mi = Number(mis), s = Number(ss);
  const utc = z ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : bucharestWallTimeToUtc(y, mo, d, h, mi, s);
  return { iso: utc.toISOString(), allDay: false };
}

function parseTriggerMinutes(trigger: string): number | null {
  // Only the "before the event, duration-only" shape this app itself
  // ever writes (-PT15M, -P1D) -- an absolute TRIGGER;VALUE=DATE-TIME
  // or a positive (after-the-event) offset isn't something
  // reminder_minutes_before can represent, so it's left unset rather
  // than guessed at.
  const m = trigger.match(/^-P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const days = Number(m[1] || 0), hours = Number(m[2] || 0), mins = Number(m[3] || 0), secs = Number(m[4] || 0);
  const total = days * 1440 + hours * 60 + mins + Math.round(secs / 60);
  return total > 0 ? total : null;
}

function parseRRule(raw: string): Pick<CalendarEventRow, "recurrence_freq" | "recurrence_interval" | "recurrence_days_of_week" | "recurrence_end_type" | "recurrence_end_date" | "recurrence_count"> {
  const parts: Record<string, string> = {};
  for (const kv of raw.split(";")) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const freq = FREQ_CODES_REV[parts.FREQ] as CalendarEventRow["recurrence_freq"] | undefined;
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : null;
  const days = parts.BYDAY ? parts.BYDAY.split(",").map((c) => DAY_CODES_REV[c]).filter((n): n is number => !!n) : null;
  let endType: CalendarEventRow["recurrence_end_type"] = "never";
  let endDate: string | null = null;
  let count: number | null = null;
  if (parts.UNTIL) {
    endType = "date";
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) endDate = `${m[1]}-${m[2]}-${m[3]}`;
  } else if (parts.COUNT) {
    endType = "count";
    count = Number(parts.COUNT);
  }
  return {
    recurrence_freq: freq ?? null,
    recurrence_interval: interval,
    recurrence_days_of_week: days?.length ? days : null,
    recurrence_end_type: freq ? endType : null,
    recurrence_end_date: endDate,
    recurrence_count: count,
  };
}

interface ParsedVEvent {
  uid: string | null;
  recurrenceId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  startIso: string;
  endIso: string | null;
  allDay: boolean;
  reminderMinutes: number | null;
  recurrence: ReturnType<typeof parseRRule> | null;
}

function parseVEvent(icsText: string): ParsedVEvent {
  const lines = unfoldIcs(icsText);
  let inEvent = false;
  let inAlarm = false;
  let uid: string | null = null;
  let recurrenceId: string | null = null;
  let title = "";
  let description: string | null = null;
  let location: string | null = null;
  let url: string | null = null;
  let startIso: string | null = null;
  let endIso: string | null = null;
  let allDay = false;
  let reminderMinutes: number | null = null;
  let currentAlarmTrigger: string | null = null;
  let rrule: string | null = null;

  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN" && prop.value === "VEVENT") { inEvent = true; continue; }
    if (prop.name === "END" && prop.value === "VEVENT") { inEvent = false; continue; }
    if (!inEvent) continue;
    if (prop.name === "BEGIN" && prop.value === "VALARM") { inAlarm = true; currentAlarmTrigger = null; continue; }
    if (prop.name === "END" && prop.value === "VALARM") {
      inAlarm = false;
      if (reminderMinutes == null && currentAlarmTrigger) reminderMinutes = parseTriggerMinutes(currentAlarmTrigger);
      continue;
    }
    if (inAlarm) {
      if (prop.name === "TRIGGER" && !prop.params.VALUE) currentAlarmTrigger = prop.value.trim();
      continue;
    }
    switch (prop.name) {
      case "UID": uid = prop.value.trim(); break;
      case "RECURRENCE-ID": recurrenceId = prop.value.trim(); break;
      case "SUMMARY": title = icalUnescape(prop.value); break;
      case "DESCRIPTION": description = icalUnescape(prop.value) || null; break;
      case "LOCATION": location = icalUnescape(prop.value) || null; break;
      case "URL": url = prop.value.trim() || null; break;
      case "DTSTART": { const r = parseDateTimeValue(prop); startIso = r.iso; allDay = r.allDay; break; }
      case "DTEND": { const r = parseDateTimeValue(prop); endIso = r.iso; break; }
      case "RRULE": rrule = prop.value.trim(); break;
    }
  }

  if (!startIso) throw new Error("VEVENT is missing DTSTART");
  if (allDay && endIso) {
    // Inverse of buildVEvent's own +1 day on DTEND (iCalendar all-day
    // DTEND is exclusive; this app's own end_time is the last
    // inclusive day) -- read back one day earlier.
    const d = new Date(endIso);
    endIso = new Date(d.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }

  return {
    uid, recurrenceId, title: title || "(Fără titlu)", description, location, url,
    startIso, endIso, allDay, reminderMinutes,
    recurrence: rrule ? parseRRule(rrule) : null,
  };
}

// ================================================================
// Auth -- HTTP Basic against calendar_feed_tokens (same token the
// "Sincronizează cu telefonul" sheet already shows for the one-way
// feed). No real Supabase password is ever sent to a calendar client.
// ================================================================
async function authenticate(req: Request): Promise<string | null> {
  const header = req.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return null;
  }
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;
  const email = decoded.slice(0, colonIdx);
  const token = decoded.slice(colonIdx + 1);
  if (!email || !token) return null;
  const { data, error } = await admin
    .from("calendar_feed_tokens")
    .select("email")
    .eq("email", email)
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  return email;
}

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Insta Grup Calendar"' },
  });
}

// ================================================================
// XML helpers for PROPFIND/REPORT multistatus responses. Hand-built
// rather than via a DOM/XML library -- Deno's edge runtime doesn't
// ship one, and the fixed set of properties real clients ask for here
// doesn't need one.
// ================================================================
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MULTISTATUS_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav">';
const MULTISTATUS_TAIL = "</d:multistatus>";

function multistatusResponse(xmlBody: string): Response {
  return new Response(xmlBody, {
    status: 207,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

// REPORT request bodies are parsed just enough to tell the three kinds
// apart and pull out the handful of values actually needed -- not a
// real XML parser, a few targeted regexes over the fixed shapes real
// clients send.
function reportKind(body: string): "multiget" | "query" | "sync-collection" {
  if (/sync-collection/i.test(body)) return "sync-collection";
  if (/calendar-multiget/i.test(body)) return "multiget";
  return "query";
}
function extractHrefs(body: string): string[] {
  const out: string[] = [];
  const re = /<[^:>]*:?href[^>]*>([^<]*)<\/[^:>]*:?href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(decodeURIComponent(m[1].trim()));
  return out;
}
function extractSyncToken(body: string): string | null {
  const m = body.match(/<[^:>]*:?sync-token[^>]*>([^<]*)<\/[^:>]*:?sync-token>/i);
  return m ? m[1].trim() : null;
}

// ================================================================
// Visibility -- identical rule to calendar-feed: a no-invitees event
// is private to its creator; one with invitees is shared with exactly
// those people plus the creator.
// ================================================================
async function visibleEventsFor(email: string): Promise<CalendarEventRow[]> {
  const { data, error } = await admin.from("calendar_events").select("*").order("start_time", { ascending: true });
  if (error) throw error;
  return ((data || []) as CalendarEventRow[]).filter(
    (e) => e.created_by === email || (Array.isArray(e.attendees) && e.attendees.includes(email)),
  );
}

function eventHref(email: string, id: string): string {
  return `/calendar-dav/calendars/${encodeURIComponent(email)}/events/${id}.ics`;
}

function eventResponseXml(email: string, e: CalendarEventRow, includeData: boolean): string {
  const href = xmlEscape(eventHref(email, e.id));
  const etag = xmlEscape(etagFor(e));
  const dataBlock = includeData
    ? `<c:calendar-data>${xmlEscape(buildVCalendar([buildVEvent(e)]))}</c:calendar-data>`
    : "";
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${etag}</d:getetag><d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>${dataBlock}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

// ================================================================
// Request handling
// ================================================================
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = davPath(url.pathname).replace(/\/+$/, "") || "/";
  const method = req.method;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        DAV: "1, 2, 3, calendar-access",
        Allow: "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, depth, if-match, if-none-match",
        "Access-Control-Allow-Methods": "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT",
      },
    });
  }

  const email = await authenticate(req);
  if (!email) return unauthorized();

  // --- root ---
  if (path === "/" && method === "PROPFIND") {
    const body = `${MULTISTATUS_HEAD}<d:response><d:href>/calendar-dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:current-user-principal><d:href>${xmlEscape(`/calendar-dav/principals/${encodeURIComponent(email)}/`)}</d:href></d:current-user-principal><d:principal-URL><d:href>${xmlEscape(`/calendar-dav/principals/${encodeURIComponent(email)}/`)}</d:href></d:principal-URL></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${MULTISTATUS_TAIL}`;
    return multistatusResponse(body);
  }

  // --- principal ---
  const principalMatch = path.match(/^\/principals\/([^/]+)$/);
  if (principalMatch && method === "PROPFIND") {
    const pEmail = decodeURIComponent(principalMatch[1]);
    if (pEmail !== email) return new Response("Forbidden", { status: 403 });
    const homeHref = `/calendar-dav/calendars/${encodeURIComponent(email)}/`;
    const body = `${MULTISTATUS_HEAD}<d:response><d:href>${xmlEscape(path + "/")}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><d:principal/></d:resourcetype><d:displayname>${xmlEscape(email)}</d:displayname><d:current-user-principal><d:href>${xmlEscape(path + "/")}</d:href></d:current-user-principal><c:calendar-home-set><d:href>${xmlEscape(homeHref)}</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${MULTISTATUS_TAIL}`;
    return multistatusResponse(body);
  }

  // --- calendar home (parent of the one calendar collection) ---
  const homeMatch = path.match(/^\/calendars\/([^/]+)$/);
  if (homeMatch && method === "PROPFIND") {
    const pEmail = decodeURIComponent(homeMatch[1]);
    if (pEmail !== email) return new Response("Forbidden", { status: 403 });
    const depth = req.headers.get("Depth") || "0";
    let body = `${MULTISTATUS_HEAD}<d:response><d:href>${xmlEscape(path + "/")}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    if (depth === "1") {
      const eventsHref = `${path}/events/`;
      body += `<d:response><d:href>${xmlEscape(eventsHref)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Insta Grup — Acasă</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    }
    body += MULTISTATUS_TAIL;
    return multistatusResponse(body);
  }

  // --- the calendar collection itself ---
  const collMatch = path.match(/^\/calendars\/([^/]+)\/events$/);
  if (collMatch) {
    const pEmail = decodeURIComponent(collMatch[1]);
    if (pEmail !== email) return new Response("Forbidden", { status: 403 });

    if (method === "PROPFIND") {
      const depth = req.headers.get("Depth") || "0";
      const events = await visibleEventsFor(email);
      const ctag = events.length ? String(Math.max(...events.map((e) => new Date(e.updated_at).getTime()))) : "0";
      let body = `${MULTISTATUS_HEAD}<d:response><d:href>${xmlEscape(path + "/")}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Insta Grup — Acasă</d:displayname><cs:getctag>${xmlEscape(ctag)}</cs:getctag><d:sync-token>${xmlEscape(ctag)}</d:sync-token><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      if (depth === "1") {
        body += events.map((e) => eventResponseXml(email, e, false)).join("");
      }
      body += MULTISTATUS_TAIL;
      return multistatusResponse(body);
    }

    if (method === "REPORT") {
      const reqBody = await req.text();
      const kind = reportKind(reqBody);
      const events = await visibleEventsFor(email);
      const byId = new Map(events.map((e) => [e.id, e]));

      if (kind === "multiget") {
        const hrefs = extractHrefs(reqBody);
        const ids = hrefs.map((h) => h.split("/").pop()?.replace(/\.ics$/, "")).filter(Boolean) as string[];
        const body = `${MULTISTATUS_HEAD}${ids.map((id) => byId.get(id)).filter((e): e is CalendarEventRow => !!e).map((e) => eventResponseXml(email, e, true)).join("")}${MULTISTATUS_TAIL}`;
        return multistatusResponse(body);
      }

      if (kind === "sync-collection") {
        const sinceToken = extractSyncToken(reqBody);
        const sinceMs = sinceToken ? Number(sinceToken) || 0 : 0;
        const changed = events.filter((e) => new Date(e.updated_at).getTime() > sinceMs);
        const { data: tombstones } = await admin
          .from("calendar_events_tombstones")
          .select("id, deleted_at")
          .gt("deleted_at", sinceMs ? new Date(sinceMs).toISOString() : "1970-01-01") as { data: { id: string; deleted_at: string }[] | null };
        const newCtag = String(Math.max(
          sinceMs,
          ...events.map((e) => new Date(e.updated_at).getTime()),
          ...(tombstones || []).map((t) => new Date(t.deleted_at).getTime()),
        ));
        let body = MULTISTATUS_HEAD;
        body += changed.map((e) => eventResponseXml(email, e, true)).join("");
        for (const t of tombstones || []) {
          if (byId.has(t.id)) continue; // still exists and visible -- not actually gone for this user
          body += `<d:response><d:href>${xmlEscape(eventHref(email, t.id))}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
        }
        body += `<d:sync-token>${xmlEscape(newCtag)}</d:sync-token>`;
        body += MULTISTATUS_TAIL;
        return multistatusResponse(body);
      }

      // calendar-query -- no real time-range filtering (see file header);
      // everything visible to this person, every time.
      const body = `${MULTISTATUS_HEAD}${events.map((e) => eventResponseXml(email, e, true)).join("")}${MULTISTATUS_TAIL}`;
      return multistatusResponse(body);
    }

    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "PROPFIND, REPORT" } });
  }

  // --- a single event resource ---
  const eventMatch = path.match(/^\/calendars\/([^/]+)\/events\/([^/]+)\.ics$/);
  if (eventMatch) {
    const pEmail = decodeURIComponent(eventMatch[1]);
    const id = eventMatch[2];
    if (pEmail !== email) return new Response("Forbidden", { status: 403 });

    if (method === "GET" || method === "HEAD") {
      const events = await visibleEventsFor(email);
      const e = events.find((ev) => ev.id === id);
      if (!e) return new Response("Not Found", { status: 404 });
      return new Response(method === "HEAD" ? null : buildVCalendar([buildVEvent(e)]), {
        headers: { "Content-Type": "text/calendar; charset=utf-8", ETag: etagFor(e) },
      });
    }

    if (method === "PUT") {
      const bodyText = await req.text();
      let parsed: ParsedVEvent;
      try {
        parsed = parseVEvent(bodyText);
      } catch (err) {
        return new Response(`Bad Request: ${String(err)}`, { status: 400 });
      }
      if (parsed.recurrenceId) {
        return new Response(
          "Editing a single occurrence of a recurring event isn't supported — edit the whole series, or remove its recurrence first.",
          { status: 403 },
        );
      }

      const { data: existingRow } = await admin.from("calendar_events").select("*").eq("id", id).maybeSingle();
      const existing = existingRow as CalendarEventRow | null;

      if (existing && existing.created_by !== email) {
        return new Response("Forbidden — you can only edit events you created.", { status: 403 });
      }
      const ifNoneMatch = req.headers.get("If-None-Match");
      if (ifNoneMatch === "*" && existing) {
        return new Response("Precondition Failed", { status: 412 });
      }
      const ifMatch = req.headers.get("If-Match");
      if (ifMatch && existing && ifMatch !== etagFor(existing)) {
        return new Response("Precondition Failed", { status: 412 });
      }

      const rec = parsed.recurrence;
      const payload = {
        title: parsed.title,
        description: parsed.description,
        location: parsed.location,
        url: parsed.url,
        start_time: parsed.startIso,
        end_time: parsed.endIso,
        all_day: parsed.allDay,
        reminder_minutes_before: parsed.reminderMinutes,
        recurrence_freq: rec?.recurrence_freq ?? null,
        recurrence_interval: rec?.recurrence_interval ?? null,
        recurrence_days_of_week: rec?.recurrence_days_of_week ?? null,
        recurrence_end_type: rec?.recurrence_end_type ?? null,
        recurrence_end_date: rec?.recurrence_end_date ?? null,
        recurrence_count: rec?.recurrence_count ?? null,
      };

      if (existing) {
        const { data: updated, error } = await admin.from("calendar_events").update(payload).eq("id", id).select("*").single();
        if (error) return new Response(`Server error: ${error.message}`, { status: 500 });
        return new Response(null, { status: 204, headers: { ETag: etagFor(updated as CalendarEventRow) } });
      } else {
        const { data: inserted, error } = await admin
          .from("calendar_events")
          .insert({ id, ...payload, created_by: email })
          .select("*")
          .single();
        if (error) return new Response(`Server error: ${error.message}`, { status: 500 });
        return new Response(null, { status: 201, headers: { ETag: etagFor(inserted as CalendarEventRow) } });
      }
    }

    if (method === "DELETE") {
      const { data: existingRow } = await admin.from("calendar_events").select("id, created_by").eq("id", id).maybeSingle();
      if (!existingRow) return new Response("Not Found", { status: 404 });
      if ((existingRow as { created_by: string | null }).created_by !== email) {
        return new Response("Forbidden — you can only delete events you created.", { status: 403 });
      }
      const { error } = await admin.from("calendar_events").delete().eq("id", id);
      if (error) return new Response(`Server error: ${error.message}`, { status: 500 });
      return new Response(null, { status: 204 });
    }

    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, PUT, DELETE" } });
  }

  return new Response("Not Found", { status: 404 });
});

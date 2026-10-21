// Supabase Edge Function: posthog-stats
// ---------------------------------------------------------------
// Returns aggregated public-website analytics (pageviews, unique
// visitors, top pages, ticket/contact funnel events) for Stare
// sistem's "Statistici site" tab -- fetched server-side from
// PostHog's Query API using a Personal API Key
// (POSTHOG_PERSONAL_API_KEY). That key can read ALL analytics data
// in the PostHog project, so it must never reach the browser --
// this function is the only place it's ever used.
//
// WHO CAN CALL THIS: any authenticated staff member, same
// staff-authenticated pattern as bright-processor's "report_needed"
// path -- admin-3.html's own session token, sent automatically by
// the Supabase JS client as the Authorization header. A bare anon
// key with no real session behind it is rejected.
//
// DEPLOY:
//   supabase functions deploy posthog-stats
//
// REQUIRED SECRETS (Project Settings -> Edge Functions -> Secrets):
//   POSTHOG_PERSONAL_API_KEY -- a read-only Personal API Key from
//                                https://eu.posthog.com/settings/user-api-keys
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PostHog's REST/query API lives on a different host than the
// ingestion endpoint the site's own capture snippet uses
// (eu.i.posthog.com) -- private/read endpoints are only on this one.
const POSTHOG_API_HOST = "https://eu.posthog.com";
const POSTHOG_PROJECT_ID = "313248";

type TrendSeriesResult = {
  data: number[];
  days: string[];
  label: string;
  // The query API returns this as an array (e.g. ["/raportare.html"])
  // even for a single breakdown property, not a plain string -- see
  // breakdownValueToPath() below.
  breakdown_value?: string | number | boolean | null | Array<string | number | boolean | null>;
  action?: { math?: string; name?: string };
};

async function runTrendsQuery(
  apiKey: string,
  series: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): Promise<TrendSeriesResult[]> {
  const resp = await fetch(`${POSTHOG_API_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {
        kind: "TrendsQuery",
        series,
        dateRange: { date_from: "-30d" },
        interval: "day",
        ...extra,
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`PostHog query failed (${resp.status}): ${await resp.text()}`);
  }
  const body = await resp.json();
  return (body.results || []) as TrendSeriesResult[];
}

function sum(data: number[]): number {
  return data.reduce((a, b) => a + b, 0);
}

function breakdownValueToPath(value: TrendSeriesResult["breakdown_value"]): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined || raw === "") return "(necunoscut)";
  return String(raw);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const POSTHOG_PERSONAL_API_KEY = Deno.env.get("POSTHOG_PERSONAL_API_KEY");

    if (!POSTHOG_PERSONAL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "PostHog not configured (missing POSTHOG_PERSONAL_API_KEY secret)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [pageviewResults, topPagesResults, funnelResults] = await Promise.all([
      // Total pageviews per day + unique daily visitors per day, same
      // event, distinguished by `action.math` (undefined == plain
      // count, 'dau' == distinct visitors that day).
      runTrendsQuery(POSTHOG_PERSONAL_API_KEY, [
        { event: "$pageview" },
        { event: "$pageview", math: "dau" },
      ]),
      // Pageviews broken down by path, summed below into one total
      // per page over the whole 30-day window.
      runTrendsQuery(POSTHOG_PERSONAL_API_KEY, [
        { event: "$pageview" },
      ], {
        breakdownFilter: { breakdowns: [{ property: "$pathname", type: "event" }] },
      }),
      // The two funnel events added alongside the site's own forms --
      // see raportare.html (ticket_submitted) and index/servicii/
      // produse.html (contact_form_submitted).
      runTrendsQuery(POSTHOG_PERSONAL_API_KEY, [
        { event: "ticket_submitted" },
        { event: "contact_form_submitted" },
      ]),
    ]);

    const days = (pageviewResults[0]?.days || []).map((d) => d.slice(0, 10));
    const totalSeries = pageviewResults.find((r) => !r.action?.math);
    const uniqueSeries = pageviewResults.find((r) => r.action?.math === "dau");

    const topPages = topPagesResults
      .map((r) => ({ path: breakdownValueToPath(r.breakdown_value), count: sum(r.data || []) }))
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const ticketSeries = funnelResults.find((r) => r.action?.name === "ticket_submitted" || r.label === "ticket_submitted");
    const contactSeries = funnelResults.find((r) => r.action?.name === "contact_form_submitted" || r.label === "contact_form_submitted");

    return new Response(
      JSON.stringify({
        pageviews: {
          days,
          total: totalSeries?.data || [],
          unique: uniqueSeries?.data || [],
          totalSum: sum(totalSeries?.data || []),
          uniqueSum: sum(uniqueSeries?.data || []),
        },
        topPages,
        funnel: {
          ticketSubmitted: sum(ticketSeries?.data || []),
          contactFormSubmitted: sum(contactSeries?.data || []),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("posthog-stats error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

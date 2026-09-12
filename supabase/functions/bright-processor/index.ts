// Supabase Edge Function: send-email (deployed as "bright-processor")
// ---------------------------------------------------------------
// Sends notification emails directly through the company's own
// cPanel mailboxes (mail.whmpanels.com), via SMTP — no third-party
// email service (EmailJS, etc.) involved.
//
// Three notification types, one hardcoded recipient each — the
// browser (or trigger — see below) never gets to pick a "to" address:
//   - "ticket"         -> sesizari@insta-grup.ro
//   - "contact"        -> office@insta-grup.ro
//   - "report_needed"  -> vlasbogdan@insta-grup.ro
//
// WHO CAN CALL THIS (security fix — see supabase/sql/README.md):
// this function used to accept any request carrying just the public
// anon key, trusting whatever ticket_number/name/address/description
// fields it was sent — meaning anyone could fabricate a "new ticket"
// email with made-up data, with nothing to validate or rate-limit the
// caller. It now accepts exactly two kinds of caller:
//
//   1. The database notify trigger (005_notify_triggers.sql), for
//      "ticket" and "contact" only — authenticated by a shared secret
//      only the trigger knows (`x-notify-secret` header). This path
//      is only ever given a row id, never raw form fields; the real
//      row is re-fetched here, server-side, with the service-role
//      key, so the email always reflects what's actually saved.
//
//   2. An authenticated staff member — admin.html's existing calls
//      already send the logged-in user's own session token as the
//      Authorization header (the Supabase JS client does this
//      automatically), so nothing changes on admin.html's side. This
//      is the only path "report_needed" ever arrives on, and it's
//      trusted with whatever payload it sends, exactly as before.
//
// A request with neither — a bare anon key, which used to be all
// that was required — is rejected outright.
//
// SMTP credentials are read from Supabase secrets (never hardcoded
// here) — see the "Set the SMTP secrets" step in the setup notes.
//
// DEPLOY:
//   supabase functions deploy bright-processor
// ---------------------------------------------------------------

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers: required because this function is called directly
// from the browser (a different origin than supabase.co) on the
// staff-authenticated path.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notify-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTIFY_SHARED_SECRET = Deno.env.get("NOTIFY_SHARED_SECRET")!;

// Trigger-originated call: body is only ever {type:'ticket', ticket_id}
// or {type:'contact', contact_message_id} — re-fetch the real row
// server-side and build the same shape the rest of this function
// already expects, rather than trusting anything else in the request.
async function loadTrustedPayloadFromTrigger(req: Request): Promise<Record<string, unknown> | Response> {
  const body = await req.json();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (body.type === "ticket" && body.ticket_id) {
    const { data, error } = await admin
      .from("tickets")
      .select("ticket_number, type, name, phone, email, address, description")
      .eq("id", body.ticket_id)
      .single();
    if (error || !data) return new Response("ticket not found", { status: 404 });
    return {
      type: "ticket",
      ticket_number: data.ticket_number,
      ticket_type: data.type === "Anunt accident" ? "Accident / urgență" : "Defect",
      name: data.name,
      phone: data.phone,
      email: data.email || "-",
      address: data.address,
      description: data.description || "-",
    };
  }

  if (body.type === "contact" && body.contact_message_id) {
    const { data, error } = await admin
      .from("contact_messages")
      .select("from_name, from_email, message")
      .eq("id", body.contact_message_id)
      .single();
    if (error || !data) return new Response("contact message not found", { status: 404 });
    return { type: "contact", from_name: data.from_name, from_email: data.from_email, message: data.message };
  }

  return new Response("unrecognized notification request", { status: 400 });
}

// Staff-authenticated call (admin.html): verify the Authorization
// header really is a logged-in user's session before trusting
// whatever payload they sent — this is the only path "report_needed"
// arrives on, and the only change here is that a bare anon key with
// no real session behind it is no longer enough.
async function loadTrustedPayloadFromStaff(req: Request, authHeader: string): Promise<Record<string, unknown> | Response> {
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  return await req.json();
}

Deno.serve(async (req) => {
  // Handle the browser's CORS preflight request.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const sharedSecret = req.headers.get("x-notify-secret");

    let body: Record<string, unknown>;

    if (sharedSecret && sharedSecret === NOTIFY_SHARED_SECRET) {
      const result = await loadTrustedPayloadFromTrigger(req);
      if (result instanceof Response) return result;
      body = result;
    } else if (authHeader.startsWith("Bearer ")) {
      const result = await loadTrustedPayloadFromStaff(req, authHeader);
      if (result instanceof Response) return result;
      body = result;
    } else {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { type } = body as { type?: string };

    if (type !== "ticket" && type !== "contact" && type !== "report_needed") {
      return new Response(
        JSON.stringify({ error: "Invalid type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const smtpUser = Deno.env.get("SMTP_USER"); // e.g. sesizari@insta-grup.ro
    const smtpPass = Deno.env.get("SMTP_PASS");

    if (!smtpHost || !smtpUser || !smtpPass) {
      throw new Error("SMTP secrets are not configured on this function.");
    }

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: true,
        auth: { username: smtpUser, password: smtpPass },
      },
    });

    let to: string, subject: string, html: string;

    if (type === "ticket") {
      const { ticket_number, ticket_type, name, phone, email, address, description } = body as Record<string, string>;
      to = "sesizari@insta-grup.ro";
      subject = `Sesizare nouă — ${ticket_number}`;
      html = `
        <h2>Sesizare nouă: ${ticket_number}</h2>
        <p><strong>Tip:</strong> ${ticket_type}</p>
        <p><strong>Nume:</strong> ${name}</p>
        <p><strong>Telefon:</strong> ${phone}</p>
        <p><strong>Email:</strong> ${email || "-"}</p>
        <p><strong>Adresă:</strong> ${address}</p>
        <p><strong>Descriere:</strong> ${description || "-"}</p>
      `;
    } else if (type === "contact") {
      const { from_name, from_email, message } = body as Record<string, string>;
      to = "office@insta-grup.ro";
      subject = `Solicitare de contact — ${from_name}`;
      html = `
        <h2>Solicitare nouă de pe site</h2>
        <p><strong>Nume:</strong> ${from_name}</p>
        <p><strong>Email:</strong> ${from_email}</p>
        <p><strong>Mesaj:</strong></p>
        <p>${message}</p>
      `;
    } else {
      // type === "report_needed" — a ticket was just closed (status
      // set to Terminat) without its "Ce s-a făcut" field filled in.
      // Recipient is hardcoded here, same pattern as the other two
      // cases above, rather than trusting a client-supplied "to"
      // field — admin.html does send one, but it's deliberately
      // ignored, since the whole point of hardcoding recipients in
      // this function is that the caller can't be trusted to decide
      // who receives what.
      const { ticket_number, address, closed_by, closed_on } = body as Record<string, string>;
      to = "vlasbogdan@insta-grup.ro";
      subject = `Raport de completat — ${ticket_number}`;
      html = `
        <h2>Tichet închis, raport de completat: ${ticket_number}</h2>
        <p><strong>Adresă:</strong> ${address}</p>
        <p><strong>Închis de:</strong> ${closed_by || "-"}</p>
        <p><strong>Data închiderii:</strong> ${closed_on || "-"}</p>
        <p>Acest tichet a fost marcat ca soluționat, dar câmpul "Ce s-a făcut" nu a fost completat încă.</p>
      `;
    }

    await client.send({
      from: smtpUser,
      to,
      subject,
      html,
    });
    await client.close();

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

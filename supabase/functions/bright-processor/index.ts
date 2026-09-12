// REFERENCE REWRITE -- see supabase/sql/README.md. This repo has never
// had the real deployed source for this function, so port whatever
// this doesn't know about (the real SMTP-send logic, the exact email
// templates/subject lines for each notification type) in from the
// live function rather than treating this as a full replacement.
//
// What changed and why: previously, ANY caller with just the public
// anon key could invoke this function with completely made-up
// ticket_number/name/address/description and it would send an email
// as if that were a real submission. This version accepts exactly two
// kinds of caller:
//
//   1. The notify trigger (005_notify_triggers.sql) -- authenticated
//      by a shared secret only it knows, sent as the `x-notify-secret`
//      header. This path is only ever given a ticket_id or
//      contact_message_id, never raw form fields -- the real row is
//      re-fetched here, server-side, with the service-role key, so
//      the email always reflects what's actually in the database.
//
//   2. An authenticated staff member -- admin.html's existing calls
//      already send the logged-in user's own session token as the
//      Authorization header (the Supabase JS client does this
//      automatically), so this path requires no changes on
//      admin.html's side at all. Whatever payload shape staff already
//      send (ticket / contact / report_needed / anything else
//      admin.html sends) is trusted exactly as before.
//
// A request with neither -- a bare anon key, which is all that used
// to be required -- is rejected outright.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

type NotifyPayload = Record<string, unknown>;

async function loadTrustedPayloadFromTrigger(req: Request): Promise<NotifyPayload | Response> {
  const body = await req.json();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (body.type === 'ticket' && body.ticket_id) {
    const { data, error } = await admin
      .from('tickets')
      .select('ticket_number, type, name, phone, email, address, description')
      .eq('id', body.ticket_id)
      .single();
    if (error || !data) return new Response('ticket not found', { status: 404 });
    return {
      type: 'ticket',
      ticket_number: data.ticket_number,
      ticket_type: data.type === 'Anunt accident' ? 'Accident / urgență' : 'Defect',
      name: data.name,
      phone: data.phone,
      email: data.email || '-',
      address: data.address,
      description: data.description || '-',
    };
  }

  if (body.type === 'contact' && body.contact_message_id) {
    const { data, error } = await admin
      .from('contact_messages')
      .select('from_name, from_email, message')
      .eq('id', body.contact_message_id)
      .single();
    if (error || !data) return new Response('contact message not found', { status: 404 });
    return { type: 'contact', from_name: data.from_name, from_email: data.from_email, message: data.message };
  }

  return new Response('unrecognized notification request', { status: 400 });
}

async function loadTrustedPayloadFromStaff(req: Request, authHeader: string): Promise<NotifyPayload | Response> {
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return new Response('unauthorized', { status: 401 });
  return await req.json();
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const sharedSecret = req.headers.get('x-notify-secret');

  let payload: NotifyPayload;

  if (sharedSecret && sharedSecret === NOTIFY_SHARED_SECRET) {
    const result = await loadTrustedPayloadFromTrigger(req);
    if (result instanceof Response) return result;
    payload = result;
  } else if (authHeader.startsWith('Bearer ')) {
    const result = await loadTrustedPayloadFromStaff(req, authHeader);
    if (result instanceof Response) return result;
    payload = result;
  } else {
    return new Response('unauthorized', { status: 401 });
  }

  // TODO: port the real SMTP-send logic here, branching on
  // payload.type same as the live function already does ('ticket' |
  // 'contact' | 'report_needed' | any other type admin.html sends).
  // This reference only logs, so nothing is silently half-migrated.
  console.log('would send email for', payload);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

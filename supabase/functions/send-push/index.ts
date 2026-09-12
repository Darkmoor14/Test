// REFERENCE REWRITE -- see supabase/sql/README.md and
// bright-processor/index.ts's header comment; same two-caller model:
// the notify trigger (shared secret, ticket_id only, re-fetched
// server-side) or an authenticated staff session (admin.html's
// existing calls, unchanged, still sending their own {title,body,url}
// directly). A bare anon key is rejected.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const sharedSecret = req.headers.get('x-notify-secret');

  let title: string;
  let body: string;
  let url: string;

  if (sharedSecret && sharedSecret === NOTIFY_SHARED_SECRET) {
    const payload = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await admin
      .from('tickets')
      .select('ticket_number, address')
      .eq('id', payload.ticket_id)
      .single();
    if (error || !data) return new Response('ticket not found', { status: 404 });

    title = 'Sesizare nouă';
    body = `${data.ticket_number} — ${data.address}`;
    url = 'admin.html?ticket=' + encodeURIComponent(data.ticket_number);
  } else if (authHeader.startsWith('Bearer ')) {
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return new Response('unauthorized', { status: 401 });

    const payload = await req.json();
    ({ title, body, url } = payload);
  } else {
    return new Response('unauthorized', { status: 401 });
  }

  // TODO: port the real web-push send logic here (existing subscriber
  // lookup + push, unchanged) using the trusted title/body/url above.
  console.log('would push', { title, body, url });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

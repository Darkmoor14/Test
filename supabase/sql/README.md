# Supabase server-side SQL — security remediation

None of this repo ever had the project's real SQL committed to it — every
Postgres function referenced from the client (`create_ticket`, the
`public_tickets` view) has lived only in the live Supabase project, with
no local source to review or diff against. That's the core problem this
folder fixes: from now on, the server-side logic that matters for public
safety is written down here first, and the live project is expected to
match it.

**The two Edge Functions in `supabase/functions/` ARE the real deployed
logic** (their actual source was provided directly, not reconstructed) —
the SMTP send, the email templates per notification type, and the full
RFC 8291/8292 Web Push implementation are all unchanged from what's live.
The only thing added to each is the caller-authentication check at the
top (see "What changed and why" below); the business logic after that
point is exactly what was already running. These are safe to deploy as
committed here, once the one-time setup below is done.

**The SQL files ARE still reference implementations, not a migration
diff** — `create_ticket()`'s real source was never available to check
against, so before running `003_create_ticket.sql`: open the real
function in the Supabase SQL editor, compare it to what's here, and port
over anything this reference doesn't know about (extra validation, a
different `ticket_number` format, additional columns) rather than blindly
overwriting a working function. The other SQL files (rate limiting,
`contact_messages`, the triggers, `public_tickets`) are all genuinely new
and don't have this concern.

## What changed and why

- **`create_ticket()`** now checks a CAPTCHA token and rate-limits the
  caller, but **only when the caller is anonymous** (`auth.role() =
  'anon'`). Staff calling it from `admin.html` (an authenticated
  session) are unaffected — no CAPTCHA, no rate limit, same signature
  plus one new optional `p_captcha_token` argument.
- New **`contact_messages`** table + `submit_contact_message()` RPC give
  the site's contact form (previously not backed by any table at all) the
  same accept-then-validate shape as the ticket form.
- A new **`created_via_public`** boolean on `tickets`, set inside
  `create_ticket()`, distinguishes a citizen's own submission from a
  ticket staff logged manually in `admin.html`. Only the former fires the
  new notify trigger — staff-created tickets keep using `admin.html`'s
  existing, already-authenticated notify calls, untouched.
- Two **`AFTER INSERT` triggers** (one on `tickets` gated by
  `created_via_public`, one on `contact_messages`) call the Edge
  Functions server-side via `pg_net`, passing only a row id — never the
  raw form data — authenticated with a shared secret only the trigger
  knows.
- **`public_tickets`** is rewritten to drop `description` and any name
  field entirely, and to replace the full `address` with a generalized
  `area` (street, no house number) via a best-effort regex. It's a
  heuristic, not a guarantee — see the comment in
  `006_public_tickets_view.sql`.

## Required one-time setup in the Supabase dashboard

1. Enable the `pg_net` and `http` Postgres extensions (Database →
   Extensions), if not already on.
2. Sign up for [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
   (free) and store the **secret** key in Vault:
   ```sql
   select vault.create_secret('YOUR_TURNSTILE_SECRET_KEY', 'turnstile_secret_key');
   ```
   The **site key** goes in the client HTML (`raportare.html`,
   `index.html`) — it's public by design, safe to commit.
3. Generate a long random string for the trigger's shared secret and
   store it the same way:
   ```sql
   select vault.create_secret('<a long random value>', 'notify_shared_secret');
   ```
   Then set the identical value as a secret named `NOTIFY_SHARED_SECRET`
   on both the `bright-processor` and `send-push` Edge Functions (Project
   Settings → Edge Functions → Secrets). This is what lets the trigger
   prove it's the trigger, and nobody else.
4. Run the files in this folder in order (001 → 006).

## Deployment order

Run 001 through 006 in order. Then deploy the two rewritten Edge
Functions in `supabase/functions/`. Update the client pages (already done
in this same change) only after the SQL and functions are live — otherwise
there's a window where new tickets are created but nothing notifies
anyone.

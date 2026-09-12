-- Extensions needed by the rest of this folder.
--   pg_net -- async outbound HTTP calls, used by the notify triggers
--             (004) to reach the Edge Functions without blocking the
--             INSERT that triggers them. Supabase installs this into
--             the `net` schema by default -- don't force a different
--             schema here, the rest of this folder assumes `net.*`.
--   http   -- synchronous outbound HTTP calls, used by verify_captcha()
--             (002) to call Cloudflare Turnstile's siteverify endpoint
--             and get an answer back within the same function call.
--             Supabase's convention is the `extensions` schema.
-- Both are already enabled on most Supabase projects; these are no-ops
-- if so. If your project has pg_net or http under a different schema
-- already, adjust the `net.` / `extensions.` references in
-- 002_public_submission_rate_limit.sql and 004_notify_triggers.sql to
-- match, rather than fighting the existing installation.
create extension if not exists pg_net;
create extension if not exists http with schema extensions;

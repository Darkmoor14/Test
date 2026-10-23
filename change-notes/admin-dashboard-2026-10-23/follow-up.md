# Dashboard follow-up — 23 October 2026

## Changes

- Replaced the owner-privileged `public_tickets` view with a `security_invoker` view. Added a generated `public_name` field for the three institution-owned ticket sources and granted anonymous access only to the exact columns shown on public status pages.
- Restored an explicit anonymous RLS policy for non-archived rows. Raw ticket contact fields (`name`, `phone`, and `email`) and free-text descriptions remain inaccessible to anonymous clients.
- Kept the existing Excel repair-sheet workflow intact. Both dashboard entry points are wired to the same preview-and-confirm importer; the separate report export remains in the overview toolbar.
- Moved the React ticket, project/backlog/work-order, and ERP inventory queries and mutations behind shared functions in `admin-react/src/lib/dataServices.ts`. Rebuilt the mounted bundle and bumped its cache key.
- Fixed partial success handling when a manually created ticket's optional submission/resolution dates fail to persist. The form now reports that the ticket exists, avoids implying the resolution status saved, and skips the resolved-ticket notification until the operator verifies it.
- Rewrote the React migration README's stale status: Excel controls are present, LPS and Parc Auto remain active vanilla workflows, and Projects/ERP do refresh on tab entry.

## Supabase verification

- The anonymous role can read the public feed (`134` visible rows) and the whitelisted institutional display name.
- The anonymous role cannot read ticket `name` or `phone` columns directly.
- `public.public_tickets` has `security_invoker = true`; the security advisor no longer reports the view as a security-definer view.
- The project still reports other security advisor findings for existing exposed `SECURITY DEFINER` functions; those are separate from this view change and were not changed here.

## Scope notes

- The LPS planning workspace is explicitly marked Vlas-only and keeps its private planning records in browser storage. Moving that private model into shared database tables would change who can see it, so this pass does not broaden access.
- Parc Auto's vehicle and fuel workflows still run through the existing vanilla module. Its React rewrite is architectural follow-up, not a current missing workflow; the add/edit, due-date, fuel-history, and Excel export flows remain available through that module.
- Other React areas and the legacy vanilla modules still contain direct Supabase calls; this is a first shared boundary for the main ticket/project/ERP workflows, not a full-dashboard data-layer migration.
- The mounted dashboard already contains responsive rules and the Excel controls described above. An authenticated browser session was not available for visual end-to-end testing.

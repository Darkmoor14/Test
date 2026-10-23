# Admin dashboard fixes — 23 October 2026

Applied on `claude/brave-albattani-xwyg14` after a user-perspective review.

## Changes

- Escaped user-entered owner/facilitator names before inserting LPS milestones, handoffs, constraints, huddles, and look-ahead metadata into HTML.
- Changed the Projects home counter to count only non-cancelled work orders whose start date is today through the next 14 days. Overdue work no longer inflates the “next 14 days” total.
- Refresh Projects, backlog, work orders, and ERP inventory when their dashboard tabs are opened, so staff returning to a module see changes made by colleagues.
- Routed checklist persistence through a shared service function. Checklist saves now report failures, keep the unsaved edit available for retry, and prevent overlapping saves.
- Rebuilt the mounted React dashboard bundle and bumped its cache key in `admin-3.html`.
- Added and applied `20261023160313_lock_down_direct_public_ticket_access.sql`. Anonymous clients can no longer query the raw `tickets` table. The public status view remains readable, now exposes only its intended status fields, and no longer includes free-text descriptions. The view grant is read-only.

## Verification

- `admin-react`: `npm run build` passed (TypeScript and standalone Vite build).
- `vite build --config vite.mount.config.ts` passed; the resulting bundle was copied to `assets/js/admin-react-status.js` and its syntax was checked.
- `npm run lint` completed with existing React lint warnings; it reported no fatal lint errors.
- Supabase verification confirmed `anon` cannot SELECT from `public.tickets`, can SELECT from `public.public_tickets`, the raw anonymous SELECT policy is absent, and the public view returns 134 rows with columns `id`, `ticket_number`, `type`, `address`, `status`, `submitted_on`, `resolved_on`, and `public_name`.

## Follow-up

See [follow-up.md](./follow-up.md) for the subsequent public-view security change and the verified state of the Excel, LPS, Parc Auto, and mobile workflows.

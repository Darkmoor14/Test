# admin-react

React + TypeScript rewrite of `admin-3.html`, built incrementally — one
section at a time, mounted into the existing page rather than run as a
separate app. See the migration tracker doc (linked from the main
conversation) for the full feature-parity checklist and progress.

**Status**: pilot section — Stare sistem (System status: dashboard,
auto-îmbunătățire, jurnal de activitate, roluri). Desktop only for now;
mobile is deliberately deferred.

## Stack

- React 19 + TypeScript, built with Vite
- `@supabase/supabase-js` — same hosted project/anon key admin-3.html
  already uses
- `chart.js` + `react-chartjs-2` — same charting library the original
  page already loads via CDN, here as an npm dependency instead
- Styling: imports the real `assets/css/admin.css` from the repo root
  (copied into `src/styles/admin.css`) for visual parity — not a
  redesign, a faithful port

## Running it

```bash
npm install
npm run dev
```

Requires a real Supabase login with the `god` role (same as Stare sistem
in admin-3.html) to see anything past the login screen.

## Structure

```
src/
  lib/            Supabase client, shared formatting/download helpers, chart.js setup
  features/status/
    useStatusHistory.ts      48h localStorage history log
    useStatusChecks.ts       live DB/auth/functions/cron+counts/push checks
    useGlobalTelemetry.ts    error logging, rage-click/heavy-typing friction signals,
                              feature-click tally, tab dwell time
    usePush.ts               Web Push subscribe flow
    StatusDashboard.tsx       "Stare sistem" tab
    AutoImprove.tsx           "Auto-îmbunătățire" tab
    AuditLog.tsx              "Jurnal de activitate" tab
    Roles.tsx                 "Roluri" tab
    StatusHistorySheet.tsx    the "i" button's 48h history sheet
  App.tsx           login gate + god-role check + the 4-tab switcher
```

## Known simplification (pilot-only, not final)

`useGlobalTelemetry` tags every signal with a fixed `"status"` tab label
since this pilot only has one page. Once mounted inside admin-3.html
alongside the real tab router, it should read the shell's actual current
tab instead.

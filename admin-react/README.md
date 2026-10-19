# admin-react

React + TypeScript rewrite of `admin-3.html`, built incrementally — one
section at a time, mounted into the existing page rather than run as a
separate app. See the migration tracker doc (linked from the main
conversation) for the full feature-parity checklist and progress.

**Status**: two sections done — Stare sistem (System status: dashboard,
auto-îmbunătățire, jurnal de activitate, roluri) and Acasă (Home: clock,
mini-calendar with full recurring-event CRUD, personal to-do widget,
role-gated nav grid) — **both mounted into admin-3.html**, replacing
their old hand-written panels. Desktop only for now; mobile is
deliberately deferred. See the migration tracker doc for what's next
(Sesizări/Tickets).

## Stack

- React 19 + TypeScript, built with Vite
- `@supabase/supabase-js` — same hosted project/anon key admin-3.html
  already uses
- `chart.js` + `react-chartjs-2` — same charting library the original
  page already loads via CDN, here as an npm dependency instead
- Styling: imports the real `assets/css/admin.css` from the repo root
  (copied into `src/styles/admin.css`) for visual parity — not a
  redesign, a faithful port

## Two entry points, two builds

- `src/main.tsx` + `vite.config.ts` → the **standalone dev app**
  (`index.html`), with its own login screen and tab switcher. Useful for
  developing/testing a section in isolation, with its own Supabase client.
- `src/mount.tsx` + `vite.mount.config.ts` → the bundle **admin-3.html
  actually loads** (`assets/js/admin-react-status.js`), as a plain classic
  `<script>` tag — same pattern as every other feature file there. It
  exposes `window.AdminReactStatus.mount*(container, supabaseClient)`
  functions, reusing admin-3.html's own already-authenticated Supabase
  client (from `admin-core.js`'s shared scope) instead of creating a
  second one. No login screen, no tab switcher — the surrounding shell
  (login, rail, nav) already handles all of that.

## Running the standalone dev app

```bash
npm install
npm run dev
```

Requires a real Supabase login with the `god` role (same as Stare sistem
in admin-3.html) to see anything past the login screen.

## Rebuilding the mounted bundle

After changing anything under `src/` that affects the mounted version
(which is most of it — `main.tsx`/`App.tsx` are standalone-only):

```bash
cd admin-react
npx tsc -b
npx vite build --config vite.mount.config.ts
cp dist-mount/admin-react-status.js ../assets/js/admin-react-status.js
```

Then bump the `?v=` cache-busting suffix on its `<script>` tag in
`admin-3.html`, same convention as every other asset there.

**`vite.mount.config.ts` sets `define: {'process.env.NODE_ENV': '"production"'}`
explicitly** — `build.lib` mode doesn't do this automatically the way
Vite's normal app build does, and without it React/Chart.js's internal
`process.env.NODE_ENV` checks reference a bare `process` global that
doesn't exist in a real browser outside a dev server, crashing the
bundle on load. Also roughly halves the bundle size by dead-code-eliminating
their dev-mode branches. If a future edit to that config ever drops this,
`grep -c "process\.env\.NODE_ENV" assets/js/admin-react-status.js` should
read 0.

The committed bundle is a **build artifact**, same as how this repo has
no build step at all today (admin-3.html's own feature files are
hand-written, not compiled) — there's no CI step that builds it on
deploy, so it must be rebuilt and re-committed by hand after any source
change. Worth setting up a real build step eventually, but matches how
the rest of the site already ships.

## Structure

```
src/
  lib/
    supabaseClient.ts    standalone-app-only: creates its own client
    supabaseContext.tsx  React context so every hook/component takes the
                          client via props/context instead of importing a
                          singleton -- lets the mounted version reuse
                          admin-3.html's existing client
    format.ts, chartSetup.ts
  features/status/
    useStatusHistory.ts      48h localStorage history log
    useStatusChecks.ts       live DB/auth/functions/cron+counts/push checks
    useGlobalTelemetry.ts    error logging, rage-click/heavy-typing friction
                              signals, feature-click tally, tab dwell time --
                              app-WIDE listeners, only ever installed once
                              (see mount.tsx's DashboardRoot)
    usePush.ts               Web Push subscribe flow
    StatusDashboard.tsx       "Stare sistem" tab
    AutoImprove.tsx           "Auto-îmbunătățire" tab
    AuditLog.tsx              "Jurnal de activitate" tab
    Roles.tsx                 "Roluri" tab
    StatusHistorySheet.tsx    the "i" button's 48h history sheet
  features/home/
    calendarUtils.ts          event model + whole-series recurrence math
                               (pure functions, ported 1:1 from admin-core.js)
    useCalendarEvents.ts      calendar_events CRUD (Supabase)
    useStaffRoster.ts         own god/modulePermission() + allStaffEmails
                               fetch -- independent of vanilla's globals
    useTodoNotes.ts           personal to-do notes (localStorage only)
    useReminders.ts           once-a-minute foreground reminder engine
                               (toast + OS notification)
    HomeClock.tsx, MiniCalendar.tsx, EventCard.tsx, NavGrid.tsx
    CalendarDaySheet.tsx, CalendarEventFormSheet.tsx, RecurrenceSheet.tsx
    TodoWidget.tsx
    HomePage.tsx               "Acasă" panel -- composes all of the above
  App.tsx     standalone-only: login gate + god-role check + tab switcher
  main.tsx    standalone entry (index.html)
  mount.tsx   mounted entry (admin-3.html) -- exposes window.AdminReactStatus
```

## Known simplifications

- `useGlobalTelemetry`'s tab label: in the mounted version it reads the
  real current tab live off `window.currentAdminTab` (the shell's own
  global); the standalone app has no such router, so it falls back to a
  fixed `"status"` label there.
- When each pilot section replaced its old vanilla code, the dead code
  was removed from the relevant vanilla files rather than left running
  alongside the React version (duplicate telemetry, duplicate DOM ids,
  wasted work) — `assets/js/admin-core.js` (Roluri/audit log, then
  Acasă's clock/calendar/to-do/nav-grid code) and
  `assets/js/features/system-status.js` (now empty but for a pointer
  comment -- it used to hold both Stare sistem and the Acasă code that
  happened to share the same file). Keep doing the same cleanup for
  future sections.
- Acasă's nav grid still needs to reach into vanilla land for cross-tab
  navigation, since Sesizări/Proiecte/ERP/HR/Docs/Stare-sistem-as-a-
  *destination* aren't all React yet. Rather than the React bundle
  reaching into vanilla's module-scope variables by bare identifier
  (which would technically work — classic `<script>` tags share one
  global lexical environment on this page — but is fragile and
  undocumented), the contract is explicit: `window.openAdminTab` (an
  ordinary top-level `function` declaration, already a real `window`
  property) for plain tab switches, and a small purpose-built
  `window.goHomeToTicketsOverview` (see its own comment in
  admin-core.js) for the one case for that needs a vanilla filter reset
  first. Same pattern `window.currentAdminTab` already used — update or
  remove these bridges as each destination section itself moves to React.

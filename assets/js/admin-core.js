
  /* ================================================================
     ADMIN DASHBOARD — insta-grup.ro
     ----------------------------------------------------------------
     Purpose: internal page for staff to view and resolve tickets
     submitted through the public form on index.html.

     How it works:
       1. Login uses Supabase Auth (real email + password accounts,
          created manually in Supabase -> Authentication -> Users).
          There is no "sign up" flow — accounts are added by whoever
          manages the Supabase project.
       2. Once logged in, the session grants the "authenticated" role
          in Supabase, which is what Row Level Security (RLS) checks
          to allow reading and updating the `tickets` table — see the
          RLS policies set up in the Supabase SQL Editor.
       3. Tickets are fetched with `.from('tickets').select('*')` and
          rendered as cards. Editing Status or "Soluționat de" and
          clicking Salvează runs `.update(...)` on that one row.
       4. A Postgres trigger (set_resolved_on, set up separately in
          Supabase) automatically stamps `resolved_on` the moment a
          ticket's status is changed to "Terminat" — this page does
          not set that timestamp itself.
       5. "Raport Excel" builds an .xlsx client-side from the tickets
          already loaded in memory (no extra network request), then
          asks for one month or all months before download.

     Editing this file: the Supabase URL/key below are meant to be
     public (they only grant what the RLS policies allow — nothing
     more). If you rename any column in the `tickets` table in
     Supabase, update the matching `t.<column>` references here too.
     ================================================================ */

  const SUPABASE_URL = "https://ebuigyyjifnjiuzsgpih.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_aXC8Q_v2faRB0uEAlZYFog_JreYGXvq";
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const loginWrap = document.getElementById('loginWrap');
  const dash = document.getElementById('dash');
  const appRail = document.getElementById('appRail');
  const categoryPanel = document.getElementById('categoryPanel');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userTag = document.getElementById('userTag');

  /* ============================================================
     PUSH NOTIFICATIONS — this is what makes admin.html behave like
     a real app with real notifications once installed to a phone's
     home screen (see manifest.json / sw.js). Every device that taps
     "Activează notificări" registers itself in the push_subscriptions
     table; raportare.html calls the "send-push" Edge Function after
     saving a new ticket, which fans a notification out to every
     registered device. Uses the standard, free Web Push protocol —
     no per-message cost like the WhatsApp integration this replaced.
     ============================================================ */
  const VAPID_PUBLIC_KEY = 'BBQABSiPkAUnsoP8vP5NIFs6P0ZpkoUiHf7zl-_f5bDkSGVbL4gKDCtSPv0Y7sFhhWy5dbQPOqRxKdgx2TC0QZY';

  function urlBase64ToUint8Array(base64String){
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  let swRegistration = null;
  let currentSessionEmail = null;

  /* ============================================================
     STAFF ROLES — 'full' (default, unrestricted) or 'limited'
     (sesizari@insta-grup.ro specifically — can close a ticket but
     can never write resolution_note, "Ce s-a făcut"). The real
     enforcement lives in a Postgres trigger (see
     staff-roles-setup.sql) that rejects the write outright at the
     database level, regardless of what this page does — everything
     here is just about giving a 'limited' account a clean UI that
     doesn't even show a field they can't use, rather than letting
     them fill it in and then discovering a save error.
     ============================================================ */
  let currentUserRole = 'limited';
  // Full staff roster (email list only) — used to populate the
  // calendar event "assign to" picker, so an event can be aimed at a
  // real platform account rather than free text.
  let allStaffEmails = [];
  async function loadStaffRoster(){
    const { data, error } = await supabaseClient.from('staff_roles').select('email').order('email', { ascending: true });
    if (error) { console.error(error); return; }
    allStaffEmails = (data || []).map(r => r.email);
  }
  async function fetchCurrentUserRole(email){
    try {
      const { data, error } = await supabaseClient
        .from('staff_roles')
        .select('role')
        .eq('email', email)
        .maybeSingle();
      if (error || !data) {
        // Restricted by default now, not full — matches the DB's own
        // policy (is_staff()/enforce_resolution_note_permission()):
        // only an explicit role='full' row (vlasbogdan@) is
        // unrestricted; every other account, including one not yet in
        // staff_roles at all, is treated as limited.
        currentUserRole = 'limited';
        return;
      }
      currentUserRole = data.role;
    } catch (err) {
      console.error('Could not fetch staff role (defaulting to limited):', err);
      currentUserRole = 'limited';
    }
  }

  // Every account gets the same view/features now — this used to be
  // keyed to one specific account's email. Kept as a function (rather
  // than inlining `true` at each call site) since it still reads as a
  // named concept throughout the rest of this file.
  function isReportFocusedView(){
    return true;
  }

  // Browser security gives every file:// page a unique origin. Keep local
  // preview usable, but enable PWA features only from a served website.
  const isWebOrigin = window.location.protocol === 'https:' || window.location.protocol === 'http:';
  if (isWebOrigin) {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    // Its own manifest, not admin.html's — they used to share
    // manifest.json, whose start_url is hardcoded to "admin.html". An
    // installed home-screen icon always launches the manifest's
    // start_url regardless of which page it was installed from, so
    // anyone who added admin-2.html to their home screen had their
    // icon silently open the full admin.html dashboard instead.
    manifest.href = 'manifest-2.json';
    document.head.append(manifest);
  }
  if (isWebOrigin && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        swRegistration = reg;
        if (currentSessionEmail) maybeAutoPromptForNotifications();
      })
      .catch(err => console.warn('Service worker registration failed:', err));

    // Handles the "admin panel is already open" case for notification
    // taps — see the comment in sw.js for why this is needed alongside
    // (not instead of) the URL-param check below.
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'go-to-ticket-url') {
        const url = new URL(event.data.url, window.location.href);
        const ticketNum = url.searchParams.get('ticket');
        if (ticketNum) goToTicketByNumber(ticketNum);
      }
    });
  }

  // goToTicket() (further down) needs the ticket's internal database
  // id, but the push notification only carries the human-readable
  // ticket_number (that's all create_ticket's RPC call returns) — so
  // this looks the ticket up in already-loaded data first.
  function goToTicketByNumber(ticketNumber){
    const match = allTickets.find(t => t.ticket_number === ticketNumber);
    if (!match) return false;
    goToTicket(match.id);
    return true;
  }


  // Requests notification permission and saves the push subscription.
  // Used to live inside the old "Activează notificări" button's click
  // handler — now called automatically instead (see
  // maybeAutoPromptForNotifications below), so failures are logged
  // rather than shown via alert(): an alert popping up unprompted the
  // first time someone opens the app would be a jarring first
  // impression for something they didn't explicitly ask to happen.
  async function subscribeToPush(){
    if (!swRegistration) {
      console.warn('Push subscribe skipped: service worker not ready yet.');
      return;
    }
    try {
      // Diagnostic check: confirm there's actually a valid logged-in
      // session right before we try to save anything. The
      // "push_subscriptions" table's RLS policy only allows the
      // authenticated role to insert — if the session has expired,
      // failed to persist, or isn't attached to this request for
      // some other reason, the save fails with an opaque RLS error
      // that doesn't explain why.
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !sessionData || !sessionData.session) {
        console.warn('Push subscribe skipped: no valid session yet.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return; // a deliberate "no" from the user — nothing to do
      }
      const sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const subJson = sub.toJSON();
      const { error } = await supabaseClient.from('push_subscriptions').upsert({
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
        // So send-push can point a cold-start notification (no admin
        // tab already open) at this specific page instead of always
        // opening admin.html for every device.
        landing_page: 'admin-2.html',
      }, { onConflict: 'endpoint' });
      if (error) {
        console.error('Push subscription save failed:', error);
        return;
      }
    } catch (err) {
      console.error('Push subscription failed:', err);
    }
  }

  // Fires once, automatically, the very first time the installed app
  // (not just a browser tab) is opened — replaces the old manual
  // "Activează notificări" button entirely. Guarded by a localStorage
  // flag so it only ever asks once, regardless of the answer.
  const NOTIF_PROMPT_KEY = 'notifAutoPromptShownV1';
  function isStandalonePwa(){
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  }
  function maybeAutoPromptForNotifications(){
    if (!isStandalonePwa()) return;
    if (localStorage.getItem(NOTIF_PROMPT_KEY)) return;
    if (!swRegistration || !('Notification' in window)) return;
    localStorage.setItem(NOTIF_PROMPT_KEY, '1'); // set first so a dismissal/crash can't re-trigger this forever
    subscribeToPush();
  }

  let allTickets = [];
  let activeFilter = 'Ongoing';
  const selectedIds = new Set();
  // Set to a ticket's id while its name/phone/email/address/
  // description fields are shown as editable inputs — only one
  // ticket at a time, triggered by "Editează" in the floating
  // selection bar (see updateArchiveBar/openTicketEdit below).
  let editingTicketId = null;

  function escapeHtml(value){
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let ticketSearchQuery = '';
  let ticketYearFilter = 'all';
  let ticketMonthFilter = 'all';
  // Whether the person has actually picked a year/month themselves
  // (via a dropdown or the desktop calendar) — set only inside
  // setTicketYearFilter/setTicketMonthFilter, never by any automatic
  // fallback. Used by the Filtre note (see createFilterPopoverWidget)
  // to tell "the person picked this" apart from "it's just sitting at
  // its untouched starting value ('all' for both here)" — without it,
  // the note would show "Filtru: toți anii, toate lunile" on every
  // fresh load, despite nobody having touched anything.
  let ticketYearFilterTouched = false;
  let ticketMonthFilterTouched = false;
  // Defaults to "Active" on phone specifically — a phone screen is
  // small enough that "everything, including tickets already closed"
  // isn't a useful first view the way it can be on a wider desktop
  // table; someone checking Overview on their phone is almost always
  // asking "what still needs attention," not doing a full audit.
  // Desktop keeps its original "Toate" default untouched. Checked
  // once at load (matches the same 900px breakpoint the rest of the
  // site's mobile/desktop split uses) — this is an initial default,
  // not something that needs to react to the window being resized
  // afterward.
  let overviewStatusFilter = 'active';
  let overviewSearchQuery = '';

  // A ticket that's Terminat but still has no "Ce s-a făcut" written
  // up yet — status and report-writing are two separate things (see
  // getFilteredTickets' own comment), so this is a lens on top of
  // Terminat, not a status of its own. Factored into one place so the
  // several call sites that need this exact check (getFilteredTickets,
  // ticketMatchesStatusFilter, getEffectiveMonthYear below) can't drift
  // out of sync with each other.
  function isAwaitingReport(t){
    return t.status === 'Terminat' && !t.resolution_note;
  }

  // Duplicate tickets — two citizens reporting the same real-world
  // issue as separate tickets. Staff mark one as a duplicate of the
  // other ("canonical") instead of it being auto-filtered, so the
  // crew never gets dispatched twice. Marking does NOT archive it —
  // it stays visible on the public site and in every list here
  // exactly as before, just styled purple and excluded from
  // statistics (see the call sites below); it only moves to the
  // archive later, the normal way, once it's picked up the
  // canonical's resolution and the usual 14-day sweep applies.
  // Whatever resolution the canonical ticket gets is mirrored onto
  // every duplicate automatically server-side (see
  // sync_duplicate_ticket()/propagate_resolution_to_duplicates() in
  // Supabase), regardless of whether it's written via a manual edit
  // or the Fișă remedieri Excel import.
  function isDuplicateTicket(t){
    return !!(t && t.duplicate_of);
  }
  function getDuplicatesOf(ticketId){
    return allTickets.filter(t => t.duplicate_of === ticketId);
  }
  function getCanonicalTicket(t){
    if (!t || !t.duplicate_of) return null;
    return allTickets.find(x => x.id === t.duplicate_of) || null;
  }

  // A ticket's "effective" month/year for filtering purposes — NOT
  // necessarily when it was actually submitted. Still-active tickets
  // always count as belonging to the CURRENT real-world month,
  // computed fresh every time this runs rather than stored anywhere,
  // so a ticket opened in August that's still unresolved in September
  // shows up under September (where someone checking "what's
  // outstanding right now" would actually look), not buried back in
  // August where it'd be easy to lose track of. Once a ticket is
  // actually resolved AND its report is written, it settles
  // permanently at its real submission month; a Terminat ticket still
  // awaiting its report stays pinned to the current month too — it's
  // not done as far as this queue is concerned just because sesizari@
  // flipped its status, and closing an older ticket shouldn't make it
  // silently vanish from the current month's Așteaptă-raport view.
  function getEffectiveMonthYear(t){
    if (t.status !== 'Terminat' || isAwaitingReport(t)) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    if (!t.submitted_on) return { year: null, month: null };
    const d = parseTicketDate(t.submitted_on);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function matchesSearch(t, query){
    if (!query) return true;
    const haystack = [t.ticket_number, t.name, t.phone, t.address, t.email]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  }

  function matchesYear(t, yearFilter){
    if (yearFilter === 'all') return true;
    const { year } = getEffectiveMonthYear(t);
    return year !== null && String(year) === String(yearFilter);
  }

  function matchesMonth(t, monthFilter){
    if (monthFilter === 'all') return true;
    const { month } = getEffectiveMonthYear(t);
    return month !== null && String(month) === String(monthFilter);
  }

  // Shared ordering used by both the overview table and the detailed
  // ticket cards: urgent/accident tickets that are still active always
  // come first — regardless of submission date — since those are the
  // ones that genuinely can't wait. Everything else follows by date,
  // with resolved tickets sinking to the bottom as before.
  function sortTicketsForDisplay(tickets){
    const urgentActive = tickets.filter(t => t.type === 'Anunt accident' && t.status !== 'Terminat')
      .sort((a, b) => parseTicketDate(b.submitted_on) - parseTicketDate(a.submitted_on));
    const regularActive = tickets.filter(t => t.type !== 'Anunt accident' && t.status !== 'Terminat')
      .sort((a, b) => parseTicketDate(b.submitted_on) - parseTicketDate(a.submitted_on));
    const done = tickets.filter(t => t.status === 'Terminat')
      .sort((a, b) => parseTicketDate(b.resolved_on || b.submitted_on) - parseTicketDate(a.resolved_on || a.submitted_on));
    return [...urgentActive, ...regularActive, ...done];
  }

  // Used by the overview table specifically — ticket number order
  // instead of by date, since with archived tickets now mixed back
  // in alongside active ones, a date-sorted table put them in a
  // confusing, hard-to-scan order. Numeric-aware comparison so
  // "SES-2026-10" sorts above "SES-2026-2", not below it. Descending
  // — newest (highest) ticket number first.
  function sortTicketsByNumber(tickets){
    return [...tickets].sort((a, b) =>
      (b.ticket_number || '').localeCompare(a.ticket_number || '', undefined, { numeric: true })
    );
  }

  let agingOnlyFilter = false;
  let typeOnlyFilter = null; // null | 'functional' | 'accident'
  // Locks the Sesizări panel to one type — 'Toate', 'functional' or
  // 'accident' — set only by openAdminTab() when switching between
  // the "Sesizări funcționale" and "Sesizări accidente" tabs (both
  // share this one panel — see panelIdForTab()). Separate from
  // typeOnlyFilter above (that one is a temporary narrow filter, this
  // one is which tab you're actually on).
  let activeTypeFilter = 'Toate';

  // Separate from the two above on purpose — those are for the
  // Sesizări tab's own filtering and get reset by goToTicket() so
  // that list isn't left narrowed after landing on a specific ticket.
  // This one drives the Overview table's priority-card filter
  // instead, and deliberately must NOT be touched by goToTicket() —
  // that's what makes the filter survive clicking into a ticket and
  // then using the browser's back button to return.
  let overviewCardFilter = null; // null | 'active' | 'aging' | 'functional' | 'accident'

  // Mirrors getFilteredTickets()'s own status-bucket logic exactly —
  // used by goToTicket() to check whether a target ticket is already
  // visible under whatever status filter is currently selected,
  // before deciding whether it actually needs to change at all.
  function ticketMatchesStatusFilter(t, filterKey){
    if (filterKey === 'AwaitingReport') return isAwaitingReport(t);
    return filterKey === 'Toate' || t.status === filterKey;
  }

  function getFilteredTickets(){
    const query = ticketSearchQuery.trim().toLowerCase();
    // No separate "Arhivate" option anymore — "Toate" already means
    // every ticket, archived or not, and since only already-Terminat
    // tickets ever get archived, leaving it out of "Ongoing"/
    // "Terminat"/"AwaitingReport" too costs nothing there (an archived
    // ticket is never Ongoing) while fixing the one place it did
    // matter: "Soluționate" no longer quietly stops counting a ticket
    // the moment it ages into the archive.
    let base;
    if (activeFilter === 'AwaitingReport') {
      // Not a real status of its own — a Terminat ticket with no
      // resolution_note yet. Derived on the fly rather than stored,
      // per the "flag on top of the existing status" approach.
      base = allTickets.filter(t => isAwaitingReport(t));
    } else {
      // "Terminat" means exactly that — status is Terminat, full
      // stop, regardless of whether a report's been written yet.
      // "AwaitingReport" above is a separate, additional lens on top
      // of it, not a condition for appearing under "Terminat" itself.
      base = allTickets.filter(t =>
        activeFilter === 'Toate' ? true : t.status === activeFilter
      );
    }
    if (activeTypeFilter === 'accident') base = base.filter(t => t.type === 'Anunt accident');
    else if (activeTypeFilter === 'functional') base = base.filter(t => t.type !== 'Anunt accident');

    base = base.filter(t => matchesSearch(t, query) && matchesYear(t, ticketYearFilter) && matchesMonth(t, ticketMonthFilter));

    // Extra narrowing applied when a priority card was clicked — see
    // clearNarrowFilter()/the priority card handlers further down.
    if (agingOnlyFilter) {
      base = base.filter(t => {
        if (t.status === 'Terminat' || !t.submitted_on) return false;
        const daysOpen = (Date.now() - parseTicketDate(t.submitted_on)) / (1000 * 60 * 60 * 24);
        return daysOpen > AGING_THRESHOLD_DAYS;
      });
    }
    if (typeOnlyFilter === 'functional') base = base.filter(t => t.type !== 'Anunt accident');
    if (typeOnlyFilter === 'accident') base = base.filter(t => t.type === 'Anunt accident');

    // Set only via the desktop day-grid calendar (see
    // createMiniCalendarWidget) — stays null forever on phone.
    if (typeof overviewDayFilter !== 'undefined' && overviewDayFilter !== null) {
      base = base.filter(t => {
        const d = parseTicketDate(t.submitted_on);
        return !isNaN(d.getTime()) && d.getDate() === overviewDayFilter;
      });
    }

    return base;
  }

  let ticketYearFilterInitialized = false;

  // Highlights a year selector (and shows an explicit text warning
  // beside it) whenever it's pinned to a specific past year — since
  // that means current-year activity, including brand new tickets,
  // simply isn't showing up on screen right now. Deliberately not
  // color-only: the text label matters just as much as the highlight,
  // same reasoning as everywhere else color carries meaning on this
  // page.
  function updateYearWarning(selectIds, warningIds, yearFilterValue){
    const currentYear = String(new Date().getFullYear());
    const isPastYearSelected = yearFilterValue !== 'all' && yearFilterValue !== currentYear;
    selectIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('not-current-year', isPastYearSelected);
    });
    warningIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('show', isPastYearSelected);
    });
  }

  // Dropdowns sharing this one piece of state (Overview + Sesizări
  // panels, each ×2 for the mobile-original/desktop-duplicate pair)
  // so changing the year from any of them keeps all the others synced
  // automatically.
  function populateYearFilterSelect(silent){
    const selects = [
      document.getElementById('yearFilterSelect'),
      document.getElementById('yearFilterSelectTickets'),
      document.getElementById('yearFilterSelectTicketsMobile'),
      document.getElementById('yearFilterSelectOverviewMobile'),
      document.getElementById('yearFilterSelectDesktop'),
      document.getElementById('yearFilterSelectTicketsDesktop'),
    ].filter(Boolean);
    if (selects.length === 0) return;

    const years = new Set();
    allTickets.forEach(t => {
      const { year } = getEffectiveMonthYear(t);
      if (year) years.add(year);
    });
    const sortedYears = [...years].sort((a, b) => b - a);
    const optionsHtml =
      '<option value="all">Toate anii</option>' +
      sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
    selects.forEach(s => { s.innerHTML = optionsHtml; });

    if (!ticketYearFilterInitialized) {
      const currentYear = new Date().getFullYear();
      ticketYearFilter = sortedYears.includes(currentYear) ? String(currentYear) : 'all';
      ticketYearFilterInitialized = true;
    } else if (!silent && ticketYearFilter !== 'all' && !sortedYears.some(y => String(y) === ticketYearFilter)) {
      // Only a non-silent (explicit) reload gets to yank the year
      // filter back to "Toate anii" when the selected year no longer
      // has any tickets — a silent background refresh (every tab
      // switch, including the one goToTicket() causes) must never do
      // this on its own.
      ticketYearFilter = 'all';
    }

    selects.forEach(s => { s.value = ticketYearFilter; });
    updateYearWarning(
      ['yearFilterSelect', 'yearFilterSelectTickets', 'yearFilterSelectTicketsMobile', 'yearFilterSelectOverviewMobile', 'yearFilterSelectDesktop', 'yearFilterSelectTicketsDesktop'],
      ['yearWarningOverview', 'yearWarningTickets', 'yearWarningOverviewDesktop', 'yearWarningTicketsDesktop'],
      ticketYearFilter
    );
  }

  // Overview and Sesizări share ticketYearFilter/ticketMonthFilter,
  // but each has its own Filtre icon — changing the year from either
  // tab's popover needs to re-check BOTH icons' "non-default filter"
  // highlight, not just the one whose own select fired the change
  // event. Called defensively (typeof guard) since these widgets
  // aren't created until further down the script.
  function syncSharedFilterButtons(){
    if (typeof overviewFilterWidget !== 'undefined' && overviewFilterWidget) overviewFilterWidget.syncActiveState();
    if (typeof ticketsFilterWidget !== 'undefined' && ticketsFilterWidget) ticketsFilterWidget.syncActiveState();
  }

  function setTicketYearFilter(value){
    ticketYearFilter = value;
    ticketYearFilterTouched = true;
    document.querySelectorAll('#yearFilterSelect, #yearFilterSelectTickets, #yearFilterSelectTicketsMobile, #yearFilterSelectOverviewMobile, #yearFilterSelectDesktop, #yearFilterSelectTicketsDesktop').forEach(s => { s.value = value; });
    updateYearWarning(
      ['yearFilterSelect', 'yearFilterSelectTickets', 'yearFilterSelectTicketsMobile', 'yearFilterSelectOverviewMobile', 'yearFilterSelectDesktop', 'yearFilterSelectTicketsDesktop'],
      ['yearWarningOverview', 'yearWarningTickets', 'yearWarningOverviewDesktop', 'yearWarningTicketsDesktop'],
      ticketYearFilter
    );
    syncSharedFilterButtons();
    renderTickets();
    renderOverviewTable();
    renderOverviewCharts();
  }

  // Months are fixed (always the same 12 + "all"), unlike years,
  // which are derived from actual ticket data — so this only needs
  // to run once, not every time tickets reload.
  const MONTH_FILTER_NAMES = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
  function populateMonthFilterSelects(){
    const selects = document.querySelectorAll('#monthFilterSelect, #monthFilterSelectTickets, #monthFilterSelectTicketsMobile, #monthFilterSelectOverviewMobile, #monthFilterSelectDesktop, #monthFilterSelectTicketsDesktop');
    const optionsHtml = '<option value="all">Toate lunile</option>' +
      MONTH_FILTER_NAMES.map((name, i) => `<option value="${i + 1}">${name}</option>`).join('');
    selects.forEach(s => { s.innerHTML = optionsHtml; s.value = ticketMonthFilter; });
  }

  function setTicketMonthFilter(value){
    ticketMonthFilter = value;
    ticketMonthFilterTouched = true;
    document.querySelectorAll('#monthFilterSelect, #monthFilterSelectTickets, #monthFilterSelectTicketsMobile, #monthFilterSelectOverviewMobile, #monthFilterSelectDesktop, #monthFilterSelectTicketsDesktop').forEach(s => { s.value = value; });
    syncSharedFilterButtons();
    renderTickets();
    renderOverviewTable();
    renderOverviewCharts();
  }

  // Used to include a time component (HH:MM) — dropped per request,
  // so it's now functionally identical to fmtDateOnly() below. Kept
  // as a separate function rather than replacing every call site with
  // fmtDateOnly(), since that's a much smaller, lower-risk change and
  // every existing caller keeps working exactly as before, just
  // without the time.
  // Some historical tickets have submitted_on/resolved_on stored with
  // a 2-digit year (e.g. someone typed "26" instead of "2026" into a
  // date field) — a perfectly VALID JavaScript Date (literally the
  // year 26 AD), so it never trips an isNaN check, but it sorts and
  // filters nowhere near where it should: string/numeric comparisons
  // put "year 26" before every real year, year-filter chips never
  // match it since no chip says "26", and aging calculations turn
  // into nonsense multi-century numbers. Every ticket in this system
  // is genuinely from the 2000s, so correcting a sub-100 year by
  // adding 2000 is safe rather than guessing — this is the one shared
  // place that correction happens, used everywhere a ticket date gets
  // parsed (filtering, sorting, aging, charts, exports, display) so
  // the fix can't drift out of sync between call sites again the way
  // it did when only the chart had this fix.
  function parseTicketDate(dateStr){
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return d;
    if (d.getFullYear() < 100) d.setFullYear(d.getFullYear() + 2000);
    return d;
  }

  // Guards against exactly the bug that caused mis-sorted/invisible
  // tickets elsewhere: a native date input's value should always be
  // a full 4-digit year, but a browser that lets an incomplete typed
  // year through (e.g. "26" before finishing "2026") can hand back
  // something like "0026-08-15". Catching it at entry (both when
  // creating a ticket and when editing one) is better than relying
  // solely on parseTicketDate() to paper over it everywhere downstream.
  // Catches a mistyped year in either direction: a browser that
  // resolved an incomplete year (someone typing "26" instead of
  // "2026") down to a literal year 26 AD, and — the far more common
  // real case — a plausible-looking but still wrong 4-digit year like
  // 2029, most often a fat-finger on a numeric keypad where 6 and 9
  // sit right above each other. +1 year of tolerance on the upper
  // bound allows an entry made right at a year boundary; there's no
  // legitimate reason for either date field to ever be further in the
  // future than that — every ticket describes something that already
  // happened.
  // The one case worth fixing automatically instead of just blocking:
  // a native date input's value is always zero-padded to 4 digits, so
  // someone typing "26" instead of "2026" — if the browser accepts it
  // at all rather than leaving the field empty — produces the literal
  // string "0026-MM-DD". That's an unambiguous truncation (the year
  // really is "26", just missing its century), so it's safe to add
  // 2000 automatically rather than making someone go back and retype
  // it. A different wrong year (2029 instead of 2026) is NOT a
  // truncation — there's no way to guess what was actually meant — so
  // that stays a hard block via hasSuspiciousYear() below, unchanged.
  function normalizeYearInDateValue(val){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val || '');
    if (!m) return val;
    const year = parseInt(m[1], 10);
    if (year >= 100) return val;
    return String(year + 2000).padStart(4, '0') + '-' + m[2] + '-' + m[3];
  }

  function hasSuspiciousYear(val){
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(val || '');
    if (!m) return false;
    const year = parseInt(m[1], 10);
    return year < 1900 || year > new Date().getFullYear() + 1;
  }

  function fmtDate(iso){
    if(!iso) return '—';
    const d = parseTicketDate(iso);
    return d.toLocaleDateString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric'});
  }

  function fmtDateOnly(iso){
    if(!iso) return '—';
    const d = parseTicketDate(iso);
    return d.toLocaleDateString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric'});
  }

  // Splits an ISO timestamp into the separate {date, time} strings
  // <input type="date">/<input type="time"> expect (YYYY-MM-DD /
  // HH:MM) — using the browser's LOCAL time getters, not
  // toISOString() (which is UTC and would silently shift the
  // displayed date/time, confusing anyone editing it near midnight).
  function toDateTimeInputParts(iso){
    if (!iso) return { date: '', time: '' };
    const d = parseTicketDate(iso);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    const pad = (n) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }

  // Reverse of the above — combines the two input values back into a
  // proper ISO timestamp for saving. `new Date('YYYY-MM-DDTHH:MM')`
  // is interpreted as local time by the browser, matching what the
  // admin actually typed/picked, then converted to ISO (UTC) for
  // storage, consistent with how the rest of the app stores dates.
  // Both callers used to send `null` when left blank, relying on a
  // Supabase trigger to fall back to "now" — defaulting to the
  // current moment right here instead means that trigger dependency
  // is no longer needed at all for the common "just resolved this
  // now" case; it only still matters if someone wants a genuinely
  // backdated timestamp AND the trigger doesn't respect an explicit
  // value (worth checking, but no longer blocking for typical use).
  // timeStr is no longer collected from any form (the time input was
  // removed, date-only now) — defaults to the current time-of-day
  // rather than midnight specifically. That matters for the "resolved
  // before submitted" check just below: a ticket submitted earlier
  // today, then resolved today, would otherwise falsely look
  // "resolved before it was submitted" if resolved_on defaulted to
  // 00:00 instead of whatever time it actually is right now.
  function combineDateTimeToISO(dateStr, timeStr){
    if (!dateStr) return new Date().toISOString();
    const nowTime = timeStr || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    const d = new Date(`${dateStr}T${nowTime}`);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  }

  /* ============================================================
     STAFF NOTIFICATIONS — mirrors raportare.html's own email + push
     notification calls exactly, so a ticket logged manually here (via
     "+ Adaugă sesizare", e.g. for a phone call) alerts the rest of
     the team the same way a citizen's own submission does. Missing
     from this file before now — the public form has always sent
     these, but nothing equivalent existed here, so an admin-created
     ticket silently notified no one. Never blocks the actual ticket
     creation if either call fails — same "don't let a notification
     problem stop the real work" principle as the public form.
     ============================================================ */
  async function sendNotification(payload){
    try {
      const { error } = await supabaseClient.functions.invoke('bright-processor', {
        body: payload,
      });
      if (error) console.error('bright-processor (email) function failed:', error);
    } catch (err) {
      console.error('bright-processor (email) call failed:', err);
    }
  }

  async function sendPushNotification(payload){
    try {
      const { error } = await supabaseClient.functions.invoke('send-push', {
        body: {
          title: 'Sesizare nouă',
          body: `${payload.ticket_number} — ${payload.address}`,
          url: 'admin.html?ticket=' + encodeURIComponent(payload.ticket_number),
        },
      });
      if (error) console.error('send-push failed:', error);
    } catch (err) {
      console.error('send-push call failed:', err);
    }
  }

  async function checkSession(){
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      showDashboard(session.user.email);
    } else {
      showLogin();
    }
  }

  /* ============================================================
     AUTO-ARCHIVE / AUTO-CLEANUP — Adam's ask: two weeks after a
     ticket is resolved or a project's due_date passes, it should
     move to archive and stop showing on the public site.

     There is no server-side cron/scheduled function wired up for
     this (that would need a Supabase Edge Function on a schedule,
     or the pg_cron extension enabled in the Supabase SQL editor —
     see the note above loadProjects() for the one-time SQL if that
     route is preferred later). Until then, this runs the sweep
     client-side, once, every time a staff member logs into this
     dashboard:
       - tickets: any row with status "Terminat" and resolved_on
         older than 14 days gets archived = true (same flag the
         manual "Arhivează" button already sets).
       - current_projects: any row whose due_date is more than 14
         days in the past gets archived = true the same way —
         "Toate" already shows archived projects too (see
         getFilteredProjects), so auto-archiving replaces the older
         behavior of deleting these rows outright.
     The public pages (relatii-publice.html, sesizari.html) also
     filter by the same 14-day window client-side, so a ticket or
     project disappears from the public site on schedule even on
     days nobody has logged into admin.

     REQUIRES the `archived` / `archived_at` columns on
     `current_projects` — see the migration note above
     getFilteredProjects().
     ============================================================ */
  const AUTO_ARCHIVE_DAYS = 14;

  async function autoArchiveStaleTickets(){
    const cutoffISO = new Date(Date.now() - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    // Requires resolution_note to actually be filled in before a
    // ticket can be swept into archived=true — a Terminat ticket
    // missing its "Ce s-a făcut" write-up stays out of the archive
    // indefinitely (and keeps showing under "Așteaptă raport") until
    // someone fills it in, however long that takes. This is
    // completely separate from the public site's own 14-day
    // visibility window (relatii-publice.html/sesizari.html filter by
    // resolved_on client-side, not by this archived flag), so a
    // ticket still disappears from the public pages on schedule
    // either way — only the *admin* archive is being held back here.
    const { error } = await supabaseClient
      .from('tickets')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('status', 'Terminat')
      .eq('archived', false)
      .not('resolution_note', 'is', null)
      .lt('resolved_on', cutoffISO);
    if (error) console.error('Auto-archive of stale tickets failed (non-blocking):', error);
  }

  async function autoCleanupStaleProjects(){
    const cutoffDate = new Date(Date.now() - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    const cutoffISO = cutoffDate.toISOString().slice(0, 10); // date-only, matches due_date column type
    const { error } = await supabaseClient
      .from('current_projects')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('archived', false)
      .lt('due_date', cutoffISO);
    if (error) console.error('Auto-archive of stale projects failed (non-blocking — likely means the archived/archived_at columns have not been added to current_projects yet):', error);
  }

  async function runAutoArchiveSweep(){
    // Both run before the lists are fetched, so the dashboard the
    // staff member sees already reflects the cleaned-up state.
    await Promise.all([autoArchiveStaleTickets(), autoCleanupStaleProjects()]);
  }

  function showDashboard(email){
    // Supabase normally returns a lowercase address, but email local
    // parts are case-insensitive for this account. Normalize once so
    // the vlasbogdan@ landing screen cannot disappear on a casing or
    // whitespace difference returned by a session.
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (dash.classList.contains('show') && currentSessionEmail === normalizedEmail) {
      maybeAutoPromptForNotifications();
      return;
    }
    currentSessionEmail = normalizedEmail;
    // This account is identified by its authenticated email, not by
    // the optional staff_roles lookup below. Switch its initial panel
    // before revealing the dashboard so the default Overview never
    // flashes for a frame while that lookup is still in flight.
    const isReportAccount = isReportFocusedView();
    document.documentElement.classList.toggle('report-focused-view', isReportAccount);
    if (isReportAccount) {
      // Land back on whatever tab was open before a refresh instead of
      // always restarting at the home page — see initialHashTab above.
      const validReportTabs = ['home', 'overview', 'tickets-functional', 'tickets-accident', 'projects-home', 'projects', 'backlog', 'lps', 'workorders', 'erp-home', 'equipment', 'machines', 'materials', 'erp-audit', 'status', 'status-improve', 'status-audit', 'docs'];
      const restoredTab = validReportTabs.includes(initialHashTab) ? initialHashTab : 'home';
      openAdminTab(restoredTab, true);
      history.replaceState({ adminTab: restoredTab }, '', window.location.pathname + window.location.search + '#' + restoredTab);
    }
    loginWrap.style.display = 'none';
    dash.classList.add('show');
    logoutBtn.style.display = 'inline-flex';
    maybeAutoPromptForNotifications();
    userTag.textContent = normalizedEmail;
    const sidebarAvatar = document.getElementById('sidebarAccountAvatar');
    if (sidebarAvatar) sidebarAvatar.textContent = normalizedEmail.charAt(0) || '—';
    // Role must be known before the first render, so tickets don't
    // briefly flash the "Ce s-a făcut" field for a limited-access
    // account before it gets hidden a moment later.
    fetchCurrentUserRole(normalizedEmail).then(() => {
      // A sign-out or account switch may happen before the request
      // resolves. Never let that stale response change the new view.
      if (currentSessionEmail !== normalizedEmail) return;
      document.documentElement.classList.toggle('report-focused-view', isReportFocusedView());
      // The sheet's status chips render with the standard 3-option
      // set at script-load time (role isn't known yet then) — this
      // adds the 4th "Așteaptă raport" option specifically for the
      // report-focused role, once we actually know who's logged in.
      if (isReportFocusedView() && overviewStatusChipsSheet && !overviewStatusChipsSheet.querySelector('[data-key="awaiting_report"]')) {
        const awaitingDef = reportFocusedChipDefs.find(c => c.key === 'awaiting_report');
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip' + (awaitingDef.key === overviewStatusFilter ? ' active' : '');
        chip.textContent = awaitingDef.label;
        chip.dataset.key = awaitingDef.key;
        chip.addEventListener('click', () => setOverviewStatusFilter(awaitingDef.key));
        overviewStatusChipsSheet.appendChild(chip);
      }
      // "Așteaptă raport" isn't relevant for a limited-role account —
      // they can't fill the report, so a chip dedicated to "here's
      // what's missing one" has nothing useful to offer them. The
      // ticket itself still shows up under "Toate" either way; only
      // this specific dedicated view is hidden. Chips render once at
      // script-load time before login (and therefore before the role
      // is known), so this hides the one in question after the fact
      // rather than restructuring that earlier initialization.
      if (currentUserRole === 'limited') {
        document.querySelectorAll('[data-key="AwaitingReport"]').forEach(el => {
          el.style.display = 'none';
        });
        // The mobile Overview status filter (Toate/Active/Soluționate)
        // used to be hidden here, on the theory that sesizari@ should
        // just work from the full, unfiltered table on Overview —
        // but that meant this account's phone view had year/month
        // filtering only, with no way to narrow by status at all.
        // Now enabled for this role too, same chips full admins get.
      }
      runAutoArchiveSweep().finally(() => {
        loadTickets();
        loadProjects();
        loadBacklogProjects();
      });
      loadStaffRoster();
      // First-ever login on this browser — walk through the basics once,
      // automatically. Re-openable anytime from the "?" button in the rail.
      try {
        if (isReportFocusedView() && !localStorage.getItem(ONBOARDING_SEEN_KEY)) {
          setTimeout(() => { if (typeof startOnboardingTour === 'function') startOnboardingTour(); }, 900);
        }
      } catch (e) { /* localStorage unavailable — just skip auto-start */ }
    });
  }

  function showLogin(){
    currentSessionEmail = null;
    document.documentElement.classList.remove('report-focused-view');
    loginWrap.style.display = 'flex';
    dash.classList.remove('show');
    logoutBtn.style.display = 'none';
    userTag.textContent = '';
    allTickets = [];
    allProjects = [];
    selectedIds.clear();
    projectSelectedIds.clear();
    editingTicketId = null;
    ticketSearchQuery = '';
    projectSearchQuery = '';
    activeFilter = 'Ongoing';
    projectsFilter = 'Ongoing';
    overviewCardFilter = null;
    agingOnlyFilter = false;
    typeOnlyFilter = null;
    activeTypeFilter = 'Toate';
    ticketYearFilter = 'all';
    projectYearFilter = 'all';
    overviewStatusFilter = 'active';
    ticketYearFilterInitialized = false;
    projectYearFilterInitialized = false;
    currentAdminTab = 'overview';
    openAdminTab('overview', true);
    document.getElementById('ticketList').innerHTML = '';
    document.getElementById('projectList').innerHTML = '';
    document.getElementById('overviewTableBody').innerHTML = '';
    const overviewCardsMobile = document.getElementById('overviewCardsMobile');
    if (overviewCardsMobile) overviewCardsMobile.innerHTML = '';
    document.getElementById('resultCount').textContent = '';
    document.getElementById('projectsCount').textContent = '';
    document.getElementById('selectionCount').textContent = '0 selectate';
    document.getElementById('projectsSelectionCount').textContent = '0 selectate';
    document.getElementById('ticketAddForm').style.display = 'none';
    document.getElementById('projectForm').style.display = 'none';
    document.getElementById('excelPreview').style.display = 'none';
    renderPrioritySummary();
    updateArchiveBar();
    updateProjectsArchiveBar();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginBtn.disabled = true;
    loginBtn.textContent = 'Se autentifică...';
    loginError.classList.remove('show');

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    loginBtn.disabled = false;
    loginBtn.textContent = 'Autentificare';

    if (error) {
      loginError.textContent = 'Email sau parolă incorectă.';
      loginError.classList.add('show');
      return;
    }
  });

  async function performLogout(){
    await supabaseClient.auth.signOut();
    showLogin();
  }
  logoutBtn.addEventListener('click', performLogout);
  const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
  if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', performLogout);
  const homeIconBtn = document.getElementById('homeIconBtn');
  if (homeIconBtn) homeIconBtn.addEventListener('click', () => openAdminTab('home'));

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session) {
      showDashboard(session.user.email);
    } else {
      showLogin();
    }
  });

  const chipDefs = [
    { key: 'Ongoing', label: 'Active' },
    { key: 'Terminat', label: 'Soluționate' },
    { key: 'AwaitingReport', label: 'Așteaptă raport' },
    { key: 'Toate', label: 'Toate' },
  ];

  const ticketSearchBox = document.getElementById('ticketSearchBox');

  // Sesizări's own search icon — widens status/year/month/day on
  // search-start (to "Toate"/"all", not just the current year/month)
  // so an exact ticket-number search can actually find an older or
  // differently-filtered ticket, then restores whatever was selected
  // before once the search is cleared again. Same widget Overview's
  // search icon already used (see createSearchToggleWidget's own
  // comment on why each widen target is optional/gated).
  const ticketsSearchWidget = createSearchToggleWidget({
    toggleBtnId: 'searchToggleBtn', wrapId: 'ticketSearchWrap', boxId: 'ticketSearchBox',
    setQuery: (v) => { ticketSearchQuery = v; }, rerender: renderTickets,
    getStatus: () => activeFilter, setStatus: (v) => setTicketFilter(v), widenStatus: 'Toate',
    getYear: () => ticketYearFilter, setYear: setTicketYearFilter,
    getMonth: () => ticketMonthFilter, setMonth: setTicketMonthFilter,
    getDayFilter: () => overviewDayFilter, setDayFilter: (d) => { overviewDayFilter = d; },
  });

  document.querySelectorAll('#yearFilterSelect, #yearFilterSelectTickets, #yearFilterSelectTicketsMobile, #yearFilterSelectOverviewMobile, #yearFilterSelectDesktop, #yearFilterSelectTicketsDesktop').forEach(select => {
    select.addEventListener('change', () => setTicketYearFilter(select.value));
  });

  populateMonthFilterSelects();
  document.querySelectorAll('#monthFilterSelect, #monthFilterSelectTickets, #monthFilterSelectTicketsMobile, #monthFilterSelectOverviewMobile, #monthFilterSelectDesktop, #monthFilterSelectTicketsDesktop').forEach(select => {
    select.addEventListener('change', () => setTicketMonthFilter(select.value));
  });

  // ============================================================
  // ICON ROW + FILTER POPOVER SYSTEM — ported 1:1 from admin.html.
  // Comments trimmed here since the full reasoning already lives
  // there; see that file for the complete history of each piece.
  // ============================================================
  function createFilterPopoverWidget(config){
    const toggleBtn = document.getElementById(config.toggleBtnId);
    const popover = document.getElementById(config.popoverId);
    if (!toggleBtn || !popover) return;
    const yearSelect = config.yearSelectId ? document.getElementById(config.yearSelectId) : null;
    const monthSelect = config.monthSelectId ? document.getElementById(config.monthSelectId) : null;
    const noteEls = (config.noteIds || []).map(id => document.getElementById(id)).filter(Boolean);

    function getNoteDateOk(){
      const now = new Date();
      const yearTouched = config.getYearTouched ? config.getYearTouched() : true;
      const monthTouched = config.getMonthTouched ? config.getMonthTouched() : true;
      const yearOk = !yearSelect || !yearTouched || String(config.getYear()) === String(now.getFullYear());
      const monthOk = !monthSelect || !monthTouched || String(config.getMonth()) === String(now.getMonth() + 1);
      return { yearOk, monthOk };
    }

    // "Default" for the icon's own active-ring and for the note's
    // "should this show at all" check are the same question — an
    // untouched year/month select (e.g. admin-2's ticketMonthFilter,
    // which starts at 'all' rather than the current month, unlike
    // admin.html's own) is still "default" even though it doesn't
    // literally equal today's year/month. Answering that only for the
    // note (via getNoteDateOk's touched-awareness) while the icon ring
    // used a stricter, non-touched-aware check was exactly the bug: the
    // icon would glow "active" — implying a filter was applied — while
    // the note correctly showed nothing, because nothing actually was.
    // One shared definition now, so the two surfaces can never disagree.
    function isNoteDefault(){
      const statusOk = config.getStatus() === config.defaultStatus;
      const day = config.getDayFilter ? config.getDayFilter() : null;
      const dayOk = day === null || day === undefined;
      const { yearOk, monthOk } = getNoteDateOk();
      return statusOk && yearOk && monthOk && dayOk;
    }
    const isDefault = isNoteDefault;

    function describeFilter(){
      const parts = [];
      if (config.getStatus() !== config.defaultStatus) {
        const chip = (config.chipDefs || []).find(c => c.key === config.getStatus());
        if (chip) parts.push(chip.label);
      }
      const day = config.getDayFilter ? config.getDayFilter() : null;
      if (day !== null && day !== undefined) {
        const y = config.getYear(), m = Number(config.getMonth());
        const monthName = MONTH_FILTER_NAMES[m - 1] || '';
        parts.push(`${day} ${monthName} ${y}`.trim());
      } else {
        const yearVal = yearSelect ? String(config.getYear()) : null;
        const monthVal = monthSelect ? String(config.getMonth()) : null;
        const { yearOk, monthOk } = getNoteDateOk();
        if (monthSelect && !monthOk) {
          parts.push(monthVal === 'all' ? 'toate lunile' : (MONTH_FILTER_NAMES[Number(monthVal) - 1] || ''));
        }
        if (yearSelect && !yearOk) {
          parts.push(yearVal === 'all' ? 'toți anii' : `an ${yearVal}`);
        }
      }
      return parts.filter(Boolean).join(', ');
    }

    function resetFilter(){
      const now = new Date();
      config.setStatus(config.defaultStatus);
      if (yearSelect) config.setYear(String(now.getFullYear()));
      if (monthSelect) config.setMonth(String(now.getMonth() + 1));
      if (config.setDayFilter) config.setDayFilter(null);
      syncActiveState();
    }

    function syncActiveState(){
      toggleBtn.classList.toggle('active', !isDefault());
      if (!noteEls.length) return;
      const text = isNoteDefault() ? '' : describeFilter();
      noteEls.forEach(el => {
        if (!text) { el.innerHTML = ''; return; }
        // Labeled as returning to the default view, not "remove the
        // filter" -- clicking it resets to this tab's own default
        // (Active + the current year/month), which is still a
        // genuinely restricted view, not "show everything". The old
        // "Elimină filtrul" wording (screen-reader only; there's no
        // visible text beside the × glyph) claimed otherwise.
        el.innerHTML = `Filtru: ${escapeHtml(text)} <button type="button" aria-label="Revino la vizualizarea implicită">×</button>`;
        const dismissBtn = el.querySelector('button');
        if (dismissBtn) dismissBtn.onclick = resetFilter;
      });
    }

    function selectStatus(key){
      config.setStatus(key);
      syncActiveState();
    }
    renderChipRow(config.chipsWrapId, config.chipDefs, config.getStatus, selectStatus);

    if (yearSelect) {
      yearSelect.addEventListener('change', () => {
        config.setYear(yearSelect.value);
        syncActiveState();
      });
    }
    if (monthSelect) {
      monthSelect.addEventListener('change', () => {
        config.setMonth(monthSelect.value);
        syncActiveState();
      });
    }

    // Saved custom filter views — optional (only configured where the
    // popover HTML actually has the savedViewsChips/saveViewBtn markup).
    // One row of named presets per tab (status + year/month/day,
    // whichever of those this particular popover has), stored in
    // saved_filter_views and scoped by config.savedViewsScope so
    // Sesizări/Proiecte/Avarii each only see their own.
    const savedViewsWrap = config.savedViewsWrapId ? document.getElementById(config.savedViewsWrapId) : null;
    const saveViewBtn = config.saveViewBtnId ? document.getElementById(config.saveViewBtnId) : null;
    let savedViews = [];

    function applyFilterValues(f){
      config.setStatus(f.status);
      if (yearSelect && f.year !== undefined && f.year !== null) config.setYear(String(f.year));
      if (monthSelect && f.month !== undefined && f.month !== null) config.setMonth(String(f.month));
      if (config.setDayFilter) config.setDayFilter(f.day !== undefined ? f.day : null);
      syncActiveState();
    }

    function renderSavedViews(){
      if (!savedViewsWrap) return;
      savedViewsWrap.innerHTML = savedViews.map(v => `
        <span class="saved-view-chip" data-id="${v.id}">
          <span>${escapeHtml(v.name)}</span>
          <span class="saved-view-chip-remove" data-remove-id="${v.id}" aria-label="Șterge vizualizarea">×</span>
        </span>
      `).join('');
    }

    async function loadSavedViews(){
      if (!config.savedViewsScope) return;
      const { data, error } = await supabaseClient.from('saved_filter_views').select('*')
        .eq('scope', config.savedViewsScope).order('created_at', { ascending: true });
      if (error) return;
      savedViews = data || [];
      renderSavedViews();
    }

    if (savedViewsWrap) {
      savedViewsWrap.addEventListener('click', async (e) => {
        const removeBtn = e.target.closest('.saved-view-chip-remove');
        if (removeBtn) {
          const id = removeBtn.dataset.removeId;
          savedViews = savedViews.filter(v => v.id !== id);
          renderSavedViews();
          await supabaseClient.from('saved_filter_views').delete().eq('id', id);
          return;
        }
        const chip = e.target.closest('.saved-view-chip');
        if (chip) {
          const view = savedViews.find(v => v.id === chip.dataset.id);
          if (view) applyFilterValues(view.filter_json || {});
        }
      });
    }
    if (saveViewBtn) {
      saveViewBtn.addEventListener('click', async () => {
        const name = (prompt('Nume pentru această vizualizare:') || '').trim();
        if (!name) return;
        const filterJson = {
          status: config.getStatus(),
          year: yearSelect ? config.getYear() : undefined,
          month: monthSelect ? config.getMonth() : undefined,
          day: config.getDayFilter ? config.getDayFilter() : undefined,
        };
        const { data, error } = await supabaseClient.from('saved_filter_views').insert({
          scope: config.savedViewsScope, name, filter_json: filterJson, user_email: currentSessionEmail || null,
        }).select();
        if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
        if (data && data[0]) { savedViews.push(data[0]); renderSavedViews(); }
      });
    }

    toggleBtn.addEventListener('click', () => {
      const willOpen = !popover.classList.contains('open');
      popover.classList.toggle('open', willOpen);
      if (willOpen && config.onOpen) config.onOpen();
      if (willOpen && config.savedViewsScope) loadSavedViews();
    });
    document.addEventListener('click', (e) => {
      if (!popover.classList.contains('open')) return;
      const path = e.composedPath();
      if (path.includes(popover) || path.includes(toggleBtn)) return;
      popover.classList.remove('open');
    });

    syncActiveState();
    return { syncActiveState };
  }

  const MINI_CAL_MONTH_NAMES = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
  function createMiniCalendarWidget(config){
    const calendar = document.getElementById(config.calendarId);
    const label = document.getElementById(config.labelId);
    const grid = document.getElementById(config.gridId);
    const clearBtn = document.getElementById(config.clearBtnId);
    const prevBtn = document.getElementById(config.prevBtnId);
    const nextBtn = document.getElementById(config.nextBtnId);
    if (!calendar || !grid) return;

    const initialYear = Number(config.getYear());
    const initialMonth = Number(config.getMonth());
    let viewYear = Number.isFinite(initialYear) ? initialYear : new Date().getFullYear();
    let viewMonth = Number.isFinite(initialMonth) ? initialMonth : (new Date().getMonth() + 1);

    function isWholeMonthSelected(){
      return config.getDay() === null &&
        String(config.getYear()) === String(viewYear) && String(config.getMonth()) === String(viewMonth);
    }

    function render(){
      label.textContent = `${MINI_CAL_MONTH_NAMES[viewMonth - 1]} ${viewYear}`;
      label.title = isWholeMonthSelected()
        ? `Șterge filtrul de lună — arată toate lunile`
        : `Selectează toată luna ${MINI_CAL_MONTH_NAMES[viewMonth - 1]} ${viewYear}`;
      label.classList.toggle('active-filter', isWholeMonthSelected());
      const firstOfMonth = new Date(viewYear, viewMonth - 1, 1);
      const startOffset = (firstOfMonth.getDay() + 6) % 7;
      const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
      const daysInPrevMonth = new Date(viewYear, viewMonth - 1, 0).getDate();
      const today = new Date();
      const isCurrentMonth = today.getFullYear() === viewYear && today.getMonth() + 1 === viewMonth;

      let html = '';
      for (let i = 0; i < startOffset; i++) {
        html += `<span class="mini-cal-day outside">${daysInPrevMonth - startOffset + i + 1}</span>`;
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const classes = ['mini-cal-day'];
        if (isCurrentMonth && d === today.getDate()) classes.push('today');
        if (config.getDay() === d && String(config.getYear()) === String(viewYear) && String(config.getMonth()) === String(viewMonth)) classes.push('selected');
        html += `<button type="button" class="${classes.join(' ')}" data-day="${d}">${d}</button>`;
      }
      const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;
      for (let i = 1; i <= trailing; i++) {
        html += `<span class="mini-cal-day outside">${i}</span>`;
      }
      grid.innerHTML = html;

      grid.querySelectorAll('.mini-cal-day[data-day]').forEach(btn => {
        btn.addEventListener('click', () => {
          config.setDay(Number(btn.dataset.day));
          config.setYear(String(viewYear));
          config.setMonth(String(viewMonth));
          render();
          config.rerender();
        });
      });
      if (clearBtn) clearBtn.classList.toggle('active-filter', config.getDay() !== null);
    }

    render();
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isWholeMonthSelected()) {
        config.setYear('all');
        config.setMonth('all');
        config.setDay(null);
      } else {
        config.setYear(String(viewYear));
        config.setMonth(String(viewMonth));
        config.setDay(null);
      }
      render();
      config.rerender();
    });
    if (prevBtn) prevBtn.addEventListener('click', () => {
      viewMonth--; if (viewMonth < 1) { viewMonth = 12; viewYear--; }
      render();
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      viewMonth++; if (viewMonth > 12) { viewMonth = 1; viewYear++; }
      render();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        config.setDay(null);
        render();
        config.rerender();
      });
    }

    return {
      refresh(){
        const y = Number(config.getYear());
        const m = Number(config.getMonth());
        if (Number.isFinite(y)) viewYear = y;
        if (Number.isFinite(m)) viewMonth = m;
        render();
      },
    };
  }

  function createSearchToggleWidget(config){
    const toggleBtn = document.getElementById(config.toggleBtnId);
    const wrap = document.getElementById(config.wrapId);
    const box = document.getElementById(config.boxId);
    if (!toggleBtn || !wrap || !box) return null;
    toggleBtn.addEventListener('click', () => {
      wrap.classList.add('expanded');
      toggleBtn.classList.add('active');
      box.focus();
    });
    box.addEventListener('blur', () => {
      if (!box.value.trim()) {
        wrap.classList.remove('expanded');
        toggleBtn.classList.remove('active');
      }
    });
    // Tracks the empty->non-empty transition specifically (not every
    // keystroke), so the widen-on-start/restore-on-exit below each
    // only fire once per search, right as it begins/ends — otherwise
    // typing would keep re-widening the filters on every character,
    // overriding one the person deliberately changed partway through.
    let hadQuery = !!box.value.trim();
    // Snapshotted status+year right as a search starts, so exiting it
    // (clearing the box back to empty, including via the native
    // search-input "×" button) puts them back exactly as they were —
    // leaving a search behaves like it was never there, rather than
    // leaving the widened filters stuck in place afterward.
    let preSearchFilters = null;
    // Widening status/year on search-start is genuinely optional --
    // gated on whether the caller actually passed getStatus/setStatus
    // (and separately getYear/setYear), rather than assumed for every
    // tab. Proiecte publice and Avarii rețele don't share Sesizări's
    // ticket status or year concepts (Avarii has no year filter at
    // all), so calling config.getStatus() / the hardcoded
    // setTicketYearFilter() unconditionally here used to throw
    // "config.getStatus is not a function" on those tabs' very first
    // search keystroke.
    function handleQueryChange(value){
      const hasQuery = !!value.trim();
      if (hasQuery && !hadQuery) {
        preSearchFilters = {
          status: config.getStatus ? config.getStatus() : null,
          year: config.getYear ? config.getYear() : null,
          month: config.getMonth ? config.getMonth() : null,
          day: config.getDayFilter ? config.getDayFilter() : null,
        };
        if (config.setStatus) config.setStatus(config.widenStatus);
        // Year/month/day all widen to "no restriction" on search-start,
        // not to "the current year" -- an exact ticket-number search
        // for a genuinely older ticket used to still come back empty,
        // since forcing the year to now() is just as much a hidden
        // restriction as leaving a specific month/day selected. "all"
        // guarantees a real match is actually findable regardless of
        // when the ticket was submitted.
        if (config.setYear) config.setYear('all');
        if (config.setMonth) config.setMonth('all');
        if (config.setDayFilter) config.setDayFilter(null);
      } else if (!hasQuery && hadQuery && preSearchFilters) {
        if (config.setStatus && preSearchFilters.status !== null) config.setStatus(preSearchFilters.status);
        if (config.setYear && preSearchFilters.year !== null) config.setYear(preSearchFilters.year);
        if (config.setMonth && preSearchFilters.month !== null) config.setMonth(preSearchFilters.month);
        if (config.setDayFilter && preSearchFilters.day !== undefined) config.setDayFilter(preSearchFilters.day);
        preSearchFilters = null;
      }
      hadQuery = hasQuery;
      config.setQuery(value);
      config.rerender();
    }
    box.addEventListener('input', () => handleQueryChange(box.value));
    return {
      applyExternalQuery(value){
        box.value = value;
        const hasQuery = !!value.trim();
        wrap.classList.toggle('expanded', hasQuery);
        toggleBtn.classList.toggle('active', hasQuery);
        handleQueryChange(value);
      },
    };
  }

  function renderChipRow(wrapId, defs, getActiveKey, onSelect){
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    defs.forEach(c => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (c.key === getActiveKey() ? ' active' : '');
      chip.textContent = c.label;
      chip.dataset.key = c.key;
      chip.addEventListener('click', () => onSelect(c.key));
      wrap.appendChild(chip);
    });
  }

  // Icon-row Filtre popover for Sesizări — ported from admin.html
  // (createFilterPopoverWidget/createMiniCalendarWidget, see their own
  // definitions). Overview and Sesizări share this same day-level
  // filter, same reasoning as admin.html: both read/write the same
  // ticketYearFilter/ticketMonthFilter already, so sharing the day too
  // keeps date filtering fully consistent between them. Only ever set
  // via the desktop day-grid calendar — the phone dropdowns don't have
  // a day concept, so this stays null forever there.
  let overviewDayFilter = null;
  function rerenderSharedTicketViews(){
    renderOverviewTable();
    renderTickets();
  }
  const ticketsMiniCal = createMiniCalendarWidget({
    calendarId: 'ticketsMiniCalendar', labelId: 'ticketsMiniCalLabel', gridId: 'ticketsMiniCalGrid',
    clearBtnId: 'ticketsMiniCalClearBtn', prevBtnId: 'ticketsMiniCalPrevBtn', nextBtnId: 'ticketsMiniCalNextBtn',
    getYear: () => ticketYearFilter, setYear: setTicketYearFilter,
    getMonth: () => ticketMonthFilter, setMonth: setTicketMonthFilter,
    getDay: () => overviewDayFilter, setDay: (d) => { overviewDayFilter = d; },
    rerender: rerenderSharedTicketViews,
  });
  const ticketsFilterWidget = createFilterPopoverWidget({
    toggleBtnId: 'ticketsFilterToggleBtn', popoverId: 'ticketsFilterPopover',
    yearSelectId: 'yearFilterSelectTicketsMobile', monthSelectId: 'monthFilterSelectTicketsMobile',
    getYear: () => ticketYearFilter, setYear: setTicketYearFilter,
    getMonth: () => ticketMonthFilter, setMonth: setTicketMonthFilter,
    getYearTouched: () => ticketYearFilterTouched, getMonthTouched: () => ticketMonthFilterTouched,
    getDayFilter: () => overviewDayFilter,
    setDayFilter: (d) => { overviewDayFilter = d; rerenderSharedTicketViews(); },
    onOpen: () => ticketsMiniCal && ticketsMiniCal.refresh(),
    chipsWrapId: 'ticketStatusChipsMobile', chipDefs: chipDefs,
    getStatus: () => activeFilter, setStatus: setTicketFilter, defaultStatus: 'Ongoing',
    noteIds: ['ticketsFilterNoteDesktop', 'ticketsFilterNoteMobile'],
    savedViewsScope: 'tickets', savedViewsWrapId: 'ticketsSavedViewsWrap', saveViewBtnId: 'ticketsSaveViewBtn',
  });

  const overviewStatusChipDefs = [
    { key: 'all', label: 'Toate' },
    { key: 'active', label: 'Active' },
    { key: 'done', label: 'Soluționate' },
  ];

  // Separate, desktop-only chip set — specifically for vlasbogdan@'s
  // report-focused Overview (see isReportFocusedView()). Deliberately
  // NOT added to overviewStatusChipDefs above: that list feeds the
  // mobile sheet used by every account, and "Așteaptă raport" only
  // makes sense in this one dedicated context. Both sets drive the
  // same underlying overviewStatusFilter variable, so nothing about
  // the mobile chips' own behavior changes — they simply never offer
  // a value that produces this third state.
  const reportFocusedChipDefs = [
    { key: 'all', label: 'Toate' },
    { key: 'active', label: 'Active' },
    { key: 'done', label: 'Soluționate' },
    { key: 'awaiting_report', label: 'Așteaptă raport' },
  ];

  function setOverviewStatusFilter(filterKey){
    overviewStatusFilter = filterKey;
    document.querySelectorAll('#overviewStatusChipsSheet .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.key === filterKey);
    });
    if (typeof overviewFilterWidget !== 'undefined' && overviewFilterWidget) overviewFilterWidget.syncActiveState();
    renderOverviewTable();
  }

  // Standard 3-option set here, not reportFocusedChipDefs — this
  // popover is the year/month/status filter for every admin, not just
  // the report-focused role, and "Așteaptă raport" only makes sense
  // for that one account. Added separately, after login, for that
  // role specifically — see fetchCurrentUserRole's .then() below.
  // Populated by createFilterPopoverWidget's own renderChipRow call
  // below (chipsWrapId/chipDefs), not manually here.
  const overviewStatusChipsSheet = document.getElementById('overviewStatusChipsSheet');

  // Overview's own Filtre popover — shares ticketYearFilter/
  // ticketMonthFilter and overviewDayFilter with Sesizări's, same as
  // admin.html, so date filtering stays consistent between both tabs.
  const overviewMiniCal = createMiniCalendarWidget({
    calendarId: 'overviewMiniCalendar', labelId: 'miniCalLabel', gridId: 'miniCalGrid',
    clearBtnId: 'miniCalClearBtn', prevBtnId: 'miniCalPrevBtn', nextBtnId: 'miniCalNextBtn',
    getYear: () => ticketYearFilter, setYear: setTicketYearFilter,
    getMonth: () => ticketMonthFilter, setMonth: setTicketMonthFilter,
    getDay: () => overviewDayFilter, setDay: (d) => { overviewDayFilter = d; },
    rerender: rerenderSharedTicketViews,
  });
  const overviewFilterWidget = createFilterPopoverWidget({
    toggleBtnId: 'overviewFilterToggleBtn', popoverId: 'overviewFilterPopover',
    yearSelectId: 'yearFilterSelectOverviewMobile', monthSelectId: 'monthFilterSelectOverviewMobile',
    getYear: () => ticketYearFilter, setYear: setTicketYearFilter,
    getMonth: () => ticketMonthFilter, setMonth: setTicketMonthFilter,
    getYearTouched: () => ticketYearFilterTouched, getMonthTouched: () => ticketMonthFilterTouched,
    getDayFilter: () => overviewDayFilter,
    setDayFilter: (d) => { overviewDayFilter = d; rerenderSharedTicketViews(); },
    onOpen: () => overviewMiniCal && overviewMiniCal.refresh(),
    chipsWrapId: 'overviewStatusChipsSheet', chipDefs: overviewStatusChipDefs,
    getStatus: () => overviewStatusFilter, setStatus: setOverviewStatusFilter, defaultStatus: 'active',
    noteIds: ['overviewFilterNote'],
    savedViewsScope: 'overview', savedViewsWrapId: 'overviewSavedViewsWrap', saveViewBtnId: 'overviewSaveViewBtn',
  });
  createSearchToggleWidget({
    toggleBtnId: 'overviewSearchToggleBtn', wrapId: 'overviewSearchWrap', boxId: 'overviewSearchBox',
    setQuery: (v) => { overviewSearchQuery = v; }, rerender: renderOverviewTable,
    getStatus: () => overviewStatusFilter, setStatus: (v) => setOverviewStatusFilter(v), widenStatus: 'all',
    getYear: () => ticketYearFilter, setYear: setTicketYearFilter,
    getMonth: () => ticketMonthFilter, setMonth: setTicketMonthFilter,
    getDayFilter: () => overviewDayFilter, setDayFilter: (d) => { overviewDayFilter = d; },
  });

  async function loadTickets(silent){
    const list = document.getElementById('ticketList');
    if (!silent) list.innerHTML = '<div class="no-results">Se încarcă...</div>';
    const { data, error } = await supabaseClient
      .from('tickets')
      .select('*')
      .order('submitted_on', { ascending: false });

    if (error) {
      if (!silent) list.innerHTML = '<div class="no-results">Eroare la încărcarea tichetelor. Reîncercați.</div>';
      console.error(error);
      return;
    }
    allTickets = data;
    populateYearFilterSelect(silent);
    renderTickets();
    renderOverviewTable();
    renderOverviewCharts();
    renderPrioritySummary();
    handlePendingTicketUrlParam();
  }

  // The 4 cards at the top of "Prezentare generală" — deliberately
  // ignores whichever year is selected in the table below. These are
  // meant to answer "what needs attention right now," and an active
  // accident matters regardless of what year's archive someone
  // happens to be browsing at the time.
  function renderPrioritySummary(){
    // Duplicates excluded here too — a duplicate no longer archives
    // immediately (it stays open/visible like any other ticket until
    // its canonical resolves), so without this it would double-count
    // toward "what needs attention right now" alongside the real
    // ticket it's linked to.
    const active = allTickets.filter(t => !t.archived && t.status !== 'Terminat' && !isDuplicateTicket(t));
    const agingCount = active.filter(t => {
      if (!t.submitted_on) return false;
      const daysOpen = (Date.now() - parseTicketDate(t.submitted_on)) / (1000 * 60 * 60 * 24);
      return daysOpen > AGING_THRESHOLD_DAYS;
    }).length;
    const accidentCount = active.filter(t => t.type === 'Anunt accident').length;
    const funcCount = active.length - accidentCount;
    // Every resolved ticket, report written or not, archived or not
    // — deliberately NOT the "isFullyComplete" (has-report)
    // distinction used elsewhere for fading/vlasbogdan@'s dedicated
    // view; this card means "closed," full stop, matching the
    // overview table below now also including archived Terminat
    // tickets rather than hiding them. Duplicates excluded — they're
    // not a real, separately-resolved issue, just a second report of
    // one the canonical ticket already accounts for.
    const solvedCount = allTickets.filter(t => t.status === 'Terminat' && !isDuplicateTicket(t)).length;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };
    setText('prioActiveCount', active.length);
    setText('prioAgingCount', agingCount);
    setText('prioFuncCount', funcCount);
    setText('prioAccidentCount', accidentCount);
    setText('prioSolvedCount', solvedCount);
  }

  // If the admin panel was just opened fresh (e.g. tapping a push
  // notification when it wasn't already running), the target ticket
  // arrives as a URL param instead of a postMessage — this is that
  // path. Runs at most once per page load; the param is stripped from
  // the address bar afterward so a manual refresh doesn't re-trigger it.
  let pendingTicketUrlParamHandled = false;
  function handlePendingTicketUrlParam(){
    if (pendingTicketUrlParamHandled) return;
    pendingTicketUrlParamHandled = true;
    const ticketNum = new URLSearchParams(window.location.search).get('ticket');
    if (!ticketNum) return;
    const jumped = goToTicketByNumber(ticketNum);
    // goToTicket() (called by goToTicketByNumber) already routed to
    // whichever of the two Sesizări tabs actually holds this ticket
    // and updated currentAdminTab to match — read it back rather than
    // assuming a single "tickets" tab, which no longer exists.
    const landedTab = jumped ? currentAdminTab : 'overview';
    window.history.replaceState({ adminTab: landedTab }, '', window.location.pathname + '#' + landedTab);
  }

  /* ============================================================
     TICKET OVERVIEW TABLE — a compact, glanceable summary of every
     non-archived ticket. Purely read-only: editing still happens in
     the detailed cards further down the page, unchanged. Active
     tickets are listed first, resolved ones sink to the bottom.
     ============================================================ */
  // Tickets still active after this many days get flagged as aging —
  // easy to spot at a glance so nothing quietly falls through the
  // cracks. Adjust this single number if a different threshold makes
  // more sense later.
  const AGING_THRESHOLD_DAYS = 7;

  function renderOverviewTable(){
    const tbody = document.getElementById('overviewTableBody');
    const cardsWrap = document.getElementById('overviewCardsMobile');
    // Archived tickets are deliberately included here, same as the
    // Sesizări tab's own "Soluționate"/"Toate" filters now do (see
    // getFilteredTickets()) — unlike the public site, which never
    // sees archived tickets at all. Archiving only hides a solved
    // ticket from clutter, it doesn't erase it from this overview,
    // and a ticket's actual status (virtually always Terminat by the
    // time it's archived) still drives its green/done styling below
    // exactly as before.
    let visible = allTickets.filter(t => matchesSearch(t, overviewSearchQuery.trim().toLowerCase()) && matchesYear(t, ticketYearFilter) && matchesMonth(t, ticketMonthFilter));
    // Day-level narrowing on top of the shared year/month state — set
    // only via the desktop day-grid calendar (Sesizări's own or this
    // tab's, both write the same overviewDayFilter); stays null
    // forever on phone.
    if (overviewDayFilter !== null) {
      visible = visible.filter(t => {
        const d = parseTicketDate(t.submitted_on);
        return !isNaN(d.getTime()) && d.getDate() === overviewDayFilter;
      });
    }

    // Every account uses the same Overview logic. vlasbogdan@ only
    // gains one extra filter: solved tickets that still need a report.
    if (overviewStatusFilter === 'active') {
      visible = visible.filter(t => t.status !== 'Terminat');
    } else if (overviewStatusFilter === 'done') {
      visible = visible.filter(t => t.status === 'Terminat');
    } else if (isReportFocusedView() && overviewStatusFilter === 'awaiting_report') {
      visible = visible.filter(t => t.status === 'Terminat' && !t.resolution_note);
    }

    // Four of the five priority cards describe a subset of ACTIVE
    // tickets, so any of those first narrows to non-Terminat, then
    // applies whatever further narrowing that specific card represents.
    if (overviewCardFilter === 'solved') {
      visible = visible.filter(t => t.status === 'Terminat');
    } else if (overviewCardFilter) {
      visible = visible.filter(t => t.status !== 'Terminat');
      if (overviewCardFilter === 'aging') {
        visible = visible.filter(t => {
          if (!t.submitted_on) return false;
          const daysOpen = (Date.now() - parseTicketDate(t.submitted_on)) / (1000 * 60 * 60 * 24);
          return daysOpen > AGING_THRESHOLD_DAYS;
        });
      } else if (overviewCardFilter === 'functional') {
        visible = visible.filter(t => t.type !== 'Anunt accident');
      } else if (overviewCardFilter === 'accident') {
        visible = visible.filter(t => t.type === 'Anunt accident');
      }
    }

    if (visible.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="overview-empty">Nicio sesizare de afișat.</td></tr>';
      if (cardsWrap) cardsWrap.innerHTML = '<div class="overview-empty">Nicio sesizare de afișat.</div>';
      return;
    }

    const ordered = sortTicketsByNumber(visible);

    tbody.innerHTML = ordered.map(t => {
      const isDone = t.status === 'Terminat';
      // Fading (done-row) specifically means "truly finished, nothing
      // left to do" — a Terminat ticket still missing its report
      // isn't that yet, so it stays visually normal here even though
      // isDone itself (used below for the status pill, resolved date,
      // etc.) correctly still reflects the real stored status.
      const isFullyComplete = (currentUserRole === 'limited' || isReportFocusedView())
        ? isDone
        : (isDone && !!t.resolution_note);
      const isUrgent = t.type === 'Anunt accident';
      const isDuplicate = isDuplicateTicket(t);
      const canonicalTicket = getCanonicalTicket(t);
      const daysOpen = t.submitted_on ? (Date.now() - parseTicketDate(t.submitted_on)) / (1000 * 60 * 60 * 24) : 0;
      const isAging = !isDone && daysOpen > AGING_THRESHOLD_DAYS;
      const resolutionDays = (isDone && t.resolved_on && t.submitted_on)
        ? calendarDaysBetween(t.submitted_on, t.resolved_on)
        : null;
      return `
        <tr class="${isFullyComplete ? 'done-row' : ''} ${isUrgent && !isDone ? 'urgent-row' : ''} ${isDuplicate ? 'duplicate-row' : ''}">
          <td class="overview-ticket-num"><a href="#" class="ticket-link" data-ticket-id="${t.id}">${escapeHtml(t.ticket_number || '—')}</a></td>
          <td class="${isAging ? 'aging-date' : ''}" title="${isAging ? 'Deschis de peste ' + AGING_THRESHOLD_DAYS + ' zile' : ''}">${isAging ? '⚠ ' : ''}${fmtDateOnly(t.submitted_on)}</td>
          <td>${isUrgent ? 'Accident' : 'Defect'}</td>
          <td class="overview-name-cell" title="${escapeHtml(t.name || '')}">${escapeHtml(t.name || '—')}</td>
          <td>${escapeHtml(t.phone || '—')}</td>
          <td class="overview-address-cell">${escapeHtml(t.address || '—')}</td>
          <td><span class="status-pill ${isDone ? 'status-pill-done' : 'status-pill-active'}">${isDone ? 'Soluționat' : 'În curs'}</span></td>
          ${isDuplicate
            ? `<td><span class="duplicate-badge">Duplicat</span></td>
               <td>${canonicalTicket ? `<a href="#" class="ticket-link" data-ticket-id="${canonicalTicket.id}" title="Mergi la sesizarea originală">${escapeHtml(canonicalTicket.ticket_number || '—')}</a>` : '—'}</td>`
            : `<td>${isDone ? fmtDateOnly(t.resolved_on) : '—'}</td>
               <td>${resolutionDays !== null ? formatDurationDays(resolutionDays) : '—'}</td>`
          }
        </tr>
      `;
    }).join('');

    // Mobile/tablet card list — same data, deliberately different
    // layout: address leads (that's what determines whether a
    // technician needs to go there), ticket number/phone/date are
    // secondary, and the whole card is one large tap target rather
    // than a small text link.
    if (cardsWrap) {
      cardsWrap.innerHTML = ordered.map(t => {
        const isDone = t.status === 'Terminat';
        const isFullyComplete = (currentUserRole === 'limited' || isReportFocusedView())
          ? isDone
          : (isDone && !!t.resolution_note);
        const isUrgent = t.type === 'Anunt accident';
        const isDuplicate = isDuplicateTicket(t);
        const daysOpen = t.submitted_on ? (Date.now() - parseTicketDate(t.submitted_on)) / (1000 * 60 * 60 * 24) : 0;
        const isAging = !isDone && daysOpen > AGING_THRESHOLD_DAYS;
        return `
          <button type="button" class="ov-card ${isFullyComplete ? 'done' : ''} ${isUrgent && !isDone ? 'urgent' : ''} ${isDuplicate ? 'duplicate' : ''}" data-ticket-id="${t.id}">
            <div class="ov-card-top">
              <span class="status-bubble ${isDone ? 'done' : 'active'}"></span>
              <span class="ov-card-type">${isUrgent ? 'Accident' : 'Defect'}</span>
              <span class="ov-card-num">${escapeHtml(t.ticket_number || '—')}</span>
              ${isDuplicate ? `<span class="duplicate-badge">Duplicat</span>` : ''}
            </div>
            <div class="ov-card-address">${escapeHtml(t.address || '—')}</div>
            <div class="ov-card-meta">
              <span class="${isAging ? 'aging' : ''}">${isAging ? '⚠ ' : ''}${fmtDateOnly(t.submitted_on)}</span>
              <span>${escapeHtml(t.name || '—')} · ${escapeHtml(t.phone || '—')}</span>
            </div>
            ${isDuplicate
              ? (getCanonicalTicket(t)
                ? `<div class="ov-card-resolved duplicate-link-note ov-card-goto-original" data-canonical-id="${getCanonicalTicket(t).id}">Duplicat al ${escapeHtml(getCanonicalTicket(t).ticket_number || '—')} — Mergi la original</div>`
                : `<div class="ov-card-resolved duplicate-link-note">Duplicat al —</div>`)
              : isDone ? `<div class="ov-card-resolved">Soluționat: ${fmtDateOnly(t.resolved_on)}</div>` : ''
            }
          </button>
        `;
      }).join('');
    }
  }

  const overviewCardsMobileEl = document.getElementById('overviewCardsMobile');
  if (overviewCardsMobileEl) {
    overviewCardsMobileEl.addEventListener('click', (e) => {
      const gotoOriginal = e.target.closest('.ov-card-goto-original');
      if (gotoOriginal) {
        e.stopPropagation();
        goToTicket(gotoOriginal.dataset.canonicalId);
        return;
      }
      const card = e.target.closest('.ov-card');
      if (card) goToTicket(card.dataset.ticketId);
    });
  }

  // Clicking a ticket number in the overview table jumps straight to
  // that ticket's editable card on the "Sesizări" tab — switching the
  // ticket filter to "Toate" first (so the card is guaranteed to
  // actually be rendered regardless of which filter was previously
  // selected), then scrolling to and briefly highlighting it.
  let currentAdminTab = 'overview';
  let overviewReturnState = null;

  /* ============================================================
     AUTOREFRESH — deliberately event-driven, not a timer polling
     every N minutes. Two triggers:
       1. Switching between admin's own tabs (Prezentare generală /
          Sesizări / Proiecte curente) — someone else may have closed
          a ticket or added a project while this tab was open on a
          different view.
       2. Returning to this browser tab after it sat unfocused/hidden
          for 5+ minutes — long enough that the data on screen is
          reasonably likely to be stale, without refetching on every
          brief alt-tab.
     Both call the same silent refresh — "silent" meaning no loading
     spinner/flash, since this happens in the background rather than
     in response to someone explicitly asking to reload. Saving,
     archiving, editing, etc. already each call loadTickets() directly
     at their own point of success (see the individual handlers) —
     this section is only about the two additional triggers above,
     not a replacement for that existing behavior.
     ============================================================ */
  function refreshAllAdminData(){
    loadTickets(true);
    loadProjects();
    loadBacklogProjects();
    loadCalendarEvents();
    // These three also keep the home-page smart search answerable
    // across ERP/Programe lucrări/LPS without visiting those tabs first.
    loadEquipment();
    loadWorkOrders();
    loadInternalProjects();
  }

  function setHomeTabFilter(tabKey){
    if (tabKey === 'tickets') {
      editingTicketId = null;
      if (ticketsSearchWidget) ticketsSearchWidget.applyExternalQuery('');
      setTicketYearFilter('all');
      setTicketMonthFilter('all');
      overviewCardFilter = null;
      updateOverviewNarrowFilterUI();
      setOverviewStatusFilter('active');
      tabKey = 'overview';
    } else if (tabKey === 'projects') {
      if (projectsSearchWidget) projectsSearchWidget.applyExternalQuery('');
      setProjectYearFilter('all');
      setProjectsFilter('Ongoing');
    } else if (tabKey === 'backlog') {
      if (backlogSearchWidget) backlogSearchWidget.applyExternalQuery('');
      setBacklogFilter('Ongoing');
    } else if (tabKey === 'reports') {
      editingTicketId = null;
      if (ticketsSearchWidget) ticketsSearchWidget.applyExternalQuery('');
      setTicketYearFilter('all');
      setTicketMonthFilter('all');
      overviewCardFilter = null;
      updateOverviewNarrowFilterUI();
      setOverviewStatusFilter('awaiting_report');
      tabKey = 'overview';
    } else if (tabKey === 'lps') {
      if (!isReportFocusedView()) return;
      renderLpsWorkspace();
    } else if (tabKey === 'home') {
      tabKey = 'home';
    }
    openAdminTab(tabKey);
  }

  // Start-page nav buttons (see panel-home) — Sesizări goes straight
  // to the two split tabs (funcționale/accidente) rather than through
  // setHomeTabFilter('tickets'), which instead redirects to Overview's
  // own active-tickets view; the other three reuse setHomeTabFilter
  // for the same reset-then-navigate behavior the hamburger menu's
  // equivalent links already use.
  document.querySelectorAll('.ticket-type-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => openAdminTab(btn.dataset.tab));
  });

  const homeNavTicketsBtn = document.getElementById('homeNavTickets');
  if (homeNavTicketsBtn) {
    homeNavTicketsBtn.addEventListener('click', () => {
      // Lands on Overview now that Sesizări has a proper Overview
      // sub-view — matches the breadcrumb's own middle "Sesizări"
      // crumb (see renderBreadcrumb below), so both entry points into
      // Sesizări agree on where "Sesizări" itself actually means.
      // Lands on the tab's own default view (Active, current year/
      // month) rather than forcing "Toate"/every year/every month —
      // that used to be harmless, but now shows up as a permanent
      // "Filtru: Toate, toate lunile, toți anii" note (see
      // createFilterPopoverWidget) every single time, which reads as
      // her having deliberately broadened the filter when she just
      // clicked a nav button.
      editingTicketId = null;
      if (ticketsSearchWidget) ticketsSearchWidget.applyExternalQuery('');
      openAdminTab('overview');
    });
  }
  const homeNavProjectsBtn = document.getElementById('homeNavProjects');
  if (homeNavProjectsBtn) homeNavProjectsBtn.addEventListener('click', () => openAdminTab('projects-home'));
  const homeNavErpBtn = document.getElementById('homeNavErp');
  if (homeNavErpBtn) homeNavErpBtn.addEventListener('click', () => openAdminTab('erp-home'));
  const homeNavStatusBtn = document.getElementById('homeNavStatus');
  if (homeNavStatusBtn) homeNavStatusBtn.addEventListener('click', () => openAdminTab('status'));
  const homeNavDocsBtn = document.getElementById('homeNavDocs');
  if (homeNavDocsBtn) homeNavDocsBtn.addEventListener('click', () => openAdminTab('docs'));

  // Documentație's own sidebar — Home / Sesizări / Proiecte (dropdown
  // of its four sub-areas) / ERP, the same category-panel pattern as
  // the rest of the app. Each .docs-section carries data-docs-group
  // saying which sidebar item shows it; Proiecte's four sub-areas use
  // their own section id as the group key so each gets its own
  // dedicated destination instead of being lumped under one page.
  let docsActiveGroup = 'home';
  function applyDocsSectionVisibility(){
    document.querySelectorAll('.docs-section').forEach(sec => {
      sec.style.display = sec.dataset.docsGroup === docsActiveGroup ? '' : 'none';
    });
    const searchWrap = document.getElementById('docsHomeSearchWrap');
    if (searchWrap) searchWrap.style.display = docsActiveGroup === 'home' ? '' : 'none';
    document.querySelectorAll('.docs-toc-link').forEach(link => {
      const target = document.getElementById(link.dataset.docsTarget);
      link.style.display = (target && target.dataset.docsGroup === docsActiveGroup) ? '' : 'none';
    });
    const emptyEl = document.getElementById('docsSearchEmpty');
    if (emptyEl) emptyEl.style.display = 'none';
    const tocEl = document.getElementById('docsToc');
    if (tocEl) tocEl.style.display = '';
  }
  function setDocsGroup(group){
    docsActiveGroup = group;
    document.querySelectorAll('.docs-nav-group-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.docsGroup === group);
    });
    if (['docs-projects', 'docs-backlog', 'docs-lps', 'docs-workorders'].includes(group)) {
      const projectsToggle = document.querySelector('.docs-nav-toggle[data-docs-toggle="projects"]');
      const projectsSubgroup = document.querySelector('.docs-nav-subgroup[data-docs-subgroup="projects"]');
      if (projectsToggle) projectsToggle.classList.add('open');
      if (projectsSubgroup) projectsSubgroup.classList.add('open');
    }
    const docsSearchBoxEl = document.getElementById('docsSearchBox');
    if (docsSearchBoxEl) docsSearchBoxEl.value = '';
    applyDocsSectionVisibility();
    const docsBodyEl = document.querySelector('#panel-docs .docs-body');
    if (docsBodyEl) docsBodyEl.scrollTop = 0;
  }
  document.querySelectorAll('.docs-nav-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openAdminTab('docs');
      setDocsGroup(btn.dataset.docsGroup);
    });
  });
  const docsProjectsToggleBtn = document.querySelector('.docs-nav-toggle[data-docs-toggle="projects"]');
  if (docsProjectsToggleBtn) {
    docsProjectsToggleBtn.addEventListener('click', () => {
      docsProjectsToggleBtn.classList.toggle('open');
      const subgroup = document.querySelector('.docs-nav-subgroup[data-docs-subgroup="projects"]');
      if (subgroup) subgroup.classList.toggle('open');
    });
  }
  applyDocsSectionVisibility(); // initial state — docsActiveGroup starts at 'home'

  // Documentație's table of contents — scrolls within the panel rather
  // than using real #anchors, which would collide with the tab-restore
  // system's own use of the URL hash (see initialHashTab above).
  const docsToc = document.getElementById('docsToc');
  if (docsToc) {
    docsToc.addEventListener('click', (event) => {
      const btn = event.target.closest('.docs-toc-link');
      if (!btn) return;
      const target = document.getElementById(btn.dataset.docsTarget);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Documentație's search box — filters sections (and their matching
  // TOC entries) by plain text content, diacritic-insensitive via the
  // same normalizeRomanianText() the repair-sheet street-matching
  // already uses, so "sesizari" finds "sesizări" too. Searching looks
  // across every section regardless of which sidebar group is active;
  // clearing the query restores the normal group-scoped view.
  const docsSearchBox = document.getElementById('docsSearchBox');
  if (docsSearchBox) {
    docsSearchBox.addEventListener('input', () => {
      const query = normalizeRomanianText(docsSearchBox.value.trim());
      if (!query) { applyDocsSectionVisibility(); return; }
      let anyVisible = false;
      document.querySelectorAll('.docs-section').forEach(sec => {
        const matches = normalizeRomanianText(sec.textContent).includes(query);
        sec.style.display = matches ? '' : 'none';
        if (matches) anyVisible = true;
      });
      document.querySelectorAll('.docs-toc-link').forEach(link => {
        const target = document.getElementById(link.dataset.docsTarget);
        const targetVisible = !target || target.style.display !== 'none';
        link.style.display = targetVisible ? '' : 'none';
      });
      const emptyEl = document.getElementById('docsSearchEmpty');
      if (emptyEl) emptyEl.style.display = anyVisible ? 'none' : '';
      const tocEl = document.getElementById('docsToc');
      if (tocEl) tocEl.style.display = anyVisible ? '' : 'none';
    });
  }

  // Live clock + fully interactive calendar on the start page — click
  // a day to see/add/edit/delete events for it. Events persist in
  // Supabase (calendar_events table — see calendar_events_setup.sql)
  // so they survive across devices/browsers, same as tickets/projects.
  const HOME_CLOCK_MONTH_NAMES = ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'];
  const HOME_CLOCK_DAY_NAMES = ['duminică','luni','marți','miercuri','joi','vineri','sâmbătă'];

  let calendarEvents = [];
  const today0 = new Date();
  let calendarViewYear = today0.getFullYear();
  let calendarViewMonth = today0.getMonth();
  let selectedCalendarDate = null; // 'YYYY-MM-DD'

  function dateKey(d){
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ============================================================
     RECURRING EVENTS — whole-series only (no per-occurrence
     exceptions): a recurring row's own start_time is occurrence #1,
     and every later occurrence is computed virtually at render time
     from recurrence_freq/interval/days_of_week/end_type/end_date/
     count, never persisted as its own row. Editing or deleting the
     row therefore edits/deletes the entire series in one step —
     genuinely simpler for a small team, and what the "Appointment
     Recurrence"-style dialog itself defines (a pattern, not a list
     of individual dates).
     ============================================================ */
  function isoWeekday(d){ return d.getDay() === 0 ? 7 : d.getDay(); } // Monday=1..Sunday=7
  function mondayOfWeek(d){
    const wd = isoWeekday(d);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (wd - 1));
  }
  // Walks day-by-day from the series' own start date rather than a
  // closed-form formula per frequency — correct for irregular
  // patterns (weekly on several weekdays at once) without risking a
  // subtle off-by-one in per-frequency math, and cheap enough at
  // calendar-UI scale (bounded to 10 years ≈ 3660 iterations worst
  // case, and only ever called for the currently-viewed month/day).
  function getRecurrenceOccurrenceDates(event, rangeStart, rangeEnd){
    if (!event.recurrence_freq || !event.start_time) return [];
    const seriesStart = new Date(event.start_time);
    const cursor0 = new Date(seriesStart.getFullYear(), seriesStart.getMonth(), seriesStart.getDate());
    const hardStop = new Date(cursor0.getTime() + 10 * 365 * 86400000);
    const endDate = event.recurrence_end_type === 'date' && event.recurrence_end_date
      ? new Date(event.recurrence_end_date + 'T00:00:00')
      : null;
    const maxCount = event.recurrence_end_type === 'count' ? (event.recurrence_count || 0) : Infinity;
    const interval = Math.max(1, event.recurrence_interval || 1);
    const weeklyDays = event.recurrence_freq === 'weekly'
      ? (event.recurrence_days_of_week && event.recurrence_days_of_week.length ? event.recurrence_days_of_week : [isoWeekday(cursor0)])
      : null;
    const seriesWeekStart = event.recurrence_freq === 'weekly' ? mondayOfWeek(cursor0) : null;

    const results = [];
    let occurrenceCount = 0;
    let d = new Date(cursor0);
    while (d <= hardStop && d <= rangeEnd) {
      if (endDate && d > endDate) break;
      if (occurrenceCount >= maxCount) break;
      let matches = false;
      if (event.recurrence_freq === 'daily') {
        const diffDays = Math.round((d - cursor0) / 86400000);
        matches = diffDays % interval === 0;
      } else if (event.recurrence_freq === 'weekly') {
        if (weeklyDays.includes(isoWeekday(d))) {
          const weekStart = mondayOfWeek(d);
          const diffWeeks = Math.round((weekStart - seriesWeekStart) / (7 * 86400000));
          matches = diffWeeks >= 0 && diffWeeks % interval === 0;
        }
      } else if (event.recurrence_freq === 'monthly') {
        matches = d >= cursor0 && d.getDate() === cursor0.getDate()
          && ((d.getFullYear() - cursor0.getFullYear()) * 12 + (d.getMonth() - cursor0.getMonth())) % interval === 0;
      } else if (event.recurrence_freq === 'yearly') {
        matches = d >= cursor0 && d.getDate() === cursor0.getDate() && d.getMonth() === cursor0.getMonth()
          && (d.getFullYear() - cursor0.getFullYear()) % interval === 0;
      }
      if (matches) {
        occurrenceCount++;
        if (d >= rangeStart) results.push(new Date(d));
      }
      d = new Date(d.getTime() + 86400000);
    }
    return results;
  }
  // Builds a display-only virtual occurrence: same id/title/
  // description/location/reminder/attendees as the series row, with
  // start_time/end_time shifted onto the given occurrence date (same
  // time-of-day and duration as the series' own first occurrence).
  function buildOccurrenceEvent(event, occurrenceDate){
    const masterStart = new Date(event.start_time);
    const start = new Date(occurrenceDate.getFullYear(), occurrenceDate.getMonth(), occurrenceDate.getDate(), masterStart.getHours(), masterStart.getMinutes());
    let end = null;
    if (event.end_time) {
      const durationMs = new Date(event.end_time) - masterStart;
      end = new Date(start.getTime() + durationMs);
    }
    return { ...event, start_time: start.toISOString(), end_time: end ? end.toISOString() : null, is_recurring_occurrence: true };
  }
  function eventsOnDate(dateKeyStr){
    const [y, m, d] = dateKeyStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);
    const direct = calendarEvents.filter(e => e.start_time && !e.recurrence_freq && dateKey(new Date(e.start_time)) === dateKeyStr);
    const recurring = calendarEvents
      .filter(e => e.recurrence_freq && getRecurrenceOccurrenceDates(e, targetDate, targetDate).length > 0)
      .map(e => buildOccurrenceEvent(e, targetDate));
    return [...direct, ...recurring].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }

  async function loadCalendarEvents(){
    if (!document.getElementById('homeClockTime')) return;
    const { data, error } = await supabaseClient
      .from('calendar_events')
      .select('*')
      .order('start_time', { ascending: true });
    if (error) {
      console.error('loadCalendarEvents failed:', error);
      return;
    }
    calendarEvents = data || [];
    renderHomeMiniCal();
    renderHomeCalToday();
    renderTodoNotes();
    if (selectedCalendarDate) renderCalendarDayEvents();
  }

  /* ============================================================
     RECURRENCE PICKER — mirrors a classic "Appointment Recurrence"
     dialog (pattern + range), opened from the "🔁" button on the
     event form. pendingRecurrence holds the in-progress choice for
     whichever event is currently open in the form; null means "does
     not repeat". Committed into the event's own payload on Salvează,
     same as every other field in the form — there's no separate save
     step for the recurrence sheet itself.
     ============================================================ */
  let pendingRecurrence = null;
  const RECUR_INTERVAL_UNITS = {
    daily: (n) => n === 1 ? 'zi' : 'zile',
    weekly: (n) => n === 1 ? 'săptămână' : 'săptămâni',
    monthly: (n) => n === 1 ? 'lună' : 'luni',
    yearly: (n) => n === 1 ? 'an' : 'ani',
  };
  const RECUR_FREQ_LABELS = { daily: 'zilnic', weekly: 'săptămânal', monthly: 'lunar', yearly: 'anual' };
  const WEEKDAY_SHORT_NAMES = { 1: 'L', 2: 'Ma', 3: 'Mi', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };

  function describeRecurrence(r){
    if (!r) return '🔁 Nu se repetă';
    let desc = `🔁 Se repetă ${RECUR_FREQ_LABELS[r.recurrence_freq]}`;
    if ((r.recurrence_interval || 1) > 1) {
      desc = `🔁 La fiecare ${r.recurrence_interval} ${RECUR_INTERVAL_UNITS[r.recurrence_freq](r.recurrence_interval)}`;
    }
    if (r.recurrence_freq === 'weekly' && r.recurrence_days_of_week && r.recurrence_days_of_week.length) {
      desc += ' (' + r.recurrence_days_of_week.slice().sort().map(d => WEEKDAY_SHORT_NAMES[d]).join(', ') + ')';
    }
    return desc;
  }
  function updateCefRecurBtn(){
    const btn = document.getElementById('cefRecurBtn');
    if (!btn) return;
    btn.textContent = describeRecurrence(pendingRecurrence);
    btn.classList.toggle('active', !!pendingRecurrence);
  }

  function updateRecurIntervalUnit(){
    const freq = document.querySelector('input[name="recur-freq"]:checked').value;
    const n = Number(document.getElementById('recurInterval').value) || 1;
    document.getElementById('recurIntervalUnit').textContent = RECUR_INTERVAL_UNITS[freq](n);
    document.getElementById('recurWeekdaysRow').style.display = freq === 'weekly' ? '' : 'none';
  }
  document.querySelectorAll('input[name="recur-freq"]').forEach(r => r.addEventListener('change', updateRecurIntervalUnit));
  const recurIntervalInput = document.getElementById('recurInterval');
  if (recurIntervalInput) recurIntervalInput.addEventListener('input', updateRecurIntervalUnit);

  function openRecurrenceSheet(){
    const dateVal = document.getElementById('cef-date').value || dateKey(new Date());
    document.getElementById('recurStartDate').value = dateVal;
    const r = pendingRecurrence;
    const freq = (r && r.recurrence_freq) || 'weekly';
    document.querySelector(`input[name="recur-freq"][value="${freq}"]`).checked = true;
    document.getElementById('recurInterval').value = (r && r.recurrence_interval) || 1;
    document.querySelectorAll('#recurWeekdaysRow input[type="checkbox"]').forEach(cb => {
      cb.checked = !!(r && r.recurrence_days_of_week && r.recurrence_days_of_week.includes(Number(cb.value)));
    });
    // Default weekly selection, when opening fresh, to the event's own
    // weekday — matches the picture's own default of pre-checking the
    // appointment's day.
    if (!r) {
      const [y, m, d] = dateVal.split('-').map(Number);
      const wd = isoWeekday(new Date(y, m - 1, d));
      document.querySelectorAll('#recurWeekdaysRow input[type="checkbox"]').forEach(cb => {
        cb.checked = Number(cb.value) === wd;
      });
    }
    const endType = (r && r.recurrence_end_type) || 'date';
    document.querySelector(`input[name="recur-end"][value="${endType}"]`).checked = true;
    document.getElementById('recurEndDate').value = (r && r.recurrence_end_date)
      || (() => { const dt = new Date(dateVal + 'T00:00:00'); dt.setMonth(dt.getMonth() + 6); return dateKey(dt); })();
    document.getElementById('recurCount').value = (r && r.recurrence_count) || 10;
    updateRecurIntervalUnit();
    setSheetOpen('recurrenceSheet', true);
  }
  const cefRecurBtn = document.getElementById('cefRecurBtn');
  if (cefRecurBtn) cefRecurBtn.addEventListener('click', openRecurrenceSheet);
  document.querySelectorAll('[id^="recur"][id$="CloseBtn"], #recurCancelBtn').forEach(btn => {
    btn.addEventListener('click', () => setSheetOpen('recurrenceSheet', false));
  });
  const recurRemoveBtn = document.getElementById('recurRemoveBtn');
  if (recurRemoveBtn) recurRemoveBtn.addEventListener('click', () => {
    pendingRecurrence = null;
    updateCefRecurBtn();
    setSheetOpen('recurrenceSheet', false);
  });
  const recurOkBtn = document.getElementById('recurOkBtn');
  if (recurOkBtn) recurOkBtn.addEventListener('click', () => {
    const freq = document.querySelector('input[name="recur-freq"]:checked').value;
    const interval = Math.max(1, Number(document.getElementById('recurInterval').value) || 1);
    const daysOfWeek = freq === 'weekly'
      ? [...document.querySelectorAll('#recurWeekdaysRow input[type="checkbox"]:checked')].map(cb => Number(cb.value))
      : null;
    if (freq === 'weekly' && (!daysOfWeek || daysOfWeek.length === 0)) {
      alert('Alege cel puțin o zi a săptămânii.');
      return;
    }
    const endType = document.querySelector('input[name="recur-end"]:checked').value;
    pendingRecurrence = {
      recurrence_freq: freq,
      recurrence_interval: interval,
      recurrence_days_of_week: daysOfWeek,
      recurrence_end_type: endType,
      recurrence_end_date: endType === 'date' ? (document.getElementById('recurEndDate').value || null) : null,
      recurrence_count: endType === 'count' ? (Number(document.getElementById('recurCount').value) || 1) : null,
    };
    updateCefRecurBtn();
    setSheetOpen('recurrenceSheet', false);
  });

  function openCalendarEventForm(event, defaultDateKey){
    document.getElementById('calendarEventFormSheetTitle').textContent = event ? 'Editează eveniment' : 'Eveniment nou';
    document.getElementById('cef-id').value = event ? event.id : '';
    document.getElementById('cef-title').value = event ? event.title : '';
    document.getElementById('cef-allday').checked = event ? !!event.all_day : false;
    const start = event ? new Date(event.start_time) : null;
    const end = event && event.end_time ? new Date(event.end_time) : null;
    document.getElementById('cef-date').value = event ? dateKey(start) : (defaultDateKey || dateKey(new Date()));

    // Ora început: snap to the 15-min select when the existing value
    // lands exactly on the grid (or there's no event yet — default to
    // the next 15-min slot from now); otherwise fall back to the
    // precise input, pre-filled, so an odd existing time is never
    // silently rounded off when just reopening the form to edit
    // something else.
    const startPrecise = document.getElementById('cef-start-time');
    const startSelect = document.getElementById('cef-start-time-select');
    if (start) {
      const hhmm = pad2(start.getHours()) + ':' + pad2(start.getMinutes());
      startPrecise.value = hhmm;
      if (start.getMinutes() % 15 === 0) {
        startSelect.value = hhmm;
        setCefTimeMode('start', false);
      } else {
        setCefTimeMode('start', true);
      }
    } else {
      const now = new Date();
      let mins = Math.ceil(now.getMinutes() / 15) * 15;
      let hrs = now.getHours();
      if (mins === 60) { mins = 0; hrs = (hrs + 1) % 24; }
      const hhmm = pad2(hrs) + ':' + pad2(mins);
      startSelect.value = hhmm;
      startPrecise.value = hhmm;
      setCefTimeMode('start', false);
    }

    // Ora sfârșit: a relative duration (30 min by default) rather than
    // an absolute time — snapped to one of the offered durations when
    // the existing end_time matches one exactly, otherwise the
    // precise input.
    const endPrecise = document.getElementById('cef-end-time');
    const endDurationSelect = document.getElementById('cef-end-duration-select');
    if (end && start) {
      const hhmm = pad2(end.getHours()) + ':' + pad2(end.getMinutes());
      endPrecise.value = hhmm;
      const diffMin = Math.round((end - start) / 60000);
      if ([30, 60, 90, 120].includes(diffMin)) {
        endDurationSelect.value = String(diffMin);
        setCefTimeMode('end', false);
      } else {
        setCefTimeMode('end', true);
      }
    } else {
      endDurationSelect.value = '30';
      endPrecise.value = '';
      setCefTimeMode('end', false);
    }

    document.getElementById('cef-location').value = event ? (event.location || '') : '';
    document.getElementById('cef-description').value = event ? (event.description || '') : '';
    document.getElementById('cef-reminder').value = event && event.reminder_minutes_before ? String(event.reminder_minutes_before) : '';
    document.getElementById('cefDeleteBtn').style.display = event ? '' : 'none';

    const attendeesListEl = document.getElementById('cefAttendeesList');
    const currentAttendees = (event && Array.isArray(event.attendees)) ? event.attendees : [];
    attendeesListEl.innerHTML = allStaffEmails.length
      ? allStaffEmails.map(email => `<label class="cef-attendee-item"><input type="checkbox" value="${escapeHtml(email)}"${currentAttendees.includes(email) ? ' checked' : ''}> ${escapeHtml(email)}</label>`).join('')
      : '<span class="cef-attendees-empty">Lista de conturi nu s-a încărcat încă.</span>';

    pendingRecurrence = (event && event.recurrence_freq) ? {
      recurrence_freq: event.recurrence_freq,
      recurrence_interval: event.recurrence_interval || 1,
      recurrence_days_of_week: event.recurrence_days_of_week || null,
      recurrence_end_type: event.recurrence_end_type || 'never',
      recurrence_end_date: event.recurrence_end_date || null,
      recurrence_count: event.recurrence_count || null,
    } : null;
    updateCefRecurBtn();

    toggleCefTimeFields();
    setSheetOpen('calendarEventFormSheet', true);
  }

  function toggleCefTimeFields(){
    const allDay = document.getElementById('cef-allday').checked;
    document.getElementById('cef-start-time-field').style.display = allDay ? 'none' : '';
    document.getElementById('cef-end-time-field').style.display = allDay ? 'none' : '';
  }
  const cefAllDayCheckbox = document.getElementById('cef-allday');
  if (cefAllDayCheckbox) cefAllDayCheckbox.addEventListener('change', toggleCefTimeFields);

  const cefSaveBtn = document.getElementById('cefSaveBtn');
  if (cefSaveBtn) {
    cefSaveBtn.addEventListener('click', async () => {
      const id = document.getElementById('cef-id').value;
      const title = document.getElementById('cef-title').value.trim();
      if (!title) { document.getElementById('cef-title').focus(); return; }
      const allDay = document.getElementById('cef-allday').checked;
      const dateVal = document.getElementById('cef-date').value;
      if (!dateVal) { document.getElementById('cef-date').focus(); return; }
      const startTimeVal = getCefStartValue() || '00:00';
      const endTimeVal = getCefEndValue(dateVal, startTimeVal);
      const startISO = new Date(`${dateVal}T${allDay ? '00:00' : startTimeVal}`).toISOString();
      const endISO = (!allDay && endTimeVal) ? new Date(`${dateVal}T${endTimeVal}`).toISOString() : null;
      const reminderVal = document.getElementById('cef-reminder').value;
      const payload = {
        title,
        description: document.getElementById('cef-description').value.trim() || null,
        location: document.getElementById('cef-location').value.trim() || null,
        start_time: startISO,
        end_time: endISO,
        all_day: allDay,
        reminder_minutes_before: reminderVal ? Number(reminderVal) : null,
        reminder_sent_at: null,
        recurrence_freq: pendingRecurrence ? pendingRecurrence.recurrence_freq : null,
        recurrence_interval: pendingRecurrence ? pendingRecurrence.recurrence_interval : null,
        recurrence_days_of_week: pendingRecurrence ? pendingRecurrence.recurrence_days_of_week : null,
        recurrence_end_type: pendingRecurrence ? pendingRecurrence.recurrence_end_type : null,
        recurrence_end_date: pendingRecurrence ? pendingRecurrence.recurrence_end_date : null,
        recurrence_count: pendingRecurrence ? pendingRecurrence.recurrence_count : null,
        attendees: Array.from(document.querySelectorAll('#cefAttendeesList input:checked')).map(cb => cb.value) || null,
      };
      if (!payload.attendees.length) payload.attendees = null;
      cefSaveBtn.disabled = true;
      try {
        if (id) {
          const { error } = await supabaseClient.from('calendar_events').update(payload).eq('id', id);
          if (error) throw error;
        } else {
          payload.created_by = currentSessionEmail || null;
          const { error } = await supabaseClient.from('calendar_events').insert(payload);
          if (error) throw error;
        }
        await loadCalendarEvents();
        setSheetOpen('calendarEventFormSheet', false);
        if (selectedCalendarDate) openCalendarDay(dateKey(new Date(startISO)));
        showToast('Eveniment salvat.');
      } catch (err) {
        console.error('Salvarea evenimentului a eșuat:', err);
        alert('Salvarea evenimentului a eșuat. Încearcă din nou.');
      } finally {
        cefSaveBtn.disabled = false;
      }
    });
  }

  const cefDeleteBtn = document.getElementById('cefDeleteBtn');
  if (cefDeleteBtn) {
    cefDeleteBtn.addEventListener('click', async () => {
      const id = document.getElementById('cef-id').value;
      if (!id) return;
      if (!confirm('Ștergi acest eveniment?')) return;
      const { error } = await supabaseClient.from('calendar_events').delete().eq('id', id);
      if (error) { console.error('Ștergerea a eșuat:', error); alert('Ștergerea a eșuat.'); return; }
      await loadCalendarEvents();
      setSheetOpen('calendarEventFormSheet', false);
    });
  }

  // Sticky-notes to-do list (vlasbogdan@ only) — same browser-storage
  // approach as internalProjects/LPS just below: personal scratch
  // space, not shared operational data, so it never touches Supabase.
  const TODO_STORAGE_KEY = 'insta-grup-vlas-todo-v1';
  let todoNotes = [];
  function loadTodoNotes(){
    try {
      const saved = JSON.parse(localStorage.getItem(TODO_STORAGE_KEY) || '[]');
      todoNotes = Array.isArray(saved) ? saved : [];
    } catch (_) {
      todoNotes = [];
    }
  }
  function saveTodoNotes(){
    localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todoNotes));
  }
  // Today's calendar events double as to-do items — pulled live from
  // calendarEvents (see eventsOnDate()) rather than copied into
  // TODO_STORAGE_KEY, so there's exactly one source of truth and they
  // never drift out of sync with the calendar itself.
  // An event with no attendees is a team-wide item, shown to everyone
  // (the original behavior); one with attendees only shows up in the
  // to-do list of the people it's actually assigned to.
  function todaysLinkedCalendarEvents(){
    if (typeof calendarEvents === 'undefined' || typeof eventsOnDate !== 'function') return [];
    return eventsOnDate(dateKey(new Date())).filter(e => {
      return !Array.isArray(e.attendees) || e.attendees.length === 0 || e.attendees.includes(currentSessionEmail);
    });
  }
  function renderTodoNotes(){
    const list = document.getElementById('homeTodoList');
    const empty = document.getElementById('homeTodoEmpty');
    if (!list) return;
    const linkedEvents = todaysLinkedCalendarEvents();
    if (!todoNotes.length && !linkedEvents.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    const infoIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    const eventItemsHtml = linkedEvents.map(e => {
      const timeLabel = e.all_day ? 'Toată ziua' : pad2(new Date(e.start_time).getHours()) + ':' + pad2(new Date(e.start_time).getMinutes());
      return `
        <div class="home-todo-note-calendar" data-event-id="${escapeHtml(String(e.id))}">
          <span class="home-todo-note-calendar-badge">${infoIcon} Din calendar</span>
          <p class="home-todo-note-calendar-text">${escapeHtml(e.title || 'Eveniment')}</p>
          <span class="home-todo-note-calendar-time">Azi · ${escapeHtml(timeLabel)}</span>
        </div>
      `;
    }).join('');
    const noteItemsHtml = todoNotes.map((note, i) => `
      <div class="home-todo-note color-${(i % 4) + 1}" data-note-id="${escapeHtml(note.id)}">
        <textarea placeholder="Notează aici…">${escapeHtml(note.text || '')}</textarea>
        <button type="button" class="home-todo-note-delete" aria-label="Șterge notița">×</button>
      </div>
    `).join('');
    list.innerHTML = eventItemsHtml + noteItemsHtml;
    list.querySelectorAll('.home-todo-note-calendar').forEach(el => {
      el.addEventListener('click', () => {
        const ev = calendarEvents.find(e => String(e.id) === el.dataset.eventId);
        if (ev) openCalendarEventForm(ev, dateKey(new Date(ev.start_time)));
      });
    });
  }
  function addTodoNote(){
    const note = { id: 'todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), text: '' };
    todoNotes.unshift(note);
    saveTodoNotes();
    renderTodoNotes();
    const newTextarea = document.querySelector(`.home-todo-note[data-note-id="${note.id}"] textarea`);
    if (newTextarea) newTextarea.focus();
  }
  const homeTodoAddBtn = document.getElementById('homeTodoAddBtn');
  if (homeTodoAddBtn) homeTodoAddBtn.addEventListener('click', addTodoNote);
  const homeTodoList = document.getElementById('homeTodoList');
  if (homeTodoList) {
    // Debounced per-note save on typing, rather than saving on every
    // keystroke — same idea as any autosave field, just local instead
    // of a network request.
    let todoSaveTimer = null;
    homeTodoList.addEventListener('input', (event) => {
      const noteEl = event.target.closest('.home-todo-note');
      if (!noteEl) return;
      const note = todoNotes.find(n => n.id === noteEl.dataset.noteId);
      if (!note) return;
      note.text = event.target.value;
      clearTimeout(todoSaveTimer);
      todoSaveTimer = setTimeout(saveTodoNotes, 400);
    });
    homeTodoList.addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('.home-todo-note-delete');
      if (!deleteBtn) return;
      const noteEl = deleteBtn.closest('.home-todo-note');
      if (!noteEl) return;
      todoNotes = todoNotes.filter(n => n.id !== noteEl.dataset.noteId);
      saveTodoNotes();
      renderTodoNotes();
    });
  }
  if (document.getElementById('homeTodoList')) {
    loadTodoNotes();
    renderTodoNotes();
  }

/* ============================================================
     OVERVIEW CHARTS — ticket volume by month, and average time to
     resolution (overall + by ticket type). Chart instances are
     destroyed and recreated on every refresh rather than updated in
     place, since refreshes here are infrequent (only on load / after
     an edit) and this keeps the logic simple.

     The pie chart that used to live here (active vs. resolved counts)
     was dropped: once the priority cards existed, it was just
     re-showing the same "Active" number a second time on the same
     page in a weaker visual form — pie charts encode values in angle
     and area, which people read far less precisely than the plain
     number a card already shows. A ticket-volume-by-month chart earns
     its place instead, since it's the one piece of information
     nowhere else on this page shows: whether ticket volume is
     climbing, flat, or shrinking over time.
     ============================================================ */
  let ticketVolumeChartInstance = null;
  let resolutionTimeChartInstance = null;

  // Counts CALENDAR DAYS, inclusive — reported and resolved on the
  // same calendar date = 1 day, resolved the next calendar date = 2
  // days, and so on. Deliberately NOT an hour-precise 24h duration:
  // a ticket reported at 23:50 and resolved at 00:10 the next day is
  // barely 20 minutes of actual work, but should still read as "2
  // days" here since it spans two different calendar dates — this is
  // meant to answer "how many calendar days did this take," not "how
  // many hours elapsed."
  function calendarDaysBetween(submittedISO, resolvedISO){
    const submitted = parseTicketDate(submittedISO);
    const resolved = parseTicketDate(resolvedISO);
    const submittedDateOnly = new Date(submitted.getFullYear(), submitted.getMonth(), submitted.getDate());
    const resolvedDateOnly = new Date(resolved.getFullYear(), resolved.getMonth(), resolved.getDate());
    const diffDays = Math.round((resolvedDateOnly - submittedDateOnly) / (1000 * 60 * 60 * 24));
    return diffDays + 1;
  }

  function formatDays(days){
    if (!isFinite(days)) return '—';
    const rounded = Math.round(days * 10) / 10;
    return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + (rounded === 1 ? ' zi' : ' zile');
  }

  // Used specifically for the "Timp de soluționare" table column —
  // a whole calendar-day count (see calendarDaysBetween above), never
  // fractional, since a single ticket's own resolution time is always
  // a whole number of calendar days by definition. Deliberately
  // separate from formatDays() above, which allows fractional output
  // for an average across several tickets.
  function formatDurationDays(days){
    if (!isFinite(days) || days < 1) return '—';
    return days === 1 ? '1 zi' : days + ' zile';
  }

  function renderOverviewCharts(){
    // Charts intentionally include archived tickets too — they're
    // meant to reflect the full historical picture, not just what's
    // currently showing in the table (which defaults to hiding
    // archived tickets for day-to-day work). A ticket being archived
    // doesn't mean it stopped happening.
    const visible = allTickets.filter(t => matchesYear(t, ticketYearFilter) && matchesMonth(t, ticketMonthFilter) && !isDuplicateTicket(t));

    const MONTH_NAMES = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Noi','Dec'];
    // "Sesizări pe an" deliberately ignores the year filter above and
    // uses every ticket (including archived) regardless of year —
    // it's meant to show the full history across however many years
    // of data exist, not just whichever single year happens to be
    // selected in the dropdown. Months with zero tickets are skipped
    // entirely rather than shown as empty bars, so e.g. 2026 (if
    // that's when this system started being used) correctly starts
    // at whichever month actually has its first ticket, instead of
    // padding out several meaningless zero-bars before that.
    const volumeSource = allTickets.filter(t => !isDuplicateTicket(t));
    const monthCounts = {}; // 'YYYY-MM' -> count
    volumeSource.forEach(t => {
      if (!t.submitted_on) return;
      // The 2-digit-year correction that used to live inline here
      // (the "August appears twice" bug — see git history/older
      // comments if curious) now happens once, centrally, in
      // parseTicketDate() — every call site gets the fix instead of
      // just this chart.
      const d = parseTicketDate(t.submitted_on);
      if (isNaN(d.getTime())) {
        console.warn('Skipping ticket with unparseable submitted_on in chart:', t.ticket_number, t.submitted_on);
        return;
      }
      const year = d.getFullYear();
      const key = year + '-' + String(d.getMonth() + 1).padStart(2, '0');
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    });
    const sortedKeys = Object.keys(monthCounts).sort();
    const volumeLabels = sortedKeys.map(k => {
      const [y, m] = k.split('-');
      return MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + y.slice(2);
    });
    const volumeData = sortedKeys.map(k => monthCounts[k]);

    const volumeCanvas = document.getElementById('ticketVolumeChart');
    if (ticketVolumeChartInstance) ticketVolumeChartInstance.destroy();
    if (typeof Chart !== 'undefined' && volumeCanvas) {
      ticketVolumeChartInstance = new Chart(volumeCanvas, {
        type: 'bar',
        data: {
          labels: volumeLabels,
          datasets: [{
            data: volumeData,
            backgroundColor: '#D11F24',
            borderRadius: 3,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
            x: { ticks: { font: { size: 10 } } },
          },
        },
      });
    }

    // Average resolution time — overall stat, plus a bar chart
    // breaking it down by ticket type (functional vs. accident/urgent).
    const resolved = visible.filter(t => t.status === 'Terminat' && t.resolved_on && t.submitted_on);
    const daysFor = (t) => calendarDaysBetween(t.submitted_on, t.resolved_on);
    const avg = (arr) => arr.length ? arr.reduce((sum, t) => sum + daysFor(t), 0) / arr.length : NaN;

    const funcResolved = resolved.filter(t => t.type !== 'Anunt accident');
    const accResolved = resolved.filter(t => t.type === 'Anunt accident');
    const overallAvg = avg(resolved);

    const statEl = document.getElementById('avgResolutionStat');
    if (statEl) {
      statEl.textContent = resolved.length ? formatDays(overallAvg) + ' (medie)' : 'Fără date încă';
    }

    const barCanvas = document.getElementById('resolutionTimeChart');
    if (resolutionTimeChartInstance) resolutionTimeChartInstance.destroy();
    if (typeof Chart !== 'undefined' && barCanvas) {
      resolutionTimeChartInstance = new Chart(barCanvas, {
        type: 'bar',
        data: {
          labels: ['Defect', 'Accident'],
          datasets: [{
            data: [
              isFinite(avg(funcResolved)) ? Math.round(avg(funcResolved) * 10) / 10 : 0,
              isFinite(avg(accResolved)) ? Math.round(avg(accResolved) * 10) / 10 : 0,
            ],
            backgroundColor: ['#D11F24', '#B5502F'],
            borderRadius: 3,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'zile', font: { size: 10 } }, ticks: { font: { size: 10 } } },
            x: { ticks: { font: { size: 11 } } },
          },
        },
      });
    }
  }

  function renderTickets(){
    const list = document.getElementById('ticketList');
    const filtered = sortTicketsForDisplay(getFilteredTickets());
    document.getElementById('resultCount').textContent = filtered.length + ' din ' + allTickets.length + ' tichete';
    const resultCountMobile = document.getElementById('resultCountMobile');
    if (resultCountMobile) resultCountMobile.textContent = filtered.length + ' din ' + allTickets.length + ' tichete';
    const ticketFilterHintMobile = document.getElementById('ticketFilterHintMobile');
    if (ticketFilterHintMobile) {
      ticketFilterHintMobile.textContent = ticketYearFilter === 'all' && ticketMonthFilter === 'all'
        ? 'Folosește filtrele sau căutarea'
        : `Filtru: ${ticketYearFilter === 'all' ? 'toți anii' : ticketYearFilter}, ${ticketMonthFilter === 'all' ? 'toate lunile' : MONTH_FILTER_NAMES[Number(ticketMonthFilter) - 1]}`;
    }

    if (filtered.length === 0) {
      list.innerHTML = '<div class="no-results">Niciun tichet în această categorie.</div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach(t => {
      const isUrgent = t.type === 'Anunt accident';
      const isDone = t.status === 'Terminat';
      // Report-completion status isn't relevant to a limited-role
      // account (they can't act on it either way), so every Terminat
      // ticket fades uniformly for them — only 'full' accounts see
      // the awaiting-report distinction called out visually.
      const isFullyComplete = currentUserRole === 'limited' ? isDone : (isDone && !isAwaitingReport(t));
      const isArchived = !!t.archived;
      const isDuplicate = isDuplicateTicket(t);
      const canonicalTicket = getCanonicalTicket(t);
      const linkedDuplicates = getDuplicatesOf(t.id);
      const card = document.createElement('div');
      card.id = 'ticket-card-' + t.id;
      card.className = 'ticket-card' + (isUrgent && !isDone ? ' urgent' : '') + (isFullyComplete ? ' done' : '') + (isArchived ? ' archived' : '') + (isDuplicate ? ' duplicate' : '');
      const safeTicketNumber = escapeHtml(t.ticket_number || '—');
      const safeName = escapeHtml(t.name || '');
      const safePhone = escapeHtml(t.phone || '');
      const safeEmail = escapeHtml(t.email || '');
      const safeAddress = escapeHtml(t.address || '');
      const safeDescription = escapeHtml(t.description || '');
      const safeResolvedBy = escapeHtml(t.resolved_by || '');
      const resolvedDateParts = toDateTimeInputParts(t.resolved_on);
      const submittedDateParts = toDateTimeInputParts(t.submitted_on);
      const isEditing = (t.id === editingTicketId);
      card.innerHTML = `
        <div class="ticket-top">
          <div class="ticket-meta">
            <label class="ticket-select">
              <input type="checkbox" class="f-select" ${selectedIds.has(t.id) ? 'checked' : ''}>
            </label>
            <span class="ticket-num">${safeTicketNumber}</span>
            <span class="ticket-tag ${isUrgent ? 'urgent-tag' : ''}">${t.type === 'Anunt accident' ? 'Accident' : 'Defect'}</span>
            ${isArchived ? `<span class="archived-badge">Arhivat ${fmtDate(t.archived_at)}</span>` : ''}
            ${isDuplicate ? (canonicalTicket
              ? `<button type="button" class="duplicate-badge f-goto-original" title="Mergi la sesizarea originală ${escapeHtml(canonicalTicket.ticket_number || '')}">Duplicat al ${escapeHtml(canonicalTicket.ticket_number || '—')} — Mergi la original</button>`
              : `<span class="duplicate-badge">Duplicat al —</span>`) : ''}
          </div>
          <span class="ticket-date">Trimis: ${fmtDate(t.submitted_on)}</span>
        </div>
        ${overviewReturnState && overviewReturnState.ticketId === t.id ? '<div class="ticket-return-row"><button type="button" class="btn ticket-return-overview">← Înapoi la tabel</button></div>' : ''}
        <div class="ticket-body">
          ${isEditing ? `
          <div class="ctrl-field">
            <label>Nume reclamant</label>
            <input type="text" class="f-name" value="${safeName}" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
          </div>
          <div class="ctrl-field">
            <label>Telefon</label>
            <input type="text" class="f-phone" value="${safePhone}" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
          </div>
          <div class="ctrl-field">
            <label>Email</label>
            <input type="email" class="f-email" value="${safeEmail}" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
          </div>
          <div class="ctrl-field">
            <label>Adresă identificare loc defect</label>
            <input type="text" class="f-address" value="${safeAddress}" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
          </div>
          <div class="ctrl-field">
            <label>Data trimiterii</label>
            <input type="date" class="f-submitted-date" value="${submittedDateParts.date}" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
          </div>
          <div class="ctrl-field">
            <label>Descriere</label>
            <input type="text" class="f-description" value="${safeDescription}" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
          </div>
          ` : `
          <div><span class="k">Nume</span>${safeName || '—'}</div>
          <div><span class="k">Telefon</span>${safePhone || '—'}</div>
          <div><span class="k">Email</span>${safeEmail || '—'}</div>
          <div><span class="k">Adresă</span>${safeAddress || '—'}</div>
          ${t.description ? `<div><span class="k">Descriere</span>${safeDescription}</div>` : ''}
          `}
          ${t.resolved_on ? `<div class="full"><span class="k">Soluționat</span>${fmtDate(t.resolved_on)}</div>` : ''}
          ${linkedDuplicates.length ? `<div class="duplicate-link-note full">🔗 ${linkedDuplicates.length === 1 ? 'Duplicat legat' : linkedDuplicates.length + ' duplicate legate'}: ${linkedDuplicates.map(d => escapeHtml(d.ticket_number || '—')).join(', ')}</div>` : ''}
        </div>
        <div class="ticket-controls">
          ${(isDone && !isEditing) ? `
          <div class="ctrl-field stare-field">
            <label>Stare</label>
            <div class="resnote-readonly">Soluționat</div>
          </div>
          <div class="ctrl-field resolver-field">
            <label>Soluționat de</label>
            <div class="resnote-readonly">${safeResolvedBy || '—'}</div>
          </div>
          <div class="ctrl-field resnote-field">
            <label>Ce s-a făcut</label>
            <div class="resnote-readonly">${escapeHtml(t.resolution_note || '—')}</div>
          </div>
          <div class="ctrl-field resolved-date-field">
            <label>Data soluționării</label>
            <div class="resnote-readonly">${resolvedDateParts.date ? escapeHtml(resolvedDateParts.date) : '—'}</div>
          </div>
          ` : `
          <div class="ctrl-field stare-field">
            <label>Stare</label>
            <select class="f-status" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
              <option value="Ongoing" ${t.status === 'Ongoing' ? 'selected' : ''}>Activ</option>
              <option value="Terminat" ${t.status === 'Terminat' ? 'selected' : ''}>Soluționat</option>
            </select>
          </div>
          <div class="ctrl-field resolver-field">
            <label>Soluționat de</label>
            <input type="text" class="f-resolver" placeholder="Nume angajat" value="${safeResolvedBy}" ${(isArchived || isDuplicate) ? 'disabled' : ''}>
          </div>
          ${t.resolution_note ? `
          <div class="ctrl-field resnote-field">
            <label>Ce s-a făcut</label>
            <div class="resnote-readonly">${escapeHtml(t.resolution_note)}</div>
          </div>
          ` : ''}
          <div class="ctrl-field resolved-date-field">
            <label>Data soluționării</label>
            <input type="date" class="f-resolved-date" value="${resolvedDateParts.date}" ${(isArchived || isDuplicate || t.status !== 'Terminat') ? 'disabled' : ''}>
          </div>
          `}
          ${isDuplicate
            ? `<button type="button" class="btn f-unduplicate">Anulează duplicat</button>`
            : isArchived
              ? `<button class="btn f-restore">Dezarhivează</button>`
              : (isDone && !isEditing)
                ? `<div class="resnote-readonly">Pentru modificări, selectează tichetul și apasă Editează.</div>`
                : `<button class="btn btn-primary f-save">Salvează<span class="save-status">✓ Salvat</span></button>
                   ${isEditing ? `<button type="button" class="btn f-cancel-edit">Anulează</button>` : ''}`
          }
          ${(!isDuplicate && !isArchived) ? `<button type="button" class="btn f-mark-duplicate">Leagă duplicate</button>` : ''}
        </div>
      `;

      const checkbox = card.querySelector('.f-select');
      const returnOverviewBtn = card.querySelector('.ticket-return-overview');
      if (returnOverviewBtn) {
        returnOverviewBtn.addEventListener('click', returnToOverviewTable);
      }
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedIds.add(t.id);
        else selectedIds.delete(t.id);
        updateArchiveBar();
        // Browser quirk (desktop-width specifically, confirmed via
        // screenshots — works instantly at mobile widths): the
        // archive bar's opacity transition sometimes doesn't
        // repaint correctly while the checkbox that triggered it
        // still holds focus, and only actually appears once
        // something else forces a reflow — clicking elsewhere on the
        // page fixes it manually. Blurring immediately here forces
        // that same reflow automatically, instead of requiring the
        // extra click every time.
        checkbox.blur();
      });

      // Resolution date/time only ever gets saved when actually
      // marking the ticket Terminat (see the save handler above) —
      // disabled here the rest of the time so that's visible upfront
      // rather than something to discover after the fact.
      const statusSelect = card.querySelector('.f-status');
      if (statusSelect && !isArchived && !isDuplicate) {
        statusSelect.addEventListener('change', () => {
          const nowTerminat = statusSelect.value === 'Terminat';
          card.querySelector('.f-resolved-date').disabled = !nowTerminat;
        });
      }

      const unduplicateBtn = card.querySelector('.f-unduplicate');
      if (unduplicateBtn) {
        unduplicateBtn.addEventListener('click', () => unmarkDuplicate(t.id));
      }

      const markDuplicateBtn = card.querySelector('.f-mark-duplicate');
      if (markDuplicateBtn) {
        markDuplicateBtn.addEventListener('click', () => markAsDuplicate(t.id));
      }

      // Only shown once "Editează" has actually unlocked the contact-
      // info fields (see the isEditing branch above) -- discards
      // whatever's been typed since, instead of the only way out being
      // to save it. selectedIds isn't touched: the checkbox stays
      // exactly as the person left it, same as a successful save does.
      const cancelEditBtn = card.querySelector('.f-cancel-edit');
      if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => {
          if (editingTicketId === t.id) editingTicketId = null;
          renderTickets();
        });
      }

      const gotoOriginalBtn = card.querySelector('.f-goto-original');
      if (gotoOriginalBtn && canonicalTicket) {
        gotoOriginalBtn.addEventListener('click', () => goToTicket(canonicalTicket.id));
      }

      const restoreBtn = card.querySelector('.f-restore');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
          restoreBtn.disabled = true;
          const { error } = await supabaseClient
            .from('tickets')
            .update({ archived: false, archived_at: null })
            .eq('id', t.id);
          restoreBtn.disabled = false;
          if (error) {
            console.error(error);
            alert('Eroare la dezarhivare. Încercați din nou.');
            return;
          }
          loadTickets();
        });
      }

      const saveBtn = card.querySelector('.f-save');
      if (saveBtn) {
        const saveStatus = card.querySelector('.save-status');
        saveBtn.addEventListener('click', async () => {
          const newStatus = card.querySelector('.f-status').value;

          // The resolution date/time only matters — and should only
          // ever get touched — when the ticket is actually being
          // marked Terminat. Previously this ran unconditionally,
          // meaning leaving the fields blank while just editing name/
          // phone/etc on a still-Ongoing ticket would silently stamp
          // it with the current time anyway. Left as undefined here,
          // it's simply omitted from the payload below, so the
          // column isn't touched at all for a ticket staying Ongoing.
          // Editable specifically so a mistyped year (someone typing
          // "26" instead of "2026" when the ticket was first logged)
          // can actually be corrected here rather than living wrong
          // forever — previously "Trimis la" was pure display text
          // with no way to fix it. Only recomputed when the date
          // field's value actually changed from what it loaded with;
          // an unrelated edit (fixing a phone number, say) shouldn't
          // silently reset the time-of-day portion of submitted_on
          // just because this field re-rendered alongside it.
          // Computed before the resolved-date check below, since that
          // check needs to compare against this (possibly just-
          // corrected) value, not the stale original.
          let submittedDateVal = isEditing ? card.querySelector('.f-submitted-date').value : null;
          if (isEditing && submittedDateVal) {
            const normalized = normalizeYearInDateValue(submittedDateVal);
            if (normalized !== submittedDateVal) {
              submittedDateVal = normalized;
              card.querySelector('.f-submitted-date').value = normalized;
              showToast(`Anul din data trimiterii a fost corectat automat la ${normalized.slice(0, 4)}.`);
            }
          }
          if (isEditing && !submittedDateVal) {
            alert('Data trimiterii nu poate fi golită.');
            return;
          }
          if (isEditing && hasSuspiciousYear(submittedDateVal)) {
            alert('Anul din data trimiterii pare greșit (verificați să fie scris complet, ex: 2026, nu 26).');
            return;
          }
          const submittedOnISO = (isEditing && submittedDateVal !== submittedDateParts.date)
            ? combineDateTimeToISO(submittedDateVal)
            : t.submitted_on;

          let resolvedOnISO;
          if (newStatus === 'Terminat') {
            let resolvedDateVal = card.querySelector('.f-resolved-date').value;
            const normalizedResolved = normalizeYearInDateValue(resolvedDateVal);
            if (normalizedResolved !== resolvedDateVal) {
              resolvedDateVal = normalizedResolved;
              card.querySelector('.f-resolved-date').value = normalizedResolved;
              showToast(`Anul din data soluționării a fost corectat automat la ${normalizedResolved.slice(0, 4)}.`);
            }
            if (hasSuspiciousYear(resolvedDateVal)) {
              alert('Anul din data soluționării pare greșit (verificați să fie scris complet, ex: 2026, nu 26).');
              return;
            }
            resolvedOnISO = combineDateTimeToISO(resolvedDateVal);

            // A resolution can't have happened before the issue was
            // even reported — most likely a typo in the date fields,
            // so this blocks the save rather than silently storing a
            // nonsensical timestamp. Compared as calendar dates only,
            // ignoring the hour entirely — the UI only ever shows a
            // date picker (no time input), but the underlying
            // timestamps still carry an implicit current-time-of-day
            // hour, which was incorrectly blocking same-day
            // resolutions whenever the ticket happened to be
            // submitted later in the day than the current time.
            const submittedDateOnly = submittedOnISO ? parseTicketDate(submittedOnISO).toDateString() : null;
            const resolvedDateOnly = new Date(resolvedOnISO).toDateString();
            if (submittedDateOnly && new Date(resolvedDateOnly) < new Date(submittedDateOnly)) {
              alert(`Data soluționării (${fmtDateOnly(resolvedOnISO)}) nu poate fi înainte de data sesizării (${fmtDateOnly(submittedOnISO)}).`);
              return;
            }
          }

          // These fields only render as inputs while this specific
          // card is in edit mode (triggered via "Editează" in the
          // floating bar) — otherwise they're plain read-only text,
          // so there's nothing to read and the existing values are
          // simply kept as-is.
          const nameVal = isEditing ? card.querySelector('.f-name').value.trim() : (t.name || '');
          const phoneVal = isEditing ? card.querySelector('.f-phone').value.trim() : (t.phone || '');
          const addressVal = isEditing ? card.querySelector('.f-address').value.trim() : (t.address || '');
          if (isEditing && (!nameVal || !phoneVal || !addressVal)) {
            alert('Numele, telefonul și adresa nu pot fi golite complet.');
            return;
          }

          // Only ask for confirmation when the status is actually
          // changing — a routine save (adding a note, adjusting the
          // resolution date) shouldn't be interrupted, but closing out
          // or reopening a ticket is consequential enough to
          // double-check, especially from a phone where a misclick is
          // easy.
          if (newStatus !== t.status) {
            const statusLabel = newStatus === 'Terminat' ? 'Soluționat' : 'Activ';
            if (!confirm(`Schimbați starea tichetului ${t.ticket_number || ''} în "${statusLabel}"?`)) {
              return;
            }
          }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Se salvează...';
          const resolver = card.querySelector('.f-resolver').value.trim();
          // "Ce s-a făcut" is read-only here now for every role — it's
          // filled in via the Excel repair-sheet import or the public
          // site, not typed by hand in this card — so .f-resnote never
          // actually exists in the DOM to read from. This just keeps
          // whatever the ticket's current value already is rather than
          // reading a field that isn't there, and avoids a null-
          // reference error doing so.
          const resnoteEl = card.querySelector('.f-resnote');
          const resNote = resnoteEl ? resnoteEl.value.trim() : (t.resolution_note || '');
          const emailVal = isEditing ? card.querySelector('.f-email').value.trim() : (t.email || '');
          const descriptionVal = isEditing ? card.querySelector('.f-description').value.trim() : (t.description || '');

          const payload = {
            status: newStatus,
            resolved_by: resolver || null,
            resolution_note: resNote || null,
            name: nameVal,
            phone: phoneVal,
            email: emailVal || null,
            address: addressVal,
            description: descriptionVal || null,
            submitted_on: submittedOnISO,
          };
          // Terminat → resolvedOnISO (computed above). Anything else
          // → explicitly cleared to null, not just left untouched —
          // an Ongoing ticket shouldn't retain a stale resolved
          // timestamp from an earlier accidental save, and this is
          // also what actually lets you reset it: switching to
          // Terminat, clearing the date fields, then back to Activ
          // only works if saving while Activ genuinely clears the
          // column rather than silently leaving the old value in
          // place underneath.
          payload.resolved_on = (newStatus === 'Terminat') ? resolvedOnISO : null;

          const { error } = await supabaseClient
            .from('tickets')
            .update(payload)
            .eq('id', t.id);

          saveBtn.disabled = false;
          saveBtn.innerHTML = 'Salvează<span class="save-status">✓ Salvat</span>';
          if (error) {
            console.error(error);
            alert('Eroare la salvare. Încercați din nou.');
            return;
          }
          if (editingTicketId === t.id) editingTicketId = null;

          // Fires an email to vlasbogdan@ the moment a ticket actually
          // ENTERS the "awaiting report" state — Terminat with no
          // resolution_note — not on every subsequent save of a
          // ticket already sitting in that state. Compares the state
          // just written against what it was before this save to
          // catch the real transition specifically.
          const wasAwaitingReport = t.status === 'Terminat' && !t.resolution_note;
          const isNowAwaitingReport = newStatus === 'Terminat' && !resNote;
          if (isNowAwaitingReport && !wasAwaitingReport) {
            sendNotification({
              type: 'report_needed',
              to: 'vlasbogdan@insta-grup.ro',
              ticket_number: t.ticket_number,
              address: addressVal,
              closed_by: resolver || '(nespecificat)',
              closed_on: fmtDate(payload.resolved_on),
            });
          }

          showToast(`Tichetul ${t.ticket_number || ''} a fost salvat.`);
          loadTickets();
        });
      }

      list.appendChild(card);
    });
  }

  /* ============================================================
     ARCHIVING — bulk-select tickets and move them out of the public
     status page + the main admin tabs, without ever deleting the
     underlying row. Meant for periodically tidying up old resolved
     tickets every couple of months. "Toate" already shows archived
     tickets too (see getFilteredTickets), so they stay reachable any
     time.
     ============================================================ */
  const archiveBar = document.getElementById('archiveBar');
  const selectionCount = document.getElementById('selectionCount');
  const archiveSelectedBtn = document.getElementById('archiveSelectedBtn');
  const clearSelectionBtn = document.getElementById('clearSelectionBtn');
  const editSelectedBtn = document.getElementById('editSelectedBtn');
  const markDuplicatesSelectedBtn = document.getElementById('markDuplicatesSelectedBtn');

  function updateArchiveBar(){
    selectionCount.textContent = selectedIds.size + ' selectate';
    archiveBar.classList.toggle('show', selectedIds.size > 0);
    archiveSelectedBtn.style.display = 'inline-flex';
    // Editing one ticket's own details at a time makes sense;
    // bulk-editing several at once doesn't, so this only shows when
    // exactly one is selected — with 2+, only Archive remains.
    editSelectedBtn.style.display = selectedIds.size === 1 ? 'inline-flex' : 'none';
    // Marking duplicates only makes sense with 2+ selected (one to
    // keep as the original, the rest pointing at it) — with a single
    // ticket selected, the per-card "Leagă duplicate" button already
    // covers that case. Below the 600px breakpoint, though, that
    // per-card button is hidden entirely (see its own CSS rule) to
    // keep the card clean, so this bar is a single ticket's only
    // route to marking a duplicate there — allow it from 1 selected.
    const minDuplicateSelection = window.innerWidth <= 600 ? 1 : 2;
    markDuplicatesSelectedBtn.style.display = selectedIds.size >= minDuplicateSelection ? 'inline-flex' : 'none';
  }

  editSelectedBtn.addEventListener('click', () => {
    const [onlyId] = selectedIds;
    editingTicketId = onlyId;
    selectedIds.clear();
    updateArchiveBar();
    renderTickets();
    const card = document.getElementById('ticket-card-' + onlyId);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  clearSelectionBtn.addEventListener('click', () => {
    selectedIds.clear();
    updateArchiveBar();
    renderTickets();
  });

  markDuplicatesSelectedBtn.addEventListener('click', async () => {
    // Visibility (updateArchiveBar) already enforces 2+ on desktop and
    // 1+ on mobile (where the per-card button is hidden below 600px)
    // -- this only guards against a stray click with nothing selected.
    if (selectedIds.size === 0) return;
    const picked = await openDuplicateLinkSheet(null);
    if (!picked) return;
    const { canonicalId, extraIds } = picked;
    const targetIds = Array.from(new Set([...selectedIds, ...extraIds])).filter(id => id !== canonicalId);
    if (targetIds.length === 0) {
      alert('Sesizarea aleasă ca originală este singura selectată — nu mai rămâne nimic de marcat ca duplicat.');
      return;
    }
    const canonicalTicket = allTickets.find(t => t.id === canonicalId);
    const dupNumbers = targetIds.map(id => allTickets.find(t => t.id === id)?.ticket_number).filter(Boolean).join(', ');
    if (!confirm(`Legi ${targetIds.length} sesizări (${dupNumbers}) ca duplicate ale ${canonicalTicket ? canonicalTicket.ticket_number : 'sesizării alese'}? Rămân vizibile pe site, doar marcate cu mov în panou.`)) {
      return;
    }
    markDuplicatesSelectedBtn.disabled = true;
    const { error } = await AppDataServices.tickets.markDuplicates(supabaseClient, canonicalId, targetIds);
    markDuplicatesSelectedBtn.disabled = false;

    if (error) {
      console.error(error);
      alert('Eroare la marcarea ca duplicate. Încercați din nou.');
      return;
    }
    showToast(`${targetIds.length} sesizări au fost marcate ca duplicate ale ${canonicalTicket ? canonicalTicket.ticket_number : 'sesizării alese'}.`);
    selectedIds.clear();
    updateArchiveBar();
    loadTickets();
  });

  archiveSelectedBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    // Archiving only part of a duplicate group would split it: the
    // canonical (or some of its duplicates) stays in the active list
    // while the rest disappears into the archive, even though they're
    // all still the same underlying issue. Whenever any member of a
    // group is selected, pull in the rest of that same group too --
    // the canonical plus every one of its duplicates -- so the whole
    // group always archives (or stays active) together.
    const idsToArchive = new Set(selectedIds);
    selectedIds.forEach(id => {
      const t = allTickets.find(x => x.id === id);
      if (!t) return;
      if (t.duplicate_of) {
        idsToArchive.add(t.duplicate_of);
        getDuplicatesOf(t.duplicate_of).forEach(d => idsToArchive.add(d.id));
      } else {
        getDuplicatesOf(t.id).forEach(d => idsToArchive.add(d.id));
      }
    });
    const addedCount = idsToArchive.size - selectedIds.size;
    const confirmMsg = addedCount > 0
      ? `Arhivați ${idsToArchive.size} tichete? (${selectedIds.size} selectate + ${addedCount} incluse automat ca să nu se rupă un grup de duplicate.) Nu vor mai apărea pe pagina publică de sesizări, dar rămân salvate și pot fi restaurate oricând.`
      : `Arhivați ${selectedIds.size} tichete? Nu vor mai apărea pe pagina publică de sesizări, dar rămân salvate și pot fi restaurate oricând.`;
    if (!confirm(confirmMsg)) {
      return;
    }
    archiveSelectedBtn.disabled = true;
    const { error } = await supabaseClient
      .from('tickets')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .in('id', Array.from(idsToArchive));
    archiveSelectedBtn.disabled = false;

    if (error) {
      console.error(error);
      alert('Eroare la arhivare. Încercați din nou.');
      return;
    }
    selectedIds.clear();
    updateArchiveBar();
    loadTickets();
  });
  /* ============================================================
     ADMIN TABS — switch between "Sesizări" and "Proiecte curente"
     within the same authenticated dashboard (no second login needed).
     ============================================================ */
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => openAdminTab(tab.dataset.tab));
  });

  /* ============================================================
     RAIL — category switching (which .category-panel-section shows).
     The category panel itself always stays open (no collapse).
     ============================================================ */
  document.querySelectorAll('.rail-item[data-category]').forEach(item => {
    item.addEventListener('click', () => {
      const category = item.dataset.category;
      if (category === 'home') return; // handled by its own .admin-tab click (data-tab="home")
      setActiveCategory(category);
      const currentTabKey = document.querySelector('.admin-tab.active')?.dataset.tab;
      // Only jump to the category's default tab if we're not already
      // showing something that belongs to this category — clicking
      // "Sesizări" while already on Defecte shouldn't bounce back to
      // Prezentare generală.
      if (TAB_CATEGORY[currentTabKey] !== category) {
        openAdminTab(CATEGORY_DEFAULT_TAB[category]);
      }
    });
  });

  /* ============================================================
     SIDEBAR — account bubble opens a small popup with the signed-in
     email and the logout action, instead of a bare logout icon.
     ============================================================ */
  const sidebarAccountBtn = document.getElementById('sidebarAccountBtn');
  const sidebarAccountMenu = document.getElementById('sidebarAccountMenu');
  const sidebarAccountMenuEmail = document.getElementById('sidebarAccountMenuEmail');
  function closeSidebarAccountMenu(){
    if (!sidebarAccountMenu || !sidebarAccountBtn) return;
    sidebarAccountMenu.classList.remove('open');
    sidebarAccountBtn.setAttribute('aria-expanded', 'false');
  }
  if (sidebarAccountBtn && sidebarAccountMenu) {
    sidebarAccountBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !sidebarAccountMenu.classList.contains('open');
      if (opening && sidebarAccountMenuEmail && userTag) sidebarAccountMenuEmail.textContent = userTag.textContent;
      sidebarAccountMenu.classList.toggle('open', opening);
      sidebarAccountBtn.setAttribute('aria-expanded', String(opening));
    });
    document.addEventListener('click', (e) => {
      if (!sidebarAccountMenu.contains(e.target) && !sidebarAccountBtn.contains(e.target)) closeSidebarAccountMenu();
    });
  }

  document.querySelectorAll('.header-tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      openAdminTab(tab.dataset.tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Swaps the logo for the compact tab bar once the real tab bar has
  // scrolled out of view above the viewport — restores the logo once
  // it's back in view.
  const adminTabsBar = document.querySelector('.admin-tabs');
  const headerEl = document.querySelector('header');
  if (adminTabsBar && headerEl && 'IntersectionObserver' in window) {
    const headerTabsObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        headerEl.classList.toggle('scrolled', !entry.isIntersecting && entry.boundingClientRect.top < 0);
      });
    }, { threshold: 0 });
    headerTabsObserver.observe(adminTabsBar);
  }

  // Priority summary cards — each one filters the Overview table
  // in place to exactly what the card is describing, rather than
  // navigating away to the Sesizări tab. Deliberately does NOT touch
  // agingOnlyFilter/typeOnlyFilter (the Sesizări tab's own filter
  // state) or switch tabs at all — clicking a ticket number from the
  // filtered table still takes you to Sesizări as normal, but since
  // this filter lives in its own separate state, using the browser's
  // back button to return leaves it exactly as it was.
  function applyOverviewCardFilter(filterKey){
    overviewCardFilter = filterKey;
    updateOverviewNarrowFilterUI();
    renderOverviewTable();
  }

  function updateOverviewNarrowFilterUI(){
    const wrap = document.getElementById('overviewNarrowFilter');
    const label = document.getElementById('overviewNarrowFilterLabel');
    if (!wrap || !label) return;
    const labels = {
      active: 'Filtru activ: doar sesizări active',
      aging: 'Filtru activ: doar sesizări deschise de peste ' + AGING_THRESHOLD_DAYS + ' zile',
      functional: 'Filtru activ: doar sesizări cu defect',
      accident: 'Filtru activ: doar accidente',
      solved: 'Filtru activ: doar sesizări soluționate',
    };
    label.textContent = overviewCardFilter ? labels[overviewCardFilter] : '';
    wrap.classList.toggle('show', !!overviewCardFilter);
  }

  function clearOverviewCardFilter(){
    overviewCardFilter = null;
    updateOverviewNarrowFilterUI();
    renderOverviewTable();
  }
  const clearOverviewNarrowFilterBtn = document.getElementById('clearOverviewNarrowFilterBtn');
  if (clearOverviewNarrowFilterBtn) clearOverviewNarrowFilterBtn.addEventListener('click', clearOverviewCardFilter);

  const prioActiveCard = document.getElementById('prioActiveCard');
  if (prioActiveCard) prioActiveCard.addEventListener('click', () => applyOverviewCardFilter('active'));

  const prioAgingCard = document.getElementById('prioAgingCard');
  if (prioAgingCard) prioAgingCard.addEventListener('click', () => applyOverviewCardFilter('aging'));

  const prioFuncCard = document.getElementById('prioFuncCard');
  if (prioFuncCard) prioFuncCard.addEventListener('click', () => applyOverviewCardFilter('functional'));

  const prioAccidentCard = document.getElementById('prioAccidentCard');
  if (prioAccidentCard) prioAccidentCard.addEventListener('click', () => applyOverviewCardFilter('accident'));

  const prioSolvedCard = document.getElementById('prioSolvedCard');
  if (prioSolvedCard) prioSolvedCard.addEventListener('click', () => applyOverviewCardFilter('solved'));


  /* ============================================================
     ADD TICKET MANUALLY — lets an admin log a report that came in
     some other way (phone call, in person) with the same fields the
     public form collects, plus a fully editable submission date/time
     (defaults to blank; "Astăzi" fills in the current moment) so the
     record reflects when the issue was actually reported, not just
     whenever it got typed into the system.

     Reuses create_ticket — the same RPC the public raportare.html
     form calls — so ticket-number generation stays centralized in
     one place rather than being duplicated/guessed at here. That RPC
     doesn't accept a custom submission date (it always stamps "now"),
     so a lightweight follow-up UPDATE overwrites submitted_on
     immediately after, only when the admin picked a specific one.
     ============================================================ */
  const ticketAddForm = document.getElementById('ticketAddForm');

  function openTicketAddForm(){
    // The form's one DOM node is shared between Overview and Sesizări
    // (same "+" icon, same fields) — rather than switching the admin
    // to Overview just to show it, relocate the node into whichever
    // panel is currently visible so the form opens right where the
    // person already is. "ticketAddFormHome" marks its original spot
    // in Overview so it can move back there rather than drifting to
    // wherever it was last opened from.
    if (panelIdForTab(currentAdminTab) === 'tickets') {
      const ticketsPanel = document.getElementById('panel-tickets');
      if (ticketAddForm.parentElement !== ticketsPanel) {
        ticketsPanel.insertBefore(ticketAddForm, ticketsPanel.firstChild);
      }
    } else {
      const homeAnchor = document.getElementById('ticketAddFormHome');
      if (ticketAddForm.previousElementSibling !== homeAnchor) {
        homeAnchor.parentElement.insertBefore(ticketAddForm, homeAnchor.nextSibling);
      }
    }
    document.getElementById('tf-type').value = 'Sesizare functionala';
    document.getElementById('tf-date').value = '';
    document.getElementById('tf-resolved-date').value = '';
    document.getElementById('tf-resolved-by').value = '';
    document.getElementById('tf-resolved-by-field').style.display = 'none';
    document.getElementById('tf-name').value = '';
    document.getElementById('tf-phone').value = '';
    document.getElementById('tf-email').value = '';
    document.getElementById('tf-address').value = '';
    document.getElementById('tf-description').value = '';
    ticketAddForm.style.display = 'block';
    ticketAddForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // "Soluționat de" only makes sense once a resolution date has
  // actually been entered — hidden the rest of the time so the form
  // doesn't ask for a name to attach to a resolution that hasn't
  // happened yet.
  document.getElementById('tf-resolved-date').addEventListener('input', () => {
    const hasDate = !!document.getElementById('tf-resolved-date').value;
    document.getElementById('tf-resolved-by-field').style.display = hasDate ? 'block' : 'none';
  });

  document.getElementById('addTicketBtn').addEventListener('click', openTicketAddForm);
  document.getElementById('addTicketBtnOverview').addEventListener('click', openTicketAddForm);
  document.getElementById('tfCancelBtn').addEventListener('click', () => {
    ticketAddForm.style.display = 'none';
  });

  document.getElementById('tfSaveBtn').addEventListener('click', async () => {
    const type = document.getElementById('tf-type').value;
    let dateVal = document.getElementById('tf-date').value;
    let resolvedDateVal = document.getElementById('tf-resolved-date').value;
    const normalizedDateVal = normalizeYearInDateValue(dateVal);
    const normalizedResolvedDateVal = normalizeYearInDateValue(resolvedDateVal);
    if (normalizedDateVal !== dateVal) {
      dateVal = normalizedDateVal;
      document.getElementById('tf-date').value = normalizedDateVal;
      showToast(`Anul din data trimiterii a fost corectat automat la ${normalizedDateVal.slice(0, 4)}.`);
    }
    if (normalizedResolvedDateVal !== resolvedDateVal) {
      resolvedDateVal = normalizedResolvedDateVal;
      document.getElementById('tf-resolved-date').value = normalizedResolvedDateVal;
      showToast(`Anul din data soluționării a fost corectat automat la ${normalizedResolvedDateVal.slice(0, 4)}.`);
    }
    const resolvedByVal = document.getElementById('tf-resolved-by').value.trim();
    const name = document.getElementById('tf-name').value.trim();
    const phone = document.getElementById('tf-phone').value.trim();
    const email = document.getElementById('tf-email').value.trim();
    const address = document.getElementById('tf-address').value.trim();
    const description = document.getElementById('tf-description').value.trim();

    if (!name || !phone || !address) {
      alert('Completați nume, telefon și adresă.');
      return;
    }

    // Guards against exactly the bug that caused mis-sorted/invisible
    // tickets elsewhere — see hasSuspiciousYear() near the top.
    if (hasSuspiciousYear(dateVal) || hasSuspiciousYear(resolvedDateVal)) {
      alert('Anul introdus într-una dintre date pare greșit (verificați să fie scris complet, ex: 2026, nu 26).');
      return;
    }

    const saveBtn = document.getElementById('tfSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Se salvează...';

    const { data: ticketNumber, error } = await supabaseClient.rpc('create_ticket', {
      p_type: type,
      p_name: name,
      p_phone: phone,
      p_email: email || null,
      p_address: address,
      p_description: description || null,
    });

    if (error) {
      console.error(error);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvează sesizarea';
      alert('Eroare la salvare. Încercați din nou.');
      return;
    }

    // Notify the rest of the team — same email + push notifications
    // the public form sends after its own successful submission, so
    // a ticket logged here doesn't silently go unnoticed by everyone
    // else. Runs after the save already succeeded (matching the
    // public form's own ordering), so a failed/unconfigured
    // notification never affects the ticket itself.
    //
    // Email always sends regardless of whether a resolution date was
    // given. Push notification is deliberately skipped when a
    // resolution date IS given — that field being filled in means
    // this ticket is a retroactive/historical record of work already
    // done (e.g. logging a phone call from weeks ago), not something
    // that just happened, so an "active ticket needs attention" push
    // alert would be misleading. Per explicit request, this
    // suppression is important — do not remove without re-confirming.
    const notifyPayload = {
      type: 'ticket',
      ticket_number: ticketNumber,
      ticket_type: type === 'Anunt accident' ? 'Accident / urgență' : 'Defect',
      name: name,
      phone: phone,
      email: email || '-',
      address: address,
      description: description || '-',
    };
    sendNotification(notifyPayload);
    if (!resolvedDateVal) {
      sendPushNotification(notifyPayload);
    }

    // Only bother with a follow-up UPDATE if the admin actually picked
    // a submission date and/or a resolution date — create_ticket's own
    // defaults (submitted_on = now, status = Ongoing) are already
    // correct otherwise, no follow-up needed. A resolution date being
    // set also marks the ticket Terminat — entering one implies the
    // work is already done, so leaving the ticket "active" alongside
    // an already-filled resolution date would be inconsistent
    // everywhere else this data shows up (Overview, resolution-time
    // stats, etc.).
    if (dateVal || resolvedDateVal) {
      const updatePayload = {};
      if (dateVal) updatePayload.submitted_on = combineDateTimeToISO(dateVal);
      if (resolvedDateVal) {
        updatePayload.resolved_on = combineDateTimeToISO(resolvedDateVal);
        updatePayload.status = 'Terminat';
        if (resolvedByVal) updatePayload.resolved_by = resolvedByVal;
      }
      const { error: dateError } = await supabaseClient
        .from('tickets')
        .update(updatePayload)
        .eq('ticket_number', ticketNumber);
      if (dateError) {
        console.error(dateError);
        // The ticket itself was already created successfully at this
        // point — only the custom date(s) failed to apply — so this
        // warns rather than treating it as a full failure.
        alert(`Sesizarea ${ticketNumber} a fost creată, dar data personalizată nu a putut fi salvată. Editați data direct pe tichet dacă e nevoie.`);
      }
    }

    // A ticket created here with a resolution date but no "Ce s-a
    // făcut" — this form has no such field at all — lands directly in
    // the "awaiting report" state the moment it's created, the same
    // state a normal ticket only reaches after being edited and
    // closed without a report. That existing state change already
    // notifies vlasbogdan@ elsewhere in this file (see the edit-save
    // handler above) — this is the equivalent trigger for tickets
    // that arrive in that state immediately, at creation, rather than
    // transitioning into it later. Without this, a retroactively-
    // logged, already-resolved ticket would silently need a report
    // forever with no one ever being told.
    if (resolvedDateVal) {
      sendNotification({
        type: 'report_needed',
        to: 'vlasbogdan@insta-grup.ro',
        ticket_number: ticketNumber,
        address: address,
        closed_by: resolvedByVal || '(nespecificat)',
        closed_on: fmtDate(combineDateTimeToISO(resolvedDateVal)),
      });
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Salvează sesizarea';
    ticketAddForm.style.display = 'none';
    showToast(`Sesizarea ${ticketNumber} a fost creată.`);
    loadTickets();
  });

  function openProjectForm(project){
    excelPreviewWrap.style.display = 'none';
    document.getElementById('pf-id').value = project ? project.id : '';
    document.getElementById('pf-title').value = project ? project.title : '';
    document.getElementById('pf-address').value = project ? project.address : '';
    document.getElementById('pf-start').value = project ? project.start_date : '';
    document.getElementById('pf-due').value = project ? project.due_date : '';
    document.getElementById('pf-notes').value = project ? (project.notes || '') : '';
    projectForm.style.display = 'block';
    projectForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  document.getElementById('addProjectBtn').addEventListener('click', () => openProjectForm(null));
  document.getElementById('pfCancelBtn').addEventListener('click', () => {
    projectForm.style.display = 'none';
  });

  document.getElementById('pfSaveBtn').addEventListener('click', async () => {
    const id = document.getElementById('pf-id').value;
    const title = document.getElementById('pf-title').value.trim();
    const address = document.getElementById('pf-address').value.trim();
    const start = document.getElementById('pf-start').value;
    const due = document.getElementById('pf-due').value;
    const notes = document.getElementById('pf-notes').value.trim();

    if (!title || !address || !start || !due) {
      alert('Completați tip lucrare, adresă, data început și data finalizare.');
      return;
    }
    if (new Date(due) < new Date(start)) {
      alert('Data de finalizare nu poate fi înainte de data de început.');
      return;
    }

    const payload = { title, address, start_date: start, due_date: due, notes: notes || null };
    const { error } = id
      ? await supabaseClient.from('current_projects').update(payload).eq('id', id)
      : await supabaseClient.from('current_projects').insert(payload);

    if (error) {
      console.error(error);
      alert('Eroare la salvare. Încercați din nou.');
      return;
    }
    projectForm.style.display = 'none';
    showToast(id ? 'Proiectul a fost actualizat.' : 'Proiectul a fost adăugat.');
    loadProjects();
  });

  /* ============================================================
     ISTORIC & NOTIȚE (entity_log) — infrastructură comună pentru
     Proiecte publice, Avarii rețele și elementele Look-ahead din
     LPS. Un singur tabel ține atât evenimentele automate (schimbări
     de stare) cât și notițele scrise de oameni, afișate împreună
     într-un cronologic — un fir de activitate, ca pe un ticket
     Plane/Linear, nu două liste separate.
     ============================================================ */
  let entityLogCurrent = { type: null, id: null, title: null };
  async function logEntityActivity(entityType, entityId, text){
    try {
      await supabaseClient.from('entity_log').insert({ entity_type: entityType, entity_id: entityId, kind: 'activity', text, user_email: currentSessionEmail || null });
    } catch (e) { /* best effort — never block the action it's describing */ }
  }
  async function renderEntityLog(){
    const listEl = document.getElementById('entityLogList');
    if (!listEl || !entityLogCurrent.id) return;
    const { data, error } = await supabaseClient.from('entity_log').select('*')
      .eq('entity_type', entityLogCurrent.type).eq('entity_id', entityLogCurrent.id)
      .order('created_at', { ascending: false }).limit(100);
    if (error) { listEl.innerHTML = '<p class="status-history-empty">Istoricul nu a putut fi încărcat.</p>'; return; }
    if (!data || data.length === 0) { listEl.innerHTML = '<p class="status-history-empty">Niciun eveniment încă.</p>'; return; }
    listEl.innerHTML = data.map(row => `
      <div class="entity-log-item ${row.kind}">
        <span class="entity-log-time">${formatLogTimeRO(row.created_at)}</span>
        <div>
          <div class="entity-log-text">${escapeHtml(row.text)}</div>
          ${row.user_email ? `<div class="entity-log-author">${escapeHtml(row.user_email)}</div>` : ''}
        </div>
      </div>
    `).join('');
  }
  async function openEntityLogSheet(entityType, entityId, title){
    entityLogCurrent = { type: entityType, id: entityId, title };
    const titleEl = document.getElementById('entityLogSheetTitle');
    if (titleEl) titleEl.textContent = `Istoric — ${title}`;
    const noteInput = document.getElementById('entityLogNoteInput');
    if (noteInput) noteInput.value = '';
    document.getElementById('entityLogList').innerHTML = '<p class="status-history-empty">Se încarcă…</p>';
    setSheetOpen('entityLogSheet', true);
    await renderEntityLog();
  }
  const entityLogAddBtn = document.getElementById('entityLogAddBtn');
  if (entityLogAddBtn) entityLogAddBtn.addEventListener('click', async () => {
    const input = document.getElementById('entityLogNoteInput');
    const text = input.value.trim();
    if (!text || !entityLogCurrent.id) return;
    entityLogAddBtn.disabled = true;
    const { error } = await supabaseClient.from('entity_log').insert({
      entity_type: entityLogCurrent.type, entity_id: entityLogCurrent.id, kind: 'note', text, user_email: currentSessionEmail || null,
    });
    entityLogAddBtn.disabled = false;
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
    input.value = '';
    renderEntityLog();
  });

  /* ============================================================
     JURNAL DE ACTIVITATE — vedere globală peste entity_log, pe
     toate categoriile. Se afișează în două locuri din aceleași
     date (auditLogEntries): tabul "Jurnal de activitate" din Stare
     sistem (doar categoriile de proiecte, cu dropdown de filtrare)
     și tabul omonim din ERP (split Proiecte / ERP, fără filtru).
     ============================================================ */
  const PROJECT_ENTITY_TYPES = ['project', 'backlog', 'lookahead'];
  const ERP_ENTITY_TYPES = ['echipament', 'masina', 'material'];
  const ENTITY_TYPE_LABEL = {
    project: 'Proiect public', backlog: 'Avarie rețea', lookahead: 'LPS Look-ahead',
    echipament: 'Echipament', masina: 'Mașină', material: 'Material',
  };
  let auditLogEntries = [];
  let auditLogLookaheadTitles = {};
  function auditLogEntityTitle(row){
    if (row.entity_type === 'project') {
      const p = (typeof allProjects !== 'undefined' ? allProjects : []).find(x => x.id === row.entity_id);
      return p ? p.title : 'Proiect șters';
    }
    if (row.entity_type === 'backlog') {
      const p = (typeof allBacklogProjects !== 'undefined' ? allBacklogProjects : []).find(x => x.id === row.entity_id);
      return p ? p.title : 'Avarie ștearsă';
    }
    if (row.entity_type === 'lookahead') return auditLogLookaheadTitles[row.entity_id] || 'Element șters';
    if (ERP_ENTITY_TYPES.includes(row.entity_type)) {
      const eq = (typeof allEquipment !== 'undefined' ? allEquipment : []).find(x => x.id === row.entity_id);
      return eq ? eq.name : 'Element șters';
    }
    return row.entity_type;
  }
  function entityLogRowHtml(row){
    return `
      <div class="entity-log-item ${row.kind}">
        <span class="entity-log-time">${formatLogTimeRO(row.created_at)}</span>
        <div>
          <div class="entity-log-text"><span class="audit-log-badge">${escapeHtml(ENTITY_TYPE_LABEL[row.entity_type] || row.entity_type)}</span> <strong>${escapeHtml(auditLogEntityTitle(row))}</strong> — ${escapeHtml(row.text)}</div>
          ${row.user_email ? `<div class="entity-log-author">${escapeHtml(row.user_email)}</div>` : ''}
        </div>
      </div>
    `;
  }
  function renderAuditLog(){
    const listEl = document.getElementById('auditLogList');
    if (!listEl) return;
    const filterSelect = document.getElementById('auditLogCategoryFilter');
    const filterVal = filterSelect ? filterSelect.value : 'all';
    const projectRows = auditLogEntries.filter(r => PROJECT_ENTITY_TYPES.includes(r.entity_type));
    const rows = filterVal === 'all' ? projectRows : projectRows.filter(r => r.entity_type === filterVal);
    if (!rows.length) { listEl.innerHTML = '<p class="status-history-empty">Niciun eveniment încă.</p>'; return; }
    listEl.innerHTML = rows.map(entityLogRowHtml).join('');
  }
  function renderErpAuditSections(){
    const projectsList = document.getElementById('erpAuditProjectsList');
    const erpList = document.getElementById('erpAuditErpList');
    if (!projectsList || !erpList) return;
    const projectRows = auditLogEntries.filter(r => PROJECT_ENTITY_TYPES.includes(r.entity_type));
    const erpRows = auditLogEntries.filter(r => ERP_ENTITY_TYPES.includes(r.entity_type));
    projectsList.innerHTML = projectRows.length ? projectRows.map(entityLogRowHtml).join('') : '<p class="status-history-empty">Niciun eveniment încă.</p>';
    erpList.innerHTML = erpRows.length ? erpRows.map(entityLogRowHtml).join('') : '<p class="status-history-empty">Niciun eveniment încă.</p>';
  }
  async function fetchAuditLogEntries(){
    const [{ data: logData, error: logError }, { data: laData }] = await Promise.all([
      supabaseClient.from('entity_log').select('*').order('created_at', { ascending: false }).limit(200),
      supabaseClient.from('lps_lookahead_items').select('id,title'),
    ]);
    auditLogLookaheadTitles = {};
    (laData || []).forEach(item => { auditLogLookaheadTitles[item.id] = item.title; });
    if (logError) { auditLogEntries = []; return false; }
    auditLogEntries = logData || [];
    return true;
  }
  async function loadAuditLog(){
    const listEl = document.getElementById('auditLogList');
    if (listEl) listEl.innerHTML = '<p class="status-history-empty">Se încarcă…</p>';
    const ok = await fetchAuditLogEntries();
    if (!ok) { if (listEl) listEl.innerHTML = '<p class="status-history-empty">Jurnalul nu a putut fi încărcat.</p>'; return; }
    renderAuditLog();
  }
  async function loadErpAuditLog(){
    const projectsList = document.getElementById('erpAuditProjectsList');
    const erpList = document.getElementById('erpAuditErpList');
    if (projectsList) projectsList.innerHTML = '<p class="status-history-empty">Se încarcă…</p>';
    if (erpList) erpList.innerHTML = '<p class="status-history-empty">Se încarcă…</p>';
    const ok = await fetchAuditLogEntries();
    if (!ok) {
      if (projectsList) projectsList.innerHTML = '<p class="status-history-empty">Jurnalul nu a putut fi încărcat.</p>';
      if (erpList) erpList.innerHTML = '<p class="status-history-empty">Jurnalul nu a putut fi încărcat.</p>';
      return;
    }
    renderErpAuditSections();
  }
  const auditLogCategoryFilter = document.getElementById('auditLogCategoryFilter');
  if (auditLogCategoryFilter) auditLogCategoryFilter.addEventListener('change', renderAuditLog);

  /* ============================================================
     LISTE DE VERIFICARE (sub-tasks) — un array JSON simplu
     ({text, done}) direct pe rândul proiectului/avariei/elementului
     Look-ahead, salvat integral la fiecare schimbare — suficient de
     simplu cât timp o singură persoană editează odată o listă.
     ============================================================ */
  let checklistCurrent = { table: null, id: null, items: [], onSaved: null };
  function renderChecklistItems(){
    const listEl = document.getElementById('checklistItems');
    if (!listEl) return;
    if (!checklistCurrent.items.length) {
      listEl.innerHTML = '<p class="status-history-empty">Nicio verificare adăugată încă.</p>';
    } else {
      listEl.innerHTML = checklistCurrent.items.map((item, i) => `
        <div class="checklist-item ${item.done ? 'done' : ''}">
          <input type="checkbox" class="checklist-item-check" data-index="${i}" ${item.done ? 'checked' : ''}>
          <span class="checklist-item-text">${escapeHtml(item.text)}</span>
          <button type="button" class="checklist-item-remove" data-index="${i}" aria-label="Șterge">×</button>
        </div>
      `).join('');
    }
    const titleEl = document.getElementById('checklistSheetTitle');
    if (titleEl) {
      const done = checklistCurrent.items.filter(i => i.done).length;
      titleEl.textContent = `Listă de verificare${checklistCurrent.items.length ? ` (${done}/${checklistCurrent.items.length})` : ''}`;
    }
  }
  async function saveChecklist(){
    if (!checklistCurrent.id) return;
    await supabaseClient.from(checklistCurrent.table).update({ checklist: checklistCurrent.items }).eq('id', checklistCurrent.id);
    if (checklistCurrent.onSaved) checklistCurrent.onSaved();
  }
  function openChecklistSheet(table, id, items, onSaved){
    checklistCurrent = { table, id, items: Array.isArray(items) ? JSON.parse(JSON.stringify(items)) : [], onSaved };
    renderChecklistItems();
    setSheetOpen('checklistSheet', true);
  }
  const checklistItemsEl = document.getElementById('checklistItems');
  if (checklistItemsEl) {
    checklistItemsEl.addEventListener('click', async (e) => {
      const removeBtn = e.target.closest('.checklist-item-remove');
      if (!removeBtn) return;
      checklistCurrent.items.splice(Number(removeBtn.dataset.index), 1);
      renderChecklistItems();
      await saveChecklist();
    });
    checklistItemsEl.addEventListener('change', async (e) => {
      const checkbox = e.target.closest('.checklist-item-check');
      if (!checkbox) return;
      checklistCurrent.items[Number(checkbox.dataset.index)].done = checkbox.checked;
      renderChecklistItems();
      await saveChecklist();
    });
  }
  const checklistAddBtn = document.getElementById('checklistAddBtn');
  const checklistNewItemInput = document.getElementById('checklistNewItemInput');
  if (checklistAddBtn && checklistNewItemInput) {
    checklistAddBtn.addEventListener('click', async () => {
      const text = checklistNewItemInput.value.trim();
      if (!text) return;
      checklistCurrent.items.push({ text, done: false });
      checklistNewItemInput.value = '';
      renderChecklistItems();
      await saveChecklist();
    });
    checklistNewItemInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checklistAddBtn.click(); } });
  }

  /* ============================================================
     REZUMATUL SĂPTĂMÂNII (home digest) — un rezumat client-side din
     datele deja încărcate (nu un cron/email de server, pentru care
     n-avem un furnizor de email configurat): sesizări noi/soluționate,
     proiecte noi, avarii soluționate și alertele ERP active, din
     ultimele 7 zile.
     ============================================================ */
  function renderHomeDigest(){
    const grid = document.getElementById('homeDigestGrid');
    if (!grid) return;
    const rangeEl = document.getElementById('homeDigestRange');
    if (rangeEl) rangeEl.textContent = 'ultimele 7 zile';
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newTickets = (typeof allTickets !== 'undefined' ? allTickets : []).filter(t => !isDuplicateTicket(t) && t.submitted_on && parseTicketDate(t.submitted_on).getTime() >= sevenDaysAgo).length;
    const solvedTickets = (typeof allTickets !== 'undefined' ? allTickets : []).filter(t => !isDuplicateTicket(t) && t.status === 'Terminat' && t.resolved_on && parseTicketDate(t.resolved_on).getTime() >= sevenDaysAgo).length;
    const newProjects = (typeof allProjects !== 'undefined' ? allProjects : []).filter(p => p.created_at && new Date(p.created_at).getTime() >= sevenDaysAgo).length;
    const solvedBacklog = (typeof allBacklogProjects !== 'undefined' ? allBacklogProjects : []).filter(p => p.resolved_on && new Date(p.resolved_on).getTime() >= sevenDaysAgo).length;
    const activeAlerts = (typeof allEquipment !== 'undefined' ? allEquipment : []).filter(e => isLowStock(e) || hasExpiredDocs(e)).length;
    const tiles = [
      { num: newTickets, label: 'Sesizări noi', tab: 'overview' },
      { num: solvedTickets, label: 'Sesizări soluționate', tab: 'overview' },
      { num: newProjects, label: 'Proiecte noi', tab: 'projects' },
      { num: solvedBacklog, label: 'Avarii soluționate', tab: 'backlog' },
      { num: activeAlerts, label: 'Alerte ERP active', tab: 'erp-home', warn: activeAlerts > 0 },
    ];
    grid.innerHTML = tiles.map(t => `
      <div class="home-digest-tile" data-goto-tab="${t.tab}">
        <div class="status-stat${t.warn ? ' warn' : ''}">${t.num}</div>
        <div class="status-stat-label">${escapeHtml(t.label)}</div>
      </div>
    `).join('');
    grid.querySelectorAll('.home-digest-tile').forEach(tile => tile.addEventListener('click', () => openAdminTab(tile.dataset.gotoTab)));
  }

  /* ============================================================
     PROIECTE → HOME — a small analytics summary across all four
     project-family panels (Proiecte publice, Avarii rețele, LPS,
     Programe lucrări), reusing whatever each panel already loaded
     rather than issuing its own separate queries.
     ============================================================ */
  function renderProjectsHomeStats(){
    const projCountEl = document.getElementById('projHomeProjectsCount');
    if (projCountEl) projCountEl.textContent = (typeof allProjects !== 'undefined' ? allProjects.filter(p => !p.archived).length : 0);
    const backlogCountEl = document.getElementById('projHomeBacklogCount');
    if (backlogCountEl) backlogCountEl.textContent = (typeof allBacklogProjects !== 'undefined' ? allBacklogProjects.filter(p => (p.status || 'Ongoing') !== 'Terminat').length : 0);
    const lpsCountEl = document.getElementById('projHomeLpsCount');
    if (lpsCountEl) lpsCountEl.textContent = (typeof internalProjects !== 'undefined' ? internalProjects.length : 0);
    const woCountEl = document.getElementById('projHomeWorkOrdersCount');
    if (woCountEl) {
      const in14Days = new Date(); in14Days.setDate(in14Days.getDate() + 14);
      const upcoming = allWorkOrders.filter(w => w.status !== 'Finalizat' && w.status !== 'Anulat' && new Date(w.scheduled_date) <= in14Days);
      woCountEl.textContent = upcoming.length;
    }
  }
  const projHomeProjectsCard = document.getElementById('projHomeProjectsCard');
  if (projHomeProjectsCard) projHomeProjectsCard.addEventListener('click', () => openAdminTab('projects'));
  const projHomeBacklogCard = document.getElementById('projHomeBacklogCard');
  if (projHomeBacklogCard) projHomeBacklogCard.addEventListener('click', () => openAdminTab('backlog'));
  const projHomeLpsCard = document.getElementById('projHomeLpsCard');
  if (projHomeLpsCard) projHomeLpsCard.addEventListener('click', () => openAdminTab('lps'));
  const projHomeWorkOrdersCard = document.getElementById('projHomeWorkOrdersCard');
  if (projHomeWorkOrdersCard) projHomeWorkOrdersCard.addEventListener('click', () => openAdminTab('workorders'));
  const projHomeNavProjects = document.getElementById('projHomeNavProjects');
  if (projHomeNavProjects) projHomeNavProjects.addEventListener('click', () => openAdminTab('projects'));
  const projHomeNavBacklog = document.getElementById('projHomeNavBacklog');
  if (projHomeNavBacklog) projHomeNavBacklog.addEventListener('click', () => openAdminTab('backlog'));
  const projHomeNavLps = document.getElementById('projHomeNavLps');
  if (projHomeNavLps) projHomeNavLps.addEventListener('click', () => openAdminTab('lps'));
  const projHomeNavWorkOrders = document.getElementById('projHomeNavWorkOrders');
  if (projHomeNavWorkOrders) projHomeNavWorkOrders.addEventListener('click', () => openAdminTab('workorders'));

  /* ============================================================
     ONBOARDING — un tur ghidat rapid pentru cineva nou, cu un
     spotlight peste elementele reale ale paginii (nu capturi de
     ecran statice — arată exact unde e fiecare lucru chiar acum).
     Pornește automat o singură dată per browser (vezi mai sus, în
     showDashboard) și poate fi redeschis oricând din butonul „?”
     din bara principală.
     ============================================================ */
  const ONBOARDING_SEEN_KEY = 'onboarding_tour_seen_v1';
  let onboardingSavedCategory = null;
  const ONBOARDING_STEPS = [
    {
      selector: '.rail',
      title: 'Bara principală',
      text: 'De aici treci între zonele mari ale platformei — Sesizări, Proiecte, ERP, Documentație și Stare sistem. Rămâne mereu vizibilă, pe orice pagină.',
    },
    {
      selector: '.category-panel',
      title: 'Submeniul',
      text: 'Fiecare zonă își arată aici paginile proprii. De exemplu, sub „Proiecte” găsești Proiecte publice, Avarii rețele, Proiecte LPS și Programe lucrări.',
      beforeShow(){ onboardingSavedCategory = TAB_CATEGORY[currentAdminTab] || 'home'; setActiveCategory('projects'); },
      afterHide(){ setActiveCategory(onboardingSavedCategory); },
    },
    {
      selector: '.home-smart-search',
      title: 'Căutare rapidă',
      text: 'Scrie o întrebare simplă — „cât cablu X mai am”, „unde e excavatorul”, „câte mașini sunt disponibile” — și primești direct răspunsul, fără să cauți manual prin ERP.',
    },
    {
      selector: '.home-nav-grid',
      title: 'Acces rapid',
      text: 'Fiecare buton te duce direct unde contează cel mai des — de exemplu, „Sesizări” te duce direct la cele active, nu la tot istoricul.',
    },
    {
      selector: '.home-todo-card',
      title: 'Notițele tale',
      text: 'Un spațiu personal, tip post-it, salvat doar în acest browser — nu e vizibil pentru alți utilizatori.',
    },
    {
      selector: '.rail-item[data-category="docs"]',
      title: 'Documentație completă',
      text: 'Dacă vrei detalii pas cu pas pentru orice pagină sau buton din platformă, ghidul complet e mereu aici — organizat pe aceleași secțiuni ca restul platformei (Sesizări, Proiecte, ERP), cu propria căutare.',
    },
  ];
  let onboardingStepIndex = 0;
  function positionOnboardingStep(){
    const step = ONBOARDING_STEPS[onboardingStepIndex];
    const target = document.querySelector(step.selector);
    const spotlight = document.getElementById('onboardingSpotlight');
    const tooltip = document.getElementById('onboardingTooltip');
    if (!target || !spotlight || !tooltip) { onboardingNext(); return; }
    const rect = target.getBoundingClientRect();
    const pad = 6;
    spotlight.style.top = (rect.top - pad) + 'px';
    spotlight.style.left = (rect.left - pad) + 'px';
    spotlight.style.width = (rect.width + pad * 2) + 'px';
    spotlight.style.height = (rect.height + pad * 2) + 'px';

    document.getElementById('onboardingStepLabel').textContent = `Pasul ${onboardingStepIndex + 1} din ${ONBOARDING_STEPS.length}`;
    document.getElementById('onboardingTooltipTitle').textContent = step.title;
    document.getElementById('onboardingTooltipText').textContent = step.text;
    document.getElementById('onboardingPrevBtn').style.visibility = onboardingStepIndex === 0 ? 'hidden' : 'visible';
    document.getElementById('onboardingNextBtn').textContent = onboardingStepIndex === ONBOARDING_STEPS.length - 1 ? 'Am înțeles' : 'Următor';

    // Prefer to the right of the spotlight if there's room, else below it,
    // clamped so the tooltip never runs off the viewport.
    const tooltipWidth = 320;
    let top = rect.top;
    let left = rect.right + 16;
    if (left + tooltipWidth > window.innerWidth) {
      left = Math.max(16, rect.left);
      top = rect.bottom + 18;
    }
    if (top + 220 > window.innerHeight) top = Math.max(16, window.innerHeight - 240);
    if (left + tooltipWidth > window.innerWidth) left = Math.max(16, window.innerWidth - tooltipWidth - 16);
    tooltip.style.top = Math.max(16, top) + 'px';
    tooltip.style.left = left + 'px';
  }
  function showOnboardingStep(){
    const step = ONBOARDING_STEPS[onboardingStepIndex];
    if (step.beforeShow) step.beforeShow();
    // Wait a frame for any layout change (e.g. the category panel
    // opening) to settle before measuring the target's position.
    requestAnimationFrame(() => requestAnimationFrame(positionOnboardingStep));
  }
  function hideCurrentOnboardingStep(){
    const step = ONBOARDING_STEPS[onboardingStepIndex];
    if (step && step.afterHide) step.afterHide();
  }
  function onboardingNext(){
    hideCurrentOnboardingStep();
    if (onboardingStepIndex >= ONBOARDING_STEPS.length - 1) { endOnboardingTour(); return; }
    onboardingStepIndex++;
    showOnboardingStep();
  }
  function onboardingPrev(){
    if (onboardingStepIndex === 0) return;
    hideCurrentOnboardingStep();
    onboardingStepIndex--;
    showOnboardingStep();
  }
  function startOnboardingTour(){
    onboardingStepIndex = 0;
    if (currentAdminTab !== 'home') openAdminTab('home');
    const overlay = document.getElementById('onboardingTour');
    if (overlay) overlay.hidden = false;
    showOnboardingStep();
    try { localStorage.setItem(ONBOARDING_SEEN_KEY, '1'); } catch (e) { /* ignore */ }
  }
  function endOnboardingTour(){
    hideCurrentOnboardingStep();
    const overlay = document.getElementById('onboardingTour');
    if (overlay) overlay.hidden = true;
  }
  window.addEventListener('resize', () => {
    const overlay = document.getElementById('onboardingTour');
    if (overlay && !overlay.hidden) positionOnboardingStep();
  });
  const railHelpBtn = document.getElementById('railHelpBtn');
  if (railHelpBtn) railHelpBtn.addEventListener('click', startOnboardingTour);
  const onboardingNextBtn = document.getElementById('onboardingNextBtn');
  if (onboardingNextBtn) onboardingNextBtn.addEventListener('click', onboardingNext);
  const onboardingPrevBtn = document.getElementById('onboardingPrevBtn');
  if (onboardingPrevBtn) onboardingPrevBtn.addEventListener('click', onboardingPrev);
  const onboardingSkipBtn = document.getElementById('onboardingSkipBtn');
  if (onboardingSkipBtn) onboardingSkipBtn.addEventListener('click', endOnboardingTour);



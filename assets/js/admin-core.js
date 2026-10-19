
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
     STAFF ROLES — one independent role per sidebar section, plus
     god (see staff_permission()/is_god() in the
     20261012055048_staff_roles_per_section_access migration, the
     actual enforcement — this mirrors that logic client-side purely
     to show/hide UI, never as the real security boundary):

       god       — full access everywhere, including Stare sistem.
       tickets   — Sesizări: full access.
       proiecte  — Proiecte: full access.
       erp       — Resurse și inventar: full access.
       hr        — HR (and Documentație, nested under it): full access.

     A person can hold any combination. No view-only tier any more —
     holding a section's role grants full read+write on it and shows
     its icon; not holding it hides that icon/tab entirely (see
     applyRolePermissionsToUI). God implies every section.
     ============================================================ */
  let currentUserRoles = [];
  function modulePermission(mod){
    if (currentUserRoles.includes('god') || currentUserRoles.includes(mod)) return 'write';
    return 'none';
  }
  function isGod(){ return currentUserRoles.includes('god'); }
  // Full staff roster (email list only, deduped — one row per role
  // now, not per person) — used to populate the calendar event
  // "assign to" picker, so an event can be aimed at a real platform
  // account rather than free text.
  let allStaffEmails = [];
  async function loadStaffRoster(){
    const { data, error } = await supabaseClient.from('staff_roles').select('email').order('email', { ascending: true });
    if (error) { console.error(error); return; }
    allStaffEmails = [...new Set((data || []).map(r => r.email))];
  }
  async function fetchCurrentUserRoles(email){
    try {
      const { data, error } = await supabaseClient
        .from('staff_roles')
        .select('role')
        .eq('email', email);
      if (error || !data) {
        // No roles at all (including an error reading them) means no
        // access to anything gated — matches the DB's own is_staff()/
        // staff_permission() behavior for an account not in
        // staff_roles.
        currentUserRoles = [];
        return;
      }
      currentUserRoles = data.map(r => r.role);
    } catch (err) {
      console.error('Could not fetch staff roles (defaulting to none):', err);
      currentUserRoles = [];
    }
  }
  // Hides each rail category/home-nav shortcut entirely for anyone not
  // granted that section's role (god sees everything). Called once
  // role is known (right after login) — DB-level RLS is the real
  // boundary; this only keeps the nav from offering a destination that
  // would just redirect straight back (see openAdminTab's matching
  // guard in lps.js) or a control that would fail at save time.
  // data-category (rail/category-panel) vs. role name differ only for
  // "projects" <-> 'proiecte'. Documentație lives nested under the HR
  // rail icon (see TAB_CATEGORY in lps.js), so it rides on 'hr' too —
  // homeNavDocs below, not a category of its own.
  const CATEGORY_TO_MODULE = { tickets: 'tickets', projects: 'proiecte', erp: 'erp', hr: 'hr' };
  function applyRolePermissionsToUI(){
    const god = isGod();
    Object.keys(CATEGORY_TO_MODULE).forEach(category => {
      const granted = god || modulePermission(CATEGORY_TO_MODULE[category]) === 'write';
      const railItem = document.querySelector(`.rail-item[data-category="${category}"]`);
      const panelSection = document.querySelector(`.category-panel-section[data-category="${category}"]`);
      if (railItem) railItem.style.display = granted ? '' : 'none';
      if (panelSection) panelSection.style.display = granted ? '' : 'none';
    });
    const statusRailItem = document.querySelector('.rail-item[data-category="status"]');
    const statusPanelSection = document.querySelector('.category-panel-section[data-category="status"]');
    if (statusRailItem) statusRailItem.style.display = god ? '' : 'none';
    if (statusPanelSection) statusPanelSection.style.display = god ? '' : 'none';
    // Acasă's own nav-grid visibility is computed independently inside
    // the React pilot now (see admin-react/'s useStaffRoster +
    // NavGrid.tsx) — it fetches its own roles rather than reading
    // currentUserRoles/isGod()/modulePermission() from here.
    // Same filtering for the mobile hamburger menu's equivalent links —
    // it has no erp/hr entries of its own to gate, just tickets/
    // proiecte/status.
    const mobileTabVisibility = {
      overview: god || modulePermission('tickets') === 'write',
      'tickets-functional': god || modulePermission('tickets') === 'write',
      'tickets-accident': god || modulePermission('tickets') === 'write',
      projects: god || modulePermission('proiecte') === 'write',
      backlog: god || modulePermission('proiecte') === 'write',
      status: god,
    };
    document.querySelectorAll('.mobile-tab-btn[data-tab]').forEach(btn => {
      if (btn.dataset.tab in mobileTabVisibility) {
        btn.style.display = mobileTabVisibility[btn.dataset.tab] ? '' : 'none';
      }
    });
    // CSS attributes, not a one-time querySelectorAll sweep: ERP/
    // Proiecte/Sesizări rows re-render constantly (every load, every
    // tab switch), so a [data-requires-write="<module>"] control added
    // to the DOM long after login still needs to come in hidden. The
    // matching CSS rule (admin.css) reacts to these attributes live,
    // for any element however it was inserted.
    document.documentElement.dataset.permTickets = modulePermission('tickets');
    document.documentElement.dataset.permProiecte = modulePermission('proiecte');
    document.documentElement.dataset.permErp = modulePermission('erp');
  }

  /* ============================================================
     ROLURI and JURNAL DE ACTIVITATE (Stare sistem's role-management
     and audit-log tabs) used to be hand-written vanilla JS here. Both
     are now a React pilot (see admin-react/, built into
     assets/js/admin-react-status.js and mounted directly into
     panel-status-roles/panel-status-audit in admin-3.html) — do not
     re-add that code here, edit the React source instead and rebuild.
     ============================================================ */
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
        // opening the same default for every device.
        landing_page: 'admin-3.html',
        // Who this device belongs to — shown as a notifications
        // on/off badge per person in the Roluri tab.
        user_email: currentSessionEmail || null,
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
    // Calendar events (Acasă) now reload themselves — see admin-react/'s
    // useCalendarEvents hook, which the React pilot mounted into
    // panel-home owns independently.
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

  /* ============================================================
     ACASĂ (panel-home) used to be hand-written vanilla JS here and in
     features/system-status.js (clock, mini calendar + recurring
     events, to-do widget, nav grid). It's now a React pilot (see
     admin-react/, built into assets/js/admin-react-status.js and
     mounted directly into panel-home in admin-3.html) — do not re-add
     that code here, edit the React source instead and rebuild.

     The one thing the React side still reaches back into vanilla for:
     its "Sesizări" nav button needs the exact same reset-then-navigate
     behavior the old homeNavTicketsBtn click handler had (see the
     comment that used to sit on it, preserved below) — exposed here as
     a small explicit window.* bridge function rather than the React
     bundle reaching into tickets.js's module-scope editingTicketId/
     ticketsSearchWidget by bare name.
     ============================================================ */
  window.goHomeToTicketsOverview = function(){
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
  };

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
  // HR's "Documentație" dropdown — moved here from its own top-level
  // rail icon (see the sidebar markup). One level above the Proiecte
  // toggle just above, which nests fine (.docs-nav-subgroup's indent
  // just stacks for each level deep).
  const hrDocsToggleBtn = document.querySelector('.docs-nav-toggle[data-hr-toggle="docs"]');
  if (hrDocsToggleBtn) {
    hrDocsToggleBtn.addEventListener('click', () => {
      hrDocsToggleBtn.classList.toggle('open');
      const subgroup = document.querySelector('.docs-nav-subgroup[data-hr-subgroup="docs"]');
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

  /* Acasă (panel-home) is now a React pilot -- see the comment on
     window.goHomeToTicketsOverview above; do not re-add vanilla
     clock/calendar/to-do code here. */

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
      // Report-completion status isn't relevant to a view-only-on-
      // tickets account (they can't act on it either way), so every
      // Terminat ticket fades uniformly for them — only an account
      // that can actually write tickets sees the awaiting-report
      // distinction called out visually.
      const isFullyComplete = modulePermission('tickets') !== 'write' ? isDone : (isDone && !isAwaitingReport(t));
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

      // Re-apply any unsaved edit tracked for this ticket — runs
      // before the field listeners below so it sizes/syncs correctly
      // against the restored text, not the blank/saved starting value.
      // A field with no tracked draft is left exactly as the template
      // above rendered it (i.e. showing the current, possibly just-
      // refreshed, server value) — only fields the person actually
      // typed into get overridden here.
      const draft = draftEdits[t.id];
      if (draft) {
        Object.entries(draft).forEach(([sel, val]) => {
          const el = card.querySelector(sel);
          if (el) el.value = val;
        });
        if (draft['.f-status'] != null) {
          const resolvedDateEl = card.querySelector('.f-resolved-date');
          if (resolvedDateEl) resolvedDateEl.disabled = draft['.f-status'] !== 'Terminat';
        }
      }

      // Tracks each field's own unsaved edits as they happen — not a
      // blanket snapshot of the whole card, so a re-render caused by
      // fresh data arriving (not by this person typing) never has
      // anything to wrongly restore. '.f-status' uses 'change' (it's
      // a <select>); its own disabled-state sync for '.f-resolved-date'
      // stays in the dedicated listener further below, unaffected by
      // this.
      RENDER_DRAFT_FIELD_SELECTORS.forEach(sel => {
        const el = card.querySelector(sel);
        if (!el) return;
        const eventName = sel === '.f-status' ? 'change' : 'input';
        el.addEventListener(eventName, () => {
          if (!draftEdits[t.id]) draftEdits[t.id] = {};
          draftEdits[t.id][sel] = el.value;
        });
      });

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
          delete draftEdits[t.id];
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
          // The save just succeeded, so whatever was tracked as
          // unsaved for this ticket is now exactly what's in the
          // database — nothing left to protect on the next re-render.
          delete draftEdits[t.id];

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
      text: 'De aici treci între zonele mari ale platformei — Sesizări, Proiecte, Resurse și inventar, HR și Stare sistem. Rămâne mereu vizibilă, pe orice pagină.',
    },
    {
      selector: '.category-panel',
      title: 'Submeniul',
      text: 'Fiecare zonă își arată aici paginile proprii. De exemplu, sub „Proiecte” găsești Proiecte publice, Avarii rețele, Proiecte LPS și Programe lucrări.',
      beforeShow(){ onboardingSavedCategory = TAB_CATEGORY[currentAdminTab] || 'home'; setActiveCategory('projects'); },
      afterHide(){ setActiveCategory(onboardingSavedCategory); },
    },
    {
      selector: '#commandPaletteBtn',
      title: 'Căutare rapidă',
      text: 'Scrie o întrebare simplă — „cât cablu X mai am”, „unde e excavatorul”, „câte mașini sunt disponibile” — și primești direct răspunsul, fără să cauți manual prin Resurse și inventar. Disponibilă din orice pagină, sau cu Ctrl/Cmd+K.',
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
      selector: '.rail-item[data-category="hr"]',
      title: 'Documentație completă',
      text: 'Dacă vrei detalii pas cu pas pentru orice pagină sau buton din platformă, ghidul complet e mereu aici — sub „HR”, ca un meniu derulant — organizat pe aceleași secțiuni ca restul platformei (Sesizări, Proiecte, Resurse și inventar), cu propria căutare.',
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



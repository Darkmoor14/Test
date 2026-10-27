
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
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userTag = document.getElementById('userTag');

  // dateKey/formatLogTimeRO — small shared date-formatting helpers used
  // across several still-vanilla feature files by bare identifier
  // (erp.js's document-expiry/service-countdown math, hr.js's
  // pontaj/concediu forms and home stats, search.js's smart search).
  // Both used to live here too, alongside the Acasă clock/calendar code
  // that got rewritten in React first — that rewrite deleted them from
  // this file without checking whether anything ELSE still needed them,
  // which it did. Restored here (not duplicated per-file) since this is
  // the one file every feature file is guaranteed to load after.
  function dateKey(d){
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function formatLogTimeRO(iso){
    const d = new Date(iso);
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

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
       hr        — HR: full access.
       docs      — Documentație: full access (view only -- nothing in
                   it writes anywhere, but it follows the same
                   grant-this-section model as every other role).

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
  // "projects" <-> 'proiecte'.
  const CATEGORY_TO_MODULE = { tickets: 'tickets', projects: 'proiecte', erp: 'erp', hr: 'hr', docs: 'docs' };
  function applyRolePermissionsToUI(){
    const god = isGod();
    Object.keys(CATEGORY_TO_MODULE).forEach(category => {
      const granted = god || modulePermission(CATEGORY_TO_MODULE[category]) === 'write';
      const railItem = document.querySelector(`.rail-item[data-category="${category}"]`);
      const topbar = document.querySelector(`.category-topbar[data-category-topbar="${category}"]`);
      if (railItem) railItem.style.display = granted ? '' : 'none';
      if (topbar) topbar.style.display = granted ? '' : 'none';
    });
    const statusRailItem = document.querySelector('.rail-item[data-category="status"]');
    const statusTopbar = document.querySelector('.category-topbar[data-category-topbar="status"]');
    if (statusRailItem) statusRailItem.style.display = god ? '' : 'none';
    if (statusTopbar) statusTopbar.style.display = god ? '' : 'none';
    // Acasă's own nav-grid visibility is computed independently inside
    // the React pilot now (see admin-react/'s useStaffRoster +
    // NavGrid.tsx) — it fetches its own roles rather than reading
    // currentUserRoles/isGod()/modulePermission() from here.
    // Apply the same module permissions to every destination in the
    // mobile menu, including the sections that used to be missing there.
    const mobileTabVisibility = {
      home: true,
      overview: god || modulePermission('tickets') === 'write',
      'tickets-functional': god || modulePermission('tickets') === 'write',
      'tickets-accident': god || modulePermission('tickets') === 'write',
      reports: god || modulePermission('tickets') === 'write',
      'projects-home': god || modulePermission('proiecte') === 'write',
      projects: god || modulePermission('proiecte') === 'write',
      backlog: god || modulePermission('proiecte') === 'write',
      lps: god || modulePermission('proiecte') === 'write',
      workorders: god || modulePermission('proiecte') === 'write',
      'erp-home': god || modulePermission('erp') === 'write',
      equipment: god || modulePermission('erp') === 'write',
      machines: god || modulePermission('erp') === 'write',
      'machines-fuel-report': god || modulePermission('erp') === 'write',
      materials: god || modulePermission('erp') === 'write',
      products: god || modulePermission('erp') === 'write',
      'hr-home': god || modulePermission('hr') === 'write',
      'hr-employees': god || modulePermission('hr') === 'write',
      'hr-worktime': god || modulePermission('hr') === 'write',
      'hr-vacation': god || modulePermission('hr') === 'write',
      docs: god || modulePermission('docs') === 'write',
      status: god,
      'status-improve': god,
      'status-audit': god,
      'status-stats': god,
      'status-roles': god,
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
    // Tickets/Overview and Proiecte/Avarii/Programe lucrări/ERP reload
    // themselves on login and on every relevant tab switch -- see the
    // admin:tabchange dispatch in lps.js's openAdminTab and
    // admin-react/'s useTicketsStore/useProjectsStore/useErpStore.
    // Calendar events (Acasă) now reload themselves — see admin-react/'s
    // useCalendarEvents hook, which the React pilot mounted into
    // panel-home owns independently.
    // This one also keeps the home-page smart search answerable across
    // Parc Auto without visiting that tab first (Parc Auto itself still
    // reads straight off allEquipment, kept vanilla/deferred this round).
    loadEquipment();
    loadInternalProjects();
  }

  function setHomeTabFilter(tabKey){
    if (tabKey === 'tickets') {
      // Ticket/Overview filter state is now React-owned (see
      // admin-react/'s useTicketsStore) -- this just navigates there;
      // React's own store already defaults to its standard view.
      tabKey = 'overview';
    } else if (tabKey === 'projects' || tabKey === 'backlog') {
      // Proiecte/Avarii filter state is now React-owned (see
      // admin-react/'s useProjectsStore) -- this just navigates there;
      // React's own store already defaults to its standard view.
    } else if (tabKey === 'reports') {
      // Same note as the 'tickets' branch above -- React's Overview
      // store owns this state now. The "Așteaptă raport" default this
      // used to force can be set from the Filtre popover once there.
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

  /* Acasă (panel-home) and Sesizări (panel-overview/panel-tickets) are
     now a React pilot -- see admin-react/, built into
     assets/js/admin-react-status.js and mounted directly into those
     panels in admin-3.html. Do not re-add vanilla code for either
     here; edit the React source instead and rebuild. */
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
    const syncCta = document.getElementById('docsOpenCalendarSyncBtn')?.closest('.docs-calendar-sync-cta');
    if (syncCta) syncCta.style.display = docsActiveGroup === 'home' ? '' : 'none';
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

  // Documentație's own calendar-sync shortcut -- opens the same sheet
  // Acasă's calendar card used to trigger (now moved here entirely; see
  // SharedSheetsRoot.tsx's window.openCalendarSync).
  const docsOpenCalendarSyncBtn = document.getElementById('docsOpenCalendarSyncBtn');
  if (docsOpenCalendarSyncBtn) {
    docsOpenCalendarSyncBtn.addEventListener('click', () => {
      if (typeof openCalendarSync === 'function') openCalendarSync();
    });
  }

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

  /* Prezentare generală (Overview) and Sesizări (Tickets) --
     charts, priority cards, the ticket list/cards, archiving,
     duplicates, the add-ticket form -- are now a React pilot. See
     admin-react/, built into assets/js/admin-react-status.js and
     mounted directly into panel-overview/panel-tickets (plus the
     shared topbar slots) in admin-3.html. Do not re-add vanilla code
     for any of this here; edit the React source instead and rebuild. */
  /* ============================================================
     ADMIN TABS — switch between "Sesizări" and "Proiecte curente"
     within the same authenticated dashboard (no second login needed).
     ============================================================ */
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      openAdminTab(tab.dataset.tab);
      // Picking a tab from inside an open dropdown (e.g. "Raport lunar
      // consum" under Parc Auto) should close it, same as clicking
      // anywhere else outside it already does (see lps.js) -- without
      // this, a tab click INSIDE the dropdown left it open since it
      // never counts as "outside".
      document.querySelectorAll('.category-topbar .docs-nav-toggle.open').forEach(btn => btn.classList.remove('open'));
      document.querySelectorAll('.category-topbar .docs-nav-subgroup.open').forEach(sg => sg.classList.remove('open'));
    });
  });

  /* ============================================================
     RAIL — category switching (which .category-topbar shows).
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

  // Priority cards, the narrow-filter banner, and the add-ticket
  // form are now the React Tickets pilot's own concern (see the
  // comment above, near the start of this file's ticket-related code).
  // Proiecte publice's add/edit form (openProjectForm/pfSaveBtn) is now
  // admin-react/'s ProjectForm. The entity_log (Istoric) and checklist
  // (Listă de verificare) SHEETS are now admin-react/'s EntityLogSheet/
  // ChecklistSheet, opened via window.openEntityLogSheet/
  // window.openChecklistSheet -- Proiecte/Avarii/Echipamente-Materiale-
  // Produse are all React-owned and call those directly; LPS look-ahead
  // items (still vanilla/deferred) call the exact same two window
  // functions by bare identifier, same bridge contract as Tickets'
  // window.goToTicket. Only the plain activity-logging INSERT helper
  // stays here, genuinely shared (LPS/Parc Auto, both still vanilla,
  // call it by bare identifier too).
  async function logEntityActivity(entityType, entityId, text){
    try {
      await supabaseClient.from('entity_log').insert({ entity_type: entityType, entity_id: entityId, kind: 'activity', text, user_email: currentSessionEmail || null });
    } catch (e) { /* best effort — never block the action it's describing */ }
  }

  // Proiecte → Home's stats/nav (renderProjectsHomeStats + its card/nav
  // listeners) is now admin-react/'s ProjectsHomePanel.

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
      selector: '.category-topbar.active',
      title: 'Submeniul',
      text: 'Fiecare zonă își arată aici, sus, paginile proprii. De exemplu, sub „Proiecte” găsești Proiecte publice, Avarii rețele, Proiecte LPS și Programe lucrări.',
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
      selector: '.rail-item[data-category="docs"]',
      title: 'Documentație completă',
      text: 'Dacă vrei detalii pas cu pas pentru orice pagină sau buton din platformă, ghidul complet e mereu aici — organizat pe aceleași secțiuni ca restul platformei (Sesizări, Proiecte, Resurse și inventar), cu propria căutare.',
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


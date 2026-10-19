
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
    // Tickets/Overview reload themselves on every tab switch into a
    // ticket-related view -- see the admin:tabchange dispatch in
    // lps.js's openAdminTab and admin-react/'s useTicketsStore.
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
      // Ticket/Overview filter state is now React-owned (see
      // admin-react/'s useTicketsStore) -- this just navigates there;
      // React's own store already defaults to its standard view.
      tabKey = 'overview';
    } else if (tabKey === 'projects') {
      if (projectsSearchWidget) projectsSearchWidget.applyExternalQuery('');
      setProjectYearFilter('all');
      setProjectsFilter('Ongoing');
    } else if (tabKey === 'backlog') {
      if (backlogSearchWidget) backlogSearchWidget.applyExternalQuery('');
      setBacklogFilter('Ongoing');
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

  // Priority cards, the narrow-filter banner, and the add-ticket
  // form are now the React Tickets pilot's own concern (see the
  // comment above, near the start of this file's ticket-related code).
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



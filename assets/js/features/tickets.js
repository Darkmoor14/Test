  function escapeHtml(value){
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  async function showDashboard(email){
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
    const isReportAccount = isReportFocusedView();
    document.documentElement.classList.toggle('report-focused-view', isReportAccount);
    // Role must be known before the first render — both so a
    // limited-access account never flashes a write-only control for a
    // frame, and so restoring the tab a reload lands on (below) can
    // correctly re-enter a god-only one (Stare sistem, Roluri, HR):
    // openAdminTab's own redirect-guard checks isGod(), which reads
    // currentUserRoles, so calling it before this resolves used to
    // bounce a real god account's reload on one of those tabs straight
    // back to Acasă — this was the actual cause of "refreshing kicks
    // me back to the home page" on exactly the tabs it only ever
    // showed for.
    await fetchCurrentUserRoles(normalizedEmail);
    // A sign-out or account switch may happen before the request
    // resolves. Never let that stale response change the new view.
    if (currentSessionEmail !== normalizedEmail) return;
    if (isReportAccount) {
      // Land back on whatever tab was open before a refresh instead of
      // always restarting at the home page — see initialHashTab above.
      const validReportTabs = ['home', 'overview', 'tickets-functional', 'tickets-accident', 'reports', 'projects-home', 'projects', 'backlog', 'lps', 'workorders', 'erp-home', 'equipment', 'machines', 'machines-fuel-report', 'materials', 'products', 'hr-home', 'hr-employees', 'hr-worktime', 'hr-vacation', 'status', 'status-improve', 'status-audit', 'status-stats', 'status-roles', 'docs'];
      const restoredTab = validReportTabs.includes(initialHashTab) ? initialHashTab : 'home';
      openAdminTab(restoredTab, true);
      // For "machines", openAdminTab's own self-heal already wrote a
      // subcategory-aware hash (#machines/masina_mica) via
      // setMachinesSubcatFilter -- reuse it as-is instead of stomping it
      // back down to the bare tab name.
      const liveHash = window.location.hash.replace(/^#/, '');
      const hashToWrite = (restoredTab === 'machines' && liveHash.indexOf('machines') === 0) ? liveHash : restoredTab;
      history.replaceState({ adminTab: restoredTab }, '', window.location.pathname + window.location.search + '#' + hashToWrite);
    }
    loginWrap.style.display = 'none';
    dash.classList.add('show');
    logoutBtn.style.display = 'inline-flex';
    maybeAutoPromptForNotifications();
    userTag.textContent = normalizedEmail;
    const sidebarAvatar = document.getElementById('sidebarAccountAvatar');
    if (sidebarAvatar) sidebarAvatar.textContent = normalizedEmail.charAt(0) || '—';
    applyRolePermissionsToUI();
    document.documentElement.classList.toggle('report-focused-view', isReportFocusedView());
    // The "Așteaptă raport" status-chip handling that used to live here
    // (adding a 4th sheet chip, hiding the AwaitingReport chip for a
    // read-only tickets account) is now the React Tickets pilot's own
    // concern -- see admin-react/'s useStaffRoster + FilterPopover,
    // which fetch modulePermission('tickets') themselves rather than
    // reading it from here.
    runAutoArchiveSweep();
    loadStaffRoster();
    // First-ever login on this browser — walk through the basics once,
    // automatically. Re-openable anytime from the "?" button in the rail.
    try {
      if (isReportFocusedView() && !localStorage.getItem(ONBOARDING_SEEN_KEY)) {
        setTimeout(() => { if (typeof startOnboardingTour === 'function') startOnboardingTour(); }, 900);
      }
    } catch (e) { /* localStorage unavailable — just skip auto-start */ }
  }

  function showLogin(){
    currentSessionEmail = null;
    document.documentElement.classList.remove('report-focused-view');
    loginWrap.style.display = 'flex';
    dash.classList.remove('show');
    logoutBtn.style.display = 'none';
    userTag.textContent = '';
    currentAdminTab = 'overview';
    openAdminTab('overview', true);
    // Tickets' and Proiecte/ERP's own React stores each watch
    // sessionEmail via their own auth listener and reload on a fresh
    // login -- see admin-react/'s useTicketsStore/useProjectsStore/
    // useErpStore.
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

  // Shared across the whole app (set/read by lps.js's openAdminTab,
  // and by window.currentAdminTab, see lps.js's own comment) --
  // not ticket-specific despite living in this file historically.
  let currentAdminTab = 'overview';

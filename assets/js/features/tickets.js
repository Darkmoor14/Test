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
     The public pages (relatii-publice/sesizari.html,
     relatii-publice/proiecte-publice.html) also filter by the same
     14-day window client-side, so a ticket or project disappears from
     the public site on schedule even on days nobody has logged into
     admin.

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
    // visibility window (relatii-publice/sesizari.html filters by
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

  // Shared across the whole app (set/read by lps.js's openAdminTab,
  // and by window.currentAdminTab, see lps.js's own comment) --
  // not ticket-specific despite living in this file historically.
  let currentAdminTab = 'overview';

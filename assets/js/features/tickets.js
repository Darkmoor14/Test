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
          url: 'admin-3.html?ticket=' + encodeURIComponent(payload.ticket_number),
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
      const validReportTabs = ['home', 'overview', 'tickets-functional', 'tickets-accident', 'projects-home', 'projects', 'backlog', 'lps', 'workorders', 'erp-home', 'equipment', 'machines', 'materials', 'products', 'hr-home', 'hr-employees', 'hr-worktime', 'hr-vacation', 'status', 'status-improve', 'status-audit', 'status-roles', 'docs'];
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
    applyRolePermissionsToUI();
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
    if (modulePermission('tickets') !== 'write') {
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
  // role specifically — see fetchCurrentUserRoles's .then() below.
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
      const isFullyComplete = (modulePermission('tickets') !== 'write' || isReportFocusedView())
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
        const isFullyComplete = (modulePermission('tickets') !== 'write' || isReportFocusedView())
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
     DUPLICATE TICKETS — see isDuplicateTicket()'s own comment. Picking
     the canonical ticket happens in a small search sheet (ticket
     number or address); the actual linking/unlinking is a single
     Supabase update — the DB triggers handle archiving the mirrored
     resolution fields.
     ============================================================ */
  // Two modes, depending on whether excludeTicketId is given:
  //
  // ANCHOR MODE (excludeTicketId set -- opened from one specific
  // ticket's own "Leagă duplicate" button): that ticket IS the
  // original and never changes. Checking boxes in the search results
  // just builds the set of tickets that become its duplicates; one
  // "Confirmă" button finalizes all of them at once. There's nothing
  // to "pick" here -- the original was already decided by which
  // ticket's button you opened this from.
  //
  // BULK MODE (excludeTicketId null -- opened from the "Marchează ca
  // duplicate" bar after pre-selecting tickets in the main list):
  // those pre-selected tickets are the known duplicates, but which
  // ticket is the original is NOT yet decided, so this still needs an
  // explicit pick -- checking a box adds an extra duplicate, and
  // tapping a result's "Alege" button both finalizes that one as the
  // original and applies to everything checked.
  //
  // Resolves with { canonicalId, extraIds } in both modes, or null on
  // cancel. Checkbox markup/wiring mirrors the main ticket list's own
  // proven .ticket-select/.f-select checkbox exactly (a <label>
  // wrapping the <input>, one direct addEventListener('change', ...)
  // attached per checkbox right after it's rendered, no event
  // delegation).
  function openDuplicateLinkSheet(excludeTicketId){
    const isAnchorMode = !!excludeTicketId;
    const sheet = document.getElementById('duplicateLinkSheet');
    const searchBox = document.getElementById('duplicateLinkSearchBox');
    const results = document.getElementById('duplicateLinkResults');
    const extraCount = document.getElementById('duplicateLinkExtraCount');
    const hint = document.getElementById('duplicateLinkSheetHint');
    const title = document.getElementById('duplicateLinkSheetTitle');
    const cancelBtn = document.getElementById('duplicateLinkCancelBtn');
    const closeBtn = document.getElementById('duplicateLinkCloseBtn');
    const confirmBtn = document.getElementById('duplicateLinkConfirmBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !searchBox || !results || !extraCount || !hint || !title || !cancelBtn || !closeBtn || !confirmBtn || !backdrop) return Promise.resolve(null);

    const anchorTicket = isAnchorMode ? allTickets.find(t => t.id === excludeTicketId) : null;
    searchBox.value = '';
    extraCount.style.display = 'none';
    title.textContent = isAnchorMode ? 'Leagă duplicate' : 'Marchează ca duplicate';
    hint.textContent = isAnchorMode
      ? `Bifează sesizările duplicate ale ${anchorTicket ? anchorTicket.ticket_number : 'acesteia'}, apoi apasă Confirmă.`
      : 'Apasă "Alege" pe cea originală — cea pe care o ții. Nu e niciuna dintre cele bifate? Caută alta (nr. tichet sau adresă).';
    confirmBtn.style.display = isAnchorMode ? '' : 'none';
    confirmBtn.disabled = true;
    setSheetOpen('duplicateLinkSheet', true);
    setTimeout(() => searchBox.focus(), 50);

    return new Promise(resolve => {
      let settled = false;
      const checkedIds = new Set();
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('duplicateLinkSheet', false);
        searchBox.removeEventListener('input', handleInput);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        confirmBtn.removeEventListener('click', handleConfirm);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };
      const updateCheckedCount = () => {
        if (isAnchorMode) {
          confirmBtn.disabled = checkedIds.size === 0;
          extraCount.style.display = 'none';
          return;
        }
        if (checkedIds.size === 0) {
          extraCount.style.display = 'none';
        } else {
          extraCount.style.display = '';
          extraCount.textContent = checkedIds.size === 1
            ? '1 sesizare bifată — apasă pe cea originală ca să le legi pe amândouă.'
            : `${checkedIds.size} sesizări bifate — apasă pe cea originală ca să le legi pe toate.`;
        }
      };
      const finalizePick = (canonicalId) => {
        checkedIds.delete(canonicalId);
        cleanup({ canonicalId, extraIds: Array.from(checkedIds) });
      };
      const renderRows = (matches) => {
        if (matches.length === 0) {
          results.innerHTML = '<div class="no-results">Nicio sesizare găsită.</div>';
          return;
        }
        results.innerHTML = matches.map(t => isAnchorMode ? `
          <div class="duplicate-link-result-item${checkedIds.has(t.id) ? ' checked' : ''}" data-ticket-id="${t.id}">
            <label class="duplicate-link-result-checkwrap">
              <input type="checkbox" class="duplicate-link-result-check" data-ticket-id="${t.id}" ${checkedIds.has(t.id) ? 'checked' : ''} aria-label="Bifează ca duplicat">
            </label>
            <span class="duplicate-link-result-pickbtn">
              <span class="duplicate-link-result-num">${escapeHtml(t.ticket_number || '—')}</span>
              <span class="duplicate-link-result-address">${escapeHtml(t.address || '—')}</span>
            </span>
          </div>
        ` : `
          <div class="duplicate-link-result-item${checkedIds.has(t.id) ? ' checked' : ''}" data-ticket-id="${t.id}">
            <label class="duplicate-link-result-checkwrap">
              <input type="checkbox" class="duplicate-link-result-check" data-ticket-id="${t.id}" ${checkedIds.has(t.id) ? 'checked' : ''} aria-label="Bifează ca duplicat suplimentar">
            </label>
            <button type="button" class="duplicate-link-result-pickbtn" data-ticket-id="${t.id}">
              <span class="duplicate-link-result-num">${escapeHtml(t.ticket_number || '—')}</span>
              <span class="duplicate-link-result-address">${escapeHtml(t.address || '—')}</span>
              <span class="duplicate-link-result-pick">Alege</span>
            </button>
          </div>
        `).join('');
        // Direct listeners, attached right here per-item -- same
        // pattern as the main list's checkbox, not event delegation.
        results.querySelectorAll('.duplicate-link-result-check').forEach(checkbox => {
          checkbox.addEventListener('change', () => {
            const id = checkbox.dataset.ticketId;
            if (checkbox.checked) checkedIds.add(id); else checkedIds.delete(id);
            checkbox.closest('.duplicate-link-result-item').classList.toggle('checked', checkbox.checked);
            updateCheckedCount();
            checkbox.blur();
          });
        });
        if (isAnchorMode) {
          // No separate "Alege" here -- the whole row is just the
          // checkbox's tap target, made bigger and easier to hit.
          results.querySelectorAll('.duplicate-link-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
              if (e.target.closest('.duplicate-link-result-check')) return;
              const checkbox = item.querySelector('.duplicate-link-result-check');
              checkbox.checked = !checkbox.checked;
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            });
          });
        } else {
          results.querySelectorAll('.duplicate-link-result-pickbtn').forEach(btn => {
            btn.addEventListener('click', () => finalizePick(btn.dataset.ticketId));
          });
        }
      };
      const renderResults = () => {
        const rawQuery = searchBox.value.trim();
        if (!rawQuery) {
          // Bulk mode opens with tickets already pre-selected via the
          // main list's own checkboxes -- show those immediately
          // instead of an empty "type to search" placeholder, so the
          // common case (the original IS one of the ones you already
          // picked) needs no typing at all, just a tap on "Alege".
          if (!isAnchorMode && selectedIds.size > 0) {
            const preselected = allTickets.filter(t => selectedIds.has(t.id) && !t.duplicate_of);
            if (preselected.length > 0) {
              renderRows(preselected);
              return;
            }
          }
          results.innerHTML = '<div class="no-results">Scrie pentru a căuta…</div>';
          return;
        }
        // Supports several terms at once (comma or newline separated),
        // matching any of them -- so a ticket number and a street name
        // (or a few candidate streets) can be searched together instead
        // of one term per search.
        const terms = rawQuery.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
        // Excludes itself and anything already marked as a duplicate —
        // a duplicate can only ever point at an original, never at
        // another duplicate (no chains), matching the DB's own check.
        const matches = allTickets.filter(t =>
          t.id !== excludeTicketId &&
          !t.duplicate_of &&
          terms.some(term => (t.ticket_number || '').toLowerCase().includes(term) || (t.address || '').toLowerCase().includes(term))
        ).slice(0, 20);
        renderRows(matches);
      };
      const handleInput = () => renderResults();
      const handleConfirm = () => {
        if (checkedIds.size === 0) return;
        cleanup({ canonicalId: excludeTicketId, extraIds: Array.from(checkedIds) });
      };
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => { if (event.key === 'Escape') handleCancel(); };
      searchBox.addEventListener('input', handleInput);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      confirmBtn.addEventListener('click', handleConfirm);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
      renderResults();
    });
  }

  async function markAsDuplicate(ticketId){
    // Anchor mode: ticketId itself is the original and never changes
    // -- only the checked tickets (extraIds) get linked to it. See
    // openDuplicateLinkSheet's own comment for why.
    const picked = await openDuplicateLinkSheet(ticketId);
    if (!picked) return;
    const { extraIds } = picked;
    if (extraIds.length === 0) return;
    const anchorTicket = allTickets.find(t => t.id === ticketId);
    const dupNumbers = extraIds
      .map(id => allTickets.find(t => t.id === id)?.ticket_number)
      .filter(Boolean)
      .join(', ');
    if (!confirm(`Legi ${extraIds.length} sesizări (${dupNumbers}) ca duplicate ale ${anchorTicket ? anchorTicket.ticket_number : 'acesteia'}?`)) {
      return;
    }
    // Deliberately does NOT archive the ticket — it stays visible on
    // the public site exactly as before (an early citizen complaint
    // about "my ticket vanished" is worse than a rare double
    // dispatch). It only ever archives later through the normal
    // 14-days-after-resolution sweep (autoArchiveStaleTickets), once
    // it has picked up a real resolution via the canonical ticket —
    // see sync_duplicate_ticket()/propagate_resolution_to_duplicates().
    const { error } = await AppDataServices.tickets.markDuplicates(supabaseClient, ticketId, extraIds);
    if (error) {
      console.error(error);
      alert('Eroare la marcarea ca duplicat. Încercați din nou.');
      return;
    }
    showToast(extraIds.length === 1 ? 'Sesizarea a fost marcată ca duplicat.' : `${extraIds.length} sesizări au fost marcate ca duplicate.`);
    loadTickets();
  }

  async function unmarkDuplicate(ticketId){
    if (!confirm('Anulezi legătura de duplicat? Sesizarea revine la starea pe care o avea înainte să fie marcată duplicat.')) return;
    // status/resolution_note/resolved_on/resolved_by are deliberately
    // NOT set here -- the DB's snapshot_before_duplicate_link_trigger
    // restores them from what the ticket actually had before it was
    // linked as a duplicate (pre_duplicate_* columns), instead of
    // blanking a ticket that was already solved back to unresolved.
    //
    // archived is different: it's only forced back to false when the
    // restored status would leave an Ongoing ticket sitting archived
    // -- an invariant the rest of the admin relies on (see
    // getFilteredTickets' own comment: "an archived ticket is never
    // Ongoing"). A ticket that was already genuinely Terminat before
    // ever being linked as a duplicate stays exactly as archived (or
    // not) as it already was; forcing it out of the archive every
    // time used to yank an old, legitimately-closed ticket back into
    // the active list for no reason.
    const ticket = allTickets.find(t => t.id === ticketId);
    const restoredStatus = ticket ? (ticket.pre_duplicate_status || 'Ongoing') : 'Ongoing';
    const payload = { duplicate_of: null };
    if (restoredStatus !== 'Terminat') {
      payload.archived = false;
      payload.archived_at = null;
    }
    const { error } = await supabaseClient
      .from('tickets')
      .update(payload)
      .eq('id', ticketId);
    if (error) {
      console.error(error);
      alert('Eroare la anularea duplicatului. Încercați din nou.');
      return;
    }
    showToast('Legătura de duplicat a fost anulată.');
    loadTickets();
  }

  
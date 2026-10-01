/* ============================================================
     CURRENT PROJECTS — full CRUD (add/edit/delete) for the
     `current_projects` table, whose contents are shown publicly on
     relatii-publice.html's "Proiecte de modernizare" section
     (formerly the homepage's "Ce facem acum" section — moved off
     the homepage so index.html no longer queries this table).
     Openly readable by anon — see current-projects-table.sql.
     Progress % and status are computed the same way here as on the
     public page: purely from today's date relative to
     start_date/due_date, so nothing needs manual updating except
     the dates themselves.

     ARCHIVING: same bulk-archive pattern as Sesizări — "Toate"
     already includes archived projects, same as it does for tickets
     (see getFilteredProjects() above). Requires an `archived`
     (boolean) and `archived_at` (timestamptz) column on
     `current_projects`, matching what `tickets` already has:

       alter table current_projects
         add column if not exists archived boolean not null default false,
         add column if not exists archived_at timestamptz;

     AUTOMATIC ARCHIVING (optional, server-side): runAutoArchiveSweep()
     above already handles the 2-week auto-archive client-side on
     every admin login, which is enough for day-to-day use. If a
     stricter guarantee is ever wanted (e.g. cleanup happens even on
     days nobody logs in), the same two operations can be scheduled
     directly in Supabase using the pg_cron extension (Database ->
     Extensions -> enable "pg_cron", then run once in the SQL editor,
     after the column migration above):

       select cron.schedule(
         'auto-archive-tickets', '0 3 * * *', $$
           update tickets set archived = true, archived_at = now()
           where status = 'Terminat' and archived = false
             and resolved_on < now() - interval '14 days';
         $$
       );
       select cron.schedule(
         'auto-archive-projects', '0 3 * * *', $$
           update current_projects set archived = true, archived_at = now()
           where archived = false
             and due_date < (now() - interval '14 days')::date;
         $$
       );

     This is entirely optional — the client-side sweep already
     satisfies the requirement without touching the database
     configuration.
     ============================================================ */
  let allProjects = [];
  let projectsFilter = 'Ongoing';
  let projectYearFilter = 'all';
  let projectYearFilterInitialized = false;
  let projectYearFilterTouched = false;
  let projectSearchQuery = '';
  const projectSelectedIds = new Set();

  function calcProjectProgress(startISO, dueISO){
    const now = new Date();
    const start = new Date(startISO);
    const due = new Date(dueISO);
    if (now <= start) return 0;
    if (now >= due) return 100;
    return Math.round(((now - start) / (due - start)) * 100);
  }
  function calcProjectStatus(startISO, dueISO){
    const now = new Date();
    const start = new Date(startISO);
    const due = new Date(dueISO);
    if (now < start) return { key: 'scheduled', label: 'Programat' };
    if (now >= due) return { key: 'done', label: 'Finalizat' };
    return { key: 'progress', label: 'În desfășurare' };
  }

  /* ============================================================
     PROJECTS FILTER — mirrors the ticket tabs (Active / Soluționate
     / Toate). "Active" covers scheduled + in-progress projects;
     "Soluționate" covers those past due_date (calculated, same as
     the public page); "Toate" includes archived projects too (the
     persisted `archived` flag, set manually here or by the 2-week
     auto-sweep) — there's no separate archive-only view, same
     reasoning as the ticket tabs.

     NOTE: this requires an `archived` (boolean) and `archived_at`
     (timestamptz) column on the `current_projects` table, matching
     the ones `tickets` already has. If they don't exist yet, run
     once in the Supabase SQL editor:

       alter table current_projects
         add column if not exists archived boolean not null default false,
         add column if not exists archived_at timestamptz;

     Until that migration runs, archiving a project will surface an
     error — everything else on this page keeps working normally
     either way.
     ============================================================ */
  function getProjectStatusFilterKey(p){
    return calcProjectStatus(p.start_date, p.due_date).key === 'done' ? 'Terminat' : 'Ongoing';
  }
  function matchesProjectYear(p, yearFilter){
    if (yearFilter === 'all') return true;
    if (!p.start_date) return false;
    return String(new Date(p.start_date).getFullYear()) === String(yearFilter);
  }

  function populateProjectYearFilterSelect(){
    const selects = [
      document.getElementById('projectYearFilterSelectMobile'),
      document.getElementById('projectYearFilterSelectDesktop'),
    ].filter(Boolean);
    if (selects.length === 0) return;

    const years = new Set();
    allProjects.forEach(p => {
      if (p.start_date) years.add(new Date(p.start_date).getFullYear());
    });
    const sortedYears = [...years].sort((a, b) => b - a);
    const optionsHtml =
      '<option value="all">Toate anii</option>' +
      sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
    selects.forEach(s => { s.innerHTML = optionsHtml; });

    if (!projectYearFilterInitialized) {
      const currentYear = new Date().getFullYear();
      projectYearFilter = sortedYears.includes(currentYear) ? String(currentYear) : 'all';
      projectYearFilterInitialized = true;
    } else if (projectYearFilter !== 'all' && !sortedYears.some(y => String(y) === projectYearFilter)) {
      projectYearFilter = 'all';
    }

    selects.forEach(s => { s.value = projectYearFilter; });
    updateYearWarning(
      ['projectYearFilterSelectMobile', 'projectYearFilterSelectDesktop'],
      ['yearWarningProjects', 'yearWarningProjectsDesktop'],
      projectYearFilter
    );
  }

  function setProjectYearFilter(value){
    projectYearFilter = value;
    projectYearFilterTouched = true;
    document.querySelectorAll('#projectYearFilterSelectMobile, #projectYearFilterSelectDesktop').forEach(s => { s.value = projectYearFilter; });
    updateYearWarning(
      ['projectYearFilterSelectMobile', 'projectYearFilterSelectDesktop'],
      ['yearWarningProjects', 'yearWarningProjectsDesktop'],
      projectYearFilter
    );
    if (typeof projectsFilterWidget !== 'undefined' && projectsFilterWidget) projectsFilterWidget.syncActiveState();
    renderProjects();
  }

  function setProjectsFilter(key){
    projectsFilter = key;
    projectSelectedIds.clear();
    updateProjectsArchiveBar();
    document.querySelectorAll('#projectsChipsWrapSheet .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.key === key);
    });
    if (typeof projectsFilterWidget !== 'undefined' && projectsFilterWidget) projectsFilterWidget.syncActiveState();
    renderProjects();
  }

  function matchesProjectSearch(p, query){
    if (!query) return true;
    const haystack = [p.title, p.address].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  }

  function getFilteredProjects(){
    // No separate "Arhivate" option anymore — "Toate" already means
    // every project, archived or not, same reasoning and same fix as
    // getFilteredTickets() above.
    const base = allProjects.filter(p =>
      projectsFilter === 'Toate' || getProjectStatusFilterKey(p) === projectsFilter
    );
    const query = projectSearchQuery.trim().toLowerCase();
    return base.filter(p => matchesProjectYear(p, projectYearFilter) && matchesProjectSearch(p, query));
  }

  const projectChipDefs = [
    { key: 'Ongoing', label: 'Active' },
    { key: 'Terminat', label: 'Soluționate' },
    { key: 'Toate', label: 'Toate' },
  ];
  const projectSearchBox = document.getElementById('projectSearchBox');

  // Proiecte's own search icon — widens status/year on search-start
  // (to "Toate"/"all") so an exact title/address search isn't hidden
  // by whatever status or year happens to be selected, then restores
  // both once the search is cleared. No month/day here (Proiecte
  // never had that granularity), matching createSearchToggleWidget's
  // own optional-target gating.
  const projectsSearchWidget = createSearchToggleWidget({
    toggleBtnId: 'projectSearchToggleBtn', wrapId: 'projectSearchWrap', boxId: 'projectSearchBox',
    setQuery: (v) => { projectSearchQuery = v; }, rerender: renderProjects,
    getStatus: () => projectsFilter, setStatus: setProjectsFilter, widenStatus: 'Toate',
    getYear: () => projectYearFilter, setYear: setProjectYearFilter,
  });

  // Proiecte's own Filtre popover — year-only (no month/day: Proiecte
  // publice never had that granularity in this file, unlike
  // admin.html's own version) plus the same status chips as before,
  // now rendered by the widget itself via chipsWrapId/chipDefs rather
  // than the old buildProjectChip loop.
  const projectsFilterWidget = createFilterPopoverWidget({
    toggleBtnId: 'projectsFilterToggleBtn', popoverId: 'projectsFilterPopover',
    yearSelectId: 'projectYearFilterSelectMobile',
    getYear: () => projectYearFilter, setYear: setProjectYearFilter,
    getYearTouched: () => projectYearFilterTouched,
    chipsWrapId: 'projectsChipsWrapSheet', chipDefs: projectChipDefs,
    getStatus: () => projectsFilter, setStatus: setProjectsFilter, defaultStatus: 'Ongoing',
    noteIds: ['projectsFilterNoteDesktop', 'projectsFilterNoteMobile'],
    savedViewsScope: 'projects', savedViewsWrapId: 'projectsSavedViewsWrap', saveViewBtnId: 'projectsSaveViewBtn',
  });

  async function loadProjects(){
    const { data, error } = await supabaseClient
      .from('current_projects')
      .select('*')
      .order('start_date', { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    allProjects = data || [];
    populateProjectYearFilterSelect();
    renderProjects();
    if (typeof renderProjectsHomeStats === 'function') renderProjectsHomeStats();
  }

  function renderProjects(){
    const list = document.getElementById('projectList');
    const filtered = getFilteredProjects();
    document.getElementById('projectsCount').textContent = filtered.length + ' din ' + allProjects.length + ' proiecte';
    const projectsCountMobile = document.getElementById('projectsCountMobile');
    if (projectsCountMobile) projectsCountMobile.textContent = filtered.length + ' din ' + allProjects.length + ' proiecte';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="no-results" style="padding:40px 0;text-align:center;color:var(--ink-400);">Niciun proiect în această categorie.</div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach(p => {
      const pct = calcProjectProgress(p.start_date, p.due_date);
      const status = calcProjectStatus(p.start_date, p.due_date);
      const isArchived = !!p.archived;
      const card = document.createElement('div');
      card.className = 'project-card' + (isArchived ? ' archived' : '');
      card.innerHTML = `
        <div class="pc-top">
          <div class="ticket-select">
            <input type="checkbox" class="pc-select" ${projectSelectedIds.has(p.id) ? 'checked' : ''}>
            <div>
              <div class="pc-title">${escapeHtml(p.title)}${p.checklist && p.checklist.length ? ` <span class="checklist-progress">${p.checklist.filter(i => i.done).length}/${p.checklist.length}</span>` : ''}</div>
              <div class="pc-address">${escapeHtml(p.address)}</div>
              ${isArchived ? `<span class="archived-badge">Arhivat ${fmtDate(p.archived_at)}</span>` : ''}
            </div>
          </div>
          <span class="pc-status ${status.key}">${status.label}</span>
        </div>
        <div class="pc-bar-track"><div class="pc-bar-fill" style="width:${pct}%;"></div></div>
        <div class="pc-meta">
          <span>${fmtDate(p.start_date).split(' ')[0]} → ${fmtDate(p.due_date).split(' ')[0]}</span>
          <span>${pct}%</span>
        </div>
        ${p.notes ? `<div class="pc-address" style="margin-bottom:12px;">📝 ${escapeHtml(p.notes)}</div>` : ''}
        <div class="pc-actions">
          <button class="btn pc-checklist">Listă</button>
          <button class="btn pc-history">Istoric</button>
          ${isArchived
            ? `<button class="btn pc-restore">Dezarhivează</button>`
            : `<button class="btn pc-edit">Editează</button><button class="btn pc-delete">Șterge</button>`
          }
        </div>
      `;

      const checkbox = card.querySelector('.pc-select');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) projectSelectedIds.add(p.id);
        else projectSelectedIds.delete(p.id);
        updateProjectsArchiveBar();
      });

      const restoreBtn = card.querySelector('.pc-restore');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
          restoreBtn.disabled = true;
          const { error } = await supabaseClient
            .from('current_projects')
            .update({ archived: false, archived_at: null })
            .eq('id', p.id);
          restoreBtn.disabled = false;
          if (error) { console.error(error); alert('Eroare la dezarhivare. Încercați din nou.'); return; }
          logEntityActivity('project', p.id, 'Proiectul a fost dezarhivat.');
          loadProjects();
        });
      }

      const editBtn = card.querySelector('.pc-edit');
      if (editBtn) editBtn.addEventListener('click', () => openProjectForm(p));

      card.querySelector('.pc-checklist').addEventListener('click', () => openChecklistSheet('current_projects', p.id, p.checklist, loadProjects));
      card.querySelector('.pc-history').addEventListener('click', () => openEntityLogSheet('project', p.id, p.title));

      const deleteBtn = card.querySelector('.pc-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Ștergeți proiectul "${p.title}"? Această acțiune este permanentă.`)) return;
          const { error } = await supabaseClient.from('current_projects').delete().eq('id', p.id);
          if (error) { console.error(error); alert('Eroare la ștergere.'); return; }
          loadProjects();
        });
      }

      list.appendChild(card);
    });
  }

  /* ============================================================
     PROJECTS ARCHIVING — same bulk-select-and-archive pattern as
     tickets: move projects out of the public "Proiecte de
     modernizare" list and the default admin tabs without deleting
     the row. "Toate" already shows archived projects too (see
     getFilteredProjects), so they stay reachable any time.
     ============================================================ */
  const projectsArchiveBar = document.getElementById('projectsArchiveBar');
  const projectsSelectionCount = document.getElementById('projectsSelectionCount');
  const projectsArchiveSelectedBtn = document.getElementById('projectsArchiveSelectedBtn');
  const projectsClearSelectionBtn = document.getElementById('projectsClearSelectionBtn');

  function updateProjectsArchiveBar(){
    projectsSelectionCount.textContent = projectSelectedIds.size + ' selectate';
    projectsArchiveBar.classList.toggle('show', projectSelectedIds.size > 0);
  }

  projectsClearSelectionBtn.addEventListener('click', () => {
    projectSelectedIds.clear();
    updateProjectsArchiveBar();
    renderProjects();
  });

  projectsArchiveSelectedBtn.addEventListener('click', async () => {
    if (projectSelectedIds.size === 0) return;
    if (!confirm(`Arhivați ${projectSelectedIds.size} proiecte? Nu vor mai apărea pe pagina publică, dar rămân salvate și pot fi restaurate oricând.`)) {
      return;
    }
    projectsArchiveSelectedBtn.disabled = true;
    const { error } = await supabaseClient
      .from('current_projects')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .in('id', Array.from(projectSelectedIds));
    projectsArchiveSelectedBtn.disabled = false;

    if (error) {
      console.error(error);
      alert('Eroare la arhivare. Încercați din nou.');
      return;
    }
    Array.from(projectSelectedIds).forEach(id => logEntityActivity('project', id, 'Proiectul a fost arhivat.'));
    projectSelectedIds.clear();
    updateProjectsArchiveBar();
    loadProjects();
  });

  const projectForm = document.getElementById('projectForm');
  const excelPreviewWrap = document.getElementById('excelPreview');

  /* ============================================================
     BACKLOG PROJECTS — work that's identified but not urgent: not
     yet finished, not scheduled to wrap up soon, ongoing-but-not-
     mandatory-right-now. Deliberately simpler than "Proiecte curente"
     above (no due date, no progress bar, no archiving, no Excel
     import) since these fields don't apply to work with no near-term
     deadline. Completed work stays in the same table and is moved to
     its own "Soluționate" filter instead of being deleted. "Zile de la data înregistrării" is never stored — it's
     computed at render time from start_date, same spirit as
     calcProjectProgress() above for current_projects.
     ============================================================ */
  let allBacklogProjects = [];
  let backlogSearchQuery = '';
  let backlogFilter = 'Ongoing';

  async function loadBacklogProjects(){
    const { data, error } = await supabaseClient
      .from('backlog_projects')
      .select('*')
      .order('start_date', { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    allBacklogProjects = data || [];
    renderBacklogProjects();
    if (typeof renderProjectsHomeStats === 'function') renderProjectsHomeStats();
  }

  function daysSince(dateStr, endDateStr){
    if (!dateStr) return 0;
    const start = new Date(dateStr);
    const end = endDateStr ? new Date(endDateStr) : new Date();
    // Count calendar days inclusively: a project started and solved
    // today is 1 day, and each new calendar day adds one more.
    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }

  function getFilteredBacklogProjects(){
    const q = backlogSearchQuery.trim().toLowerCase();
    return allBacklogProjects.filter(p => {
      const statusMatches = backlogFilter === 'Toate' || (p.status || 'Ongoing') === backlogFilter;
      const searchMatches = !q || [p.title, p.address, p.employee_name, p.description]
        .some(field => (field || '').toLowerCase().includes(q));
      return statusMatches && searchMatches;
    });
  }

  const backlogChipDefs = [
    { key: 'Ongoing', label: 'Active' },
    { key: 'Terminat', label: 'Soluționate' },
    { key: 'Toate', label: 'Toate' },
  ];

  function setBacklogFilter(key){
    backlogFilter = key;
    document.querySelectorAll('#backlogChipsWrap .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.key === key);
    });
    if (typeof backlogFilterWidget !== 'undefined' && backlogFilterWidget) backlogFilterWidget.syncActiveState();
    renderBacklogProjects();
  }

  // Avarii rețele's own Filtre popover — status-only, no year/month/day
  // (Avarii never had that granularity in this file, matching
  // admin.html's own version, which also keeps it status-only here).
  const backlogFilterWidget = createFilterPopoverWidget({
    toggleBtnId: 'backlogFilterToggleBtn', popoverId: 'backlogFilterPopover',
    chipsWrapId: 'backlogChipsWrap', chipDefs: backlogChipDefs,
    getStatus: () => backlogFilter, setStatus: setBacklogFilter, defaultStatus: 'Ongoing',
    noteIds: ['backlogFilterNoteDesktop', 'backlogFilterNoteMobile'],
    savedViewsScope: 'backlog', savedViewsWrapId: 'backlogSavedViewsWrap', saveViewBtnId: 'backlogSaveViewBtn',
  });

  function renderBacklogProjects(){
    const list = document.getElementById('backlogList');
    const filtered = getFilteredBacklogProjects();
    // Export only makes sense as a full-list dump, so it's only shown
    // on the "Toate" chip — on "Active"/"Soluționate" it'd just be a
    // confusing partial export of whichever filter happens to be on.
    const exportBtn = document.getElementById('exportBacklogExcelBtn');
    if (exportBtn) exportBtn.style.display = backlogFilter === 'Toate' ? '' : 'none';
    const countEl = document.getElementById('backlogCount');
    if (countEl) countEl.textContent = filtered.length + ' din ' + allBacklogProjects.length + ' lucrări';
    const countMobileEl = document.getElementById('backlogCountMobile');
    if (countMobileEl) countMobileEl.textContent = filtered.length + ' din ' + allBacklogProjects.length + ' lucrări';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="no-results" style="padding:40px 0;text-align:center;color:var(--ink-400);">Nicio lucrare în backlog.</div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach(p => {
      const isDone = (p.status || 'Ongoing') === 'Terminat';
      // Solved work keeps its duration at the completion date;
      // active work continues counting through today.
      const days = daysSince(p.start_date, isDone ? p.resolved_on : null);
      const ageClass = days >= 90 ? 'age-stale' : days >= 30 ? 'age-aging' : 'age-fresh';
      const row = document.createElement('div');
      row.className = 'backlog-row ' + ageClass + (isDone ? ' done' : '');
      row.innerHTML = `
        <div class="backlog-main">
          <div class="backlog-title-line">
            <span class="backlog-title">${escapeHtml(p.title)}</span>
            ${isDone ? '<span class="backlog-tag">Soluționat</span>' : ''}
            <span class="backlog-days">${days} ${days === 1 ? 'zi' : 'zile'}</span>
            ${p.checklist && p.checklist.length ? `<span class="checklist-progress">${p.checklist.filter(i => i.done).length}/${p.checklist.length}</span>` : ''}
          </div>
          <div class="backlog-meta-line">${escapeHtml(p.address)}${p.employee_name ? ' · ' + escapeHtml(p.employee_name) : ''}${p.description ? ' · ' + escapeHtml(p.description) : ''}</div>
        </div>
        <div class="backlog-actions">
          <button class="btn bl-checklist">Listă</button>
          <button class="btn bl-history">Istoric</button>
          <button class="btn bl-edit">Editează</button>
          <button class="btn ${isDone ? '' : 'btn-primary'} bl-status">${isDone ? 'Reactivează' : 'Soluționat'}</button>
        </div>
      `;

      row.querySelector('.bl-edit').addEventListener('click', () => openBacklogForm(p));
      row.querySelector('.bl-checklist').addEventListener('click', () => openChecklistSheet('backlog_projects', p.id, p.checklist, loadBacklogProjects));
      row.querySelector('.bl-history').addEventListener('click', () => openEntityLogSheet('backlog', p.id, p.title));
      row.querySelector('.bl-status').addEventListener('click', async () => {
        const nextStatus = isDone ? 'Ongoing' : 'Terminat';
        const question = isDone
          ? `Reactivați lucrarea "${p.title}"?`
          : `Marcați lucrarea "${p.title}" ca soluționată? Va fi mutată în tab-ul „Soluționate”.`;
        if (!confirm(question)) return;
        const { error } = await supabaseClient
          .from('backlog_projects')
          .update({ status: nextStatus, resolved_on: isDone ? null : new Date().toISOString() })
          .eq('id', p.id);
        if (error) { console.error(error); alert('Eroare la actualizarea lucrării. Încercați din nou.'); return; }
        logEntityActivity('backlog', p.id, isDone ? 'Lucrarea a fost reactivată.' : 'Lucrarea a fost marcată ca soluționată.');
        loadBacklogProjects();
      });

      list.appendChild(row);
    });
  }

  const backlogForm = document.getElementById('backlogForm');

  function openBacklogForm(project){
    document.getElementById('bf-id').value = project ? project.id : '';
    document.getElementById('bf-title').value = project ? project.title : '';
    document.getElementById('bf-address').value = project ? project.address : '';
    document.getElementById('bf-employee').value = project ? (project.employee_name || '') : '';
    document.getElementById('bf-start').value = project ? project.start_date : '';
    document.getElementById('bf-description').value = project ? (project.description || '') : '';
    backlogForm.style.display = 'block';
    backlogForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  document.getElementById('addBacklogBtn').addEventListener('click', () => openBacklogForm(null));
  document.getElementById('bfCancelBtn').addEventListener('click', () => {
    backlogForm.style.display = 'none';
  });

  document.getElementById('bfSaveBtn').addEventListener('click', async () => {
    const id = document.getElementById('bf-id').value;
    const title = document.getElementById('bf-title').value.trim();
    const address = document.getElementById('bf-address').value.trim();
    const employee_name = document.getElementById('bf-employee').value.trim();
    const start = document.getElementById('bf-start').value;
    const description = document.getElementById('bf-description').value.trim();

    if (!title || !address || !start) {
      alert('Completați tipul lucrării, adresa și data înregistrării.');
      return;
    }

    const payload = {
      title, address, start_date: start,
      employee_name: employee_name || null,
      description: description || null,
    };
    const { error } = id
      ? await supabaseClient.from('backlog_projects').update(payload).eq('id', id)
      : await supabaseClient.from('backlog_projects').insert(payload);

    if (error) {
      console.error(error);
      alert('Eroare la salvare. Încercați din nou.');
      return;
    }
    backlogForm.style.display = 'none';
    showToast(id ? 'Lucrarea a fost actualizată.' : 'Lucrarea a fost adăugată.');
    loadBacklogProjects();
  });

  const backlogSearchBox = document.getElementById('backlogSearchBox');

  // Avarii's own search icon — status-only widen (no year/month/day:
  // Avarii rețele never had that concept), matching
  // createSearchToggleWidget's own optional-target gating.
  const backlogSearchWidget = createSearchToggleWidget({
    toggleBtnId: 'backlogSearchToggleBtn', wrapId: 'backlogSearchWrap', boxId: 'backlogSearchBox',
    setQuery: (v) => { backlogSearchQuery = v; }, rerender: renderBacklogProjects,
    getStatus: () => backlogFilter, setStatus: setBacklogFilter, widenStatus: 'Toate',
  });

  
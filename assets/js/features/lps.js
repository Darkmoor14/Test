  // Personal planning workspace for vlasbogdan@. It deliberately uses
  // browser storage, keeping internal initiatives separate from shared
  // field projects and avoiding any change to the existing Supabase schema.
  const INTERNAL_PROJECTS_STORAGE_KEY = 'insta-grup-vlas-internal-projects-v1';
  let internalProjects = [];

  function loadInternalProjects(){
    try {
      const saved = JSON.parse(localStorage.getItem(INTERNAL_PROJECTS_STORAGE_KEY) || '[]');
      internalProjects = Array.isArray(saved) ? saved : [];
    } catch (_) {
      internalProjects = [];
    }
  }

  function saveInternalProjects(){
    localStorage.setItem(INTERNAL_PROJECTS_STORAGE_KEY, JSON.stringify(internalProjects));
  }

  // Project add/edit form now lives inline in the LPS panel itself
  // (see lpsEditProjectBtn/lpsDeleteProjectBtn below) — there's no
  // longer a separate "Proiecte interne" list view to browse/manage
  // projects from; LPS's own project dropdown is the only place a
  // project is picked, so managing one happens right there too.
  function showInternalProjectForm(project){
    const form = document.getElementById('internalProjectForm');
    if (!form) return;
    document.getElementById('internalProjectId').value = project ? project.id : '';
    document.getElementById('internalProjectTitle').value = project ? project.title : '';
    document.getElementById('internalProjectOwner').value = project ? project.owner || '' : '';
    document.getElementById('internalProjectDue').value = project ? project.due_date || '' : '';
    document.getElementById('internalProjectStage').value = project ? project.stage : 'Planificare';
    document.getElementById('internalProjectNext').value = project ? project.next_action || '' : '';
    form.hidden = false;
    document.getElementById('internalProjectTitle').focus();
  }

  document.getElementById('cancelInternalProjectBtn').addEventListener('click', () => { document.getElementById('internalProjectForm').hidden = true; });
  document.getElementById('internalProjectForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!isReportFocusedView()) return;
    loadInternalProjects();
    const id = document.getElementById('internalProjectId').value;
    const project = {
      id: id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      title: document.getElementById('internalProjectTitle').value.trim(),
      owner: document.getElementById('internalProjectOwner').value.trim(),
      due_date: document.getElementById('internalProjectDue').value,
      stage: document.getElementById('internalProjectStage').value,
      next_action: document.getElementById('internalProjectNext').value.trim(),
    };
    if (!project.title) return;
    const index = internalProjects.findIndex(item => item.id === project.id);
    if (index >= 0) internalProjects[index] = project;
    else internalProjects.push(project);
    saveInternalProjects();
    document.getElementById('internalProjectForm').hidden = true;
    lpsSelectedProjectId = project.id;
    renderLpsWorkspace();
  });
  document.getElementById('lpsEditProjectBtn').addEventListener('click', () => {
    const project = getSelectedLpsProject();
    if (project) showInternalProjectForm(project);
  });
  document.getElementById('lpsDeleteProjectBtn').addEventListener('click', () => {
    const project = getSelectedLpsProject();
    if (!project || !window.confirm(`Șterge proiectul „${project.title}” și toată planificarea LPS asociată?`)) return;
    loadInternalProjects();
    const index = internalProjects.findIndex(item => item.id === project.id);
    if (index >= 0) internalProjects.splice(index, 1);
    saveInternalProjects();
    const lpsStore = loadLpsStore();
    delete lpsStore[project.id];
    saveLpsStore(lpsStore);
    lpsSelectedProjectId = '';
    renderLpsWorkspace();
  });

  /* ============================================================
     LAST PLANNER SYSTEM — VLAS-ONLY PERSONAL WORKSPACE
     The LPS data stays separate from shared operational records.
     It is structured around LCI's connected conversations: SHOULD
     (milestones), CAN (handoffs / look-ahead), WILL (weekly promises),
     DID (huddles, PPC, and reasons for variance).
     ============================================================ */
  const LPS_STORAGE_KEY = 'insta-grup-vlas-lps-v1';
  const LPS_VARIANCE_REASONS = ['Materiale', 'Acces', 'Aviz / proiectare', 'Resurse', 'Predecesor', 'Vreme', 'Schimbare de plan', 'Supracomitere', 'Altul'];
  let lpsSelectedProjectId = '';
  let lpsActiveView = 'overview';

  function lpsId(){
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function mondayIso(date = new Date()){
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
    return value.toISOString().slice(0, 10);
  }
  function lpsDate(value){ return value ? fmtDateOnly(value) : 'fără dată'; }
  // "dd.mm–dd.mm" label for the Mon-Sun week starting on weekStartIso.
  function lpsWeekRangeLabel(weekStartIso){
    if (!weekStartIso) return '';
    const start = new Date(weekStartIso + 'T00:00:00');
    if (isNaN(start.getTime())) return '';
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
    return `${fmt(start)}–${fmt(end)}`;
  }
  function loadLpsStore(){
    try {
      const parsed = JSON.parse(localStorage.getItem(LPS_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }
  function saveLpsStore(store){ localStorage.setItem(LPS_STORAGE_KEY, JSON.stringify(store)); }
  function getLpsProjectData(store, projectId){
    if (!store[projectId]) store[projectId] = { milestones: [], pull: [], lookahead: [], constraints: [], weekly: [], huddles: [] };
    return store[projectId];
  }
  function getSelectedLpsProject(){
    loadInternalProjects();
    return internalProjects.find(project => project.id === lpsSelectedProjectId) || null;
  }
  function renderLpsWorkspace(){
    if (!isReportFocusedView()) return;
    loadInternalProjects();
    const select = document.getElementById('lpsProjectSelect');
    const workspace = document.getElementById('lpsWorkspace');
    const empty = document.getElementById('lpsNoProjectMessage');
    if (!select || !workspace || !empty) return;
    if (!internalProjects.length) {
      select.innerHTML = '<option value="">Nu există proiecte interne</option>';
      workspace.hidden = true;
      empty.hidden = false;
      return;
    }
    if (!internalProjects.some(project => project.id === lpsSelectedProjectId)) lpsSelectedProjectId = internalProjects[0].id;
    select.innerHTML = internalProjects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title)}</option>`).join('');
    select.value = lpsSelectedProjectId;
    workspace.hidden = false;
    empty.hidden = true;
    const store = loadLpsStore();
    const data = getLpsProjectData(store, lpsSelectedProjectId);
    saveLpsStore(store);
    const currentWeek = mondayIso();
    const previousWeekDate = new Date();
    previousWeekDate.setDate(previousWeekDate.getDate() - 7);
    const previousWeekStart = mondayIso(previousWeekDate);
    const weeklyCurrent = data.weekly.filter(item => item.week_start === currentWeek);
    // PPC is a lagging measure — it's meant to compare what was
    // promised for a week against what actually got done BY THE END
    // of that week, not a mid-week snapshot of a plan still in
    // progress. Computing it off weeklyCurrent (the week that's still
    // running) made it look artificially bad every Monday/Tuesday,
    // since most of that week's promises are legitimately still
    // "Promis" rather than evaluated yet. The headline number below
    // is now the most recently CLOSED week (always the calendar week
    // immediately before this one); the still-running week gets its
    // own live, unlabeled-as-PPC progress note in the weekly section
    // instead (see lpsWeeklyLiveNote below).
    const weeklyLastCompleted = data.weekly.filter(item => item.week_start === previousWeekStart);
    const completeLast = weeklyLastCompleted.filter(item => item.status === 'Terminat').length;
    const missedLast = weeklyLastCompleted.filter(item => item.status === 'Neîndeplinit');
    const ppc = weeklyLastCompleted.length ? Math.round((completeLast / weeklyLastCompleted.length) * 100) : null;
    const ready = lpsLookaheadItems.filter(item => item.ready).length;
    const openConstraints = data.constraints.filter(item => !item.resolved).length;
    document.getElementById('lpsPpcValue').textContent = ppc === null ? '–' : `${ppc}%`;
    document.getElementById('lpsPpcNote').textContent = weeklyLastCompleted.length
      ? `${completeLast} din ${weeklyLastCompleted.length} promisiuni · săpt. ${lpsWeekRangeLabel(previousWeekStart)}`
      : `fără promisiuni în săpt. ${lpsWeekRangeLabel(previousWeekStart)}`;
    document.getElementById('lpsReadyValue').textContent = ready;
    document.getElementById('lpsConstraintsValue').textContent = openConstraints;
    document.getElementById('lpsVarianceValue').textContent = missedLast.length;
    const liveNoteEl = document.getElementById('lpsWeeklyLiveNote');
    if (liveNoteEl) {
      const completeCurrent = weeklyCurrent.filter(item => item.status === 'Terminat').length;
      liveNoteEl.textContent = weeklyCurrent.length
        ? `Săptămâna în curs (${lpsWeekRangeLabel(currentWeek)}): ${completeCurrent} din ${weeklyCurrent.length} finalizate până acum — PPC-ul acestei săptămâni se calculează abia după ce se încheie.`
        : `Săptămâna în curs (${lpsWeekRangeLabel(currentWeek)}): nicio promisiune adăugată încă.`;
    }
    document.querySelectorAll('.lps-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.lpsView === lpsActiveView));
    document.querySelectorAll('.lps-section').forEach(section => section.classList.toggle('active', section.dataset.lpsSection === lpsActiveView));

    const milestoneList = document.getElementById('lpsMilestonesList');
    milestoneList.innerHTML = data.milestones.length ? data.milestones.map(item => lpsItemHtml('milestones', item, `${item.owner || 'Responsabil nealocat'} · ${lpsDate(item.due_date)}`, item.done ? 'Finalizat' : 'Deschis', item.done ? 'done' : '')).join('') : lpsEmpty('Adaugă reperele care definesc fazele proiectului.');
    const pullList = document.getElementById('lpsPullList');
    pullList.innerHTML = data.pull.length ? data.pull.map(item => lpsItemHtml('pull', item, `${item.from_owner || 'Nespecificat'} → ${item.to_owner || 'Nespecificat'}`, item.done ? 'Predat' : 'De predat', item.done ? 'done' : '', item.condition)).join('') : lpsEmpty('Adaugă predările necesare dintre echipe sau responsabili.');
    const lookaheadList = document.getElementById('lpsLookaheadList');
    lookaheadList.innerHTML = lpsLookaheadItems.length
      ? lpsLookaheadItems.map(item => lpsLookaheadItemHtml(item)).join('')
      : lpsEmpty('Adaugă lucrările care pot începe în următoarele șase săptămâni.');
    const constraintList = document.getElementById('lpsConstraintsList');
    constraintList.innerHTML = data.constraints.length ? data.constraints.map(item => {
      const meta = `${escapeHtml(item.category)} · ${item.owner || 'Responsabil nealocat'} · termen ${lpsDate(item.due_date)}`;
      const resolve = item.resolved ? '' : '<button type="button" class="btn lps-resolve-btn">Marchează eliminată</button>';
      return lpsItemHtml('constraints', item, meta, item.resolved ? 'Eliminată' : 'Deschisă', item.resolved ? 'done' : 'blocked', item.action, resolve);
    }).join('') : lpsEmpty('Înregistrează un blocaj înainte ca acesta să întârzie lucrarea.');
    const weeklyList = document.getElementById('lpsWeeklyList');
    weeklyList.innerHTML = data.weekly.length ? data.weekly.slice().sort((a, b) => (b.week_start || '').localeCompare(a.week_start || '')).map(item => lpsWeeklyItemHtml(item)).join('') : lpsEmpty('Adaugă promisiuni pentru săptămâna de lucru sau promovează o lucrare pregătită din look-ahead.');
    const huddleList = document.getElementById('lpsHuddleList');
    huddleList.innerHTML = data.huddles.length ? data.huddles.slice().sort((a, b) => (b.huddle_date || '').localeCompare(a.huddle_date || '')).map(item => lpsItemHtml('huddles', item, `${lpsDate(item.huddle_date)} · ${item.facilitator || 'Facilitator nealocat'}`, 'Huddle', '', item.notes)).join('') : lpsEmpty('Salvează rezultatul următoarei întâlniri scurte de coordonare.');
    const weeklyStart = document.querySelector('#lpsWeeklyForm [name="week_start"]');
    if (weeklyStart && !weeklyStart.value) weeklyStart.value = currentWeek;
    renderLpsVarianceBreakdown(data);
    renderLpsGantt(data);
  }
  function lpsGanttDate(iso){
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  function lpsGanttPct(date, range){
    const total = range.end.getTime() - range.start.getTime();
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, ((date.getTime() - range.start.getTime()) / total) * 100));
  }
  // Weekly ticks read better than monthly ones on a short project, but
  // stop being legible once the visible window gets much past two
  // months — 70 days is the rough crossover point.
  function lpsGanttTicks(range){
    const stepDays = (range.end.getTime() - range.start.getTime()) / 86400000 <= 70 ? 7 : 30;
    const ticks = [];
    let cursor = new Date(range.start);
    while (cursor.getTime() <= range.end.getTime()) {
      ticks.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + stepDays * 86400000);
    }
    return ticks;
  }
  // A lightweight Gantt-style timeline built from data the LPS tabs
  // already collect — no separate schedule to maintain. Milestones
  // plot as diamonds on their due date; look-ahead items (the only
  // things with both a start and an end) plot as bars; open
  // constraints and weekly promises plot as single-point markers,
  // since they don't have a duration of their own. Rows are grouped
  // by section and sorted by date within each group so the chart
  // reads top-to-bottom the same way the LPS conversations flow.
  function renderLpsGantt(data){
    const el = document.getElementById('lpsGanttChart');
    if (!el) return;
    const rows = [];
    const dated = [];
    const trackDate = (iso) => { const d = lpsGanttDate(iso); if (d) dated.push(d); return d; };

    const milestonesDated = data.milestones.filter(m => m.due_date);
    if (milestonesDated.length) {
      rows.push({ type: 'group', label: 'Repere' });
      milestonesDated.slice().sort((a, b) => a.due_date.localeCompare(b.due_date)).forEach(m => {
        rows.push({ type: 'milestone', label: m.title, date: trackDate(m.due_date), done: !!m.done });
      });
    }
    const lookaheadDated = data.lookahead.filter(l => l.start_date || l.due_date);
    if (lookaheadDated.length) {
      rows.push({ type: 'group', label: 'Look-ahead' });
      lookaheadDated.slice().sort((a, b) => (a.start_date || a.due_date).localeCompare(b.start_date || b.due_date)).forEach(l => {
        rows.push({ type: 'lookahead', label: l.title, start: trackDate(l.start_date || l.due_date), end: trackDate(l.due_date || l.start_date), ready: !!l.ready });
      });
    }
    const openConstraints = data.constraints.filter(c => !c.resolved && c.due_date);
    if (openConstraints.length) {
      rows.push({ type: 'group', label: 'Constrângeri deschise' });
      openConstraints.slice().sort((a, b) => a.due_date.localeCompare(b.due_date)).forEach(c => {
        rows.push({ type: 'constraint', label: c.title, date: trackDate(c.due_date) });
      });
    }
    const weeklyDated = data.weekly.filter(w => w.planned_date || w.week_start);
    if (weeklyDated.length) {
      rows.push({ type: 'group', label: 'Promisiuni săptămânale' });
      weeklyDated.slice().sort((a, b) => (a.planned_date || a.week_start).localeCompare(b.planned_date || b.week_start)).forEach(w => {
        rows.push({ type: 'weekly', label: w.title, date: trackDate(w.planned_date || w.week_start), status: w.status });
      });
    }

    if (!dated.length) {
      el.innerHTML = '<div class="lps-gantt-empty">Adaugă date la repere, look-ahead, constrângeri sau promisiuni pentru a vedea cronologia proiectului.</div>';
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(Math.min(...dated.map(d => d.getTime()), today.getTime()));
    const end = new Date(Math.max(...dated.map(d => d.getTime()), today.getTime()));
    start.setDate(start.getDate() - 3);
    end.setDate(end.getDate() + 3);
    const range = { start, end };

    const ticks = lpsGanttTicks(range);
    const fmtTick = (d) => d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });

    const labelsHtml = ['<div class="lps-gantt-label-spacer"></div>'];
    const trackHtml = [
      `<div class="lps-gantt-scale">${ticks.map(t => `<span class="lps-gantt-tick-label" style="left:${lpsGanttPct(t, range)}%">${fmtTick(t)}</span>`).join('')}</div>`,
      ...ticks.map(t => `<div class="lps-gantt-gridline" style="left:${lpsGanttPct(t, range)}%"></div>`),
      `<div class="lps-gantt-today-line" style="left:${lpsGanttPct(today, range)}%"><span>Azi</span></div>`,
    ];

    rows.forEach(row => {
      if (row.type === 'group') {
        labelsHtml.push(`<div class="lps-gantt-group-label">${escapeHtml(row.label)}</div>`);
        trackHtml.push('<div class="lps-gantt-group-row"></div>');
        return;
      }
      labelsHtml.push(`<div class="lps-gantt-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>`);
      if (row.type === 'milestone') {
        trackHtml.push(`<div class="lps-gantt-track-row"><span class="lps-gantt-marker ${row.done ? 'milestone-done' : 'milestone-open'}" style="left:${lpsGanttPct(row.date, range)}%" title="${escapeHtml(row.label)} · ${fmtTick(row.date)}"></span></div>`);
      } else if (row.type === 'lookahead') {
        const leftPct = lpsGanttPct(row.start, range);
        const widthPct = Math.max(lpsGanttPct(row.end, range) - leftPct, 1.2);
        trackHtml.push(`<div class="lps-gantt-track-row"><span class="lps-gantt-bar ${row.ready ? 'ready' : 'blocked'}" style="left:${leftPct}%;width:${widthPct}%" title="${escapeHtml(row.label)}"></span></div>`);
      } else if (row.type === 'constraint') {
        trackHtml.push(`<div class="lps-gantt-track-row"><span class="lps-gantt-marker constraint" style="left:${lpsGanttPct(row.date, range)}%" title="${escapeHtml(row.label)} · termen ${fmtTick(row.date)}"></span></div>`);
      } else if (row.type === 'weekly') {
        const statusClass = row.status === 'Terminat' ? 'status-done' : row.status === 'Neîndeplinit' ? 'status-missed' : 'status-pending';
        trackHtml.push(`<div class="lps-gantt-track-row"><span class="lps-gantt-dot ${statusClass}" style="left:${lpsGanttPct(row.date, range)}%" title="${escapeHtml(row.label)} · ${fmtTick(row.date)}"></span></div>`);
      }
    });

    el.innerHTML = `<div class="lps-gantt-labels">${labelsHtml.join('')}</div><div class="lps-gantt-track-wrap">${trackHtml.join('')}</div>`;
  }
  // The "Learn" half of Should/Can/Will/Did/Learn: a missed promise
  // on its own is just a log entry — the point of recording a reason
  // is to spot which one keeps coming back so it can actually be
  // fixed, rather than re-discovering the same blocker every huddle.
  // Counted across the whole project's history rather than a rolling
  // window, since a new LPS project won't have enough missed weeks
  // yet for a windowed view to mean anything.
  function renderLpsVarianceBreakdown(data){
    const el = document.getElementById('lpsVarianceBreakdown');
    if (!el) return;
    const counts = {};
    let total = 0;
    data.weekly.forEach(item => {
      if (item.status === 'Neîndeplinit' && item.variance) {
        counts[item.variance] = (counts[item.variance] || 0) + 1;
        total++;
      }
    });
    if (!total) {
      el.innerHTML = '<h4>Motive de variație (de la începutul proiectului)</h4><p class="lps-item-meta">Încă nu există promisiuni neîndeplinite cu motiv înregistrat.</p>';
      return;
    }
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([reason, count]) => {
      const pct = Math.round((count / total) * 100);
      return `<div class="lps-variance-row"><span>${escapeHtml(reason)}</span><span class="lps-variance-bar-track"><span class="lps-variance-bar-fill" style="width:${pct}%"></span></span><span>${count}</span></div>`;
    }).join('');
    el.innerHTML = `<h4>Motive de variație (de la începutul proiectului · ${total} promisiuni neîndeplinite)</h4>${rows}`;
  }
  function lpsEmpty(message){ return `<div class="lps-empty">${message}</div>`; }
  function lpsItemHtml(collection, item, meta, status, statusClass = '', note = '', extraAction = ''){
    return `<article class="lps-item" data-lps-collection="${collection}" data-lps-id="${escapeHtml(item.id)}"><div><div class="lps-item-title">${escapeHtml(item.title)}</div><div class="lps-item-meta">${meta}</div><span class="lps-status ${statusClass}">${status}</span>${note ? `<p class="lps-item-note">${escapeHtml(note)}</p>` : ''}</div><div class="lps-item-actions">${extraAction}${['milestones', 'pull'].includes(collection) ? '<button type="button" class="btn lps-complete-btn">Finalizează</button>' : ''}<button type="button" class="btn lps-delete-btn">Șterge</button></div></article>`;
  }

  /* ============================================================
     LPS LOOK-AHEAD — the one LPS section backed by Supabase instead
     of the local LPS_STORAGE_KEY blob (see the migration comment on
     lps_lookahead_items), so equipment/material needs attached here
     are visible to everyone and actually affect shared ERP stock.
     Grouped by project_label (the local internal project's title —
     internal projects themselves stay local, only look-ahead moved).
     ============================================================ */
  let lpsLookaheadItems = [];
  async function loadLookaheadItems(){
    const project = getSelectedLpsProject();
    if (!project) { lpsLookaheadItems = []; return; }
    const { data, error } = await supabaseClient
      .from('lps_lookahead_items')
      .select('*')
      .eq('project_label', project.title)
      .order('start_date', { ascending: true });
    if (error) { console.error(error); lpsLookaheadItems = []; return; }
    lpsLookaheadItems = data || [];
  }
  async function refreshLookaheadWorkspace(){
    // Establishes internalProjects/lpsSelectedProjectId first (a plain
    // sync render using whatever's already cached) so the async fetch
    // right after knows which project to actually ask for — on the
    // very first LPS visit nothing is selected yet until this runs.
    renderLpsWorkspace();
    const { data: eqData, error: eqError } = await supabaseClient.from('equipment_inventory').select('*').order('name', { ascending: true });
    if (!eqError) allEquipment = eqData || [];
    await Promise.all([loadLookaheadItems(), loadResourceAssignments()]);
    renderLpsWorkspace();
  }
  function lpsLookaheadItemHtml(item){
    const meta = `${item.owner || 'Responsabil nealocat'} · ${lpsDate(item.start_date)} → ${lpsDate(item.due_date)}${item.location ? ' · ' + escapeHtml(item.location) : ''}`;
    const action = item.ready
      ? '<button type="button" class="btn lps-promote-btn">Promite săptămâna asta</button>'
      : '<button type="button" class="btn lps-make-ready-btn">Marchează pregătită</button>';
    const myAssignments = allResourceAssignments.filter(a => a.lookahead_item_id === item.id);
    const resourceRowsHtml = myAssignments.map(a => {
      const inv = allEquipment.find(e => e.id === a.inventory_item_id);
      const name = inv ? inv.name : '(șters din inventar)';
      const detail = a.item_type === 'echipament'
        ? `${formatWoDateRO(a.reserved_from)} – ${formatWoDateRO(a.reserved_to)}`
        : `${a.quantity}${inv && inv.unit ? ' ' + inv.unit : ''}`;
      const statusLabel = a.status === 'reserved' ? (a.item_type === 'material' ? 'Rezervat (proiect neterminat)' : 'Rezervat') : a.status === 'consumed' ? 'Consumat' : 'Eliberat';
      const consumeBtn = a.status === 'reserved' && a.item_type === 'material' ? `<button type="button" class="btn lps-resource-consume" data-assignment-id="${escapeHtml(a.id)}">Marchează consumat</button>` : '';
      const releaseBtn = a.status === 'reserved' && a.item_type === 'echipament' ? `<button type="button" class="btn lps-resource-release" data-assignment-id="${escapeHtml(a.id)}">Eliberează</button>` : '';
      return `<div class="lps-resource-row">
        <span class="lps-resource-name">${escapeHtml(name)}</span>
        <span class="lps-resource-detail">${escapeHtml(detail)}</span>
        <span class="lps-resource-status ${a.status}">${statusLabel}</span>
        ${consumeBtn}${releaseBtn}
        <button type="button" class="btn lps-resource-delete" data-assignment-id="${escapeHtml(a.id)}">Șterge</button>
      </div>`;
    }).join('');
    return `<article class="lps-item" data-lps-collection="lookahead" data-lps-id="${escapeHtml(item.id)}">
      <div>
        <div class="lps-item-title">${escapeHtml(item.title)}${item.checklist && item.checklist.length ? ` <span class="checklist-progress">${item.checklist.filter(i => i.done).length}/${item.checklist.length}</span>` : ''}</div>
        <div class="lps-item-meta">${meta}</div>
        <span class="lps-status ${item.ready ? 'ready' : 'blocked'}">${item.ready ? 'Pregătit' : 'Blocată'}</span>
        <div class="lps-resources">
          ${resourceRowsHtml}
          <button type="button" class="btn lps-add-resource-btn" data-lookahead-id="${escapeHtml(item.id)}">+ Resursă (echipament/material)</button>
        </div>
      </div>
      <div class="lps-item-actions">${action}<button type="button" class="btn lps-checklist-btn">Listă</button><button type="button" class="btn lps-history-btn">Istoric</button><button type="button" class="btn lps-delete-btn">Șterge</button></div>
    </article>`;
  }
  function lpsWeeklyItemHtml(item){
    const statusOptions = ['Promis', 'Terminat', 'Neîndeplinit'].map(status => `<option${item.status === status ? ' selected' : ''}>${status}</option>`).join('');
    const reasonOptions = `<option value="">Alege motivul dacă nu s-a îndeplinit</option>${LPS_VARIANCE_REASONS.map(reason => `<option${item.variance === reason ? ' selected' : ''}>${reason}</option>`).join('')}`;
    return `<article class="lps-item" data-lps-collection="weekly" data-lps-id="${escapeHtml(item.id)}"><div><div class="lps-item-title">${escapeHtml(item.title)}</div><div class="lps-item-meta">${escapeHtml(item.owner)} · săptămâna ${lpsDate(item.week_start)}${item.planned_date ? ' · ziua ' + lpsDate(item.planned_date) : ''}</div><span class="lps-status ${item.status === 'Terminat' ? 'done' : item.status === 'Neîndeplinit' ? 'missed' : ''}">${item.status}</span>${item.condition ? `<p class="lps-item-note">Condiție: ${escapeHtml(item.condition)}</p>` : ''}<div class="lps-eval"><select class="lps-weekly-status">${statusOptions}</select><select class="lps-weekly-variance"${item.status === 'Neîndeplinit' ? '' : ' disabled'}>${reasonOptions}</select></div></div><div class="lps-item-actions"><button type="button" class="btn lps-delete-btn">Șterge</button></div></article>`;
  }
  function addLpsItem(collection, item){
    const store = loadLpsStore();
    getLpsProjectData(store, lpsSelectedProjectId)[collection].push({ id: lpsId(), ...item });
    saveLpsStore(store);
    renderLpsWorkspace();
  }
  function bindLpsForm(formId, collection, mapper){
    document.getElementById(formId).addEventListener('submit', event => {
      event.preventDefault();
      if (!isReportFocusedView() || !lpsSelectedProjectId) return;
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.title && collection !== 'huddles') return;
      addLpsItem(collection, mapper(values));
      form.reset();
      if (formId === 'lpsWeeklyForm') form.querySelector('[name="week_start"]').value = mondayIso();
    });
  }
  bindLpsForm('lpsMilestoneForm', 'milestones', values => ({ ...values, done: false }));
  bindLpsForm('lpsPullForm', 'pull', values => ({ ...values, done: false }));
  document.getElementById('lpsLookaheadForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!isReportFocusedView() || !lpsSelectedProjectId) return;
    const project = getSelectedLpsProject();
    if (!project) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.title) return;
    const payload = {
      project_label: project.title,
      title: values.title,
      owner: values.owner || null,
      location: values.location || null,
      start_date: values.start_date || null,
      due_date: values.due_date || null,
      ready: values.ready === 'true',
    };
    const { error } = await supabaseClient.from('lps_lookahead_items').insert(payload);
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
    form.reset();
    await refreshLookaheadWorkspace();
  });
  bindLpsForm('lpsConstraintForm', 'constraints', values => ({ ...values, resolved: false }));
  bindLpsForm('lpsWeeklyForm', 'weekly', values => ({ ...values, status: 'Promis', variance: '' }));
  document.getElementById('lpsHuddleForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!isReportFocusedView() || !lpsSelectedProjectId) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.huddle_date) return;
    addLpsItem('huddles', { ...values, title: 'Huddle de coordonare' });
    form.reset();
  });
  document.getElementById('lpsProjectSelect').addEventListener('change', event => { lpsSelectedProjectId = event.target.value; refreshLookaheadWorkspace(); });
  document.getElementById('lpsNewProjectBtn').addEventListener('click', () => showInternalProjectForm(null));
  document.querySelectorAll('.lps-tab').forEach(tab => tab.addEventListener('click', () => { lpsActiveView = tab.dataset.lpsView; renderLpsWorkspace(); }));
  document.getElementById('panel-lps').addEventListener('click', async event => {
    // Look-ahead resource rows (Marchează consumat / Eliberează / Șterge
    // on one equipment or material assignment) and the "+ Resursă"
    // button aren't collection items themselves, so they're handled
    // first, ahead of the [data-lps-collection] lookup below.
    const addResourceBtn = event.target.closest('.lps-add-resource-btn');
    if (addResourceBtn) { openAddResourceSheet(addResourceBtn.dataset.lookaheadId); return; }
    const consumeBtn = event.target.closest('.lps-resource-consume');
    const releaseBtn = event.target.closest('.lps-resource-release');
    const deleteResourceBtn = event.target.closest('.lps-resource-delete');
    if (consumeBtn || releaseBtn || deleteResourceBtn) {
      const assignmentId = (consumeBtn || releaseBtn || deleteResourceBtn).dataset.assignmentId;
      const assignment = allResourceAssignments.find(a => a.id === assignmentId);
      if (!assignment) return;
      if (consumeBtn) {
        const { error } = await AppDataServices.erp.setResourceStatus(supabaseClient, assignmentId, 'consumed');
        if (error) { console.error(error); alert('Eroare. Încercați din nou.'); return; }
      } else if (releaseBtn) {
        const { error } = await AppDataServices.erp.setResourceStatus(supabaseClient, assignmentId, 'returned');
        if (error) { console.error(error); alert('Eroare. Încercați din nou.'); return; }
      } else if (deleteResourceBtn) {
        if (!confirm('Ștergeți această resursă din lucrare?')) return;
        const { error } = await AppDataServices.erp.deleteResource(supabaseClient, assignmentId);
        if (error) { console.error(error); alert('Eroare. Încercați din nou.'); return; }
      }
      await refreshLookaheadWorkspace();
      return;
    }

    const itemElement = event.target.closest('[data-lps-collection]');
    if (!itemElement || !isReportFocusedView()) return;
    const collection = itemElement.dataset.lpsCollection;

    if (collection === 'lookahead') {
      const lookaheadId = itemElement.dataset.lpsId;
      const item = lpsLookaheadItems.find(x => x.id === lookaheadId);
      if (!item) return;
      if (event.target.closest('.lps-delete-btn')) {
        if (!window.confirm('Șterge această înregistrare LPS? Resursele asociate (rezervări echipament/material) se șterg și ele.')) return;
        // Give back stock for any still-reserved material assignments
        // before the cascade delete removes their rows.
        const myAssignments = allResourceAssignments.filter(a => a.lookahead_item_id === lookaheadId);
        for (const a of myAssignments) {
          if (a.status === 'reserved' && a.item_type === 'material' && a.quantity) {
            const inv = allEquipment.find(e => e.id === a.inventory_item_id);
            if (inv) {
              const resultingQty = Number(inv.quantity) + Number(a.quantity);
              await supabaseClient.from('equipment_inventory').update({ quantity: resultingQty }).eq('id', inv.id);
              logStockLedger(inv.id, inv.name, Number(a.quantity), resultingQty, 'Returnat — ștergere lucrare LPS');
            }
          }
        }
        const { error } = await supabaseClient.from('lps_lookahead_items').delete().eq('id', lookaheadId);
        if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
      } else if (event.target.closest('.lps-make-ready-btn')) {
        const { error } = await supabaseClient.from('lps_lookahead_items').update({ ready: true }).eq('id', lookaheadId);
        if (error) { console.error(error); alert('Eroare. Încercați din nou.'); return; }
        logEntityActivity('lookahead', lookaheadId, 'Marcată pregătită.');
      } else if (event.target.closest('.lps-promote-btn')) {
        addLpsItem('weekly', { title: item.title, owner: item.owner || '', week_start: mondayIso(), planned_date: item.start_date || '', condition: item.location ? `Lucru realizat în ${item.location}` : '', status: 'Promis', variance: '' });
        logEntityActivity('lookahead', lookaheadId, 'Promisă pentru săptămâna curentă.');
      } else if (event.target.closest('.lps-checklist-btn')) {
        openChecklistSheet('lps_lookahead_items', item.id, item.checklist, refreshLookaheadWorkspace);
        return;
      } else if (event.target.closest('.lps-history-btn')) {
        openEntityLogSheet('lookahead', item.id, item.title);
        return;
      } else return;
      await refreshLookaheadWorkspace();
      return;
    }

    // The remaining sections (milestones/pull/constraints/weekly/huddles)
    // still live entirely in local storage.
    const store = loadLpsStore();
    const data = getLpsProjectData(store, lpsSelectedProjectId);
    const items = data[collection];
    const index = items.findIndex(item => item.id === itemElement.dataset.lpsId);
    if (index < 0) return;
    if (event.target.closest('.lps-delete-btn')) {
      if (!window.confirm('Șterge această înregistrare LPS?')) return;
      items.splice(index, 1);
    } else if (event.target.closest('.lps-complete-btn')) {
      if (collection === 'milestones' || collection === 'pull') items[index].done = !items[index].done;
    } else if (event.target.closest('.lps-resolve-btn')) {
      items[index].resolved = true;
    } else return;
    saveLpsStore(store);
    renderLpsWorkspace();
  });
  document.getElementById('panel-lps').addEventListener('change', event => {
    const itemElement = event.target.closest('[data-lps-collection="weekly"]');
    if (!itemElement || !isReportFocusedView()) return;
    const store = loadLpsStore();
    const weekly = getLpsProjectData(store, lpsSelectedProjectId).weekly;
    const item = weekly.find(entry => entry.id === itemElement.dataset.lpsId);
    if (!item) return;
    if (event.target.classList.contains('lps-weekly-status')) {
      item.status = event.target.value;
      if (item.status !== 'Neîndeplinit') item.variance = '';
    } else if (event.target.classList.contains('lps-weekly-variance')) {
      item.variance = event.target.value;
    } else return;
    saveLpsStore(store);
    renderLpsWorkspace();
  });

  /* ============================================================
     ADD RESOURCE SHEET — attach an ERP equipment/material need to a
     look-ahead item. Material inserts decrement equipment_inventory
     right away (shown immediately as reserved-but-not-yet-consumed,
     see the "ⓘ ... rezervat" note on the ERP panel); equipment inserts
     are checked for a date-range overlap against that same item's
     other active reservations first, with a confirm() warning (not a
     hard block) on conflict.
     ============================================================ */
  const aresTypeSelect = document.getElementById('ares-type');
  const aresItemSelect = document.getElementById('ares-item');
  const aresQuantityField = document.getElementById('ares-quantity-field');
  const aresDatesField = document.getElementById('ares-dates-field');
  const aresHint = document.getElementById('ares-hint');
  function populateAresItemSelect(){
    const type = aresTypeSelect.value;
    const options = allEquipment.filter(e => e.item_type === type);
    aresItemSelect.innerHTML = options.length
      ? options.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')
      : '<option value="">Niciun element de acest tip în ERP</option>';
    updateAresHint();
  }
  function updateAresHint(){
    const type = aresTypeSelect.value;
    const inv = allEquipment.find(e => e.id === aresItemSelect.value);
    if (!inv) { aresHint.textContent = ''; return; }
    if (type === 'material') {
      const reserved = allResourceAssignments.filter(a => a.inventory_item_id === inv.id && a.status === 'reserved').reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
      aresHint.textContent = `Disponibil: ${inv.quantity}${inv.unit ? ' ' + inv.unit : ''}` + (reserved ? ` (din care ${reserved}${inv.unit ? ' ' + inv.unit : ''} deja rezervat pe alte lucrări neterminate)` : '');
    } else {
      const upcoming = allResourceAssignments.filter(a => a.inventory_item_id === inv.id && a.status === 'reserved');
      aresHint.textContent = upcoming.length
        ? 'Deja rezervat: ' + upcoming.map(a => `${formatWoDateRO(a.reserved_from)}–${formatWoDateRO(a.reserved_to)}`).join(', ')
        : 'Fără alte rezervări momentan.';
    }
  }
  function syncAresFormFields(){
    const isEquipment = aresTypeSelect.value === 'echipament';
    aresQuantityField.style.display = isEquipment ? 'none' : '';
    aresDatesField.style.display = isEquipment ? '' : 'none';
  }
  if (aresTypeSelect) {
    aresTypeSelect.addEventListener('change', () => { syncAresFormFields(); populateAresItemSelect(); });
    aresItemSelect.addEventListener('change', updateAresHint);
  }
  function openAddResourceSheet(lookaheadId){
    document.getElementById('ares-lookahead-id').value = lookaheadId;
    aresTypeSelect.value = 'material';
    document.getElementById('ares-quantity').value = '';
    document.getElementById('ares-from').value = '';
    document.getElementById('ares-to').value = '';
    syncAresFormFields();
    populateAresItemSelect();
    setSheetOpen('addResourceSheet', true);
  }
  const aresSaveBtn = document.getElementById('aresSaveBtn');
  if (aresSaveBtn) aresSaveBtn.addEventListener('click', async () => {
    const lookaheadId = document.getElementById('ares-lookahead-id').value;
    const type = aresTypeSelect.value;
    const inventoryId = aresItemSelect.value;
    if (!lookaheadId || !inventoryId) { alert('Alegeți un element din inventar.'); return; }
    const inv = allEquipment.find(e => e.id === inventoryId);
    if (!inv) return;
    if (type === 'material') {
      const quantity = parseFloat(document.getElementById('ares-quantity').value);
      if (!quantity || quantity <= 0) { alert('Introduceți o cantitate validă.'); return; }
      if (quantity > Number(inv.quantity)) {
        if (!confirm(`Doar ${inv.quantity}${inv.unit ? ' ' + inv.unit : ''} disponibil în stoc — cantitatea cerută (${quantity}) depășește stocul curent. Rezervați oricum?`)) return;
      }
      const { error: reserveError } = await AppDataServices.erp.reserveMaterial(supabaseClient, {
        lookaheadId, inventoryId, quantity, allowOverstock: quantity > Number(inv.quantity),
      });
      if (reserveError) { console.error(reserveError); alert('Eroare la rezervarea materialului. Stocul și rezervarea au rămas neschimbate. Încercați din nou.'); return; }
    } else {
      const from = document.getElementById('ares-from').value;
      const to = document.getElementById('ares-to').value;
      if (!from || !to) { alert('Completați perioada de rezervare.'); return; }
      if (to < from) { alert('Data de sfârșit e înaintea celei de început.'); return; }
      const conflict = allResourceAssignments.some(a => a.inventory_item_id === inventoryId && a.status === 'reserved' && a.reserved_from <= to && a.reserved_to >= from);
      if (conflict) {
        if (!confirm(`„${inv.name}” este deja rezervat(ă) într-o perioadă care se suprapune cu ${formatWoDateRO(from)}–${formatWoDateRO(to)}. Rezervați oricum?`)) return;
      }
      const { error: assignError } = await supabaseClient.from('lps_resource_assignments').insert({
        lookahead_item_id: lookaheadId, inventory_item_id: inventoryId, item_type: 'echipament', reserved_from: from, reserved_to: to, status: 'reserved',
      });
      if (assignError) { console.error(assignError); alert('Eroare la salvare. Încercați din nou.'); return; }
    }
    setSheetOpen('addResourceSheet', false);
    await refreshLookaheadWorkspace();
  });

  const reportNavBtn = document.getElementById('reportNavBtn');
  const reportNavMenu = document.getElementById('reportNavMenu');
  if (reportNavBtn && reportNavMenu) {
    reportNavBtn.addEventListener('click', () => {
      const isOpen = reportNavMenu.classList.toggle('show');
      reportNavBtn.setAttribute('aria-expanded', String(isOpen));
    });
    reportNavMenu.querySelectorAll('[data-home-action]').forEach(item => {
      item.addEventListener('click', () => {
        reportNavMenu.classList.remove('show');
        reportNavBtn.setAttribute('aria-expanded', 'false');
        setHomeTabFilter(item.dataset.homeAction);
      });
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.report-nav-wrap')) {
        reportNavMenu.classList.remove('show');
        reportNavBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
  let tabHiddenAt = null;
  const STALE_TAB_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      tabHiddenAt = Date.now();
      return;
    }
    // Becoming visible again — only refresh if it was actually hidden
    // long enough to matter. tabHiddenAt stays null if the page never
    // went hidden yet this session (e.g. very first load), so nothing
    // fires then either.
    if (tabHiddenAt && (Date.now() - tabHiddenAt) >= STALE_TAB_THRESHOLD_MS) {
      refreshAllAdminData();
    }
    tabHiddenAt = null;
  });

  // Sesizări funcționale/accidente are two tabs sharing one underlying
  // panel/list (panel-tickets) — they're distinguished only by which
  // type activeTypeFilter is locked to (see setTicketTypeFilter()),
  // same approach admin.html already uses.
  function panelIdForTab(tabKey){
    return (tabKey === 'tickets-functional' || tabKey === 'tickets-accident') ? 'tickets' : tabKey;
  }

  // Breadcrumb next to the logo (vlasbogdan@ only — see its own CSS).
  // "Sesizări" as a middle segment currently jumps to Funcționale,
  // the same landing spot the home page's own Sesizări button uses;
  // there's no separate "Sesizări overview" destination yet.
  const BREADCRUMB_TABS = {
    overview: 'Prezentare generală',
    'tickets-functional': 'Sesizări funcționale',
    'tickets-accident': 'Sesizări accidente',
    'projects-home': 'Proiecte',
    projects: 'Proiecte publice',
    backlog: 'Avarii rețele',
    lps: 'Proiecte LPS',
    workorders: 'Programe lucrări',
    'erp-home': 'ERP',
    equipment: 'Echipamente',
    machines: 'Parc Auto',
    materials: 'Materiale',
    status: 'Stare sistem',
    'status-improve': 'Auto-îmbunătățire',
    'status-audit': 'Jurnal de activitate',
    'status-roles': 'Roluri',
    docs: 'Documentație',
  };
  // Which rail category each tab belongs to, and each category's
  // default landing tab (used when a rail icon itself is clicked,
  // rather than a specific item inside its category panel).
  const TAB_CATEGORY = {
    overview: 'tickets', 'tickets-functional': 'tickets', 'tickets-accident': 'tickets',
    'projects-home': 'projects', projects: 'projects', backlog: 'projects', lps: 'projects', workorders: 'projects',
    'erp-home': 'erp', equipment: 'erp', machines: 'erp', materials: 'erp',
    docs: 'docs',
    status: 'status', 'status-improve': 'status', 'status-audit': 'status', 'status-roles': 'status',
  };
  const CATEGORY_DEFAULT_TAB = {
    tickets: 'overview', projects: 'projects-home', erp: 'erp-home', docs: 'docs', status: 'status',
  };
  const CATEGORY_TITLES = {
    tickets: 'Sesizări', projects: 'Proiecte', erp: 'ERP', docs: 'Documentație', status: 'Stare sistem',
  };
  function setActiveCategory(category){
    document.querySelectorAll('.rail-item[data-category]').forEach(item => {
      item.classList.toggle('active', item.dataset.category === category);
    });
    document.querySelectorAll('.category-panel-section').forEach(sec => {
      sec.classList.toggle('active', sec.dataset.category === category);
    });
    const titleEl = document.getElementById('categoryPanelTitle');
    if (titleEl) titleEl.textContent = CATEGORY_TITLES[category] || '';
    // Acasă isn't a category with sub-items — nothing to show in the
    // second sidebar there, so it collapses itself rather than
    // sitting empty. This is independent of the user's own manual
    // collapse toggle (a different class), which still applies again
    // as soon as a real category is picked.
    const catPanel = document.getElementById('categoryPanel');
    if (catPanel) catPanel.classList.toggle('empty', !CATEGORY_TITLES[category]);
  }
  function renderBreadcrumb(tabKey){
    const bc = document.getElementById('navBreadcrumb');
    if (!bc || !isReportFocusedView()) return;
    const crumbs = [{ label: 'Acasă', tab: 'home' }];
    if (tabKey === 'overview') {
      // Overview is now what "Sesizări" itself lands on (see
      // homeNavTickets' click handler above and this same crumb's
      // target below) — a proper sub-view of Sesizări, not a
      // separate top-level destination, so it renders as the
      // "Sesizări" crumb rather than "Prezentare generală".
      crumbs.push({ label: 'Sesizări', tab: 'overview' });
    } else if (tabKey === 'tickets-functional' || tabKey === 'tickets-accident') {
      crumbs.push({ label: 'Sesizări', tab: 'overview' });
      crumbs.push({ label: tabKey === 'tickets-functional' ? 'Funcționale' : 'Accidente', tab: tabKey });
    } else if (BREADCRUMB_TABS[tabKey]) {
      crumbs.push({ label: BREADCRUMB_TABS[tabKey], tab: tabKey });
    }
    bc.innerHTML = crumbs.map((crumb, i) => {
      const isLast = i === crumbs.length - 1;
      const item = `<button type="button" class="nav-breadcrumb-item${isLast ? ' current' : ''}" data-tab="${crumb.tab}"${isLast ? ' aria-current="page"' : ''}>${escapeHtml(crumb.label)}</button>`;
      return isLast ? item : item + '<span class="nav-breadcrumb-sep">/</span>';
    }).join('');
  }
  const navBreadcrumbEl = document.getElementById('navBreadcrumb');
  if (navBreadcrumbEl) {
    navBreadcrumbEl.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-breadcrumb-item');
      if (item && !item.classList.contains('current')) openAdminTab(item.dataset.tab);
    });
  }

  const STATUS_TABS = ['status', 'status-improve', 'status-audit', 'status-roles'];
  function openAdminTab(tabKey, fromPopState){
    // Stare sistem's nav is hidden for anyone but 'god' (see
    // applyRolePermissionsToUI), but the tab itself is still reachable
    // by a stale browser back/forward entry or hash from before a role
    // change — redirect rather than silently rendering a panel nobody
    // meant to let them see.
    if (STATUS_TABS.includes(tabKey) && typeof isGod === 'function' && !isGod()) {
      tabKey = 'home';
    }
    const panelId = panelIdForTab(tabKey);
    const isHome = tabKey === 'home' && isReportFocusedView();
    dash.classList.toggle('home-active', isHome);
    document.documentElement.classList.toggle('home-active', isHome);
    renderBreadcrumb(tabKey);
    const topbarTitleEl = document.getElementById('topbarTitle');
    if (topbarTitleEl) topbarTitleEl.textContent = tabKey === 'home' ? 'Acasă' : (BREADCRUMB_TABS[tabKey] || '');
    setActiveCategory(TAB_CATEGORY[tabKey] || null);
    document.querySelectorAll('.admin-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabKey);
    });
    document.querySelectorAll('.header-tab-btn').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabKey);
    });
    document.querySelectorAll('.mobile-tab-btn').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabKey);
    });
    document.querySelectorAll('.ticket-type-switch-btn').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabKey);
    });
    document.querySelectorAll('.admin-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'panel-' + panelId);
    });
    document.querySelectorAll('.topbar-actions .overview-year-bar').forEach(bar => {
      bar.classList.toggle('active', bar.dataset.yearPanel === panelId);
    });
    document.querySelectorAll('.overview-quick-filters').forEach(qf => {
      qf.classList.toggle('active', qf.dataset.yearPanel === panelId);
    });
    document.querySelectorAll('.ticket-type-switch').forEach(sw => {
      sw.classList.toggle('active', panelId === 'overview' || panelId === 'tickets');
    });
    // Locks which type shows on the shared Sesizări panel — whichever
    // of the two tabs was actually clicked. skipRender: true since
    // whatever calls openAdminTab() already triggers its own render
    // right after (refreshAllAdminData() below, or goToTicket's own
    // explicit renderTickets()).
    if (tabKey === 'tickets-functional') setTicketTypeFilter('functional', { skipRender: true });
    else if (tabKey === 'tickets-accident') setTicketTypeFilter('accident', { skipRender: true });
    else if (tabKey === 'status' || tabKey === 'status-improve') loadSystemStatus();
    else if (tabKey === 'status-audit') loadAuditLog();
    else if (tabKey === 'status-roles') loadStaffRolesTab();
    else if (tabKey === 'workorders') loadWorkOrders();
    else if (tabKey === 'equipment' || tabKey === 'machines' || tabKey === 'materials' || tabKey === 'erp-home') loadEquipment();
    else if (tabKey === 'projects-home') renderProjectsHomeStats();
    else if (tabKey === 'home') renderHomeDigest();
    else if (tabKey === 'lps' && isReportFocusedView()) refreshLookaheadWorkspace();
    if (tabKey === 'machines') {
      const sg = document.querySelector('[data-erp-subgroup="machines"]');
      const tg = document.querySelector('[data-erp-toggle="machines"]');
      if (sg) sg.classList.add('open');
      if (tg) tg.classList.add('open');
    } else {
      // .erp-machines-subcat-btn isn't .admin-tab, so the toggle above
      // never reaches it — without this, whichever subcategory was last
      // open (or the "Toate" default) stayed lit in red after navigating
      // away to an unrelated tab entirely.
      document.querySelectorAll('.erp-machines-subcat-btn').forEach(btn => btn.classList.remove('active'));
    }
    // Proiecte publice always opens on "Active" — otherwise whichever
    // status chip was last clicked earlier in the session (e.g. "Toate"
    // while triaging) silently stuck for every later visit to this tab,
    // which read as if "Toate" were the actual default.
    if (tabKey === 'projects' && currentAdminTab !== 'projects') {
      if (typeof setProjectYearFilter === 'function') setProjectYearFilter('all');
      setProjectsFilter('Ongoing');
    }

    // Browser back/forward support — each real tab switch becomes its
    // own history entry, so pressing back steps back through
    // Sesizări → Prezentare generală → (wherever you were before
    // admin) one at a time, instead of the very first back-press
    // leaving the admin page entirely, which is what happened before
    // this existed. fromPopState=true means this call is already a
    // response to the browser's own back/forward button, so it must
    // not push yet another entry on top of that.
    if (!fromPopState && tabKey !== currentAdminTab) {
      history.pushState({ adminTab: tabKey }, '', '#' + tabKey);
    }
    // Refresh whenever actually moving to a different tab — someone
    // else may have closed a ticket or added a project while this tab
    // sat open on a different view. Not gated on fromPopState: using
    // the browser's own back/forward buttons is still "moving between
    // tabs" from the person's perspective. Skips the very first call
    // (tabKey === currentAdminTab, since both start as 'overview'),
    // so this doesn't duplicate the load that showDashboard() already
    // does on login.
    if (tabKey !== currentAdminTab) {
      refreshAllAdminData();
    }
    if (tabKey !== currentAdminTab && typeof recordTabDwellTime === 'function') {
      recordTabDwellTime(currentAdminTab);
      if (typeof flushFeatureClickTally === 'function') flushFeatureClickTally();
    }
    currentAdminTab = tabKey;
  }

  window.addEventListener('popstate', (event) => {
    const tabKey = (event.state && event.state.adminTab) || 'overview';
    openAdminTab(tabKey, true);
  });
  // A hard refresh keeps the browser's URL (hash included) — capture it
  // here, before the replaceState below overwrites it, so showDashboard()
  // can land back on whatever tab was open instead of always restarting
  // at the default. See its use in the report-focused-view branch.
  const initialHashTab = window.location.hash.slice(1);
  // Replaces (not pushes) the current history entry so the very first
  // back-press still correctly leaves admin.html entirely, landing on
  // whatever page linked here — it doesn't insert an extra step.
  history.replaceState({ adminTab: 'overview' }, '', window.location.pathname + window.location.search + '#overview');

  function setTicketFilter(filterKey){
    activeFilter = filterKey;
    selectedIds.clear();
    updateArchiveBar();
    document.querySelectorAll('#ticketStatusChipsMobile .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.key === filterKey);
    });
    if (typeof ticketsFilterWidget !== 'undefined' && ticketsFilterWidget) ticketsFilterWidget.syncActiveState();
    renderTickets();
  }

  function setTicketTypeFilter(filterKey, { skipRender = false } = {}){
    activeTypeFilter = filterKey;
    selectedIds.clear();
    updateArchiveBar();
    if (!skipRender) renderTickets();
  }

  function updateActiveNarrowFilterUI(){
    const wrap = document.getElementById('activeNarrowFilter');
    const label = document.getElementById('activeNarrowFilterLabel');
    if (!wrap || !label) return;
    let text = '';
    if (agingOnlyFilter) text = 'Filtru activ: doar tichete deschise de peste ' + AGING_THRESHOLD_DAYS + ' zile';
    else if (typeOnlyFilter === 'functional') text = 'Filtru activ: doar tichete cu defect';
    else if (typeOnlyFilter === 'accident') text = 'Filtru activ: doar accidente';
    label.textContent = text;
    wrap.classList.toggle('show', !!text);
  }

  function clearNarrowFilter(){
    agingOnlyFilter = false;
    typeOnlyFilter = null;
    updateActiveNarrowFilterUI();
    renderTickets();
  }

  const clearNarrowFilterBtn = document.getElementById('clearNarrowFilterBtn');
  if (clearNarrowFilterBtn) clearNarrowFilterBtn.addEventListener('click', clearNarrowFilter);

  function goToTicket(ticketId){
    const targetTicket = allTickets.find(ticket => ticket.id === ticketId);
    if (!targetTicket) return;
    // Preserve the exact table state so a ticket opened from Overview
    // can return to the same table, filter, year, and month.
    overviewReturnState = currentAdminTab === 'overview'
      ? {
          status: overviewStatusFilter,
          priority: overviewCardFilter,
          year: ticketYearFilter,
          month: ticketMonthFilter,
          ticketId,
        }
      : null;
    agingOnlyFilter = false;
    typeOnlyFilter = null;
    updateActiveNarrowFilterUI();
    // Only clear the Sesizări search if it's stale — i.e. it does NOT
    // already match the ticket being navigated to. A search that
    // still matches (e.g. the very search that found this ticket)
    // must survive the click; only a leftover, unrelated search from
    // earlier browsing gets wiped, and only then.
    if (ticketSearchQuery.trim() && !matchesSearch(targetTicket, ticketSearchQuery.trim().toLowerCase()) && ticketsSearchWidget) {
      ticketsSearchWidget.applyExternalQuery('');
    }
    // Only widen the year/month filters when the target ticket
    // actually falls outside them — otherwise clicking into (or
    // getting a push notification for) a ticket that was already
    // visible under e.g. "2026 / Octombrie" silently blew that filter
    // back to "Toți anii" every time.
    if (!matchesYear(targetTicket, ticketYearFilter)) setTicketYearFilter('all');
    if (!matchesMonth(targetTicket, ticketMonthFilter)) setTicketMonthFilter('all');
    // Same "only widen if necessary" fix as the year/month filters
    // just above — this used to unconditionally force the status
    // filter to Toate on every click, even when the target ticket was
    // already visible under whatever was currently selected (e.g.
    // clicking an active ticket while already viewing "Active").
    // "Toate" also includes archived tickets (see getFilteredTickets),
    // so it's the right fallback for an archived target too.
    if (!ticketMatchesStatusFilter(targetTicket, activeFilter)) {
      setTicketFilter('Toate');
    }
    // Sesizări funcționale/accidente are two separate tabs sharing one
    // panel — route to whichever one actually holds this ticket's
    // type, instead of a no-longer-valid single "tickets" tab key.
    openAdminTab(targetTicket.type === 'Anunt accident' ? 'tickets-accident' : 'tickets-functional');

    requestAnimationFrame(() => {
      const card = document.getElementById('ticket-card-' + ticketId);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('jump-highlight');
        setTimeout(() => card.classList.remove('jump-highlight'), 1800);
      }
    });
  }

  function returnToOverviewTable(){
    const state = overviewReturnState;
    overviewReturnState = null;
    if (!state) {
      openAdminTab('overview');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setTicketYearFilter(state.year);
    setTicketMonthFilter(state.month);
    overviewCardFilter = state.priority;
    updateOverviewNarrowFilterUI();
    setOverviewStatusFilter(state.status);
    openAdminTab('overview');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.getElementById('overviewTableBody').addEventListener('click', (e) => {
    const link = e.target.closest('.ticket-link');
    if (!link) return;
    e.preventDefault();
    goToTicket(link.dataset.ticketId);
  });

  
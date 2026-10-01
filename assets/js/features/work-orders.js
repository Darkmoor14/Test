/* ============================================================
     PROGRAME LUCRĂRI (work_orders) — a scheduled/assigned unit of
     field work, same simple CRUD shape as Avarii rețele above (a
     project_form-styled add/edit form + a backlog-list-styled list).
     ============================================================ */
  let allWorkOrders = [];
  async function loadWorkOrders(){
    const { data, error } = await supabaseClient
      .from('work_orders')
      .select('*')
      .order('scheduled_date', { ascending: true });
    if (error) { console.error(error); return; }
    allWorkOrders = data || [];
    renderWorkOrders();
  }
  function formatWorkOrderDate(d){
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  }
  function renderWorkOrders(){
    renderWorkOrdersCalendar();
    const list = document.getElementById('workOrdersList');
    if (!list) return;
    const countEl = document.getElementById('workOrdersCount');
    if (countEl) countEl.textContent = allWorkOrders.length + (allWorkOrders.length === 1 ? ' programare' : ' programări');
    if (allWorkOrders.length === 0) {
      list.innerHTML = '<div class="no-results" style="padding:40px 0;text-align:center;color:var(--ink-400);">Nicio lucrare programată.</div>';
      return;
    }
    list.innerHTML = '';
    allWorkOrders.forEach(w => {
      const isDone = w.status === 'Finalizat';
      const isCancelled = w.status === 'Anulat';
      const dateLabel = formatWorkOrderDate(w.scheduled_date) + (w.scheduled_end_date ? ' – ' + formatWorkOrderDate(w.scheduled_end_date) : '');
      const row = document.createElement('div');
      row.className = 'backlog-row' + (isDone ? ' done' : '');
      row.innerHTML = `
        <div class="backlog-main">
          <div class="backlog-title-line">
            <span class="backlog-title">${escapeHtml(w.title)}</span>
            <span class="backlog-tag">${escapeHtml(w.status)}</span>
            <span class="backlog-days">${escapeHtml(dateLabel)}</span>
          </div>
          <div class="backlog-meta-line">${escapeHtml(w.location || '')}${w.crew ? ' · ' + escapeHtml(w.crew) : ''}${w.description ? ' · ' + escapeHtml(w.description) : ''}</div>
        </div>
        <div class="backlog-actions">
          <button class="btn wo-edit">Editează</button>
          ${!isDone && !isCancelled ? '<button class="btn btn-primary wo-status">Finalizat</button>' : ''}
          <button class="btn wo-delete">Șterge</button>
        </div>
      `;
      row.querySelector('.wo-edit').addEventListener('click', () => openWorkOrderForm(w));
      const statusBtn = row.querySelector('.wo-status');
      if (statusBtn) {
        statusBtn.addEventListener('click', async () => {
          if (!confirm(`Marcați „${w.title}” ca finalizată?`)) return;
          const { error } = await supabaseClient.from('work_orders').update({ status: 'Finalizat' }).eq('id', w.id);
          if (error) { console.error(error); alert('Eroare la actualizare. Încercați din nou.'); return; }
          loadWorkOrders();
        });
      }
      row.querySelector('.wo-delete').addEventListener('click', async () => {
        if (!confirm(`Ștergeți definitiv programarea „${w.title}”?`)) return;
        const { error } = await supabaseClient.from('work_orders').delete().eq('id', w.id);
        if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
        loadWorkOrders();
      });
      list.appendChild(row);
    });
  }

  // Full month calendar — independent month cursor from the home
  // page's mini-calendar (someone reviewing October's schedule
  // shouldn't also flip the home widget to October). Same Monday-first
  // grid math as renderHomeMiniCal(), sized for a day's work order
  // titles to actually fit rather than just a dot.
  let woCalYear = new Date().getFullYear();
  let woCalMonthIdx = new Date().getMonth();
  function workOrdersOnDate(dateKeyStr){
    return allWorkOrders.filter(w => {
      const start = w.scheduled_date;
      const end = w.scheduled_end_date || w.scheduled_date;
      return start && dateKeyStr >= start && dateKeyStr <= end;
    });
  }
  function renderWorkOrdersCalendar(){
    const monthEl = document.getElementById('woCalMonthLabel');
    const gridEl = document.getElementById('woCalendarGrid');
    if (!monthEl || !gridEl) return;
    const todayKey = dateKey(new Date());
    const year = woCalYear, month = woCalMonthIdx;
    monthEl.textContent = `${HOME_CLOCK_MONTH_NAMES[month]} ${year}`;
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const MAX_CHIPS = 3;
    const dayCellHtml = (dNum, y, m, isOutside) => {
      const thisKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      const dayOrders = isOutside ? [] : workOrdersOnDate(thisKey);
      const shown = dayOrders.slice(0, MAX_CHIPS);
      const extra = dayOrders.length - shown.length;
      const chipsHtml = shown.map(w => `<span class="wo-cal-chip status-${w.status.replace(/\s+/g, '-')}" data-wo-id="${escapeHtml(w.id)}" title="${escapeHtml(w.title)}">${escapeHtml(w.title)}</span>`).join('')
        + (extra > 0 ? `<span class="wo-cal-chip-more">+${extra} mai multe</span>` : '');
      return `<button type="button" class="wo-cal-day${isOutside ? ' outside' : ''}${thisKey === todayKey ? ' today' : ''}" data-date="${thisKey}">
        <span class="wo-cal-day-num">${dNum}</span>
        <span class="wo-cal-day-chips">${chipsHtml}</span>
      </button>`;
    };
    let html = '';
    for (let i = 0; i < startOffset; i++) {
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      html += dayCellHtml(daysInPrevMonth - startOffset + i + 1, prevYear, prevMonth, true);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      html += dayCellHtml(d, year, month, false);
    }
    const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      html += dayCellHtml(i, nextYear, nextMonth, true);
    }
    gridEl.innerHTML = html;
    gridEl.querySelectorAll('.wo-cal-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const w = allWorkOrders.find(x => String(x.id) === chip.dataset.woId);
        if (w) openWorkOrderForm(w);
      });
    });
    gridEl.querySelectorAll('.wo-cal-day[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        openWorkOrderForm(null);
        document.getElementById('wf-start').value = cell.dataset.date;
      });
    });
  }
  const woCalPrevBtn = document.getElementById('woCalPrevBtn');
  if (woCalPrevBtn) woCalPrevBtn.addEventListener('click', () => {
    woCalMonthIdx--; if (woCalMonthIdx < 0) { woCalMonthIdx = 11; woCalYear--; }
    renderWorkOrdersCalendar();
  });
  const woCalNextBtn = document.getElementById('woCalNextBtn');
  if (woCalNextBtn) woCalNextBtn.addEventListener('click', () => {
    woCalMonthIdx++; if (woCalMonthIdx > 11) { woCalMonthIdx = 0; woCalYear++; }
    renderWorkOrdersCalendar();
  });
  const woCalTodayBtn = document.getElementById('woCalTodayBtn');
  if (woCalTodayBtn) woCalTodayBtn.addEventListener('click', () => {
    const now = new Date();
    woCalYear = now.getFullYear(); woCalMonthIdx = now.getMonth();
    renderWorkOrdersCalendar();
  });
  const woCalDownloadBtn = document.getElementById('woCalDownloadBtn');
  if (woCalDownloadBtn) woCalDownloadBtn.addEventListener('click', () => {
    document.body.classList.add('print-calendar-only');
    window.print();
  });
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-calendar-only');
  });

  const workOrderForm = document.getElementById('workOrderForm');
  function openWorkOrderForm(w){
    document.getElementById('wf-id').value = w ? w.id : '';
    document.getElementById('wf-title').value = w ? w.title : '';
    document.getElementById('wf-location').value = w ? (w.location || '') : '';
    document.getElementById('wf-crew').value = w ? (w.crew || '') : '';
    document.getElementById('wf-start').value = w ? w.scheduled_date : '';
    document.getElementById('wf-end').value = w ? (w.scheduled_end_date || '') : '';
    document.getElementById('wf-description').value = w ? (w.description || '') : '';
    workOrderForm.style.display = 'block';
    workOrderForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const addWorkOrderBtn = document.getElementById('addWorkOrderBtn');
  if (addWorkOrderBtn) addWorkOrderBtn.addEventListener('click', () => openWorkOrderForm(null));
  const wfCancelBtn = document.getElementById('wfCancelBtn');
  if (wfCancelBtn) wfCancelBtn.addEventListener('click', () => { workOrderForm.style.display = 'none'; });
  const wfSaveBtn = document.getElementById('wfSaveBtn');
  if (wfSaveBtn) wfSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('wf-id').value;
    const title = document.getElementById('wf-title').value.trim();
    const location = document.getElementById('wf-location').value.trim();
    const crew = document.getElementById('wf-crew').value.trim();
    const scheduled_date = document.getElementById('wf-start').value;
    const scheduled_end_date = document.getElementById('wf-end').value;
    const description = document.getElementById('wf-description').value.trim();
    if (!title || !scheduled_date) {
      alert('Completați lucrarea și data programată.');
      return;
    }
    if (scheduled_end_date && scheduled_end_date < scheduled_date) {
      alert('Data de sfârșit nu poate fi înaintea datei de început.');
      return;
    }
    const payload = {
      title, scheduled_date,
      location: location || null,
      crew: crew || null,
      scheduled_end_date: scheduled_end_date || null,
      description: description || null,
    };
    const { error } = id
      ? await supabaseClient.from('work_orders').update(payload).eq('id', id)
      : await supabaseClient.from('work_orders').insert(payload);
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
    workOrderForm.style.display = 'none';
    showToast(id ? 'Programarea a fost actualizată.' : 'Programarea a fost adăugată.');
    loadWorkOrders();
  });

  
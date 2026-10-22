/* ============================================================
     HR — ANGAJAȚI / PONTAJ / CONCEDIU. Open to every signed-in staff
     account, view and write both — no per-role split here, unlike
     tickets/proiecte/erp (see "Authenticated staff can …" RLS
     policies on hr_employees/hr_worktime_entries/hr_vacation_entries).
     Three tables, loaded together since Pontaj/Concediu both need
     employee names and Angajați needs vacation totals.
     ============================================================ */
  let allHrEmployees = [];
  let allHrWorktime = [];
  let allHrVacation = [];

  async function loadHrData(){
    const [empRes, wtRes, vacRes] = await Promise.all([
      supabaseClient.from('hr_employees').select('*').order('full_name', { ascending: true }),
      supabaseClient.from('hr_worktime_entries').select('*').order('work_date', { ascending: false }),
      supabaseClient.from('hr_vacation_entries').select('*').order('start_date', { ascending: false }),
    ]);
    if (empRes.error) { console.error(empRes.error); return; }
    allHrEmployees = empRes.data || [];
    allHrWorktime = wtRes.data || [];
    allHrVacation = vacRes.data || [];
    populateHrEmployeeSelects();
  }
  async function loadHrEmployees(){ await loadHrData(); renderHrEmployeesTable(); renderHrHomeStats(); }
  async function loadHrWorktime(){ await loadHrData(); renderHrWorktimeTable(); }
  async function loadHrVacation(){ await loadHrData(); renderHrVacationTable(); }

  function hrEmployeeName(id){
    const emp = allHrEmployees.find(e => e.id === id);
    return emp ? emp.full_name : '—';
  }
  function hrVacationUsedForEmployee(employeeId){
    return allHrVacation.filter(v => v.employee_id === employeeId).reduce((sum, v) => sum + (Number(v.days_used) || 0), 0);
  }
  function populateHrEmployeeSelects(){
    const optionsHtml = allHrEmployees.map(emp => `<option value="${escapeHtml(emp.id)}">${escapeHtml(emp.full_name)}</option>`).join('');
    [document.getElementById('hrWf-employee'), document.getElementById('hrVf-employee')].forEach(sel => {
      if (sel) sel.innerHTML = optionsHtml || '<option value="">Niciun angajat</option>';
    });
  }
  function renderHrHomeStats(){
    const empCountEl = document.getElementById('hrHomeEmployeesCount');
    if (empCountEl) empCountEl.textContent = allHrEmployees.length;
    const [curYear, curMonth] = dateKey(new Date()).split('-');
    const wtCountEl = document.getElementById('hrHomeWorktimeCount');
    if (wtCountEl) {
      wtCountEl.textContent = allHrWorktime.filter(wt => wt.work_date && wt.work_date.startsWith(`${curYear}-${curMonth}`)).length;
    }
    const vacCountEl = document.getElementById('hrHomeVacationCount');
    if (vacCountEl) {
      const thisYearUsed = allHrVacation.filter(v => v.start_date && v.start_date.startsWith(curYear)).reduce((sum, v) => sum + (Number(v.days_used) || 0), 0);
      vacCountEl.textContent = thisYearUsed;
    }
  }

  /* ----------------------------- Angajați ----------------------------- */
  function renderHrEmployeesTable(){
    const tbody = document.getElementById('hrEmployeesTableBody');
    if (!tbody) return;
    const countEl = document.getElementById('hrEmployeesCount');
    if (countEl) countEl.textContent = allHrEmployees.length + (allHrEmployees.length === 1 ? ' angajat' : ' angajați');
    if (!allHrEmployees.length) { tbody.innerHTML = '<tr><td colspan="6" class="no-results">Niciun angajat încă — adaugă primul.</td></tr>'; return; }
    tbody.innerHTML = allHrEmployees.map(emp => `
      <tr>
        <td>${escapeHtml(emp.full_name)}</td>
        <td>${emp.date_of_birth ? formatWoDateRO(emp.date_of_birth) : '—'}</td>
        <td>${emp.address ? escapeHtml(emp.address) : '—'}</td>
        <td>${emp.vacation_days_allowed}</td>
        <td>${hrVacationUsedForEmployee(emp.id)}</td>
        <td>
          <button type="button" class="btn hr-emp-edit-btn" data-id="${escapeHtml(emp.id)}">Editează</button>
          <button type="button" class="btn hr-emp-delete-btn" data-id="${escapeHtml(emp.id)}">Șterge</button>
        </td>
      </tr>
    `).join('');
  }
  function openHrEmployeeForm(emp){
    document.getElementById('hrEf-id').value = emp ? emp.id : '';
    document.getElementById('hrEf-name').value = emp ? emp.full_name : '';
    document.getElementById('hrEf-dob').value = emp ? (emp.date_of_birth || '') : '';
    document.getElementById('hrEf-address').value = emp ? (emp.address || '') : '';
    document.getElementById('hrEf-vacation-allowed').value = emp ? emp.vacation_days_allowed : 21;
    const titleEl = document.getElementById('hrEmployeeFormSheetTitle');
    if (titleEl) titleEl.textContent = emp ? `Editează — ${emp.full_name}` : 'Adaugă angajat';
    setSheetOpen('hrEmployeeFormSheet', true);
  }
  const addHrEmployeeBtn = document.getElementById('addHrEmployeeBtn');
  if (addHrEmployeeBtn) addHrEmployeeBtn.addEventListener('click', () => openHrEmployeeForm(null));
  const hrEfSaveBtn = document.getElementById('hrEfSaveBtn');
  if (hrEfSaveBtn) hrEfSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('hrEf-id').value;
    const full_name = document.getElementById('hrEf-name').value.trim();
    if (!full_name) { alert('Completați numele angajatului.'); return; }
    const date_of_birth = document.getElementById('hrEf-dob').value || null;
    const address = document.getElementById('hrEf-address').value.trim() || null;
    const vacation_days_allowed = parseFloat(document.getElementById('hrEf-vacation-allowed').value) || 0;
    const payload = { full_name, date_of_birth, address, vacation_days_allowed };
    if (id) {
      const { error } = await supabaseClient.from('hr_employees').update(payload).eq('id', id);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      showToast('Angajatul a fost actualizat.');
    } else {
      const { error } = await supabaseClient.from('hr_employees').insert(payload);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      showToast('Angajatul a fost adăugat.');
    }
    setSheetOpen('hrEmployeeFormSheet', false);
    loadHrEmployees();
  });
  const hrEmployeesTableBody = document.getElementById('hrEmployeesTableBody');
  if (hrEmployeesTableBody) hrEmployeesTableBody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.hr-emp-edit-btn');
    if (editBtn) { const emp = allHrEmployees.find(x => x.id === editBtn.dataset.id); if (emp) openHrEmployeeForm(emp); return; }
    const delBtn = e.target.closest('.hr-emp-delete-btn');
    if (delBtn) {
      const emp = allHrEmployees.find(x => x.id === delBtn.dataset.id);
      if (!confirm(`Ștergeți definitiv angajatul${emp ? ' „' + emp.full_name + '”' : ''}? Se șterg și toate înregistrările de pontaj și concediu asociate. Această acțiune nu poate fi anulată.`)) return;
      supabaseClient.from('hr_employees').delete().eq('id', delBtn.dataset.id).then(({ error }) => {
        if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
        showToast('Angajatul a fost șters.');
        loadHrEmployees();
      });
    }
  });

  /* ------------------------------ Pontaj ------------------------------ */
  function renderHrWorktimeTable(){
    const tbody = document.getElementById('hrWorktimeTableBody');
    if (!tbody) return;
    const countEl = document.getElementById('hrWorktimeCount');
    if (countEl) countEl.textContent = allHrWorktime.length + (allHrWorktime.length === 1 ? ' înregistrare' : ' înregistrări');
    if (!allHrWorktime.length) { tbody.innerHTML = '<tr><td colspan="6" class="no-results">Nicio înregistrare de pontaj încă.</td></tr>'; return; }
    tbody.innerHTML = allHrWorktime.map(wt => `
      <tr>
        <td>${escapeHtml(hrEmployeeName(wt.employee_id))}</td>
        <td>${formatWoDateRO(wt.work_date)}</td>
        <td>${wt.hours_worked}</td>
        <td>${wt.extra_hours}</td>
        <td>${wt.notes ? escapeHtml(wt.notes) : ''}</td>
        <td>
          <button type="button" class="btn hr-wt-edit-btn" data-id="${escapeHtml(wt.id)}">Editează</button>
          <button type="button" class="btn hr-wt-delete-btn" data-id="${escapeHtml(wt.id)}">Șterge</button>
        </td>
      </tr>
    `).join('');
  }
  // Ore lucrate/Ore suplimentare are no longer typed in -- they're
  // derived from the clock-in/clock-out times, with anything past a
  // standard 8h shift counted as overtime.
  const HR_STANDARD_SHIFT_HOURS = 8;
  function calcWorkedHours(start, end){
    if (!start || !end) return null;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const diffMin = (eh * 60 + em) - (sh * 60 + sm);
    if (diffMin <= 0) return null;
    return Math.round((diffMin / 60) * 100) / 100;
  }
  function minutesToTime(totalMinutes){
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = Math.round(totalMinutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  function openHrWorktimeForm(entry){
    document.getElementById('hrWf-id').value = entry ? entry.id : '';
    document.getElementById('hrWf-employee').value = entry ? entry.employee_id : (allHrEmployees[0] ? allHrEmployees[0].id : '');
    document.getElementById('hrWf-date').value = entry ? entry.work_date : dateKey(new Date());
    if (entry && entry.start_time && entry.end_time) {
      document.getElementById('hrWf-start-time').value = entry.start_time.slice(0, 5);
      document.getElementById('hrWf-end-time').value = entry.end_time.slice(0, 5);
    } else if (entry) {
      // Older entry recorded before clock-in/out existed -- back into a
      // plausible time range from its stored hours so the total still
      // matches what was there, rather than silently losing it.
      const legacyTotal = (entry.hours_worked || 0) + (entry.extra_hours || 0);
      document.getElementById('hrWf-start-time').value = '08:00';
      document.getElementById('hrWf-end-time').value = minutesToTime(8 * 60 + legacyTotal * 60);
    } else {
      document.getElementById('hrWf-start-time').value = '08:00';
      document.getElementById('hrWf-end-time').value = '16:00';
    }
    document.getElementById('hrWf-notes').value = entry ? (entry.notes || '') : '';
    const titleEl = document.getElementById('hrWorktimeFormSheetTitle');
    if (titleEl) titleEl.textContent = entry ? 'Editează pontaj' : 'Adaugă pontaj';
    setSheetOpen('hrWorktimeFormSheet', true);
  }
  const addHrWorktimeBtn = document.getElementById('addHrWorktimeBtn');
  if (addHrWorktimeBtn) addHrWorktimeBtn.addEventListener('click', () => {
    if (!allHrEmployees.length) { alert('Adaugă mai întâi un angajat, din tab-ul Angajați.'); return; }
    openHrWorktimeForm(null);
  });
  const hrWfSaveBtn = document.getElementById('hrWfSaveBtn');
  if (hrWfSaveBtn) hrWfSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('hrWf-id').value;
    const employee_id = document.getElementById('hrWf-employee').value;
    if (!employee_id) { alert('Alegeți un angajat.'); return; }
    const work_date = document.getElementById('hrWf-date').value;
    if (!work_date) { alert('Completați data.'); return; }
    const start_time = document.getElementById('hrWf-start-time').value;
    const end_time = document.getElementById('hrWf-end-time').value;
    const totalHours = calcWorkedHours(start_time, end_time);
    if (totalHours === null) { alert('Ora de sfârșit trebuie să fie după ora de început.'); return; }
    const hours_worked = Math.min(totalHours, HR_STANDARD_SHIFT_HOURS);
    const extra_hours = Math.round(Math.max(0, totalHours - HR_STANDARD_SHIFT_HOURS) * 100) / 100;
    const notes = document.getElementById('hrWf-notes').value.trim() || null;
    const payload = { employee_id, work_date, start_time, end_time, hours_worked, extra_hours, notes };
    if (id) {
      const { error } = await supabaseClient.from('hr_worktime_entries').update(payload).eq('id', id);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      showToast('Pontajul a fost actualizat.');
    } else {
      const { error } = await supabaseClient.from('hr_worktime_entries').insert(payload);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      showToast('Pontajul a fost adăugat.');
    }
    setSheetOpen('hrWorktimeFormSheet', false);
    loadHrWorktime();
  });
  const hrWorktimeTableBody = document.getElementById('hrWorktimeTableBody');
  if (hrWorktimeTableBody) hrWorktimeTableBody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.hr-wt-edit-btn');
    if (editBtn) { const entry = allHrWorktime.find(x => x.id === editBtn.dataset.id); if (entry) openHrWorktimeForm(entry); return; }
    const delBtn = e.target.closest('.hr-wt-delete-btn');
    if (delBtn) {
      if (!confirm('Ștergeți această înregistrare de pontaj?')) return;
      supabaseClient.from('hr_worktime_entries').delete().eq('id', delBtn.dataset.id).then(({ error }) => {
        if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
        showToast('Înregistrarea a fost ștearsă.');
        loadHrWorktime();
      });
    }
  });

  /* ----------------------------- Concediu ----------------------------- */
  function renderHrVacationTable(){
    const tbody = document.getElementById('hrVacationTableBody');
    if (!tbody) return;
    const countEl = document.getElementById('hrVacationCount');
    if (countEl) countEl.textContent = allHrVacation.length + (allHrVacation.length === 1 ? ' înregistrare' : ' înregistrări');
    if (!allHrVacation.length) { tbody.innerHTML = '<tr><td colspan="6" class="no-results">Nicio înregistrare de concediu încă.</td></tr>'; return; }
    tbody.innerHTML = allHrVacation.map(v => `
      <tr>
        <td>${escapeHtml(hrEmployeeName(v.employee_id))}</td>
        <td>${formatWoDateRO(v.start_date)}</td>
        <td>${formatWoDateRO(v.end_date)}</td>
        <td>${v.days_used}</td>
        <td>${v.notes ? escapeHtml(v.notes) : ''}</td>
        <td>
          <button type="button" class="btn hr-vac-edit-btn" data-id="${escapeHtml(v.id)}">Editează</button>
          <button type="button" class="btn hr-vac-delete-btn" data-id="${escapeHtml(v.id)}">Șterge</button>
        </td>
      </tr>
    `).join('');
  }
  // Inclusive day count between two YYYY-MM-DD date-input values (same
  // start/end = 1 day off), so "Zile folosite" no longer needs to be
  // typed in by hand -- it's always exactly what De la/Până la imply.
  function calcVacationDays(start, end){
    if (!start || !end) return null;
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const diff = Math.round((e - s) / 86400000);
    return diff >= 0 ? diff + 1 : null;
  }
  function openHrVacationForm(entry){
    document.getElementById('hrVf-id').value = entry ? entry.id : '';
    document.getElementById('hrVf-employee').value = entry ? entry.employee_id : (allHrEmployees[0] ? allHrEmployees[0].id : '');
    document.getElementById('hrVf-start').value = entry ? entry.start_date : dateKey(new Date());
    document.getElementById('hrVf-end').value = entry ? entry.end_date : dateKey(new Date());
    document.getElementById('hrVf-notes').value = entry ? (entry.notes || '') : '';
    const titleEl = document.getElementById('hrVacationFormSheetTitle');
    if (titleEl) titleEl.textContent = entry ? 'Editează concediu' : 'Adaugă concediu';
    setSheetOpen('hrVacationFormSheet', true);
  }
  const addHrVacationBtn = document.getElementById('addHrVacationBtn');
  if (addHrVacationBtn) addHrVacationBtn.addEventListener('click', () => {
    if (!allHrEmployees.length) { alert('Adaugă mai întâi un angajat, din tab-ul Angajați.'); return; }
    openHrVacationForm(null);
  });
  const hrVfSaveBtn = document.getElementById('hrVfSaveBtn');
  if (hrVfSaveBtn) hrVfSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('hrVf-id').value;
    const employee_id = document.getElementById('hrVf-employee').value;
    if (!employee_id) { alert('Alegeți un angajat.'); return; }
    const start_date = document.getElementById('hrVf-start').value;
    const end_date = document.getElementById('hrVf-end').value;
    if (!start_date || !end_date) { alert('Completați perioada.'); return; }
    if (end_date < start_date) { alert('Data de sfârșit nu poate fi înainte de data de început.'); return; }
    const days_used = calcVacationDays(start_date, end_date);
    const notes = document.getElementById('hrVf-notes').value.trim() || null;
    const payload = { employee_id, start_date, end_date, days_used, notes };
    if (id) {
      const { error } = await supabaseClient.from('hr_vacation_entries').update(payload).eq('id', id);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      showToast('Concediul a fost actualizat.');
    } else {
      const { error } = await supabaseClient.from('hr_vacation_entries').insert(payload);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      showToast('Concediul a fost adăugat.');
    }
    setSheetOpen('hrVacationFormSheet', false);
    loadHrVacation();
  });
  const hrVacationTableBody = document.getElementById('hrVacationTableBody');
  if (hrVacationTableBody) hrVacationTableBody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.hr-vac-edit-btn');
    if (editBtn) { const entry = allHrVacation.find(x => x.id === editBtn.dataset.id); if (entry) openHrVacationForm(entry); return; }
    const delBtn = e.target.closest('.hr-vac-delete-btn');
    if (delBtn) {
      if (!confirm('Ștergeți această înregistrare de concediu?')) return;
      supabaseClient.from('hr_vacation_entries').delete().eq('id', delBtn.dataset.id).then(({ error }) => {
        if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
        showToast('Înregistrarea a fost ștearsă.');
        loadHrVacation();
      });
    }
  });

  /* --------------------------- Home navigation --------------------------- */
  const hrHomeEmployeesCard = document.getElementById('hrHomeEmployeesCard');
  if (hrHomeEmployeesCard) hrHomeEmployeesCard.addEventListener('click', () => openAdminTab('hr-employees'));
  const hrHomeWorktimeCard = document.getElementById('hrHomeWorktimeCard');
  if (hrHomeWorktimeCard) hrHomeWorktimeCard.addEventListener('click', () => openAdminTab('hr-worktime'));
  const hrHomeVacationCard = document.getElementById('hrHomeVacationCard');
  if (hrHomeVacationCard) hrHomeVacationCard.addEventListener('click', () => openAdminTab('hr-vacation'));
  const hrHomeNavEmployees = document.getElementById('hrHomeNavEmployees');
  if (hrHomeNavEmployees) hrHomeNavEmployees.addEventListener('click', () => openAdminTab('hr-employees'));
  const hrHomeNavWorktime = document.getElementById('hrHomeNavWorktime');
  if (hrHomeNavWorktime) hrHomeNavWorktime.addEventListener('click', () => openAdminTab('hr-worktime'));
  const hrHomeNavVacation = document.getElementById('hrHomeNavVacation');
  if (hrHomeNavVacation) hrHomeNavVacation.addEventListener('click', () => openAdminTab('hr-vacation'));
  // homeNavHr's own click wiring moved into the Acasă React pilot (see
  // admin-react/'s NavGrid.tsx) — it now calls openAdminTab('hr-home')
  // directly from there.

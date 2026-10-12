/* ============================================================
     ERP — ECHIPAMENTE / MAȘINI / MATERIALE (equipment_inventory).
     One shared table and one shared add/edit sheet, split into three
     list panels (plus a Home overview) by erp_category. item_type
     stays the older echipament/material split that actually drives
     LPS reservation behaviour (date-range reservation vs quantity
     draw-down) — a "mașină" is just an echipament for that purpose
     (reserved by date range like any other piece of equipment), so
     erp_category is purely which of the three ERP tabs a row lives
     under, derived 1:1 from item_type except for the echipament/
     mașină split which has no behavioural difference.
     ============================================================ */
  let allEquipment = [];
  // ALL LPS resource assignments (every status) — loaded alongside the
  // inventory so the ERP list can show what's spoken for, and so each
  // look-ahead item's resource list can still show a row's final state
  // (Consumat/Eliberat) after it stops being active, rather than the
  // row just vanishing. Anywhere that means "currently active", filter
  // locally for status === 'reserved' (see renderEquipment,
  // updateAresHint, and the conflict check in aresSaveBtn).
  let allResourceAssignments = [];
  async function loadResourceAssignments(){
    const { data, error } = await supabaseClient
      .from('lps_resource_assignments')
      .select('*');
    if (error) { console.error(error); return; }
    allResourceAssignments = data || [];
  }
  // Month-by-month fuel data for Parc Auto's "Raport lunar consum" --
  // both loaded alongside the vehicles themselves so switching months
  // in the report, or recomputing a delta against an earlier month, is
  // just a client-side filter, no refetch per month.
  //   vehicle_fuel_logs      — one row per (vehicle, year, month):
  //                            the odometer/hour-meter READING taken
  //                            that month, not a distance.
  //   vehicle_fuel_purchases — one row per fuel bill, summed per
  //                            month for "Total alimentare" (same
  //                            append-only shape as stock_ledger).
  let allVehicleFuelLogs = [];
  let allVehicleFuelPurchases = [];
  async function loadVehicleFuelLogs(){
    const { data, error } = await supabaseClient.from('vehicle_fuel_logs').select('*');
    if (error) { console.error(error); return; }
    allVehicleFuelLogs = data || [];
  }
  async function loadVehicleFuelPurchases(){
    const { data, error } = await supabaseClient.from('vehicle_fuel_purchases').select('*').order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    allVehicleFuelPurchases = data || [];
  }
  async function loadEquipment(){
    const [eqResult] = await Promise.all([
      supabaseClient.from('equipment_inventory').select('*').order('name', { ascending: true }),
      loadResourceAssignments(),
      loadVehicleFuelLogs(),
      loadVehicleFuelPurchases(),
    ]);
    if (eqResult.error) { console.error(eqResult.error); return; }
    allEquipment = eqResult.data || [];
    renderEquipment();
  }
  function formatWoDateRO(d){
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  }
  const EQUIPMENT_STATUS_CYCLE = { 'Disponibil': 'In folosinta', 'In folosinta': 'Service', 'Service': 'Disponibil', 'Indisponibil': 'Disponibil' };
  const EQUIPMENT_STATUS_LABEL = { 'Disponibil': 'Disponibil', 'In folosinta': 'În folosință', 'Service': 'Service', 'Indisponibil': 'Indisponibil' };
  const ERP_CATEGORY_LABEL = { echipament: 'Echipament', masina: 'Mașină', material: 'Material', produs: 'Produs' };
  const ERP_CATEGORY_LIST_IDS = {
    echipament: { list: 'equipmentList', count: 'equipmentCount', empty: 'Niciun echipament înregistrat.' },
    material: { list: 'materialsList', count: 'materialsCount', empty: 'Niciun material înregistrat.' },
    produs: { list: 'productsList', count: 'productsCount', empty: 'Niciun produs înregistrat.' },
  };
  // Parc Auto se împarte în 4 subcategorii fixe, distribuite automat după
  // câmpul "Subcategorie" ales la adăugare — Camion are în plus
  // Licență transport/Tahograf, celelalte 3 nu.
  const VEHICLE_SUBCAT_LABEL = { masina_mica: 'Mașină mică', autoutilitara: 'Autoutilitară', camion: 'Camion', utilaj: 'Utilaj' };
  let machinesSubcatFilter = 'Toate';
  // machinesSidebarKey tracks which sidebar sub-item is lit up, separate
  // from machinesSubcatFilter: navigating via the sidebar itself (default)
  // highlights the matching sub-item and leaves "Prezentare generală", but
  // the quick-filter cards only narrow the table in place — they keep
  // sidebarKey on 'Toate' so it doesn't look like you left the overview
  // page for a different sidebar section. The cards themselves are only
  // shown while sidebarKey is 'Toate' (see renderMachinesOverview).
  let machinesSidebarKey = 'Toate';
  function setMachinesSubcatFilter(key, opts){
    machinesSubcatFilter = key;
    machinesSidebarKey = (opts && opts.sidebarKey !== undefined) ? opts.sidebarKey : key;
    document.querySelectorAll('.erp-machines-subcat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subcat === machinesSidebarKey);
    });
    renderEquipment();
  }

  /* ============================================================
     JURNAL STOC (stock_ledger) — un rând per schimbare de cantitate
     pe un material (rezervare, returnare la ștergere, editare
     manuală), în loc de a suprascrie tăcut quantity. Doar materialele
     au o cantitate urmărită bucată-cu-bucată — echipamentele/mașinile
     se rezervă pe perioadă, nu se "consumă".
     ============================================================ */
  async function logStockLedger(itemId, itemName, changeQty, resultingQty, reason){
    try {
      await supabaseClient.from('stock_ledger').insert({
        item_id: itemId, item_name: itemName, change_qty: changeQty, resulting_qty: resultingQty, reason, user_email: currentSessionEmail || null,
      });
    } catch (e) { /* best effort — never block the stock change it's describing */ }
  }
  let stockLedgerCurrentItemId = null;
  async function renderStockLedger(){
    const listEl = document.getElementById('stockLedgerList');
    if (!listEl || !stockLedgerCurrentItemId) return;
    const { data, error } = await supabaseClient.from('stock_ledger').select('*')
      .eq('item_id', stockLedgerCurrentItemId).order('created_at', { ascending: false }).limit(100);
    if (error) { listEl.innerHTML = '<p class="status-history-empty">Jurnalul nu a putut fi încărcat.</p>'; return; }
    if (!data || data.length === 0) { listEl.innerHTML = '<p class="status-history-empty">Nicio mișcare de stoc încă.</p>'; return; }
    listEl.innerHTML = data.map(row => {
      const sign = Number(row.change_qty) > 0 ? '+' : '';
      return `
        <div class="entity-log-item">
          <span class="entity-log-time">${formatLogTimeRO(row.created_at)}</span>
          <div>
            <div class="entity-log-text">${sign}${row.change_qty} (rămas: ${row.resulting_qty}) — ${escapeHtml(row.reason)}</div>
            ${row.user_email ? `<div class="entity-log-author">${escapeHtml(row.user_email)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
  async function openStockLedgerSheet(itemId, itemName){
    stockLedgerCurrentItemId = itemId;
    const titleEl = document.getElementById('stockLedgerSheetTitle');
    if (titleEl) titleEl.textContent = `Jurnal stoc — ${itemName}`;
    document.getElementById('stockLedgerList').innerHTML = '<p class="status-history-empty">Se încarcă…</p>';
    setSheetOpen('stockLedgerSheet', true);
    await renderStockLedger();
  }

  function isLowStock(eq){
    return (eq.erp_category === 'material' || eq.erp_category === 'produs') && eq.reorder_threshold != null && Number(eq.quantity) <= Number(eq.reorder_threshold);
  }
  // Licență transport/Tahograf se aplică doar subcategoriei Camion —
  // celelalte 3 subcategorii nu le au în formular, deci nu intră în
  // verificarea de expirare pentru ele.
  const VEHICLE_DOC_FIELDS = [
    { key: 'itp_expires_on', label: 'ITP' },
    { key: 'insurance_expires_on', label: 'Asigurare' },
    { key: 'parking_ticket_expires_on', label: 'Tichete parcare' },
    { key: 'vignette_expires_on', label: 'Rovinietă' },
    { key: 'transport_license_expires_on', label: 'Licență transport', camionOnly: true },
    { key: 'tachograph_expires_on', label: 'Tahograf', camionOnly: true },
  ];
  function hasExpiredDocs(eq){
    return expiredDocNames(eq).length > 0;
  }
  function expiredDocNames(eq){
    if (eq.erp_category !== 'masina') return [];
    const today = dateKey(new Date());
    return VEHICLE_DOC_FIELDS.filter(f => {
      if (f.camionOnly && eq.category !== 'camion') return false;
      return eq[f.key] && eq[f.key] < today;
    }).map(f => f.label);
  }
  // Zile rămase până la o dată (negativ = deja expirată). Folosit atât
  // pentru evidențierea portocalie din tabel (≤14 zile), cât și pentru
  // cardul Notificări (≤7 zile) — praguri diferite, aceeași bază.
  function daysUntilDate(dateStr){
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    const [todayYear, todayMonth, todayDay] = dateKey(new Date()).split('-').map(Number);
    const targetOrdinal = Date.UTC(year, month - 1, day) / 86400000;
    const todayOrdinal = Date.UTC(todayYear, todayMonth - 1, todayDay) / 86400000;
    return targetOrdinal - todayOrdinal;
  }
  function docDateClass(dateStr){
    if (!dateStr) return '';
    const days = daysUntilDate(dateStr);
    if (days < 0) return 'mt-expired';
    if (days <= 14) return 'mt-warn';
    return '';
  }
  function vehicleHasUrgentDocs(eq){
    return VEHICLE_DOC_FIELDS.some(f => {
      if (f.camionOnly && eq.category !== 'camion') return false;
      return eq[f.key] && daysUntilDate(eq[f.key]) <= 7;
    });
  }
  const MACHINES_FILTER_CARD_DEFS = [
    { key: 'masina_mica', label: 'Mașină mică' },
    { key: 'autoutilitara', label: 'Autoutilitară' },
    { key: 'camion', label: 'Camion' },
    { key: 'utilaj', label: 'Utilaj' },
    { key: 'notificari', label: 'Notificări' },
  ];
  function renderMachinesOverview(){
    const cardsWrap = document.getElementById('machinesFilterCards');
    const tbody = document.getElementById('machinesTableBody');
    const tableWrap = document.getElementById('machinesTableWrap');
    const cardsList = document.getElementById('machinesCardsList');
    if (!cardsWrap || !tbody || !tableWrap || !cardsList) return;
    const allVehicles = allEquipment.filter(eq => eq.erp_category === 'masina');
    const urgentVehicles = allVehicles.filter(vehicleHasUrgentDocs);
    const subcatCounts = { masina_mica: 0, autoutilitara: 0, camion: 0, utilaj: 0 };
    allVehicles.forEach(eq => { if (subcatCounts[eq.category] != null) subcatCounts[eq.category]++; });

    // The cards only make sense as a quick-filter on top of "Prezentare
    // generală" — once you've navigated into a specific sidebar section
    // (Mașină mică, Camion, ...) you're already looking at just that
    // category, so re-showing the same cards there is redundant.
    const showCards = machinesSidebarKey === 'Toate';
    cardsWrap.style.display = showCards ? '' : 'none';
    if (showCards) {
      cardsWrap.innerHTML = MACHINES_FILTER_CARD_DEFS.map(def => {
        const count = def.key === 'notificari' ? urgentVehicles.length : subcatCounts[def.key];
        const isActive = machinesSubcatFilter === def.key;
        const isWarn = def.key === 'notificari' && count > 0;
        return `
          <button type="button" class="priority-card${isWarn ? ' warn' : ''}${isActive ? ' active' : ''}" data-subcat="${def.key}">
            <span class="k">${escapeHtml(def.label)}</span>
            <div class="num">${count}</div>
          </button>
        `;
      }).join('');
      // Clicking an already-active card clears it back to "Toate" —
      // a card is a toggle, not a one-way door.
      cardsWrap.querySelectorAll('.priority-card').forEach(card => {
        card.addEventListener('click', () => {
          const nextKey = machinesSubcatFilter === card.dataset.subcat ? 'Toate' : card.dataset.subcat;
          setMachinesSubcatFilter(nextKey, { sidebarKey: 'Toate' });
        });
      });
    } else {
      cardsWrap.innerHTML = '';
    }

    const filtered = (machinesSubcatFilter === 'Toate' ? allVehicles
      : machinesSubcatFilter === 'notificari' ? urgentVehicles
      : allVehicles.filter(eq => eq.category === machinesSubcatFilter))
      .slice()
      .sort((a, b) => (a.plate_number || '').localeCompare(b.plate_number || '', 'ro'));

    const countEl = document.getElementById('machinesCount');
    if (countEl) countEl.textContent = machinesSubcatFilter === 'Toate'
      ? allVehicles.length + (allVehicles.length === 1 ? ' mașină' : ' mașini')
      : `${filtered.length} din ${allVehicles.length} mașini`;

    // Prezentare generală is the browse-everything overview, kept as a
    // table with the plate number as the one entry point — click it and
    // you land straight on the car's own subcategory page, same as a
    // ticket in Sesizări Overview. A specific subcategory page is itself
    // that destination: a worklist of full cards (not a table), so every
    // field is already visible with no extra click, plus Editează/Șterge
    // icons on each card.
    const onOverview = machinesSidebarKey === 'Toate';
    tableWrap.style.display = onOverview ? '' : 'none';
    cardsList.style.display = onOverview ? 'none' : '';

    if (onOverview) {
      if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="machines-table-empty">Nicio mașină înregistrată.</div></td></tr>`;
        return;
      }
      function dateCell(dateStr, applicable){
        if (!applicable) return '<td class="mt-na">—</td>';
        if (!dateStr) return '<td class="mt-na">—</td>';
        const cls = docDateClass(dateStr);
        return `<td class="${cls}">${formatWoDateRO(dateStr)}${cls ? ' ⚠' : ''}</td>`;
      }
      tbody.innerHTML = filtered.map(eq => {
        const isCamion = eq.category === 'camion';
        return `
          <tr>
            <td class="mt-name-cell"><div class="mt-name">${escapeHtml(eq.name)}</div><div class="mt-subcat">${eq.notes ? escapeHtml(eq.notes) : ''}</div></td>
            <td><a href="#" class="ticket-link" data-vehicle-id="${escapeHtml(eq.id)}">${escapeHtml(eq.plate_number || '—')}</a></td>
            ${dateCell(eq.itp_expires_on, true)}
            ${dateCell(eq.insurance_expires_on, true)}
            ${dateCell(eq.transport_license_expires_on, isCamion)}
            ${dateCell(eq.parking_ticket_expires_on, true)}
            ${dateCell(eq.vignette_expires_on, true)}
            ${dateCell(eq.tachograph_expires_on, isCamion)}
          </tr>
        `;
      }).join('');
    } else {
      cardsList.innerHTML = filtered.length
        ? filtered.map(vehicleBigCardHtml).join('')
        : `<div class="machines-table-empty">Nicio mașină în această categorie.</div>`;
    }
  }
  const machinesTableBody = document.getElementById('machinesTableBody');
  if (machinesTableBody) machinesTableBody.addEventListener('click', (e) => {
    const link = e.target.closest('.ticket-link');
    if (!link) return;
    e.preventDefault();
    const eq = allEquipment.find(v => v.id === link.dataset.vehicleId);
    if (eq) goToVehicle(eq);
  });
  // Which raw reading column a vehicle uses -- utilaje are tracked by
  // engine hours (no odometer on a stationary machine), everything
  // else by km.
  function vehicleReadingField(eq){
    return eq.category === 'utilaj' ? 'fuel_odometer_hours' : 'fuel_odometer_km';
  }
  // Baseline a month's delta is measured against: the most recent
  // EARLIER month's own reading for this vehicle, or -- for its
  // first-ever tracked month -- the one-time initial reading set on
  // the vehicle itself (purchase, or whenever tracking started).
  function previousFuelReading(eq, year, month){
    const field = vehicleReadingField(eq);
    const earlier = allVehicleFuelLogs
      .filter(l => l.vehicle_id === eq.id && l[field] != null && (l.year < year || (l.year === year && l.month < month)))
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));
    if (earlier.length) return Number(earlier[0][field]);
    const initial = eq.category === 'utilaj' ? eq.fuel_initial_hours : eq.fuel_initial_km;
    return initial != null ? Number(initial) : null;
  }
  function fuelPurchaseSum(vehicleId, year, month){
    return allVehicleFuelPurchases
      .filter(p => p.vehicle_id === vehicleId && p.year === year && p.month === month)
      .reduce((sum, p) => sum + Number(p.liters), 0);
  }
  function fuelLogFor(vehicleId, year, month){
    return allVehicleFuelLogs.find(l => l.vehicle_id === vehicleId && l.year === year && l.month === month) || null;
  }
  // Full picture for one vehicle in one month: the reading entered (if
  // any), what it's measured against, the resulting delta, that
  // month's fuel-bill total, and the consumption that implies.
  // vehicle_fuel_odometer_and_purchase_ledger migration mirrors this
  // exact logic server-side (check_vehicle_month_fuel_consumption) for
  // the >50% alert, so this is display-only here. REPORT_MONTHS comes
  // from excel.js (shared top-level script scope, same cross-file
  // pattern already used throughout this app) — only referenced
  // inside functions, never at load time, so file load order doesn't
  // matter.
  function vehicleFuelConsumption(eq, year, month){
    const isUtilaj = eq.category === 'utilaj';
    const unit = isUtilaj ? 'L/H' : 'L/100km';
    const field = vehicleReadingField(eq);
    const log = fuelLogFor(eq.id, year, month);
    const reading = (log && log[field] != null) ? Number(log[field]) : null;
    const baseline = previousFuelReading(eq, year, month);
    const delta = (reading != null && baseline != null && reading - baseline > 0) ? (reading - baseline) : null;
    const totalAdded = fuelPurchaseSum(eq.id, year, month);
    const actual = (delta != null && totalAdded > 0)
      ? (isUtilaj ? totalAdded / delta : totalAdded / delta * 100)
      : null;
    const rated = eq.fuel_rated_consumption != null ? Number(eq.fuel_rated_consumption) : null;
    const overLimit = actual != null && rated != null && actual > rated * 1.5;
    return { isUtilaj, unit, reading, baseline, delta, totalAdded, actual, rated, overLimit };
  }
  const erpLoadedAt = new Date();
  let fuelReportYear = erpLoadedAt.getFullYear();
  let fuelReportMonth = erpLoadedAt.getMonth() + 1; // 1-12, matches vehicle_fuel_logs.month
  function renderMachinesFuelReport(){
    const tbody = document.getElementById('machinesFuelReportTableBody');
    const countEl = document.getElementById('machinesFuelReportCount');
    const labelEl = document.getElementById('fuelReportMonthLabel');
    if (!tbody) return;
    if (labelEl) labelEl.textContent = `${REPORT_MONTHS[fuelReportMonth - 1]} ${fuelReportYear}`;
    const vehicles = allEquipment.filter(eq => eq.erp_category === 'masina')
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ro'));
    if (countEl) countEl.textContent = vehicles.length + (vehicles.length === 1 ? ' mașină' : ' mașini');
    if (!vehicles.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="machines-table-empty">Nicio mașină înregistrată.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = vehicles.map(eq => {
      const c = vehicleFuelConsumption(eq, fuelReportYear, fuelReportMonth);
      const na = '<span class="mt-na">—</span>';
      return `
        <tr class="${c.overLimit ? 'row-error' : ''}">
          <td><a href="#" class="ticket-link" data-vehicle-id="${escapeHtml(eq.id)}">${escapeHtml(eq.name)}</a></td>
          <td>${!c.isUtilaj && c.delta != null ? escapeHtml(String(c.delta)) + ' km' : na}</td>
          <td>${c.isUtilaj && c.delta != null ? escapeHtml(String(c.delta)) + ' h' : na}</td>
          <td>${c.totalAdded > 0 ? escapeHtml(String(c.totalAdded)) + ' L' : na}</td>
          <td class="${c.overLimit ? 'mt-warn' : ''}">${c.actual != null ? `${c.actual.toFixed(1)} ${c.unit}${c.overLimit ? ' ⚠' : ''}` : na}</td>
          <td>${c.rated != null ? `${c.rated} ${c.unit}` : na}</td>
          <td><button type="button" class="btn fuel-log-edit-btn" data-requires-write="erp" data-vehicle-id="${escapeHtml(eq.id)}">Editează</button></td>
        </tr>
      `;
    }).join('');
  }
  function shiftFuelReportMonth(delta){
    fuelReportMonth += delta;
    if (fuelReportMonth < 1) { fuelReportMonth = 12; fuelReportYear -= 1; }
    else if (fuelReportMonth > 12) { fuelReportMonth = 1; fuelReportYear += 1; }
    renderMachinesFuelReport();
  }
  const fuelReportPrevMonthBtn = document.getElementById('fuelReportPrevMonthBtn');
  const fuelReportNextMonthBtn = document.getElementById('fuelReportNextMonthBtn');
  if (fuelReportPrevMonthBtn) fuelReportPrevMonthBtn.addEventListener('click', () => shiftFuelReportMonth(-1));
  if (fuelReportNextMonthBtn) fuelReportNextMonthBtn.addEventListener('click', () => shiftFuelReportMonth(1));
  /* ============================================================
     PER-VEHICLE, PER-MONTH SHEET — two independent, immediately-
     saved actions rather than one combined Salvează: the odometer/
     hour-meter reading (one value, replaces whatever was there for
     this vehicle+month) and the fuel-bill ledger (append/remove
     individual entries, same "never silently overwritten" shape as
     stock_ledger). fuelLogSheetContext tracks which vehicle+month the
     open sheet refers to, for both halves and their handlers below.
     ============================================================ */
  let fuelLogSheetContext = null; // { vehicleId, year, month, eq, baseline }
  function updateVflDiffDisplay(){
    if (!fuelLogSheetContext) return;
    const { eq, baseline } = fuelLogSheetContext;
    const prevEl = document.getElementById('vfl-previous-reading');
    const diffEl = document.getElementById('vfl-diff-display');
    const unit = eq.category === 'utilaj' ? 'h' : 'km';
    if (prevEl) prevEl.textContent = baseline != null ? `${baseline} ${unit}` : 'fără citire anterioară';
    if (!diffEl) return;
    const newVal = document.getElementById('vfl-reading').value;
    if (newVal === '' || baseline == null) {
      diffEl.textContent = baseline == null ? 'nimic de comparat încă' : '—';
      diffEl.classList.remove('negative');
      return;
    }
    const diff = Number(newVal) - baseline;
    diffEl.textContent = `${diff >= 0 ? '+' : ''}${diff} ${unit}`;
    diffEl.classList.toggle('negative', diff < 0);
  }
  const vflReadingInput = document.getElementById('vfl-reading');
  if (vflReadingInput) vflReadingInput.addEventListener('input', updateVflDiffDisplay);
  function renderFuelPurchaseList(){
    const listEl = document.getElementById('vflPurchaseList');
    const totalEl = document.getElementById('vfl-purchase-total');
    if (!listEl || !fuelLogSheetContext) return;
    const { vehicleId, year, month } = fuelLogSheetContext;
    const entries = allVehicleFuelPurchases
      .filter(p => p.vehicle_id === vehicleId && p.year === year && p.month === month)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = entries.reduce((sum, p) => sum + Number(p.liters), 0);
    if (totalEl) totalEl.textContent = `${total} L`;
    if (!entries.length) {
      listEl.innerHTML = '<p class="status-history-empty">Nicio alimentare înregistrată încă.</p>';
      return;
    }
    listEl.innerHTML = entries.map(p => `
      <div class="fuel-purchase-item">
        <div>
          <div class="fuel-purchase-item-main">${escapeHtml(String(p.liters))} L</div>
          ${p.note ? `<div class="fuel-purchase-item-note">${escapeHtml(p.note)}</div>` : ''}
        </div>
        <button type="button" class="fuel-purchase-delete" data-id="${escapeHtml(p.id)}" data-requires-write="erp" aria-label="Șterge alimentarea">×</button>
      </div>
    `).join('');
  }
  // Entering a month's fuel figures for one vehicle — a small sheet
  // rather than inline table inputs, same reasoning as every other
  // add/edit flow in this file (room for labels/validation).
  function openVehicleFuelLogForm(eq){
    const field = vehicleReadingField(eq);
    const log = fuelLogFor(eq.id, fuelReportYear, fuelReportMonth);
    const baseline = previousFuelReading(eq, fuelReportYear, fuelReportMonth);
    fuelLogSheetContext = { vehicleId: eq.id, year: fuelReportYear, month: fuelReportMonth, eq, baseline };
    document.getElementById('vfl-vehicle-id').value = eq.id;
    document.getElementById('vfl-year').value = fuelReportYear;
    document.getElementById('vfl-month').value = fuelReportMonth;
    document.getElementById('vfl-reading').value = (log && log[field] != null) ? log[field] : '';
    const isUtilaj = eq.category === 'utilaj';
    const readingLabelEl = document.getElementById('vfl-reading-label');
    if (readingLabelEl) readingLabelEl.textContent = isUtilaj ? 'Ore noi (citire contor)' : 'Km nou (citire bord)';
    updateVflDiffDisplay();
    renderFuelPurchaseList();
    document.getElementById('vfl-purchase-liters').value = '';
    document.getElementById('vfl-purchase-note').value = '';
    const titleEl = document.getElementById('vehicleFuelLogFormSheetTitle');
    if (titleEl) titleEl.textContent = `${eq.name} — ${REPORT_MONTHS[fuelReportMonth - 1]} ${fuelReportYear}`;
    setSheetOpen('vehicleFuelLogFormSheet', true);
  }
  const vflSaveReadingBtn = document.getElementById('vflSaveReadingBtn');
  if (vflSaveReadingBtn) vflSaveReadingBtn.addEventListener('click', async () => {
    if (!fuelLogSheetContext) return;
    const { vehicleId, year, month, eq } = fuelLogSheetContext;
    const isUtilaj = eq.category === 'utilaj';
    const readingVal = document.getElementById('vfl-reading').value;
    if (readingVal === '') { alert('Introduceți citirea.'); return; }
    const payload = {
      vehicle_id: vehicleId, year, month,
      fuel_odometer_km: isUtilaj ? null : Number(readingVal),
      fuel_odometer_hours: isUtilaj ? Number(readingVal) : null,
      updated_at: new Date().toISOString(),
    };
    vflSaveReadingBtn.disabled = true;
    const { error } = await supabaseClient.from('vehicle_fuel_logs').upsert(payload, { onConflict: 'vehicle_id,year,month' });
    vflSaveReadingBtn.disabled = false;
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
    showToast('Citirea a fost salvată.');
    await loadVehicleFuelLogs();
    renderMachinesFuelReport();
  });
  const vflPurchaseAddBtn = document.getElementById('vflPurchaseAddBtn');
  if (vflPurchaseAddBtn) vflPurchaseAddBtn.addEventListener('click', async () => {
    if (!fuelLogSheetContext) return;
    const litersInput = document.getElementById('vfl-purchase-liters');
    const noteInput = document.getElementById('vfl-purchase-note');
    const liters = Number(litersInput.value);
    if (!liters || liters <= 0) { alert('Introduceți o cantitate validă de litri.'); return; }
    const { vehicleId, year, month } = fuelLogSheetContext;
    vflPurchaseAddBtn.disabled = true;
    const { error } = await supabaseClient.from('vehicle_fuel_purchases').insert({
      vehicle_id: vehicleId, year, month, liters,
      note: noteInput.value.trim() || null,
      user_email: currentSessionEmail || null,
    });
    vflPurchaseAddBtn.disabled = false;
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
    litersInput.value = '';
    noteInput.value = '';
    await loadVehicleFuelPurchases();
    renderFuelPurchaseList();
    renderMachinesFuelReport();
  });
  const vflPurchaseList = document.getElementById('vflPurchaseList');
  if (vflPurchaseList) vflPurchaseList.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.fuel-purchase-delete');
    if (!delBtn || !fuelLogSheetContext) return;
    if (!confirm('Ștergeți această alimentare?')) return;
    const { error } = await supabaseClient.from('vehicle_fuel_purchases').delete().eq('id', delBtn.dataset.id);
    if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
    await loadVehicleFuelPurchases();
    renderFuelPurchaseList();
    renderMachinesFuelReport();
  });
  const machinesFuelReportTableBody = document.getElementById('machinesFuelReportTableBody');
  if (machinesFuelReportTableBody) machinesFuelReportTableBody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.fuel-log-edit-btn');
    if (editBtn) {
      const eq = allEquipment.find(v => v.id === editBtn.dataset.vehicleId);
      if (eq) openVehicleFuelLogForm(eq);
      return;
    }
    const link = e.target.closest('.ticket-link');
    if (!link) return;
    e.preventDefault();
    const eq = allEquipment.find(v => v.id === link.dataset.vehicleId);
    if (eq) goToVehicle(eq);
  });
  // Mirrors Sesizări's own "Raport Excel" choice-then-generate flow
  // (openReportTypeSelection in excel.js) but self-contained here --
  // just two destinations instead of that one's year/month picker,
  // since a fuel report sheet is one flat table either way.
  function openFuelReportExportScope(){
    const sheet = document.getElementById('fuelReportExportScopeSheet');
    const monthBtn = document.getElementById('fuelReportExportMonthBtn');
    const allBtn = document.getElementById('fuelReportExportAllBtn');
    const cancelBtn = document.getElementById('fuelReportExportCancelBtn');
    const closeBtn = document.getElementById('fuelReportExportScopeCloseBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !monthBtn || !allBtn || !cancelBtn || !closeBtn || !backdrop) {
      return Promise.resolve('month');
    }
    setSheetOpen('fuelReportExportScopeSheet', true);
    return new Promise(resolve => {
      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('fuelReportExportScopeSheet', false);
        monthBtn.removeEventListener('click', handleMonth);
        allBtn.removeEventListener('click', handleAll);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };
      const handleMonth = () => cleanup('month');
      const handleAll = () => cleanup('all');
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => { if (event.key === 'Escape') handleCancel(); };
      monthBtn.addEventListener('click', handleMonth);
      allBtn.addEventListener('click', handleAll);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
    });
  }
  function fuelReportAoaForPeriod(vehicles, year, month){
    const header = ['Mașină', 'Nr. înmatriculare', 'Km (diferență)', 'Timp (diferență)', 'Total alimentare (L)', 'Consum efectiv', 'Consum normat'];
    const rows = [header];
    vehicles.forEach(eq => {
      const c = vehicleFuelConsumption(eq, year, month);
      rows.push([
        eq.name || '',
        eq.plate_number || '',
        (!c.isUtilaj && c.delta != null) ? c.delta : '',
        (c.isUtilaj && c.delta != null) ? c.delta : '',
        c.totalAdded > 0 ? c.totalAdded : '',
        c.actual != null ? `${c.actual.toFixed(1)} ${c.unit}` : '',
        c.rated != null ? `${c.rated} ${c.unit}` : '',
      ]);
    });
    return rows;
  }
  async function exportFuelReportToExcel(){
    const btn = document.getElementById('fuelReportExportBtn');
    if (!btn) return;
    const scope = await openFuelReportExportScope();
    if (scope === null) return;
    const vehicles = allEquipment.filter(eq => eq.erp_category === 'masina')
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ro'));
    if (!vehicles.length) { alert('Nicio mașină înregistrată.'); return; }
    btn.disabled = true;
    try {
      const workbook = XLSX.utils.book_new();
      if (scope === 'month') {
        const aoa = fuelReportAoaForPeriod(vehicles, fuelReportYear, fuelReportMonth);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        autosizeWorksheet(ws, aoa);
        XLSX.utils.book_append_sheet(workbook, ws, `${REPORT_MONTHS[fuelReportMonth - 1]} ${fuelReportYear}`.slice(0, 31));
      } else {
        const periods = new Set();
        allVehicleFuelLogs.forEach(l => periods.add(`${l.year}-${l.month}`));
        allVehicleFuelPurchases.forEach(p => periods.add(`${p.year}-${p.month}`));
        if (!periods.size) {
          alert('Nu există date de consum înregistrate încă.');
          btn.disabled = false;
          return;
        }
        const sortedPeriods = [...periods]
          .map(p => { const [y, m] = p.split('-').map(Number); return { y, m }; })
          .sort((a, b) => a.y - b.y || a.m - b.m);
        sortedPeriods.forEach(({ y, m }) => {
          const aoa = fuelReportAoaForPeriod(vehicles, y, m);
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          autosizeWorksheet(ws, aoa);
          XLSX.utils.book_append_sheet(workbook, ws, `${REPORT_MONTHS[m - 1]} ${y}`.slice(0, 31));
        });
      }
      const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = scope === 'month'
        ? `consum-carburant-${fuelReportYear}-${String(fuelReportMonth).padStart(2, '0')}.xlsx`
        : 'consum-carburant-toate-lunile.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Raportul Excel a fost descărcat.');
    } catch (err) {
      console.error('Fuel report Excel export failed:', err);
      alert('Eroare la generarea raportului Excel: ' + (err && err.message ? err.message : 'motiv necunoscut'));
    } finally {
      btn.disabled = false;
    }
  }
  const fuelReportExportBtn = document.getElementById('fuelReportExportBtn');
  if (fuelReportExportBtn) fuelReportExportBtn.addEventListener('click', exportFuelReportToExcel);
  function renderErpRow(eq){
    const isEquipment = eq.item_type === 'echipament';
    const erpCategory = eq.erp_category || (isEquipment ? 'echipament' : 'material');
    const qtyLabel = !isEquipment && eq.quantity != null ? (Number(eq.quantity) + (eq.unit ? ' ' + eq.unit : '')) : '';
    const lowStock = isLowStock(eq);
    const myAssignments = allResourceAssignments.filter(a => a.inventory_item_id === eq.id && a.status === 'reserved');
    let reservationNote = '';
    if (isEquipment && myAssignments.length) {
      const ranges = myAssignments.map(a => `${formatWoDateRO(a.reserved_from)}–${formatWoDateRO(a.reserved_to)}`).join(', ');
      reservationNote = `Rezervat: ${ranges}`;
    } else if (!isEquipment && myAssignments.length) {
      const reservedTotal = myAssignments.reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
      reservationNote = `${reservedTotal}${eq.unit ? ' ' + eq.unit : ''} rezervat pe proiecte neterminate`;
    }
    const row = document.createElement('div');
    row.className = 'backlog-row' + (eq.status === 'Indisponibil' ? ' done' : '');
    row.innerHTML = `
      <div class="backlog-main">
        <div class="backlog-title-line">
          <span class="backlog-title">${escapeHtml(eq.name)}</span>
          <span class="backlog-tag erp-type-tag ${erpCategory}">${ERP_CATEGORY_LABEL[erpCategory]}</span>
          <span class="backlog-tag">${escapeHtml(EQUIPMENT_STATUS_LABEL[eq.status] || eq.status)}</span>
          ${lowStock ? '<span class="backlog-tag erp-warning-tag">⚠ Stoc redus</span>' : ''}
          ${qtyLabel ? `<span class="backlog-days">${escapeHtml(qtyLabel)}</span>` : ''}
        </div>
        <div class="backlog-meta-line">${escapeHtml(eq.category || '')}${eq.location ? ' · ' + escapeHtml(eq.location) : ''}${eq.assigned_to ? ' · alocat: ' + escapeHtml(eq.assigned_to) : ''}${eq.serial_number ? ' · SN ' + escapeHtml(eq.serial_number) : ''}</div>
        ${reservationNote ? `<div class="backlog-meta-line erp-reservation-note">ⓘ ${escapeHtml(reservationNote)}</div>` : ''}
      </div>
      <div class="backlog-actions">
        <button class="btn eq-edit" data-requires-write="erp">Editează</button>
        <button class="btn btn-primary eq-status" data-requires-write="erp">${escapeHtml(EQUIPMENT_STATUS_LABEL[EQUIPMENT_STATUS_CYCLE[eq.status]] || 'Schimbă starea')}</button>
        ${(erpCategory === 'material' || erpCategory === 'produs') ? '<button class="btn eq-ledger">Jurnal stoc</button>' : ''}
        <button class="btn eq-delete" data-requires-write="erp">Șterge</button>
      </div>
    `;
    row.querySelector('.eq-edit').addEventListener('click', () => openEquipmentForm(eq));
    const ledgerBtn = row.querySelector('.eq-ledger');
    if (ledgerBtn) ledgerBtn.addEventListener('click', () => openStockLedgerSheet(eq.id, eq.name));
    const statusBtn = row.querySelector('.eq-status');
    if (statusBtn) statusBtn.addEventListener('click', async () => {
      const nextStatus = EQUIPMENT_STATUS_CYCLE[eq.status] || 'Disponibil';
      const { error } = await supabaseClient.from('equipment_inventory').update({ status: nextStatus }).eq('id', eq.id);
      if (error) { console.error(error); alert('Eroare la actualizare. Încercați din nou.'); return; }
      logEntityActivity(erpCategory, eq.id, `Stare schimbată în „${EQUIPMENT_STATUS_LABEL[nextStatus] || nextStatus}”.`);
      loadEquipment();
    });
    row.querySelector('.eq-delete').addEventListener('click', async () => {
      if (!confirm(`Ștergeți definitiv „${eq.name}” din inventar?`)) return;
      const { error } = await supabaseClient.from('equipment_inventory').delete().eq('id', eq.id);
      if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
      logEntityActivity(erpCategory, eq.id, `„${eq.name}” a fost șters din inventar.`);
      loadEquipment();
    });
    return row;
  }
  function renderEquipment(){
    Object.keys(ERP_CATEGORY_LIST_IDS).forEach(erpCategory => {
      const { list: listId, count: countId, empty: emptyMsg } = ERP_CATEGORY_LIST_IDS[erpCategory];
      const list = document.getElementById(listId);
      if (!list) return;
      const items = allEquipment.filter(eq => (eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material')) === erpCategory);
      const countEl = document.getElementById(countId);
      if (countEl) countEl.textContent = items.length + (items.length === 1 ? ' element' : ' elemente');
      if (items.length === 0) {
        list.innerHTML = `<div class="no-results" style="padding:40px 0;text-align:center;color:var(--ink-400);">${emptyMsg}</div>`;
        return;
      }
      list.innerHTML = '';
      items.forEach(eq => list.appendChild(renderErpRow(eq)));
    });
    renderMachinesOverview();
    renderMachinesFuelReport();
    renderErpHomeStats();
  }
  function renderErpHomeStats(){
    const counts = { echipament: 0, masina: 0, material: 0, produs: 0 };
    allEquipment.forEach(eq => {
      const erpCategory = eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material');
      if (counts[erpCategory] != null) counts[erpCategory]++;
    });
    const eqCountEl = document.getElementById('erpHomeEquipmentCount');
    if (eqCountEl) eqCountEl.textContent = counts.echipament;
    const maCountEl = document.getElementById('erpHomeMachinesCount');
    if (maCountEl) maCountEl.textContent = counts.masina;
    const mtCountEl = document.getElementById('erpHomeMaterialsCount');
    if (mtCountEl) mtCountEl.textContent = counts.material;
    const pdCountEl = document.getElementById('erpHomeProductsCount');
    if (pdCountEl) pdCountEl.textContent = counts.produs;
    renderErpAlerts();
  }
  function renderErpAlerts(){
    const wrap = document.getElementById('erpAlertsWrap');
    const list = document.getElementById('erpAlertsList');
    if (!wrap || !list) return;
    const lowStockItems = allEquipment.filter(isLowStock);
    const expiredDocsItems = allEquipment.filter(hasExpiredDocs);
    if (!lowStockItems.length && !expiredDocsItems.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
    wrap.style.display = '';
    const lowStockHtml = lowStockItems.map(eq => `
      <div class="status-history-item" data-goto-tab="${eq.erp_category === 'produs' ? 'products' : 'materials'}">
        <span class="status-history-time">${eq.erp_category === 'produs' ? 'PRODUS' : 'MATERIAL'}</span>
        <span class="status-history-dot"></span>
        <div>
          <div class="status-history-check">${escapeHtml(eq.name)}</div>
          <div class="status-history-message">Stoc redus: ${eq.quantity}${eq.unit ? ' ' + escapeHtml(eq.unit) : ''} (prag ${eq.reorder_threshold}${eq.unit ? ' ' + escapeHtml(eq.unit) : ''})</div>
        </div>
      </div>
    `).join('');
    const expiredDocsHtml = expiredDocsItems.map(eq => `
      <div class="status-history-item" data-goto-tab="machines">
        <span class="status-history-time">MAȘINĂ</span>
        <span class="status-history-dot"></span>
        <div>
          <div class="status-history-check">${escapeHtml(eq.name)}</div>
          <div class="status-history-message">Acte expirate: ${escapeHtml(expiredDocNames(eq).join(', '))}</div>
        </div>
      </div>
    `).join('');
    list.innerHTML = lowStockHtml + expiredDocsHtml;
    list.querySelectorAll('.status-history-item').forEach(row => row.addEventListener('click', () => openAdminTab(row.dataset.gotoTab)));
  }
  const erpHomeEquipmentCard = document.getElementById('erpHomeEquipmentCard');
  if (erpHomeEquipmentCard) erpHomeEquipmentCard.addEventListener('click', () => openAdminTab('equipment'));
  const erpHomeMachinesCard = document.getElementById('erpHomeMachinesCard');
  if (erpHomeMachinesCard) erpHomeMachinesCard.addEventListener('click', () => openAdminTab('machines'));
  const erpHomeMaterialsCard = document.getElementById('erpHomeMaterialsCard');
  if (erpHomeMaterialsCard) erpHomeMaterialsCard.addEventListener('click', () => openAdminTab('materials'));
  const erpHomeProductsCard = document.getElementById('erpHomeProductsCard');
  if (erpHomeProductsCard) erpHomeProductsCard.addEventListener('click', () => openAdminTab('products'));
  const erpHomeNavEquipment = document.getElementById('erpHomeNavEquipment');
  if (erpHomeNavEquipment) erpHomeNavEquipment.addEventListener('click', () => openAdminTab('equipment'));
  const erpHomeNavMachines = document.getElementById('erpHomeNavMachines');
  if (erpHomeNavMachines) erpHomeNavMachines.addEventListener('click', () => openAdminTab('machines'));
  const erpHomeNavMaterials = document.getElementById('erpHomeNavMaterials');
  if (erpHomeNavMaterials) erpHomeNavMaterials.addEventListener('click', () => openAdminTab('materials'));
  const erpHomeNavProducts = document.getElementById('erpHomeNavProducts');
  if (erpHomeNavProducts) erpHomeNavProducts.addEventListener('click', () => openAdminTab('products'));

  const efTypeSelect = document.getElementById('ef-type');
  const ERP_ITEM_FORM_TITLE = { echipament: 'echipament', masina: 'mașină', material: 'material', produs: 'produs' };
  function syncEquipmentFormFields(){
    const isStockTracked = efTypeSelect.value === 'material' || efTypeSelect.value === 'produs';
    document.getElementById('ef-quantity-field').style.display = isStockTracked ? '' : 'none';
    document.getElementById('ef-unit-field').style.display = isStockTracked ? '' : 'none';
    document.getElementById('ef-reorder-field').style.display = isStockTracked ? '' : 'none';
  }
  if (efTypeSelect) efTypeSelect.addEventListener('change', syncEquipmentFormFields);
  let efEditingOriginalQuantity = null;
  function openEquipmentForm(eq, presetCategory){
    efEditingOriginalQuantity = eq && eq.quantity != null ? Number(eq.quantity) : null;
    const erpCategory = eq ? (eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material')) : (presetCategory || 'echipament');
    document.getElementById('ef-id').value = eq ? eq.id : '';
    document.getElementById('ef-name').value = eq ? eq.name : '';
    document.getElementById('ef-type').value = erpCategory;
    document.getElementById('ef-category').value = eq ? (eq.category || '') : '';
    document.getElementById('ef-quantity').value = eq ? eq.quantity : 1;
    document.getElementById('ef-unit').value = eq ? (eq.unit || '') : '';
    document.getElementById('ef-reorder-threshold').value = eq && eq.reorder_threshold != null ? eq.reorder_threshold : '';
    document.getElementById('ef-serial').value = eq ? (eq.serial_number || '') : '';
    document.getElementById('ef-location').value = eq ? (eq.location || '') : '';
    document.getElementById('ef-assigned').value = eq ? (eq.assigned_to || '') : '';
    document.getElementById('ef-notes').value = eq ? (eq.notes || '') : '';
    syncEquipmentFormFields();
    const titleEl = document.getElementById('erpItemFormSheetTitle');
    if (titleEl) titleEl.textContent = (eq ? 'Editează ' : 'Adaugă ') + ERP_ITEM_FORM_TITLE[erpCategory];
    setSheetOpen('erpItemFormSheet', true);
  }
  const addEquipmentBtn = document.getElementById('addEquipmentBtn');
  if (addEquipmentBtn) addEquipmentBtn.addEventListener('click', () => openEquipmentForm(null, 'echipament'));
  // vehicleFormSheet is the one merged vehicle form — identity (Titlu,
  // Nr. înmatriculare, Serie șasiu, Subcategorie, Alocat la, Notițe)
  // and documents (ITP, Asigurare, ...) together, used both for
  // "+ Adaugă mașină" (vf-id blank → insert) and for "Editează" on the
  // detail card (vf-id set → update). Licență transport/Tahograf only
  // apply to Camion, and toggle live as the Subcategorie select changes.
  function syncVehicleFormCamionFields(){
    const subcat = document.getElementById('vf-subcat').value;
    const isCamion = subcat === 'camion';
    document.getElementById('vf-transport-license-field').style.display = isCamion ? '' : 'none';
    document.getElementById('vf-tachograph-field').style.display = isCamion ? '' : 'none';
    // Utilaje are tracked by hours worked, not km driven (there's no
    // odometer on a stationary machine) — everything else is the
    // reverse. Consum normat's unit, and which initial-reading field
    // applies, both follow that same split (the monthly readings
    // themselves live in "Raport lunar consum", not on this form —
    // see openVehicleFuelLogForm).
    const isUtilaj = subcat === 'utilaj';
    document.getElementById('vf-fuel-rated-unit').textContent = isUtilaj ? 'L/H' : 'L/100km';
    document.getElementById('vf-fuel-initial-km-field').style.display = isUtilaj ? 'none' : '';
    document.getElementById('vf-fuel-initial-hours-field').style.display = isUtilaj ? '' : 'none';
  }
  const vfSubcatSelect = document.getElementById('vf-subcat');
  if (vfSubcatSelect) vfSubcatSelect.addEventListener('change', syncVehicleFormCamionFields);
  const addMachineBtn = document.getElementById('addMachineBtn');
  if (addMachineBtn) addMachineBtn.addEventListener('click', () => {
    document.getElementById('vf-id').value = '';
    document.getElementById('vf-title').value = '';
    document.getElementById('vf-plate').value = '';
    document.getElementById('vf-chassis').value = '';
    document.getElementById('vf-subcat').value = 'masina_mica';
    document.getElementById('vf-assigned').value = '';
    document.getElementById('vf-notes').value = '';
    document.getElementById('vf-itp-expires').value = '';
    document.getElementById('vf-insurance-expires').value = '';
    document.getElementById('vf-transport-license-expires').value = '';
    document.getElementById('vf-parking-ticket-expires').value = '';
    document.getElementById('vf-vignette-expires').value = '';
    document.getElementById('vf-tachograph-expires').value = '';
    document.getElementById('vf-fuel-rated').value = '';
    document.getElementById('vf-fuel-tank-capacity').value = '';
    document.getElementById('vf-fuel-initial-km').value = '';
    document.getElementById('vf-fuel-initial-hours').value = '';
    syncVehicleFormCamionFields();
    const titleEl = document.getElementById('vehicleFormSheetTitle');
    if (titleEl) titleEl.textContent = 'Adaugă mașină';
    const saveBtn = document.getElementById('vfSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Adaugă';
    setSheetOpen('vehicleFormSheet', true);
  });
  function openVehicleEdit(eq){
    document.getElementById('vf-id').value = eq.id;
    document.getElementById('vf-title').value = eq.name || '';
    document.getElementById('vf-plate').value = eq.plate_number || '';
    document.getElementById('vf-chassis').value = eq.serial_number || '';
    document.getElementById('vf-subcat').value = eq.category || 'masina_mica';
    document.getElementById('vf-assigned').value = eq.assigned_to || '';
    document.getElementById('vf-notes').value = eq.notes || '';
    document.getElementById('vf-itp-expires').value = eq.itp_expires_on || '';
    document.getElementById('vf-insurance-expires').value = eq.insurance_expires_on || '';
    document.getElementById('vf-transport-license-expires').value = eq.transport_license_expires_on || '';
    document.getElementById('vf-parking-ticket-expires').value = eq.parking_ticket_expires_on || '';
    document.getElementById('vf-vignette-expires').value = eq.vignette_expires_on || '';
    document.getElementById('vf-tachograph-expires').value = eq.tachograph_expires_on || '';
    document.getElementById('vf-fuel-rated').value = eq.fuel_rated_consumption ?? '';
    document.getElementById('vf-fuel-tank-capacity').value = eq.fuel_tank_capacity_l ?? '';
    document.getElementById('vf-fuel-initial-km').value = eq.fuel_initial_km ?? '';
    document.getElementById('vf-fuel-initial-hours').value = eq.fuel_initial_hours ?? '';
    syncVehicleFormCamionFields();
    const titleEl = document.getElementById('vehicleFormSheetTitle');
    if (titleEl) titleEl.textContent = `Editează — ${eq.name}`;
    const saveBtn = document.getElementById('vfSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Salvează';
    setSheetOpen('vehicleFormSheet', true);
  }
  const vfSaveBtn = document.getElementById('vfSaveBtn');
  if (vfSaveBtn) vfSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('vf-id').value;
    const title = document.getElementById('vf-title').value.trim();
    const plate = document.getElementById('vf-plate').value.trim();
    const chassis = document.getElementById('vf-chassis').value.trim();
    const subcat = document.getElementById('vf-subcat').value;
    const assigned = document.getElementById('vf-assigned').value.trim();
    const notes = document.getElementById('vf-notes').value.trim();
    if (!plate) { alert('Completați numărul de înmatriculare.'); return; }
    const normalizedPlate = plate.toUpperCase().replace(/[\s-]+/g, '');
    const duplicatePlate = allEquipment.find(vehicle =>
      vehicle.id !== id && vehicle.erp_category === 'masina' &&
      (vehicle.plate_number || '').toUpperCase().replace(/[\s-]+/g, '') === normalizedPlate
    );
    if (duplicatePlate) {
      alert(`Numărul de înmatriculare „${duplicatePlate.plate_number}” este deja folosit.`);
      return;
    }
    const isCamion = subcat === 'camion';
    // Titlul e opțional — fără el, numărul de înmatriculare rămâne
    // afișat în tabel la coloana "Mașină", ca înainte.
    const name = title || plate;
    const docsPayload = {
      itp_expires_on: document.getElementById('vf-itp-expires').value || null,
      insurance_expires_on: document.getElementById('vf-insurance-expires').value || null,
      parking_ticket_expires_on: document.getElementById('vf-parking-ticket-expires').value || null,
      vignette_expires_on: document.getElementById('vf-vignette-expires').value || null,
      transport_license_expires_on: isCamion ? (document.getElementById('vf-transport-license-expires').value || null) : null,
      tachograph_expires_on: isCamion ? (document.getElementById('vf-tachograph-expires').value || null) : null,
    };
    const isUtilaj = subcat === 'utilaj';
    const vfNumOrNull = (elId) => {
      const v = document.getElementById(elId).value;
      return v === '' ? null : Number(v);
    };
    const fuelPayload = {
      fuel_rated_consumption: vfNumOrNull('vf-fuel-rated'),
      fuel_tank_capacity_l: vfNumOrNull('vf-fuel-tank-capacity'),
      fuel_initial_km: isUtilaj ? null : vfNumOrNull('vf-fuel-initial-km'),
      fuel_initial_hours: isUtilaj ? vfNumOrNull('vf-fuel-initial-hours') : null,
    };
    if (id) {
      const payload = Object.assign({
        name, category: subcat, plate_number: plate,
        serial_number: chassis || null, assigned_to: assigned || null, notes: notes || null,
      }, docsPayload, fuelPayload);
      const { error } = await AppDataServices.erp.saveVehicle(supabaseClient, payload, id);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      logEntityActivity('masina', id, 'Mașina a fost actualizată.');
      setSheetOpen('vehicleFormSheet', false);
      showToast('Mașina a fost actualizată.');
      loadEquipment();
    } else {
      const payload = Object.assign({
        name, item_type: 'echipament', erp_category: 'masina', category: subcat,
        plate_number: plate, serial_number: chassis || null, status: 'Disponibil',
        assigned_to: assigned || null, notes: notes || null,
      }, docsPayload, fuelPayload);
      const { data, error } = await AppDataServices.erp.saveVehicle(supabaseClient, payload, null);
      if (error) { console.error(error); alert('Verificați numărul de înmatriculare și încercați din nou.'); return; }
      if (data && data[0]) logEntityActivity('masina', data[0].id, 'Mașină adăugată.');
      setSheetOpen('vehicleFormSheet', false);
      showToast('Mașina a fost adăugată.');
      loadEquipment();
    }
  });
  /* ============================================================
     CARDUL UNEI MAȘINI — folosit pe pagina unei subcategorii
     specifice (Mașină mică, Autoutilitară, Camion, Utilaj), unde
     fiecare mașină e un card complet (identitate + toate documentele),
     nu un rând de tabel. Un click pe numărul de înmatriculare din
     Prezentare generală (goToVehicle) duce direct la cardul ei acolo,
     la fel cum un click pe o sesizare din Overview duce la fișa ei
     completă din Sesizări — nu un popup intermediar.
     ============================================================ */
  function vehicleCardContentHtml(eq){
    const metaParts = [];
    if (eq.serial_number) metaParts.push(`Serie șasiu: ${escapeHtml(eq.serial_number)}`);
    if (eq.assigned_to) metaParts.push(`Alocat la: ${escapeHtml(eq.assigned_to)}`);
    if (eq.notes) metaParts.push(`Notițe: ${escapeHtml(eq.notes)}`);
    const isCamion = eq.category === 'camion';
    const docsHtml = VEHICLE_DOC_FIELDS.filter(f => !f.camionOnly || isCamion).map(f => {
      const val = eq[f.key];
      const cls = docDateClass(val);
      return `
        <div class="vd-doc-item">
          <div class="vd-doc-label">${escapeHtml(f.label)}</div>
          <div class="vd-doc-value ${cls}">${val ? escapeHtml(formatWoDateRO(val)) + (cls ? ' ⚠' : '') : '—'}</div>
        </div>
      `;
    }).join('');
    // The title (set via "Titlu", falling back to the plate number) is
    // the heading — same as the table's "Mașină" column — with the
    // plate number itself shown as a tag alongside it, not duplicated
    // as the heading when a real title has been given.
    return `
      <div class="backlog-title-line">
        <span class="backlog-title">${escapeHtml(eq.name)}</span>
        <span class="backlog-tag">${escapeHtml(eq.plate_number || '—')}</span>
        <span class="backlog-tag">${escapeHtml(VEHICLE_SUBCAT_LABEL[eq.category] || '')}</span>
      </div>
      ${metaParts.length ? `<div class="backlog-meta-line">${metaParts.join(' · ')}</div>` : ''}
      <div class="vd-docs-grid">${docsHtml}</div>
      ${vehicleFuelSummaryHtml(eq)}
    `;
  }
  // Compact read-out of this real-world calendar month's fuel figures
  // (independent of whatever month "Raport lunar consum" happens to be
  // scrolled to) — so checking one vehicle's current numbers doesn't
  // require leaving its own card. Only shown once something's
  // actually been entered for this month, or a rated consumption is
  // set at all.
  function vehicleFuelSummaryHtml(eq){
    const c = vehicleFuelConsumption(eq, erpLoadedAt.getFullYear(), erpLoadedAt.getMonth() + 1);
    if (c.actual == null && c.rated == null) return '';
    return `
      <div class="backlog-meta-line${c.overLimit ? ' erp-warning-tag' : ''}">
        Consum (${REPORT_MONTHS[erpLoadedAt.getMonth()]}): ${c.actual != null ? `${c.actual.toFixed(1)} ${c.unit} efectiv` : 'fără date suficiente'}${c.rated != null ? ` (normat ${c.rated} ${c.unit})` : ''}${c.overLimit ? ' ⚠ peste 50% față de normat' : ''}
      </div>
    `;
  }
  function vehicleBigCardHtml(eq){
    return `
      <div class="vehicle-big-card" id="vehicle-card-${escapeHtml(eq.id)}">
        <div class="vehicle-big-card-actions">
          <button type="button" class="mt-row-icon-btn mt-edit-icon" data-requires-write="erp" data-vehicle-id="${escapeHtml(eq.id)}" title="Editează" aria-label="Editează ${escapeHtml(eq.name)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </button>
          <button type="button" class="mt-row-icon-btn danger mt-delete-icon" data-requires-write="erp" data-vehicle-id="${escapeHtml(eq.id)}" title="Șterge" aria-label="Șterge ${escapeHtml(eq.name)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
        ${vehicleCardContentHtml(eq)}
      </div>
    `;
  }
  // Mirrors goToTicket: switch to the vehicle's own subcategory page,
  // then scroll to and highlight its card there — a click on Prezentare
  // generală goes straight to the car, not through another popup.
  function goToVehicle(eq){
    // Unlike the in-table ticket-link (already on panel-machines), this
    // is also reached from the Home smart search and command palette —
    // it must switch to Parc Auto itself, not just update its filter.
    openAdminTab('machines');
    setMachinesSubcatFilter(eq.category);
    requestAnimationFrame(() => {
      const card = document.getElementById('vehicle-card-' + eq.id);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('jump-highlight');
        setTimeout(() => card.classList.remove('jump-highlight'), 1800);
      }
    });
  }
  // Shared by the row delete icon — one confirm/delete/refresh path.
  async function deleteVehicle(id){
    const eq = allEquipment.find(v => v.id === id);
    if (!confirm(`Ștergeți mașina${eq ? ' „' + eq.name + '"' : ''}? Această acțiune nu poate fi anulată.`)) return false;
    const result = await AppDataServices.erp.deleteVehicle(supabaseClient, id);
    if (result.blockedByHistory) {
      alert('Mașina are rezervări LPS asociate. Păstrează istoricul: schimbă starea în „Indisponibil” în ERP în loc să o ștergi.');
      return false;
    }
    const { error } = result;
    if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return false; }
    logEntityActivity('masina', id, 'Mașina a fost ștearsă.');
    showToast('Mașina a fost ștearsă.');
    loadEquipment();
    return true;
  }
  const machinesCardsList = document.getElementById('machinesCardsList');
  if (machinesCardsList) machinesCardsList.addEventListener('click', (e) => {
    const editIcon = e.target.closest('.mt-edit-icon');
    if (editIcon) {
      const eq = allEquipment.find(v => v.id === editIcon.dataset.vehicleId);
      if (eq) openVehicleEdit(eq);
      return;
    }
    const deleteIcon = e.target.closest('.mt-delete-icon');
    if (deleteIcon) deleteVehicle(deleteIcon.dataset.vehicleId);
  });
  const erpMachinesToggle = document.querySelector('[data-erp-toggle="machines"]');
  const erpMachinesSubgroup = document.querySelector('[data-erp-subgroup="machines"]');
  if (erpMachinesToggle && erpMachinesSubgroup) {
    erpMachinesToggle.addEventListener('click', () => {
      const open = erpMachinesSubgroup.classList.toggle('open');
      erpMachinesToggle.classList.toggle('open', open);
    });
    erpMachinesSubgroup.querySelectorAll('.erp-machines-subcat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openAdminTab('machines');
        setMachinesSubcatFilter(btn.dataset.subcat);
      });
    });
  }
  const addMaterialBtn = document.getElementById('addMaterialBtn');
  if (addMaterialBtn) addMaterialBtn.addEventListener('click', () => openEquipmentForm(null, 'material'));
  const addProductBtn = document.getElementById('addProductBtn');
  if (addProductBtn) addProductBtn.addEventListener('click', () => openEquipmentForm(null, 'produs'));
  const efSaveBtn = document.getElementById('efSaveBtn');
  if (efSaveBtn) efSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('ef-id').value;
    const name = document.getElementById('ef-name').value.trim();
    const erp_category = document.getElementById('ef-type').value;
    const isStockTracked = erp_category === 'material' || erp_category === 'produs';
    const item_type = isStockTracked ? 'material' : 'echipament';
    const category = document.getElementById('ef-category').value.trim();
    const quantity = parseFloat(document.getElementById('ef-quantity').value) || 0;
    const unit = document.getElementById('ef-unit').value.trim();
    const reorderRaw = document.getElementById('ef-reorder-threshold').value;
    const reorder_threshold = isStockTracked && reorderRaw !== '' ? parseFloat(reorderRaw) : null;
    const serial_number = document.getElementById('ef-serial').value.trim();
    const location = document.getElementById('ef-location').value.trim();
    const assigned_to = document.getElementById('ef-assigned').value.trim();
    const notes = document.getElementById('ef-notes').value.trim();
    if (!name) {
      alert('Completați denumirea echipamentului sau materialului.');
      return;
    }
    const payload = {
      name, quantity, item_type, erp_category,
      category: category || null,
      unit: unit || null,
      reorder_threshold,
      serial_number: serial_number || null,
      location: location || null,
      assigned_to: assigned_to || null,
      notes: notes || null,
    };
    // Materialele au cantitatea urmărită în stock_ledger — o editare
    // manuală aici e doar un alt tip de mișcare de stoc, nu o
    // suprascriere tăcută, ca să rămână un istoric complet.
    if (id) {
      const { error } = await supabaseClient.from('equipment_inventory').update(payload).eq('id', id);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      if (isStockTracked && efEditingOriginalQuantity !== null && quantity !== efEditingOriginalQuantity) {
        logStockLedger(id, name, quantity - efEditingOriginalQuantity, quantity, 'Editare manuală');
      }
      logEntityActivity(erp_category, id, `„${name}” a fost actualizat.`);
    } else {
      const { data, error } = await supabaseClient.from('equipment_inventory').insert(payload).select();
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      if (data && data[0]) logEntityActivity(erp_category, data[0].id, `„${name}” a fost adăugat.`);
      if (isStockTracked && data && data[0]) {
        logStockLedger(data[0].id, name, quantity, quantity, 'Articol adăugat');
      }
    }
    setSheetOpen('erpItemFormSheet', false);
    showToast(id ? 'Articolul a fost actualizat.' : 'Articolul a fost adăugat.');
    loadEquipment();
  });

  
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
  // Echipamente/Materiale/Produse (erp_category !== 'masina') CRUD, their
  // list rendering, the shared add/edit sheet, and the ERP Home stats/
  // alerts panel all now live in admin-react/'s features/erp/ -- this
  // file keeps only what Parc Auto (still vanilla/deferred) needs:
  // allEquipment itself (the full equipment_inventory table, all 4
  // categories), loadEquipment(), and everything below that only
  // concerns vehicles. EQUIPMENT_STATUS_LABEL stays -- search.js's smart
  // search still answers echipament/material status questions off it.
  const EQUIPMENT_STATUS_LABEL = { 'Disponibil': 'Disponibil', 'In folosinta': 'În folosință', 'Service': 'Service', 'Indisponibil': 'Indisponibil' };
  // Parc Auto se împarte în 4 subcategorii fixe, distribuite automat după
  // câmpul "Subcategorie" ales la adăugare — Camion are în plus
  // Licență transport/Tahograf, celelalte 3 nu. "rezervor" (rezervor de
  // motorină) e o a 5-a, deliberat separată: n-are plan/șasiu/documente/
  // km/ore, doar un nivel de litri -- vezi isReservoir() mai jos pentru
  // toate locurile unde se exclude din tabelul/cardurile/filtrele restului
  // Parc Auto (nu e o "mașină" de contorizat alături de ele).
  const VEHICLE_SUBCAT_LABEL = { masina_mica: 'Mașină mică', autoutilitara: 'Autoutilitară', camion: 'Camion', utilaj: 'Utilaj', rezervor: 'Rezervor motorină' };
  function isReservoir(eq){ return eq.category === 'rezervor'; }
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
    // The dropdown itself auto-closes on the next click anywhere outside
    // it (see lps.js), so which subcategory is open was otherwise only
    // ever visible for the instant it stayed open — same information,
    // but on the trigger button itself: its own label flips from "Parc
    // Auto" to whichever dropdown item is active (including "Prezentare
    // generală" itself), highlighted red the same way an active tab is,
    // so it stays visible on screen regardless of whether the dropdown
    // is open.
    const erpMachinesToggleLabel = document.getElementById('erpMachinesToggleLabel');
    const erpMachinesToggleBtn = document.querySelector('[data-erp-toggle="machines"]');
    if (erpMachinesToggleLabel) {
      erpMachinesToggleLabel.textContent = machinesSidebarKey === 'Toate' ? 'Prezentare generală' : (VEHICLE_SUBCAT_LABEL[machinesSidebarKey] || 'Parc Auto');
    }
    if (erpMachinesToggleBtn) erpMachinesToggleBtn.classList.add('active');
    renderEquipment();
    // Encodes which subcategory is open as a second hash segment
    // (#machines/masina_mica) -- replaceState, not pushState, so
    // switching between subcategories stays the single back-step it
    // always was, but a reload now lands back on the right one instead
    // of always resetting to Prezentare generală (see openAdminTab's
    // restore logic in lps.js).
    if (typeof history !== 'undefined') {
      history.replaceState({ adminTab: 'machines', subcat: machinesSidebarKey }, '', window.location.pathname + window.location.search + '#machines/' + machinesSidebarKey);
    }
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
  // The stock_ledger SHEET (stockLedgerSheet) is now
  // admin-react/'s StockLedgerSheet, opened via window.openStockLedgerSheet
  // -- Materiale/Produse are React-owned and call it directly; nothing
  // vanilla/deferred opens it, so only the write-side logStockLedger()
  // above stays here (still called by lps.js when returning reserved
  // stock on a deleted LPS look-ahead item).

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
  // Field-level diff for the activity journal -- "Mașina a fost
  // actualizată" said *that* an edit happened, never *what* changed, so
  // every save looked identical whether it was one typo fix or a full
  // rewrite of the vehicle's record.
  const VEHICLE_EDIT_FIELD_LABELS = {
    name: 'Titlu', category: 'Categorie', plate_number: 'Număr înmatriculare',
    serial_number: 'Serie șasiu', assigned_to: 'Alocat cui', notes: 'Note',
    itp_expires_on: 'ITP', insurance_expires_on: 'Asigurare',
    parking_ticket_expires_on: 'Tichete parcare', vignette_expires_on: 'Rovinietă',
    transport_license_expires_on: 'Licență transport', tachograph_expires_on: 'Tahograf',
    fuel_rated_consumption_km: 'Consum normat (km)', fuel_rated_consumption_hours: 'Consum normat (ore)',
    fuel_tank_capacity_l: 'Capacitate rezervor', fuel_initial_km: 'Km inițial',
    fuel_initial_hours: 'Ore inițiale', fuel_service_interval_km: 'Interval revizie (km)',
    fuel_service_interval_hours: 'Interval revizie (ore)', quantity: 'Litri',
  };
  function describeVehicleFieldChanges(before, after){
    const changes = [];
    Object.keys(VEHICLE_EDIT_FIELD_LABELS).forEach(key => {
      const oldVal = before[key], newVal = after[key];
      const oldNorm = (oldVal === null || oldVal === undefined || oldVal === '') ? '—' : String(oldVal);
      const newNorm = (newVal === null || newVal === undefined || newVal === '') ? '—' : String(newVal);
      if (oldNorm !== newNorm) changes.push(`${VEHICLE_EDIT_FIELD_LABELS[key]}: ${oldNorm} → ${newNorm}`);
    });
    return changes.join('; ');
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
  function machinesFilterCounts(){
    // Rezervorul nu e o "mașină" de contorizat/filtrat alături de restul
    // Parc Auto -- exclus aici o singură dată, astfel încât tabelul
    // Prezentare generală, Raport lunar consum, cardurile de filtrare și
    // Notificările (documente/service) îl ignoră automat pe toate.
    const allVehicles = allEquipment.filter(eq => eq.erp_category === 'masina' && !isReservoir(eq));
    const urgentVehicles = allVehicles.filter(eq => vehicleHasUrgentDocs(eq) || vehicleHasUrgentService(eq));
    const subcatCounts = { masina_mica: 0, autoutilitara: 0, camion: 0, utilaj: 0 };
    allVehicles.forEach(eq => { if (subcatCounts[eq.category] != null) subcatCounts[eq.category]++; });
    return { allVehicles, urgentVehicles, subcatCounts };
  }
  // Rezervorul (rezervoarele) de motorină -- rânduri simple în același
  // tabel ca restul Parc Auto (nu un card separat deasupra), cu „—"
  // pentru orice coloană care nu i se aplică (documente/service/km).
  // Apare doar pe „Toate" (nefiltrat) -- nicio subcategorie nu-l poate
  // selecta, pentru că n-are propriul card de filtrare.
  function allReservoirs(){
    return allEquipment.filter(eq => eq.erp_category === 'masina' && isReservoir(eq));
  }
  function reservoirLitersLabel(eq){
    return `${eq.quantity != null ? Number(eq.quantity).toLocaleString('ro-RO') : '0'} L`;
  }
  // Shared by the Prezentare generală cards and the Raport lunar
  // consum cards below -- same defs, same counts, same toggle-off
  // behaviour, just a different active key and a different callback
  // for what "filter changed" means on each page. urgentOverride lets
  // a page swap in its own meaning for "Notificări" -- Raport lunar
  // consum cares about over-limit fuel consumption, not expiring
  // documents, so reusing the doc-based list there would be wrong.
  function renderMachinesFilterCardsInto(cardsWrap, activeKey, onToggle, urgentOverride){
    if (!cardsWrap) return;
    const { urgentVehicles: docUrgentVehicles, subcatCounts } = machinesFilterCounts();
    const urgentVehicles = urgentOverride || docUrgentVehicles;
    cardsWrap.innerHTML = MACHINES_FILTER_CARD_DEFS.map(def => {
      const count = def.key === 'notificari' ? urgentVehicles.length : subcatCounts[def.key];
      const isActive = activeKey === def.key;
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
        const nextKey = activeKey === card.dataset.subcat ? 'Toate' : card.dataset.subcat;
        onToggle(nextKey);
      });
    });
  }
  function renderMachinesOverview(){
    const cardsWrap = document.getElementById('machinesFilterCards');
    const tbody = document.getElementById('machinesTableBody');
    const tableWrap = document.getElementById('machinesTableWrap');
    const cardsList = document.getElementById('machinesCardsList');
    if (!cardsWrap || !tbody || !tableWrap || !cardsList) return;
    const { allVehicles, urgentVehicles } = machinesFilterCounts();

    // The cards only make sense as a quick-filter on top of "Prezentare
    // generală" — once you've navigated into a specific sidebar section
    // (Mașină mică, Camion, ...) you're already looking at just that
    // category, so re-showing the same cards there is redundant.
    const showCards = machinesSidebarKey === 'Toate';
    cardsWrap.style.display = showCards ? '' : 'none';
    if (showCards) {
      renderMachinesFilterCardsInto(cardsWrap, machinesSubcatFilter, (nextKey) => {
        setMachinesSubcatFilter(nextKey, { sidebarKey: 'Toate' });
      });
    } else {
      cardsWrap.innerHTML = '';
    }

    const filtered = (machinesSubcatFilter === 'Toate' ? allVehicles
      : machinesSubcatFilter === 'notificari' ? urgentVehicles
      : allVehicles.filter(eq => eq.category === machinesSubcatFilter))
      .slice()
      .sort((a, b) => (a.plate_number || '').localeCompare(b.plate_number || '', 'ro'));
    // Rezervorul apare doar pe "Toate" nefiltrat -- n-are propriul card
    // de filtrare, deci orice altă subcategorie sau "Notificări" îl
    // exclude automat (allVehicles deja nu-l include).
    const reservoirRows = machinesSubcatFilter === 'Toate' ? allReservoirs() : [];
    const rowsToRender = filtered.concat(reservoirRows);

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
      if (!rowsToRender.length) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="machines-table-empty">Nicio mașină înregistrată.</div></td></tr>`;
        return;
      }
      function dateCell(dateStr, applicable){
        if (!applicable) return '<td class="mt-na">—</td>';
        if (!dateStr) return '<td class="mt-na">—</td>';
        const cls = docDateClass(dateStr);
        return `<td class="${cls}">${formatWoDateRO(dateStr)}${cls ? ' ⚠' : ''}</td>`;
      }
      // One cell covers every unit the vehicle tracks -- most vehicles
      // show just a km or hours countdown, Camion/Autoutilitara show
      // both side by side (same " · " join the Raport lunar consum
      // table already uses for its own dual-unit columns).
      function serviceDueCell(eq){
        const parts = vehicleUnits(eq).map(unit => {
          const c = vehicleServiceCountdownFor(eq, unit);
          if (c == null) return null;
          const cls = serviceDueClass(c.remaining, unit);
          const val = c.remaining >= 0 ? `${c.remaining} ${c.unit}` : `depășit cu ${Math.abs(c.remaining)} ${c.unit}`;
          return `<span class="${cls}">${val}${cls ? ' ⚠' : ''}</span>`;
        }).filter(Boolean);
        if (!parts.length) return '<td class="mt-na">—</td>';
        return `<td>${parts.join(' · ')}</td>`;
      }
      tbody.innerHTML = rowsToRender.map(eq => {
        if (isReservoir(eq)) {
          return `
            <tr>
              <td class="mt-name-cell"><div class="mt-name">${escapeHtml(eq.name)}</div><div class="mt-subcat">${eq.notes ? escapeHtml(eq.notes) : ''}</div></td>
              <td><a href="#" class="ticket-link" data-vehicle-id="${escapeHtml(eq.id)}">${escapeHtml(reservoirLitersLabel(eq))}</a></td>
              <td class="mt-na">—</td>
              <td class="mt-na">—</td>
              <td class="mt-na">—</td>
              <td class="mt-na">—</td>
              <td class="mt-na">—</td>
              <td class="mt-na">—</td>
              <td class="mt-na">—</td>
            </tr>
          `;
        }
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
            ${serviceDueCell(eq)}
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
  // Which metrics a vehicle is tracked by. Utilaje are stationary (no
  // odometer) so hours-only; everything else drives, so km-only --
  // except Camion/Autoutilitara, which also run stationary a lot (PTO,
  // hydraulics, a crane) and so track both at once.
  function vfSubcatTracksKm(category){
    return category !== 'utilaj';
  }
  function vfSubcatTracksHours(category){
    return category === 'utilaj' || category === 'camion' || category === 'autoutilitara';
  }
  function vehicleTracksKm(eq){
    return vfSubcatTracksKm(eq.category);
  }
  function vehicleTracksHours(eq){
    return vfSubcatTracksHours(eq.category);
  }
  function vehicleUnits(eq){
    const units = [];
    if (vehicleTracksKm(eq)) units.push('km');
    if (vehicleTracksHours(eq)) units.push('hours');
    return units;
  }
  function readingFieldFor(unit){ return unit === 'hours' ? 'fuel_odometer_hours' : 'fuel_odometer_km'; }
  function initialFieldFor(unit){ return unit === 'hours' ? 'fuel_initial_hours' : 'fuel_initial_km'; }
  function serviceIntervalFieldFor(unit){ return unit === 'hours' ? 'fuel_service_interval_hours' : 'fuel_service_interval_km'; }
  function serviceLastFieldFor(unit){ return unit === 'hours' ? 'fuel_service_last_hours' : 'fuel_service_last_km'; }
  function ratedFieldFor(unit){ return unit === 'hours' ? 'fuel_rated_consumption_hours' : 'fuel_rated_consumption_km'; }
  function unitLabel(unit){ return unit === 'hours' ? 'h' : 'km'; }
  // Baseline a month's delta is measured against: the most recent
  // EARLIER month's own reading for this vehicle, or -- for its
  // first-ever tracked month -- the one-time initial reading set on
  // the vehicle itself (purchase, or whenever tracking started).
  function previousFuelReadingFor(eq, unit, year, month){
    const field = readingFieldFor(unit);
    const earlier = allVehicleFuelLogs
      .filter(l => l.vehicle_id === eq.id && l[field] != null && (l.year < year || (l.year === year && l.month < month)))
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));
    if (earlier.length) return Number(earlier[0][field]);
    const initial = eq[initialFieldFor(unit)];
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
  // Most recent reading ever entered for this vehicle+unit -- whatever
  // month was last logged, independent of which month "Raport lunar
  // consum" happens to be scrolled to. Distinct from eq.fuel_initial_km
  // (the one-time purchase/start-of-tracking baseline, never updated).
  function latestFuelLogFor(eq, unit){
    const field = readingFieldFor(unit);
    const logs = allVehicleFuelLogs
      .filter(l => l.vehicle_id === eq.id && l[field] != null)
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));
    return logs.length ? logs[0] : null;
  }
  // Service tracking is interval-based (fuel_service_interval_km/hours,
  // e.g. "every 10000 km") rather than a one-off target you recompute
  // by hand. The next due point is fuel_service_last_km/hours (set the
  // moment "Service efectuat" is clicked) plus that interval -- or,
  // before any service has ever been marked done, fuel_initial_km/hours
  // plus the interval, so a freshly-configured vehicle already has a
  // sensible first due point with no extra setup. Camion/Autoutilitara
  // get one of these per unit (km and hours independently) -- whichever
  // comes due first is the one that matters, same as a real engine
  // service.
  // "Current" reading for service-countdown purposes: the latest logged
  // value if one exists, or -- for a vehicle with no monthly reading at
  // all yet (either freshly configured, or because its only logged
  // value turned out to be bad data and got cleared) -- the one-time
  // initial reading, so the countdown still shows something (the full
  // interval, since baseline defaults to that same initial reading)
  // instead of silently vanishing until the next "Raport lunar consum"
  // entry.
  function currentServiceReadingFor(eq, unit){
    const log = latestFuelLogFor(eq, unit);
    const field = readingFieldFor(unit);
    if (log && log[field] != null) return Number(log[field]);
    const initial = eq[initialFieldFor(unit)];
    return initial != null ? Number(initial) : null;
  }
  function vehicleServiceCountdownFor(eq, unit){
    const interval = eq[serviceIntervalFieldFor(unit)];
    if (interval == null) return null;
    const baseline = eq[serviceLastFieldFor(unit)] ?? eq[initialFieldFor(unit)];
    if (baseline == null) return null;
    const current = currentServiceReadingFor(eq, unit);
    if (current == null) return null;
    const due = Number(baseline) + Number(interval);
    return { remaining: due - current, due, unit: unitLabel(unit) };
  }
  // Two-tier warning, same shape as docDateClass/vehicleHasUrgentDocs
  // above: an orange heads-up with no Notificări entry well before it's
  // actually due, and a red one -- which DOES count toward Notificări --
  // once it's close enough to matter. Hours get the same thresholds
  // scaled down by the km:h ratio the rest of this file already uses
  // for its single service-warning cutoff (1000km ~ 50h).
  const SERVICE_WARN_KM = 2500;
  const SERVICE_URGENT_KM = 500;
  function serviceWarnThreshold(unit){ return unit === 'hours' ? SERVICE_WARN_KM / 20 : SERVICE_WARN_KM; }
  function serviceUrgentThreshold(unit){ return unit === 'hours' ? SERVICE_URGENT_KM / 20 : SERVICE_URGENT_KM; }
  function serviceDueClass(remaining, unit){
    if (remaining <= serviceUrgentThreshold(unit)) return 'mt-expired';
    if (remaining <= serviceWarnThreshold(unit)) return 'mt-warn';
    return '';
  }
  function vehicleHasUrgentService(eq){
    return vehicleUnits(eq).some(u => {
      const c = vehicleServiceCountdownFor(eq, u);
      return c != null && c.remaining <= serviceUrgentThreshold(u);
    });
  }
  // Full picture for one vehicle+unit in one month: the reading entered
  // (if any), what it's measured against, the resulting delta, that
  // month's fuel-bill total, and the consumption that implies. A
  // Camion/Autoutilitara that both drove and ran stationary in the same
  // month gets both of these computed against the SAME fuel-bill total
  // (there's only one tank) -- each is "what this would be if all of
  // it went to that use", not a true split, since the data doesn't
  // distinguish which liters went where.
  // vehicle_dual_unit_consumption_trigger migration mirrors this exact
  // logic server-side (check_vehicle_month_fuel_consumption) for the
  // >50% alert, so this is display-only here. REPORT_MONTHS comes from
  // excel.js (shared top-level script scope, same cross-file pattern
  // already used throughout this app) — only referenced inside
  // functions, never at load time, so file load order doesn't matter.
  // Real (observed) lifetime average for this vehicle+unit -- total liters
  // ever purchased divided by total km/hours ever driven across every
  // tracked month, deliberately NOT the manufacturer "rated" figure (that
  // one stays below, as `rated`, purely for the over-limit alert
  // threshold -- a different comparison). A single month's purchases
  // rarely land exactly on what was burned that same month (see
  // vehicleFuelLeftoverChain below), but averaged across a vehicle's
  // whole history the two settle into agreement -- self-correcting as
  // more months of data come in.
  function vehicleRealRateFor(eq, unit){
    const field = readingFieldFor(unit);
    const months = allVehicleFuelLogs
      .filter(l => l.vehicle_id === eq.id && l[field] != null)
      .map(l => ({ year: l.year, month: l.month }));
    if (!months.length) return null;
    let totalDelta = 0, totalPurchased = 0;
    months.forEach(m => {
      const log = fuelLogFor(eq.id, m.year, m.month);
      const baseline = previousFuelReadingFor(eq, unit, m.year, m.month);
      const reading = log && log[field] != null ? Number(log[field]) : null;
      const delta = (reading != null && baseline != null && reading - baseline > 0) ? reading - baseline : 0;
      totalDelta += delta;
      totalPurchased += fuelPurchaseSum(eq.id, m.year, m.month);
    });
    if (totalDelta <= 0) return null;
    return totalPurchased / totalDelta * (unit === 'hours' ? 1 : 100);
  }
  // Month-by-month running fuel-tank balance for one vehicle+unit, chained
  // chronologically from its first tracked month (leftover starts at 0 --
  // some vehicles already had fuel in the tank before tracking began, but
  // that's unknowable and self-corrects over a few months same as any
  // other baseline-less first reading in this file). Each month's
  // "theoretical" burn is the vehicle's own real lifetime rate (see
  // vehicleRealRateFor) applied to that month's km/hours -- comparing
  // against what was actually purchased gives a surplus/deficit, which
  // carries into the next month capped by the tank's physical capacity
  // (fuel_tank_capacity_l). A month whose balance would overflow that cap
  // means more was bought than could possibly have fit, which is exactly
  // the signal that catches fuel-card skimming or a misdeclared fill-up.
  function vehicleFuelLeftoverChain(eq, unit){
    const chain = new Map();
    const capacity = eq.fuel_tank_capacity_l != null ? Number(eq.fuel_tank_capacity_l) : null;
    const realRate = vehicleRealRateFor(eq, unit);
    if (capacity == null || realRate == null) return chain;
    const field = readingFieldFor(unit);
    const months = allVehicleFuelLogs
      .filter(l => l.vehicle_id === eq.id && l[field] != null)
      .map(l => ({ year: l.year, month: l.month }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
    let leftover = 0;
    months.forEach(m => {
      const log = fuelLogFor(eq.id, m.year, m.month);
      const baseline = previousFuelReadingFor(eq, unit, m.year, m.month);
      const reading = log && log[field] != null ? Number(log[field]) : null;
      const delta = (reading != null && baseline != null && reading - baseline > 0) ? reading - baseline : 0;
      const purchased = fuelPurchaseSum(eq.id, m.year, m.month);
      const theoretical = realRate * delta / (unit === 'hours' ? 1 : 100);
      const leftoverIn = leftover;
      const leftoverOut = Math.max(0, Math.min(capacity, leftoverIn + purchased - theoretical));
      chain.set(`${m.year}-${m.month}`, { leftoverIn, leftoverOut, delta, purchased, theoretical });
      leftover = leftoverOut;
    });
    return chain;
  }
  function vehicleFuelConsumptionFor(eq, unit, year, month){
    const unitLbl = unitLabel(unit);
    const unitRateLabel = unit === 'hours' ? 'L/H' : 'L/100km';
    const field = readingFieldFor(unit);
    const log = fuelLogFor(eq.id, year, month);
    const reading = (log && log[field] != null) ? Number(log[field]) : null;
    const baseline = previousFuelReadingFor(eq, unit, year, month);
    const delta = (reading != null && baseline != null && reading - baseline > 0) ? (reading - baseline) : null;
    const totalAdded = fuelPurchaseSum(eq.id, year, month);
    // Adjusted for the running tank balance when there's enough history
    // for one (see vehicleFuelLeftoverChain) -- falls back to the raw
    // liters-purchased figure otherwise (no tank capacity set, or too few
    // tracked months yet to establish a real rate).
    const leftoverEntry = vehicleFuelLeftoverChain(eq, unit).get(`${year}-${month}`) || null;
    const consumedBasis = leftoverEntry != null ? (leftoverEntry.leftoverIn + totalAdded - leftoverEntry.leftoverOut) : totalAdded;
    const actual = (delta != null && consumedBasis > 0)
      ? (unit === 'hours' ? consumedBasis / delta : consumedBasis / delta * 100)
      : null;
    const rated = eq[ratedFieldFor(unit)] != null ? Number(eq[ratedFieldFor(unit)]) : null;
    const overLimit = actual != null && rated != null && actual > rated * 1.5;
    const leftoverOut = leftoverEntry != null ? leftoverEntry.leftoverOut : null;
    return { unit: unitLbl, unitRateLabel, reading, baseline, delta, totalAdded, actual, rated, overLimit, leftoverOut };
  }
  // Across every unit this vehicle tracks (one for most, two for
  // Camion/Autoutilitara).
  function vehicleFuelConsumptions(eq, year, month){
    return vehicleUnits(eq).map(u => vehicleFuelConsumptionFor(eq, u, year, month));
  }
  function vehicleFuelOverLimit(eq, year, month){
    return vehicleFuelConsumptions(eq, year, month).some(c => c.overLimit);
  }
  const erpLoadedAt = new Date();
  let fuelReportYear = erpLoadedAt.getFullYear();
  let fuelReportMonth = erpLoadedAt.getMonth() + 1; // 1-12, matches vehicle_fuel_logs.month
  // Independent of machinesSubcatFilter (Prezentare generală's own
  // quick-filter) -- the two pages can be filtered to different
  // subcategories at the same time, same as their sidebar entries are
  // independent pages.
  let fuelReportSubcatFilter = 'Toate';
  function renderMachinesFuelReport(){
    const tbody = document.getElementById('machinesFuelReportTableBody');
    const countEl = document.getElementById('machinesFuelReportCount');
    const labelEl = document.getElementById('fuelReportMonthLabel');
    const cardsWrap = document.getElementById('machinesFuelReportFilterCards');
    if (!tbody) return;
    if (labelEl) labelEl.textContent = `${REPORT_MONTHS[fuelReportMonth - 1]} ${fuelReportYear}`;
    const { allVehicles } = machinesFilterCounts();
    // This page's own "Notificări" — vehicles over 50% of normat for
    // the month currently displayed, not the doc-expiry warnings
    // Prezentare generală's identical-looking card means.
    const fuelUrgentVehicles = allVehicles.filter(eq => vehicleFuelOverLimit(eq, fuelReportYear, fuelReportMonth));
    renderMachinesFilterCardsInto(cardsWrap, fuelReportSubcatFilter, (nextKey) => {
      fuelReportSubcatFilter = nextKey;
      renderMachinesFuelReport();
    }, fuelUrgentVehicles);
    const vehicles = (fuelReportSubcatFilter === 'Toate' ? allVehicles
      : fuelReportSubcatFilter === 'notificari' ? fuelUrgentVehicles
      : allVehicles.filter(eq => eq.category === fuelReportSubcatFilter))
      .slice()
      .sort((a, b) => (a.plate_number || '').localeCompare(b.plate_number || '', 'ro'));
    if (countEl) countEl.textContent = vehicles.length + (vehicles.length === 1 ? ' mașină' : ' mașini');
    // Same rule as Prezentare generală: the reservoir only shows on
    // "Toate" nefiltrat, in the "L (diferență)" column -- the one slot
    // here that already means "fuel currently in the tank" for a real
    // vehicle (its leftoverOut), just showing the bulk tank's own level
    // instead of a per-vehicle computed one.
    const reservoirRows = fuelReportSubcatFilter === 'Toate' ? allReservoirs() : [];
    const rowsToRender = vehicles.concat(reservoirRows);
    if (!rowsToRender.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="machines-table-empty">Nicio mașină înregistrată.</div></td></tr>`;
      return;
    }
    const na = '<span class="mt-na">—</span>';
    tbody.innerHTML = rowsToRender.map(eq => {
      if (isReservoir(eq)) {
        return `
          <tr>
            <td class="mt-name-cell"><div class="mt-name">${escapeHtml(eq.name)}</div></td>
            <td>${na}</td>
            <td>${na}</td>
            <td>${na}</td>
            <td>${na}</td>
            <td>${escapeHtml(reservoirLitersLabel(eq))}</td>
            <td>${na}</td>
            <td>${na}</td>
            <td><button type="button" class="mt-row-icon-btn fuel-log-edit-btn" data-requires-write="erp" data-vehicle-id="${escapeHtml(eq.id)}" title="Editează" aria-label="Editează ${escapeHtml(eq.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button></td>
          </tr>
        `;
      }
      const cs = vehicleFuelConsumptions(eq, fuelReportYear, fuelReportMonth);
      const kmC = cs.find(c => c.unit === 'km');
      const hC = cs.find(c => c.unit === 'h');
      const overLimit = cs.some(c => c.overLimit);
      const totalAdded = fuelPurchaseSum(eq.id, fuelReportYear, fuelReportMonth);
      // Camion/Autoutilitara track both -- join whichever of the two
      // have a value into one cell instead of adding more columns.
      const joinPair = (fmt) => {
        const parts = [kmC, hC].filter(Boolean).map(fmt).filter(Boolean);
        return parts.length ? parts.join(' · ') : na;
      };
      // km and hours share the same tank/balance -- on a dual-tracked
      // vehicle both branches compute the identical leftoverOut, so show
      // it once rather than joining a duplicate.
      const leftoverVal = [kmC, hC].map(c => c && c.leftoverOut).find(v => v != null);
      const leftoverCell = leftoverVal == null ? na : (leftoverVal < 0.05 ? '0.0 L' : `-${leftoverVal.toFixed(1)} L`);
      return `
        <tr class="${overLimit ? 'row-error' : ''}">
          <td class="mt-name-cell"><div class="mt-name">${escapeHtml(eq.name)}</div></td>
          <td><a href="#" class="ticket-link" data-vehicle-id="${escapeHtml(eq.id)}">${escapeHtml(eq.plate_number || '—')}</a></td>
          <td>${kmC && kmC.delta != null ? escapeHtml(String(kmC.delta)) + ' km' : na}</td>
          <td>${hC && hC.delta != null ? escapeHtml(String(hC.delta)) + ' h' : na}</td>
          <td>${totalAdded > 0 ? escapeHtml(String(totalAdded)) + ' L' : na}</td>
          <td>${leftoverCell}</td>
          <td class="${overLimit ? 'mt-warn' : ''}">${joinPair(c => c.actual != null ? `${c.actual.toFixed(1)} ${c.unitRateLabel}${c.overLimit ? ' ⚠' : ''}` : null)}</td>
          <td>${joinPair(c => c.rated != null ? `${c.rated} ${c.unitRateLabel}` : null)}</td>
          <td><button type="button" class="mt-row-icon-btn fuel-log-edit-btn" data-requires-write="erp" data-vehicle-id="${escapeHtml(eq.id)}" title="Editează" aria-label="Editează ${escapeHtml(eq.name)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </button></td>
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
  let fuelLogSheetContext = null; // { vehicleId, year, month, eq, baselineKm, baselineHours }
  // One km block + one hours block, each independently filled/diffed --
  // Camion/Autoutilitara show both (a month might only move one of the
  // two, e.g. a truck that only ran stationary that month), everything
  // else shows just the one it tracks (see openVehicleFuelLogForm).
  function updateVflDiffDisplayFor(prefix, baseline, unitLbl){
    const prevEl = document.getElementById(`vfl-previous-reading-${prefix}`);
    const diffEl = document.getElementById(`vfl-diff-display-${prefix}`);
    if (prevEl) prevEl.textContent = baseline != null ? `${baseline} ${unitLbl}` : 'fără citire anterioară';
    if (!diffEl) return;
    const readingEl = document.getElementById(`vfl-reading-${prefix}`);
    const newVal = readingEl ? readingEl.value : '';
    if (newVal === '' || baseline == null) {
      diffEl.textContent = baseline == null ? 'nimic de comparat încă' : '—';
      diffEl.classList.remove('negative');
      return;
    }
    const diff = Number(newVal) - baseline;
    diffEl.textContent = `${diff >= 0 ? '+' : ''}${diff} ${unitLbl}`;
    diffEl.classList.toggle('negative', diff < 0);
  }
  function updateVflDiffDisplay(){
    if (!fuelLogSheetContext) return;
    const { baselineKm, baselineHours } = fuelLogSheetContext;
    updateVflDiffDisplayFor('km', baselineKm, 'km');
    updateVflDiffDisplayFor('hours', baselineHours, 'h');
  }
  const vflReadingKmInput = document.getElementById('vfl-reading-km');
  if (vflReadingKmInput) vflReadingKmInput.addEventListener('input', updateVflDiffDisplay);
  const vflReadingHoursInput = document.getElementById('vfl-reading-hours');
  if (vflReadingHoursInput) vflReadingHoursInput.addEventListener('input', updateVflDiffDisplay);
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
    const log = fuelLogFor(eq.id, fuelReportYear, fuelReportMonth);
    const tracksKm = vehicleTracksKm(eq);
    const tracksHours = vehicleTracksHours(eq);
    fuelLogSheetContext = {
      vehicleId: eq.id, year: fuelReportYear, month: fuelReportMonth, eq,
      baselineKm: tracksKm ? previousFuelReadingFor(eq, 'km', fuelReportYear, fuelReportMonth) : null,
      baselineHours: tracksHours ? previousFuelReadingFor(eq, 'hours', fuelReportYear, fuelReportMonth) : null,
    };
    document.getElementById('vfl-vehicle-id').value = eq.id;
    document.getElementById('vfl-year').value = fuelReportYear;
    document.getElementById('vfl-month').value = fuelReportMonth;
    const kmSection = document.getElementById('vfl-km-section');
    const hoursSection = document.getElementById('vfl-hours-section');
    if (kmSection) kmSection.style.display = tracksKm ? '' : 'none';
    if (hoursSection) hoursSection.style.display = tracksHours ? '' : 'none';
    document.getElementById('vfl-reading-km').value = (log && log.fuel_odometer_km != null) ? log.fuel_odometer_km : '';
    document.getElementById('vfl-reading-hours').value = (log && log.fuel_odometer_hours != null) ? log.fuel_odometer_hours : '';
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
    const { vehicleId, year, month, eq, baselineKm, baselineHours } = fuelLogSheetContext;
    const kmVal = vehicleTracksKm(eq) ? document.getElementById('vfl-reading-km').value : '';
    const hoursVal = vehicleTracksHours(eq) ? document.getElementById('vfl-reading-hours').value : '';
    if (kmVal === '' && hoursVal === '') { alert('Introduceți cel puțin o citire.'); return; }
    // Odometers/hour-meters only ever increase -- a reading below the
    // last one on record is almost always a mistyped/placeholder value
    // (the exact bug that made service countdowns show the wrong
    // number), so flag it rather than silently saving it.
    const belowBaseline = [];
    if (kmVal !== '' && baselineKm != null && Number(kmVal) < baselineKm) belowBaseline.push(`Km (${kmVal} < ${baselineKm})`);
    if (hoursVal !== '' && baselineHours != null && Number(hoursVal) < baselineHours) belowBaseline.push(`Ore (${hoursVal} < ${baselineHours})`);
    if (belowBaseline.length && !confirm(`Citirea introdusă e mai mică decât cea anterioară pentru: ${belowBaseline.join(', ')}. Continui oricum?`)) return;
    const payload = {
      vehicle_id: vehicleId, year, month,
      updated_at: new Date().toISOString(),
    };
    if (kmVal !== '') payload.fuel_odometer_km = Number(kmVal);
    if (hoursVal !== '') payload.fuel_odometer_hours = Number(hoursVal);
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
      // The reservoir has no monthly odometer/purchase log -- its edit
      // icon here opens the identity form (Nume/Litri) instead.
      if (eq && isReservoir(eq)) openVehicleEdit(eq);
      else if (eq) openVehicleFuelLogForm(eq);
      return;
    }
    const link = e.target.closest('.ticket-link');
    if (!link) return;
    e.preventDefault();
    const eq = allEquipment.find(v => v.id === link.dataset.vehicleId);
    if (eq) goToVehicle(eq);
  });
  // Which vehicles an export can be narrowed to -- same subcategories
  // as the filter cards, minus "Notificări" (not a real subcategory,
  // meaningless as an export scope).
  const FUEL_EXPORT_SUBCAT_OPTIONS = [
    { key: 'Toate', label: 'Toate' },
    { key: 'masina_mica', label: VEHICLE_SUBCAT_LABEL.masina_mica },
    { key: 'autoutilitara', label: VEHICLE_SUBCAT_LABEL.autoutilitara },
    { key: 'camion', label: VEHICLE_SUBCAT_LABEL.camion },
    { key: 'utilaj', label: VEHICLE_SUBCAT_LABEL.utilaj },
  ];
  function openFuelReportExportFilter(){
    const sheet = document.getElementById('fuelReportExportFilterSheet');
    const list = document.getElementById('fuelReportExportFilterList');
    const confirmBtn = document.getElementById('fuelReportExportFilterConfirmBtn');
    const cancelBtn = document.getElementById('fuelReportExportFilterCancelBtn');
    const closeBtn = document.getElementById('fuelReportExportFilterCloseBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !list || !confirmBtn || !cancelBtn || !closeBtn || !backdrop) {
      return Promise.resolve('Toate');
    }
    list.innerHTML = FUEL_EXPORT_SUBCAT_OPTIONS.map((opt, index) => `
      <label class="month-picker-option">
        <input type="radio" name="fuelExportFilterChoice" value="${opt.key}" ${index === 0 ? 'checked' : ''}>
        <span>${opt.label}</span>
      </label>
    `).join('');
    setSheetOpen('fuelReportExportFilterSheet', true);
    return new Promise(resolve => {
      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('fuelReportExportFilterSheet', false);
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };
      const handleConfirm = () => {
        const picked = list.querySelector('input[name="fuelExportFilterChoice"]:checked');
        cleanup(picked ? picked.value : 'Toate');
      };
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => { if (event.key === 'Escape') handleCancel(); };
      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
    });
  }
  // Years any vehicle has logged fuel data for -- drives whether the
  // year picker below is even shown (reportYearSheet skips itself for
  // a single option, same as Sesizări's own yearly export).
  function fuelReportExportYearsWithData(){
    const years = new Set();
    allVehicleFuelLogs.forEach(l => years.add(l.year));
    allVehicleFuelPurchases.forEach(p => years.add(p.year));
    return [...years].sort((a, b) => b - a);
  }
  function fuelReportAoaForPeriod(vehicles, year, month){
    const header = ['Mașină', 'Nr. înmatriculare', 'Km (diferență)', 'Timp (diferență)', 'Total alimentare (L)', 'L (diferență)', 'Consum efectiv', 'Consum normat'];
    const rows = [header];
    vehicles.forEach(eq => {
      const cs = vehicleFuelConsumptions(eq, year, month);
      const kmC = cs.find(c => c.unit === 'km');
      const hC = cs.find(c => c.unit === 'h');
      const totalAdded = fuelPurchaseSum(eq.id, year, month);
      const joinPair = (fmt) => [kmC, hC].filter(Boolean).map(fmt).filter(Boolean).join(' · ');
      const leftoverVal = [kmC, hC].map(c => c && c.leftoverOut).find(v => v != null);
      rows.push([
        eq.name || '',
        eq.plate_number || '',
        kmC && kmC.delta != null ? kmC.delta : '',
        hC && hC.delta != null ? hC.delta : '',
        totalAdded > 0 ? totalAdded : '',
        leftoverVal == null ? '' : (leftoverVal < 0.05 ? 0 : -Number(leftoverVal.toFixed(1))),
        joinPair(c => c.actual != null ? `${c.actual.toFixed(1)} ${c.unitRateLabel}` : ''),
        joinPair(c => c.rated != null ? `${c.rated} ${c.unitRateLabel}` : ''),
      ]);
    });
    return rows;
  }
  async function exportFuelReportToExcel(){
    const btn = document.getElementById('fuelReportExportBtn');
    if (!btn) return;
    const subcat = await openFuelReportExportFilter();
    if (subcat === null) return;
    const allVehicles = allEquipment.filter(eq => eq.erp_category === 'masina');
    const vehicles = (subcat === 'Toate' ? allVehicles : allVehicles.filter(eq => eq.category === subcat))
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ro'));
    if (!vehicles.length) { alert('Nicio mașină înregistrată pentru acest filtru.'); return; }

    const yearsWithData = fuelReportExportYearsWithData();
    let year;
    if (yearsWithData.length > 1) {
      const pickedYear = await openReportYearSelection(yearsWithData.map(String));
      if (pickedYear === null) return;
      year = Number(pickedYear);
    } else {
      year = yearsWithData.length === 1 ? yearsWithData[0] : fuelReportYear;
    }
    const monthSelection = await openReportMonthSelection(year);
    if (monthSelection === null) return;
    const months = monthSelection === 'all'
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : monthSelection.map(i => i + 1).sort((a, b) => a - b);

    btn.disabled = true;
    try {
      const workbook = XLSX.utils.book_new();
      months.forEach(m => {
        const aoa = fuelReportAoaForPeriod(vehicles, year, m);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        autosizeWorksheet(ws, aoa);
        XLSX.utils.book_append_sheet(workbook, ws, `${REPORT_MONTHS[m - 1]} ${year}`.slice(0, 31));
      });
      const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const subcatSuffix = subcat === 'Toate' ? '' : `-${subcat}`;
      a.download = monthSelection === 'all'
        ? `consum-carburant-${year}${subcatSuffix}.xlsx`
        : `consum-carburant-${year}-${monthSelection.map(i => String(i + 1).padStart(2, '0')).join('-')}${subcatSuffix}.xlsx`;
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
  // Echipamente/Materiale/Produse's own list rows, the ERP Home stats
  // card + alert banner, and the shared add/edit sheet (erpItemFormSheet)
  // are now admin-react/'s EquipmentRow/ErpHomePanel/EquipmentForm -- all
  // of loadEquipment()'s non-vehicle work moved there. renderEquipment()
  // itself only needs to still refresh Parc Auto's own views.
  function renderEquipment(){
    renderMachinesOverview();
    renderMachinesFuelReport();
  }

  // vehicleFormSheet is the one merged vehicle form — identity (Titlu,
  // Nr. înmatriculare, Serie șasiu, Subcategorie, Alocat la, Notițe)
  // and documents (ITP, Asigurare, ...) together, used both for
  // "+ Adaugă mașină" (vf-id blank → insert) and for "Editează" on the
  // detail card (vf-id set → update). Licență transport/Tahograf only
  // apply to Camion, and toggle live as the Subcategorie select changes.
  // Rezervor is the odd one out: it skips identity (plate/chassis/
  // assigned), the whole "Consum carburant"/"Documente" sections, and
  // shows only Nume + Litri -- a tank has none of the rest.
  function syncVehicleFormFields(){
    const subcat = document.getElementById('vf-subcat').value;
    const reservoirMode = subcat === 'rezervor';
    document.getElementById('vf-plate-field').style.display = reservoirMode ? 'none' : '';
    document.getElementById('vf-chassis-field').style.display = reservoirMode ? 'none' : '';
    document.getElementById('vf-assigned-field').style.display = reservoirMode ? 'none' : '';
    document.getElementById('vf-reservoir-liters-field').style.display = reservoirMode ? '' : 'none';
    document.getElementById('vf-fuel-section').style.display = reservoirMode ? 'none' : '';
    document.getElementById('vf-docs-section').style.display = reservoirMode ? 'none' : '';
    if (reservoirMode) return;
    const isCamion = subcat === 'camion';
    document.getElementById('vf-transport-license-field').style.display = isCamion ? '' : 'none';
    document.getElementById('vf-tachograph-field').style.display = isCamion ? '' : 'none';
    // Utilaje are tracked by hours worked only (there's no odometer on
    // a stationary machine); masina_mica by km only. Camion/Autoutilitara
    // track both -- they also run stationary a lot (PTO, hydraulics, a
    // crane), not just drive. Which initial-reading/interval/rated
    // fields show follows that split (the monthly readings themselves
    // live in "Raport lunar consum", not on this form — see
    // openVehicleFuelLogForm).
    const tracksKm = vfSubcatTracksKm(subcat);
    const tracksHours = vfSubcatTracksHours(subcat);
    document.getElementById('vf-fuel-rated-km-field').style.display = tracksKm ? '' : 'none';
    document.getElementById('vf-fuel-rated-hours-field').style.display = tracksHours ? '' : 'none';
    document.getElementById('vf-fuel-initial-km-field').style.display = tracksKm ? '' : 'none';
    document.getElementById('vf-fuel-initial-hours-field').style.display = tracksHours ? '' : 'none';
    document.getElementById('vf-service-due-km-field').style.display = tracksKm ? '' : 'none';
    document.getElementById('vf-service-due-hours-field').style.display = tracksHours ? '' : 'none';
  }
  const vfSubcatSelect = document.getElementById('vf-subcat');
  if (vfSubcatSelect) vfSubcatSelect.addEventListener('change', syncVehicleFormFields);
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
    document.getElementById('vf-fuel-rated-km').value = '';
    document.getElementById('vf-fuel-rated-hours').value = '';
    document.getElementById('vf-fuel-tank-capacity').value = '';
    document.getElementById('vf-fuel-initial-km').value = '';
    document.getElementById('vf-fuel-initial-hours').value = '';
    document.getElementById('vf-service-due-km').value = '';
    document.getElementById('vf-service-due-hours').value = '';
    document.getElementById('vf-reservoir-liters').value = '';
    syncVehicleFormFields();
    const titleEl = document.getElementById('vehicleFormSheetTitle');
    if (titleEl) titleEl.textContent = 'Adaugă mașină';
    const saveBtn = document.getElementById('vfSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Adaugă';
    const deleteBtn = document.getElementById('vfDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';
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
    document.getElementById('vf-fuel-rated-km').value = eq.fuel_rated_consumption_km ?? '';
    document.getElementById('vf-fuel-rated-hours').value = eq.fuel_rated_consumption_hours ?? '';
    document.getElementById('vf-fuel-tank-capacity').value = eq.fuel_tank_capacity_l ?? '';
    document.getElementById('vf-fuel-initial-km').value = eq.fuel_initial_km ?? '';
    document.getElementById('vf-fuel-initial-hours').value = eq.fuel_initial_hours ?? '';
    document.getElementById('vf-service-due-km').value = eq.fuel_service_interval_km ?? '';
    document.getElementById('vf-service-due-hours').value = eq.fuel_service_interval_hours ?? '';
    document.getElementById('vf-reservoir-liters').value = eq.quantity ?? '';
    syncVehicleFormFields();
    const titleEl = document.getElementById('vehicleFormSheetTitle');
    if (titleEl) titleEl.textContent = `Editează — ${eq.name}`;
    const saveBtn = document.getElementById('vfSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Salvează';
    // Real vehicles still delete from their own subcategory card page
    // (Editează/Șterge icons) -- the reservoir has no such page, so this
    // is its only delete path, shown only when editing an existing one.
    const deleteBtn = document.getElementById('vfDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = isReservoir(eq) ? '' : 'none';
    setSheetOpen('vehicleFormSheet', true);
  }
  const vfDeleteBtn = document.getElementById('vfDeleteBtn');
  if (vfDeleteBtn) vfDeleteBtn.addEventListener('click', async () => {
    const id = document.getElementById('vf-id').value;
    if (!id) return;
    const ok = await deleteVehicle(id);
    if (ok) setSheetOpen('vehicleFormSheet', false);
  });
  const vfSaveBtn = document.getElementById('vfSaveBtn');
  if (vfSaveBtn) vfSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('vf-id').value;
    const title = document.getElementById('vf-title').value.trim();
    const plate = document.getElementById('vf-plate').value.trim();
    const chassis = document.getElementById('vf-chassis').value.trim();
    const subcat = document.getElementById('vf-subcat').value;
    const assigned = document.getElementById('vf-assigned').value.trim();
    const notes = document.getElementById('vf-notes').value.trim();
    if (subcat === 'rezervor') {
      const litersInput = document.getElementById('vf-reservoir-liters').value;
      if (litersInput === '') { alert('Completați litrii din rezervor.'); return; }
      const liters = Number(litersInput);
      const name = title || 'Rezervor motorină';
      const reservoirPayload = {
        name, category: subcat, quantity: liters, unit: 'L', notes: notes || null,
        plate_number: null, serial_number: null, assigned_to: null,
        itp_expires_on: null, insurance_expires_on: null, transport_license_expires_on: null,
        parking_ticket_expires_on: null, vignette_expires_on: null, tachograph_expires_on: null,
        fuel_rated_consumption_km: null, fuel_rated_consumption_hours: null, fuel_tank_capacity_l: null,
        fuel_initial_km: null, fuel_initial_hours: null,
        fuel_service_interval_km: null, fuel_service_interval_hours: null,
      };
      if (id) {
        const original = allEquipment.find(v => v.id === id);
        const { error } = await AppDataServices.erp.saveVehicle(supabaseClient, reservoirPayload, id);
        if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
        const changeSummary = original ? describeVehicleFieldChanges(original, reservoirPayload) : '';
        logEntityActivity('masina', id, changeSummary ? `Rezervorul a fost actualizat — ${changeSummary}.` : 'Rezervorul a fost actualizat (fără modificări de câmp).');
        setSheetOpen('vehicleFormSheet', false);
        showToast('Rezervorul a fost actualizat.');
        loadEquipment();
      } else {
        const payload = Object.assign({ item_type: 'echipament', erp_category: 'masina', status: 'Disponibil' }, reservoirPayload);
        const { data, error } = await AppDataServices.erp.saveVehicle(supabaseClient, payload, null);
        if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
        if (data && data[0]) logEntityActivity('masina', data[0].id, 'Rezervor adăugat.');
        setSheetOpen('vehicleFormSheet', false);
        showToast('Rezervorul a fost adăugat.');
        loadEquipment();
      }
      return;
    }
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
    const tracksKm = vfSubcatTracksKm(subcat);
    const tracksHours = vfSubcatTracksHours(subcat);
    const vfNumOrNull = (elId) => {
      const v = document.getElementById(elId).value;
      return v === '' ? null : Number(v);
    };
    const fuelPayload = {
      fuel_rated_consumption_km: tracksKm ? vfNumOrNull('vf-fuel-rated-km') : null,
      fuel_rated_consumption_hours: tracksHours ? vfNumOrNull('vf-fuel-rated-hours') : null,
      fuel_tank_capacity_l: vfNumOrNull('vf-fuel-tank-capacity'),
      fuel_initial_km: tracksKm ? vfNumOrNull('vf-fuel-initial-km') : null,
      fuel_initial_hours: tracksHours ? vfNumOrNull('vf-fuel-initial-hours') : null,
      fuel_service_interval_km: tracksKm ? vfNumOrNull('vf-service-due-km') : null,
      fuel_service_interval_hours: tracksHours ? vfNumOrNull('vf-service-due-hours') : null,
    };
    if (id) {
      const payload = Object.assign({
        name, category: subcat, plate_number: plate,
        serial_number: chassis || null, assigned_to: assigned || null, notes: notes || null,
      }, docsPayload, fuelPayload);
      const original = allEquipment.find(v => v.id === id);
      const { error } = await AppDataServices.erp.saveVehicle(supabaseClient, payload, id);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      const changeSummary = original ? describeVehicleFieldChanges(original, payload) : '';
      logEntityActivity('masina', id, changeSummary ? `Mașina a fost actualizată — ${changeSummary}.` : 'Mașina a fost actualizată (fără modificări de câmp).');
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
    const docFields = VEHICLE_DOC_FIELDS.filter(f => !f.camionOnly || isCamion);
    const docsHtml = docFields.map(f => {
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
      <div class="vd-docs-grid" style="grid-template-columns:repeat(${docFields.length},1fr);">${docsHtml}</div>
      ${vehicleFuelReadingRowHtml(eq, docFields.length)}
    `;
  }
  // Second doc-style row, right below the ITP/Asigurare/... grid: the
  // latest odometer/hour-meter reading actually entered (never the
  // one-time initial reading from the vehicle form) and the fuel
  // consumption that reading implies for its own month — so checking a
  // vehicle's current numbers doesn't require leaving its own card.
  // Camion/Autoutilitara render this twice over (once per unit they
  // track) rather than picking one — a truck's km and hours countdowns
  // are independent, so both need their own visible row of numbers.
  function vehicleFuelReadingRowHtml(eq, columnCount){
    const items = [];
    vehicleUnits(eq).forEach(unit => {
      const unitLbl = unitLabel(unit);
      const log = latestFuelLogFor(eq, unit);
      const field = readingFieldFor(unit);
      const readingVal = log ? `${log[field]} ${unitLbl}` : '—';
      items.push({
        label: unit === 'hours' ? 'Ore actuale' : 'Km actual',
        value: readingVal,
        cls: '',
      });
      const c = log ? vehicleFuelConsumptionFor(eq, unit, log.year, log.month) : null;
      const consumptionVal = c && c.actual != null
        ? `${c.actual.toFixed(1)} ${c.unitRateLabel}${c.rated != null ? ` (normat ${c.rated} ${c.unitRateLabel})` : ''}${c.overLimit ? ' ⚠' : ''}`
        : '—';
      items.push({
        label: unit === 'hours' ? 'Consum efectiv (ore)' : 'Consum efectiv',
        value: consumptionVal,
        cls: c && c.overLimit ? 'mt-warn' : '',
      });
      const service = vehicleServiceCountdownFor(eq, unit);
      if (service != null) {
        const serviceCls = serviceDueClass(service.remaining, unit);
        const serviceVal = service.remaining >= 0 ? `${service.remaining} ${service.unit}`
          : `depășit cu ${Math.abs(service.remaining)} ${service.unit}`;
        items.push({
          label: unit === 'hours' ? 'Ore rămase service' : 'Km rămași service',
          value: `${serviceVal}${serviceCls ? ' ⚠' : ''}`,
          cls: serviceCls,
        });
      }
    });
    // Normally matches the docs row above so values line up in columns
    // (see vehicleCardContentHtml) -- but a dual-tracked vehicle can
    // have more items here than that row has columns, in which case
    // this row just uses its own count instead of forcing a squeeze.
    const finalColumnCount = Math.max(columnCount, items.length);
    return `
      <div class="vd-docs-grid vd-fuel-grid" style="grid-template-columns:repeat(${finalColumnCount},1fr);">
        ${items.map(it => `
        <div class="vd-doc-item">
          <div class="vd-doc-label">${escapeHtml(it.label)}</div>
          <div class="vd-doc-value ${it.cls}">${it.value}</div>
        </div>
        `).join('')}
      </div>
    `;
  }
  function vehicleBigCardHtml(eq){
    return `
      <div class="vehicle-big-card" id="vehicle-card-${escapeHtml(eq.id)}">
        <div class="vehicle-big-card-actions">
          ${vehicleDueItems(eq).length > 0 ? `
          <button type="button" class="mt-row-icon-btn mt-service-done-icon" data-requires-write="erp" data-vehicle-id="${escapeHtml(eq.id)}" title="Scadențe" aria-label="Vezi scadențele pentru ${escapeHtml(eq.name)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </button>
          ` : ''}
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
    // The reservoir has no subcategory page of its own to jump to --
    // its only row lives right on Prezentare generală, so its one-click
    // action is opening the edit form directly instead.
    if (isReservoir(eq)) { openAdminTab('machines'); setMachinesSubcatFilter('Toate', { sidebarKey: 'Toate' }); openVehicleEdit(eq); return; }
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
    const noun = eq && isReservoir(eq) ? 'rezervorul' : 'mașina';
    if (!confirm(`Ștergeți ${noun}${eq ? ' „' + eq.name + '"' : ''}? Această acțiune nu poate fi anulată.`)) return false;
    const result = await AppDataServices.erp.deleteVehicle(supabaseClient, id);
    if (result.blockedByHistory) {
      alert('Mașina are rezervări LPS asociate. Păstrează istoricul: schimbă starea în „Indisponibil” în ERP în loc să o ștergi.');
      return false;
    }
    const { error } = result;
    if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return false; }
    logEntityActivity('masina', id, eq && isReservoir(eq) ? 'Rezervorul a fost șters.' : 'Mașina a fost ștearsă.');
    showToast(eq && isReservoir(eq) ? 'Rezervorul a fost șters.' : 'Mașina a fost ștearsă.');
    loadEquipment();
    return true;
  }
  const machinesCardsList = document.getElementById('machinesCardsList');
  // Resets the interval's baseline to whatever's currently logged, so
  // the next due point becomes current + interval -- the only way the
  // countdown is meant to move forward, instead of editing a raw target
  // by hand each time a real service happens. Takes whichever units the
  // caller hands it -- a single one from a per-item "Marchează efectuat"
  // in the due-service sheet below, or all of them at once from its
  // "Marchează toate efectuate" convenience button.
  async function markServiceDoneForUnits(eq, units){
    const readings = units
      .map(u => ({ unit: u, current: currentServiceReadingFor(eq, u) }))
      .filter(r => r.current != null);
    if (!readings.length) return false;
    const summary = readings.map(r => `${r.current} ${r.unit === 'hours' ? 'ore' : 'km'}`).join(' / ');
    if (!confirm(`Marchezi service efectuat pentru „${eq.name}” la ${summary}? Următorul service se calculează de la aceste valori.`)) return false;
    const payload = {};
    readings.forEach(r => { payload[serviceLastFieldFor(r.unit)] = r.current; });
    const { error } = await AppDataServices.erp.saveVehicle(supabaseClient, payload, eq.id);
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return false; }
    logEntityActivity('masina', eq.id, `Service efectuat la ${summary}.`);
    showToast('Service marcat ca efectuat.');
    return true;
  }
  // Which of a vehicle's tracked units are actually due soon (orange)
  // or overdue (red) -- i.e. serviceDueClass() is non-empty, not just
  // "has a countdown at all". This is what gates the checkmark icon and
  // what the sheet below lists: a vehicle with 9000km left shouldn't
  // show either, only one that's actually worth acting on.
  function vehicleDueUnits(eq){
    return vehicleUnits(eq).map(unit => {
      const countdown = vehicleServiceCountdownFor(eq, unit);
      if (countdown == null) return null;
      const cls = serviceDueClass(countdown.remaining, unit);
      return cls ? { type: 'service', unit, countdown, cls } : null;
    }).filter(Boolean);
  }
  // Documents due soon (orange, <=14 days) or already expired (red) --
  // same docDateClass() the Prezentare generală table's own date
  // columns already use, just filtered down to the ones actually worth
  // surfacing (an empty/never-set date isn't "due", it's just unset).
  function vehicleDueDocs(eq){
    const isCamion = eq.category === 'camion';
    return VEHICLE_DOC_FIELDS.filter(f => !f.camionOnly || isCamion).map(f => {
      const dateStr = eq[f.key];
      const cls = docDateClass(dateStr);
      return cls ? { type: 'doc', key: f.key, label: f.label, dateStr, cls } : null;
    }).filter(Boolean);
  }
  // Everything currently worth surfacing on this vehicle -- due/overdue
  // service intervals AND due/expired documents together. Gates the
  // checkmark icon and populates the sheet it opens, so a km countdown
  // and an expiring ITP show up the same way instead of two different
  // UI patterns for "something needs attention on this car".
  function vehicleDueItems(eq){
    return [...vehicleDueUnits(eq), ...vehicleDueDocs(eq)];
  }
  // Which vehicle the open serviceDueSheet refers to -- re-read from
  // allEquipment (not captured once) on every render so resolving one
  // item and reloading reflects immediately, same as fuelLogSheetContext.
  let serviceDueSheetVehicleId = null;
  function renderServiceDueSheet(){
    const listEl = document.getElementById('serviceDueList');
    const markAllBtn = document.getElementById('serviceDueMarkAllBtn');
    if (!listEl || !serviceDueSheetVehicleId) return;
    const eq = allEquipment.find(v => v.id === serviceDueSheetVehicleId);
    const due = eq ? vehicleDueItems(eq) : [];
    if (!due.length) {
      // Nothing left due (the vehicle vanished, or its only due item
      // just got resolved) -- an empty sheet isn't useful, close it.
      setSheetOpen('serviceDueSheet', false);
      return;
    }
    listEl.innerHTML = due.map(d => {
      if (d.type === 'doc') {
        const statusText = d.cls === 'mt-expired' ? `Expirat pe ${formatWoDateRO(d.dateStr)}` : `Expiră pe ${formatWoDateRO(d.dateStr)}`;
        return `
          <div class="fuel-purchase-item">
            <div>
              <div class="fuel-purchase-item-main">${escapeHtml(d.label)}</div>
              <div class="fuel-purchase-item-note ${d.cls}">${statusText} ⚠</div>
            </div>
            <div class="service-due-date-edit">
              <div class="ctrl-field"><input type="date" class="service-due-date-input" data-key="${d.key}" value="${escapeHtml(d.dateStr || '')}"></div>
              <button type="button" class="btn btn-primary service-due-date-save-btn" data-requires-write="erp" data-key="${d.key}">Salvează</button>
            </div>
          </div>
        `;
      }
      const label = d.unit === 'hours' ? 'Ore rămase service' : 'Km rămași service';
      const val = d.countdown.remaining >= 0 ? `${d.countdown.remaining} ${d.countdown.unit}`
        : `depășit cu ${Math.abs(d.countdown.remaining)} ${d.countdown.unit}`;
      return `
        <div class="fuel-purchase-item">
          <div>
            <div class="fuel-purchase-item-main">${escapeHtml(label)}</div>
            <div class="fuel-purchase-item-note ${d.cls}">${val} ⚠</div>
          </div>
          <button type="button" class="btn btn-primary service-due-resolve-btn" data-requires-write="erp" data-unit="${d.unit}">Marchează efectuat</button>
        </div>
      `;
    }).join('');
    // Bulk-resolve only ever applies to service intervals -- there's no
    // automatic value for a renewed document the way there is for an
    // odometer reading, so it stays a per-document Salvează only.
    const serviceCount = due.filter(d => d.type === 'service').length;
    if (markAllBtn) markAllBtn.style.display = serviceCount > 1 ? '' : 'none';
  }
  function openServiceDueSheet(eq){
    serviceDueSheetVehicleId = eq.id;
    const titleEl = document.getElementById('serviceDueSheetTitle');
    if (titleEl) titleEl.textContent = `Scadențe — ${eq.name}`;
    renderServiceDueSheet();
    setSheetOpen('serviceDueSheet', true);
  }
  const serviceDueList = document.getElementById('serviceDueList');
  if (serviceDueList) serviceDueList.addEventListener('click', async (e) => {
    const eq = serviceDueSheetVehicleId ? allEquipment.find(v => v.id === serviceDueSheetVehicleId) : null;
    if (!eq) return;
    const resolveBtn = e.target.closest('.service-due-resolve-btn');
    if (resolveBtn) {
      const ok = await markServiceDoneForUnits(eq, [resolveBtn.dataset.unit]);
      if (ok) { await loadEquipment(); renderServiceDueSheet(); }
      return;
    }
    const dateSaveBtn = e.target.closest('.service-due-date-save-btn');
    if (dateSaveBtn) {
      const key = dateSaveBtn.dataset.key;
      const input = serviceDueList.querySelector(`.service-due-date-input[data-key="${key}"]`);
      const newVal = input ? input.value : '';
      if (!newVal) { alert('Alegeți o dată.'); return; }
      dateSaveBtn.disabled = true;
      const { error } = await AppDataServices.erp.saveVehicle(supabaseClient, { [key]: newVal }, eq.id);
      dateSaveBtn.disabled = false;
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      const fieldDef = VEHICLE_DOC_FIELDS.find(f => f.key === key);
      logEntityActivity('masina', eq.id, `${fieldDef ? fieldDef.label : key} actualizat la ${formatWoDateRO(newVal)}.`);
      showToast('Data a fost actualizată.');
      await loadEquipment();
      renderServiceDueSheet();
    }
  });
  const serviceDueMarkAllBtn = document.getElementById('serviceDueMarkAllBtn');
  if (serviceDueMarkAllBtn) serviceDueMarkAllBtn.addEventListener('click', async () => {
    if (!serviceDueSheetVehicleId) return;
    const eq = allEquipment.find(v => v.id === serviceDueSheetVehicleId);
    if (!eq) return;
    const ok = await markServiceDoneForUnits(eq, vehicleDueUnits(eq).map(d => d.unit));
    if (ok) { await loadEquipment(); renderServiceDueSheet(); }
  });
  if (machinesCardsList) machinesCardsList.addEventListener('click', (e) => {
    const editIcon = e.target.closest('.mt-edit-icon');
    if (editIcon) {
      const eq = allEquipment.find(v => v.id === editIcon.dataset.vehicleId);
      if (eq) openVehicleEdit(eq);
      return;
    }
    const deleteIcon = e.target.closest('.mt-delete-icon');
    if (deleteIcon) { deleteVehicle(deleteIcon.dataset.vehicleId); return; }
    const serviceDoneIcon = e.target.closest('.mt-service-done-icon');
    if (serviceDoneIcon) {
      const eq = allEquipment.find(v => v.id === serviceDoneIcon.dataset.vehicleId);
      if (eq) openServiceDueSheet(eq);
    }
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
  // addMaterialBtn/addProductBtn/efSaveBtn (the shared Echipamente/
  // Materiale/Produse add/edit sheet) are now admin-react/'s
  // EquipmentForm, opened from CategoryPanel's own "+ Adaugă" button --
  // see useErpStore's saveItem for the equivalent insert/update +
  // logStockLedger/logEntityActivity calls.


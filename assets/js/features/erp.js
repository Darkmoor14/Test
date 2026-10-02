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
  async function loadEquipment(){
    const [eqResult] = await Promise.all([
      supabaseClient.from('equipment_inventory').select('*').order('name', { ascending: true }),
      loadResourceAssignments(),
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
  const ERP_CATEGORY_LABEL = { echipament: 'Echipament', masina: 'Mașină', material: 'Material' };
  const ERP_CATEGORY_LIST_IDS = {
    echipament: { list: 'equipmentList', count: 'equipmentCount', empty: 'Niciun echipament înregistrat.' },
    material: { list: 'materialsList', count: 'materialsCount', empty: 'Niciun material înregistrat.' },
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
    return eq.erp_category === 'material' && eq.reorder_threshold != null && Number(eq.quantity) <= Number(eq.reorder_threshold);
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
        ${erpCategory === 'material' ? '<button class="btn eq-ledger">Jurnal stoc</button>' : ''}
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
    renderErpHomeStats();
  }
  function renderErpHomeStats(){
    const counts = { echipament: 0, masina: 0, material: 0 };
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
      <div class="status-history-item" data-goto-tab="materials">
        <span class="status-history-time">MATERIAL</span>
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
  const erpHomeNavEquipment = document.getElementById('erpHomeNavEquipment');
  if (erpHomeNavEquipment) erpHomeNavEquipment.addEventListener('click', () => openAdminTab('equipment'));
  const erpHomeNavMachines = document.getElementById('erpHomeNavMachines');
  if (erpHomeNavMachines) erpHomeNavMachines.addEventListener('click', () => openAdminTab('machines'));
  const erpHomeNavMaterials = document.getElementById('erpHomeNavMaterials');
  if (erpHomeNavMaterials) erpHomeNavMaterials.addEventListener('click', () => openAdminTab('materials'));

  const efTypeSelect = document.getElementById('ef-type');
  const ERP_ITEM_FORM_TITLE = { echipament: 'echipament', masina: 'mașină', material: 'material' };
  function syncEquipmentFormFields(){
    const isMaterial = efTypeSelect.value === 'material';
    document.getElementById('ef-quantity-field').style.display = isMaterial ? '' : 'none';
    document.getElementById('ef-unit-field').style.display = isMaterial ? '' : 'none';
    document.getElementById('ef-reorder-field').style.display = isMaterial ? '' : 'none';
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
    const isCamion = document.getElementById('vf-subcat').value === 'camion';
    document.getElementById('vf-transport-license-field').style.display = isCamion ? '' : 'none';
    document.getElementById('vf-tachograph-field').style.display = isCamion ? '' : 'none';
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
    if (id) {
      const payload = Object.assign({
        name, category: subcat, plate_number: plate,
        serial_number: chassis || null, assigned_to: assigned || null, notes: notes || null,
      }, docsPayload);
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
      }, docsPayload);
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
  const efSaveBtn = document.getElementById('efSaveBtn');
  if (efSaveBtn) efSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('ef-id').value;
    const name = document.getElementById('ef-name').value.trim();
    const erp_category = document.getElementById('ef-type').value;
    const item_type = erp_category === 'material' ? 'material' : 'echipament';
    const category = document.getElementById('ef-category').value.trim();
    const quantity = parseFloat(document.getElementById('ef-quantity').value) || 0;
    const unit = document.getElementById('ef-unit').value.trim();
    const reorderRaw = document.getElementById('ef-reorder-threshold').value;
    const reorder_threshold = erp_category === 'material' && reorderRaw !== '' ? parseFloat(reorderRaw) : null;
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
      if (erp_category === 'material' && efEditingOriginalQuantity !== null && quantity !== efEditingOriginalQuantity) {
        logStockLedger(id, name, quantity - efEditingOriginalQuantity, quantity, 'Editare manuală');
      }
      logEntityActivity(erp_category, id, `„${name}” a fost actualizat.`);
    } else {
      const { data, error } = await supabaseClient.from('equipment_inventory').insert(payload).select();
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
      if (data && data[0]) logEntityActivity(erp_category, data[0].id, `„${name}” a fost adăugat.`);
      if (erp_category === 'material' && data && data[0]) {
        logStockLedger(data[0].id, name, quantity, quantity, 'Articol adăugat');
      }
    }
    setSheetOpen('erpItemFormSheet', false);
    showToast(id ? 'Articolul a fost actualizat.' : 'Articolul a fost adăugat.');
    loadEquipment();
  });

  
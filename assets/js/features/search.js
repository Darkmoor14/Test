/* ============================================================
     ACASĂ — CĂUTARE INTELIGENTĂ. Un motor pe reguli (nu AI — fără
     cost, fără cheie API, răspunde instant) peste ERP, Proiecte
     publice, Avarii rețele, Proiecte LPS și Programe lucrări, pentru
     întrebări de genul "cât cablu X mai am", "unde e excavatorul",
     "cine lucrează la avaria de pe strada X", "când e programată
     lucrarea Y". Acoperă tiparele de mai jos; orice altceva primește
     fie câteva sugestii apropiate (dacă există ceva asemănător),
     fie un mesaj clar că nu a fost găsit — niciodată un răspuns
     ghicit greșit. Fiecare căutare e logată ca semnal ('search_query')
     — inclusiv cele nereușite, care arată exact ce lipsește din date
     — vizibil în Stare sistem, sub „Ce caută oamenii”.

     "Se îmbunătățește singură" înseamnă aici ceva concret și
     verificabil, nu magie: când cineva alege o sugestie pentru o
     întrebare nepotrivită, acea pereche întrebare→rezultat se ține
     minte în search_query_aliases (o tabelă simplă, nu AI) — data
     viitoare când cineva scrie exact aceeași întrebare, răspunsul
     vine direct, fără ghicit. Căutarea se îmbunătățește din
     folosire reală, nu dintr-un algoritm care "învață" pe ascuns.
     ============================================================ */
  function normalizeSearchText(s){
    return (s || '').toString().toLowerCase()
      .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i').replace(/ș/g, 's').replace(/ş/g, 's').replace(/ț/g, 't').replace(/ţ/g, 't')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const SEARCH_STOPWORDS = new Set(['de', 'la', 'in', 'din', 'pe', 'si', 'cu', 'al', 'a', 'un', 'o', 'ce', 'mai', 'e', 'este', 'sunt', 'am', 'are']);
  function searchTokens(s){
    return normalizeSearchText(s).split(' ').filter(t => t.length >= 2 && !SEARCH_STOPWORDS.has(t));
  }
  function tabForErpCategory(cat){ return cat === 'echipament' ? 'equipment' : cat === 'masina' ? 'machines' : 'materials'; }
  const SEARCH_COLLECTION_LABEL = { erp_echipament: 'Echipament', erp_masina: 'Mașină', erp_material: 'Material', projects: 'Proiect public', backlog: 'Avarie rețea', lps: 'Proiect LPS', workorders: 'Programare', tickets: 'Sesizare' };
  // One flat index across every searchable collection — rebuilt on
  // every search (cheap: a few hundred rows at most for a platform
  // this size) so it always reflects whatever's currently loaded,
  // without a separate cache-invalidation path to keep in sync.
  function buildSearchIndex(){
    const index = [];
    (typeof allEquipment !== 'undefined' ? allEquipment : []).forEach(eq => {
      const cat = eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material');
      index.push({ collection: 'erp_' + cat, id: eq.id, title: eq.name, searchText: [eq.name, eq.plate_number, eq.serial_number, eq.assigned_to, eq.location, eq.category].filter(Boolean).join(' '), tab: tabForErpCategory(cat), item: eq });
    });
    (typeof allTickets !== 'undefined' ? allTickets : []).forEach(t => {
      const tab = t.type === 'Anunt accident' ? 'tickets-accident' : 'tickets-functional';
      index.push({ collection: 'tickets', id: t.id, title: t.ticket_number || 'Sesizare', searchText: [t.ticket_number, t.name, t.phone, t.address, t.email, t.description].filter(Boolean).join(' '), tab, item: t });
    });
    (typeof allProjects !== 'undefined' ? allProjects : []).filter(p => !p.archived).forEach(p => {
      index.push({ collection: 'projects', id: p.id, title: p.title, searchText: [p.title, p.address].filter(Boolean).join(' '), tab: 'projects', item: p });
    });
    (typeof allBacklogProjects !== 'undefined' ? allBacklogProjects : []).forEach(p => {
      index.push({ collection: 'backlog', id: p.id, title: p.title, searchText: [p.title, p.address, p.employee_name].filter(Boolean).join(' '), tab: 'backlog', item: p });
    });
    (typeof internalProjects !== 'undefined' ? internalProjects : []).forEach(p => {
      index.push({ collection: 'lps', id: p.id, title: p.title, tab: 'lps', item: p });
    });
    (typeof allWorkOrders !== 'undefined' ? allWorkOrders : []).forEach(w => {
      index.push({ collection: 'workorders', id: w.id, title: w.title, searchText: [w.title, w.location, w.crew, w.description].filter(Boolean).join(' '), tab: 'workorders', item: w });
    });
    return index;
  }
  function findBestIndexMatch(queryNorm, index){
    // Real names carry extra words nobody actually types ("Excavator
    // JCB 3CX" for "unde e excavatorul") — so this picks whichever
    // entry has the most of its title's tokens present in the query
    // at all (not a strict majority), tie-broken by how much of the
    // title that covers.
    let best = null, bestHits = 0, bestRatio = 0;
    index.forEach(entry => {
      const titleTokens = searchTokens(entry.searchText || entry.title);
      if (!titleTokens.length) return;
      let hits = 0;
      titleTokens.forEach(t => { if (queryNorm.indexOf(t) !== -1) hits++; });
      if (hits === 0) return;
      const ratio = hits / titleTokens.length;
      if (hits > bestHits || (hits === bestHits && ratio > bestRatio)) {
        best = entry; bestHits = hits; bestRatio = ratio;
      }
    });
    return best;
  }
  // Used only when findBestIndexMatch found literally nothing — catches
  // typos ("excavatr") via a shared-prefix match instead of requiring
  // an exact substring, so there's something to suggest rather than
  // just "not found" for an almost-right query.
  function findSuggestedMatches(queryTokens, index){
    const scored = [];
    index.forEach(entry => {
      const titleTokens = searchTokens(entry.title);
      let score = 0;
      titleTokens.forEach(tt => {
        queryTokens.forEach(qt => {
          if (tt === qt) { score += 2; return; }
          const prefixLen = Math.min(tt.length, qt.length);
          if (prefixLen >= 4 && tt.slice(0, 4) === qt.slice(0, 4)) score += 1;
        });
      });
      if (score > 0) scored.push({ entry, score });
    });
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const out = [];
    for (const s of scored) {
      const key = s.entry.collection + '|' + s.entry.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s.entry);
      if (out.length >= 3) break;
    }
    return out;
  }
  const SEARCH_CATEGORY_WORDS = { echipament: ['echipament', 'echipamente'], masina: ['masina', 'masini'], material: ['material', 'materiale'] };
  const SEARCH_STATUS_WORDS = { 'Disponibil': ['disponibil', 'disponibile'], 'In folosinta': ['folosinta', 'folosita', 'folosite'], 'Service': ['service'], 'Indisponibil': ['indisponibil', 'indisponibile'] };
  function describeErpMatch(item, q){
    const cat = item.erp_category || (item.item_type === 'echipament' ? 'echipament' : 'material');
    const isVehicle = cat === 'masina';
    const isMaterial = cat === 'material';
    const tab = tabForErpCategory(cat);
    if (isVehicle && /\bkm\b|kilometr/.test(q)) {
      if (item.odometer_km != null) {
        const updated = item.odometer_updated_at ? ` (actualizat ${formatLogTimeRO(item.odometer_updated_at)})` : '';
        return { text: `${item.name} are ${Number(item.odometer_km).toLocaleString('ro-RO')} km${updated}.`, tab, matched: true };
      }
      return { text: `Nu există încă un kilometraj înregistrat pentru ${item.name}.`, tab, matched: false };
    }
    if (/\bunde\b|cine are|la cine/.test(q)) {
      const loc = item.location ? `se află la ${item.location}` : 'nu are o locație înregistrată';
      const assigned = item.assigned_to ? `, alocat(ă) la ${item.assigned_to}` : '';
      return { text: `${item.name} ${loc}${assigned}.`, tab, matched: true };
    }
    if (isMaterial && (/\bstoc\b|ramas|\bcat\b|\bcate\b/.test(q))) {
      const reserved = (allResourceAssignments || []).filter(a => a.inventory_item_id === item.id && a.status === 'reserved' && a.item_type === 'material').reduce((s, a) => s + (Number(a.quantity) || 0), 0);
      const reservedNote = reserved ? ` (din care ${reserved}${item.unit ? ' ' + item.unit : ''} rezervat pe proiecte neterminate)` : '';
      return { text: `Mai sunt ${Number(item.quantity)}${item.unit ? ' ' + item.unit : ''} din ${item.name}${reservedNote}.`, tab, matched: true };
    }
    if (/status|stare|disponibil/.test(q)) {
      return { text: `${item.name}: ${EQUIPMENT_STATUS_LABEL[item.status] || item.status}.`, tab, matched: true };
    }
    const parts = [`${item.name} — ${EQUIPMENT_STATUS_LABEL[item.status] || item.status}`];
    if (isMaterial) parts.push(`stoc: ${Number(item.quantity)}${item.unit ? ' ' + item.unit : ''}`);
    if (item.location) parts.push(`locație: ${item.location}`);
    if (item.assigned_to) parts.push(`alocat: ${item.assigned_to}`);
    if (isVehicle && item.odometer_km != null) parts.push(`${Number(item.odometer_km).toLocaleString('ro-RO')} km`);
    return { text: parts.join(' · '), tab, matched: true };
  }
  function describeMatch(entry, q){
    const it = entry.item;
    if (entry.collection === 'tickets') return { text: `${it.ticket_number || 'Sesizare'} — ${it.address || it.name || 'adresă neprecizată'} · ${it.status === 'Terminat' ? 'Soluționat' : 'Activă'}`, tab: entry.tab, matched: true };
    if (entry.collection.indexOf('erp_') === 0) return describeErpMatch(it, q);
    if (entry.collection === 'projects') {
      const status = calcProjectStatus(it.start_date, it.due_date);
      if (/\bunde\b/.test(q)) return { text: `${it.title} este la ${it.address || 'adresă neprecizată'}.`, tab: 'projects', matched: true };
      if (/cand|termin|gata/.test(q)) return { text: `${it.title} — termen: ${fmtDate(it.due_date)}.`, tab: 'projects', matched: true };
      if (/stare|status/.test(q)) return { text: `${it.title}: ${status.label}.`, tab: 'projects', matched: true };
      return { text: `${it.title} — ${status.label}${it.address ? ' · ' + it.address : ''} · termen ${fmtDate(it.due_date)}`, tab: 'projects', matched: true };
    }
    if (entry.collection === 'backlog') {
      const statusLabel = (it.status || 'Ongoing') === 'Terminat' ? 'Soluționată' : 'Activă';
      if (/cine\b/.test(q)) return { text: `${it.title} — angajat: ${it.employee_name || 'neatribuit'}.`, tab: 'backlog', matched: true };
      if (/\bunde\b/.test(q)) return { text: `${it.title} este la ${it.address || 'adresă neprecizată'}.`, tab: 'backlog', matched: true };
      if (/stare|status/.test(q)) return { text: `${it.title}: ${statusLabel}.`, tab: 'backlog', matched: true };
      return { text: `${it.title} — ${statusLabel}${it.address ? ' · ' + it.address : ''}${it.employee_name ? ' · ' + it.employee_name : ''}`, tab: 'backlog', matched: true };
    }
    if (entry.collection === 'lps') {
      if (/cine\b|responsabil/.test(q)) return { text: `${it.title} — responsabil: ${it.owner || 'neatribuit'}.`, tab: 'lps', matched: true };
      if (/urmeaza|urmatoar/.test(q)) return { text: `${it.title} — următoarea acțiune: ${it.next_action || 'nespecificată'}.`, tab: 'lps', matched: true };
      return { text: `${it.title} — etapă: ${it.stage || 'neprecizată'}${it.owner ? ' · ' + it.owner : ''}`, tab: 'lps', matched: true };
    }
    if (entry.collection === 'workorders') {
      if (/cand\b/.test(q)) return { text: `${it.title} este programat pe ${formatWoDateRO(it.scheduled_date)}.`, tab: 'workorders', matched: true };
      if (/stare|status/.test(q)) return { text: `${it.title}: ${it.status}.`, tab: 'workorders', matched: true };
      return { text: `${it.title} — ${it.status} · ${formatWoDateRO(it.scheduled_date)}`, tab: 'workorders', matched: true };
    }
    return { text: it.title, tab: entry.tab, matched: true };
  }
  async function lookupSearchAlias(queryNormalized){
    try {
      const { data, error } = await supabaseClient.from('search_query_aliases').select('*').eq('query_normalized', queryNormalized).order('hit_count', { ascending: false }).limit(1).maybeSingle();
      if (error || !data) return null;
      return data;
    } catch (e) { return null; }
  }
  async function recordSearchAlias(queryNormalized, entry){
    try {
      const { data: existing } = await supabaseClient.from('search_query_aliases').select('*').eq('query_normalized', queryNormalized).maybeSingle();
      if (existing) {
        await supabaseClient.from('search_query_aliases').update({
          collection: entry.collection, item_id: String(entry.id), item_title: entry.title,
          hit_count: (Number(existing.hit_count) || 0) + 1, updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        await supabaseClient.from('search_query_aliases').insert({
          query_normalized: queryNormalized, collection: entry.collection, item_id: String(entry.id), item_title: entry.title,
        });
      }
    } catch (e) { /* best effort — learning is a bonus, never a blocker */ }
  }
  async function answerSmartQuery(raw){
    const q = normalizeSearchText(raw);
    if (!q) return { text: 'Scrie o întrebare — de exemplu „cât cablu CYABY mai am” sau „unde e excavatorul”.', tab: null, matched: false, suggestions: [] };

    const index = buildSearchIndex();

    // 0) A previously-learned alias for this exact question — someone
    // already disambiguated it once via a suggestion chip.
    const alias = await lookupSearchAlias(q);
    if (alias) {
      const aliasedEntry = index.find(e => e.collection === alias.collection && String(e.id) === String(alias.item_id));
      if (aliasedEntry) return Object.assign(describeMatch(aliasedEntry, q), { suggestions: [], targetType: aliasedEntry.collection === 'tickets' ? 'ticket' : aliasedEntry.collection === 'erp_masina' ? 'vehicle' : null, targetId: aliasedEntry.id });
    }

    // 1) Aggregate/count questions over the ERP: "câte <categorie> [stare]"
    if (/\b(cat|cate|cati)\b/.test(q)) {
      let matchedCategory = null;
      for (const cat of Object.keys(SEARCH_CATEGORY_WORDS)) { if (SEARCH_CATEGORY_WORDS[cat].some(w => q.includes(w))) { matchedCategory = cat; break; } }
      if (matchedCategory) {
        let matchedStatus = null;
        for (const status of Object.keys(SEARCH_STATUS_WORDS)) { if (SEARCH_STATUS_WORDS[status].some(w => q.includes(w))) { matchedStatus = status; break; } }
        let items = (allEquipment || []).filter(e => (e.erp_category || '') === matchedCategory);
        if (matchedStatus) items = items.filter(e => e.status === matchedStatus);
        const catLabel = { echipament: 'echipamente', masina: 'mașini', material: 'materiale' }[matchedCategory];
        const statusLabel = matchedStatus ? ' ' + (EQUIPMENT_STATUS_LABEL[matchedStatus] || matchedStatus).toLowerCase() : '';
        const names = items.slice(0, 6).map(e => e.name).join(', ');
        return {
          text: `${items.length} ${catLabel}${statusLabel}${items.length ? ': ' + names + (items.length > 6 ? '…' : '') : '.'}`,
          tab: tabForErpCategory(matchedCategory), matched: true, suggestions: [],
        };
      }
    }

    // 2) Item-specific questions across every collection.
    const match = findBestIndexMatch(q, index);
    if (match) return Object.assign(describeMatch(match, q), { suggestions: [], targetType: match.collection === 'tickets' ? 'ticket' : match.collection === 'erp_masina' ? 'vehicle' : null, targetId: match.id });

    // 3) Nothing matched at all — offer close-but-not-exact suggestions
    // (typo tolerance via shared-prefix scoring) instead of a flat "no".
    const suggestions = findSuggestedMatches(searchTokens(q), index);
    if (suggestions.length) {
      return {
        text: `Nu am găsit exact „${raw.trim()}”, dar poate vrei una dintre acestea:`,
        tab: null, matched: false, suggestions, suggestQuery: q,
      };
    }
    return { text: `Nu am găsit niciun rezultat pentru „${raw.trim()}”. Încearcă numele unui echipament/mașină/material/proiect, sau o întrebare ca „unde e X”, „cine lucrează la X”, „când e X”.`, tab: null, matched: false, suggestions: [] };
  }
  const homeSmartSearchInput = document.getElementById('homeSmartSearchInput');
  const homeSmartSearchBtn = document.getElementById('homeSmartSearchBtn');
  const homeSmartSearchResult = document.getElementById('homeSmartSearchResult');
  async function runHomeSmartSearch(){
    if (!homeSmartSearchInput || !homeSmartSearchResult) return;
    const raw = homeSmartSearchInput.value;
    if (!raw.trim()) { homeSmartSearchResult.hidden = true; return; }
    const result = await answerSmartQuery(raw);
    renderSmartSearchResult(result, raw);
    if (typeof logFrictionSignal === 'function') logFrictionSignal('search_query', raw.trim().slice(0, 120), { matched: result.matched, tab: result.tab });
  }
  function renderSmartSearchResult(result, raw){
    homeSmartSearchResult.hidden = false;
    const suggestionsHtml = (result.suggestions || []).length
      ? `<div class="home-smart-search-suggestions">${result.suggestions.map((s, i) => `<button type="button" class="chip home-smart-suggestion-chip" data-suggest-index="${i}">${escapeHtml(SEARCH_COLLECTION_LABEL[s.collection] || '')}: ${escapeHtml(s.title)}</button>`).join('')}</div>`
      : '';
    homeSmartSearchResult.innerHTML = `
      <div class="home-smart-search-answer-row">
        <p class="home-smart-search-answer">${escapeHtml(result.text)}</p>
        ${result.tab ? '<button type="button" class="btn" id="homeSmartSearchGoto">Vezi</button>' : ''}
      </div>
      ${suggestionsHtml}
    `;
    const gotoBtn = document.getElementById('homeSmartSearchGoto');
    if (gotoBtn) gotoBtn.addEventListener('click', () => {
      if (result.targetType === 'ticket') goToTicket(result.targetId);
      else if (result.targetType === 'vehicle') { const vehicle = allEquipment.find(eq => eq.id === result.targetId); if (vehicle) goToVehicle(vehicle); else openAdminTab(result.tab); }
      else openAdminTab(result.tab);
    });
    homeSmartSearchResult.querySelectorAll('.home-smart-suggestion-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const entry = result.suggestions[Number(chip.dataset.suggestIndex)];
        if (!entry) return;
        const described = Object.assign(describeMatch(entry, result.suggestQuery || ''), { suggestions: [], targetType: entry.collection === 'tickets' ? 'ticket' : entry.collection === 'erp_masina' ? 'vehicle' : null, targetId: entry.id });
        renderSmartSearchResult(described, raw);
        recordSearchAlias(result.suggestQuery || normalizeSearchText(raw), entry);
      });
    });
  }
  if (homeSmartSearchBtn) homeSmartSearchBtn.addEventListener('click', runHomeSmartSearch);
  if (homeSmartSearchInput) homeSmartSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runHomeSmartSearch(); } });

  /* ============================================================
     COMMAND PALETTE (Cmd/Ctrl+K) — jump to any tab by name, or ask
     the same question the Home smart search answers, from anywhere
     in the app. Nav destinations come straight from BREADCRUMB_TABS
     so the list can never drift from the real tab registry; a typed
     question that doesn't match a destination falls through to the
     Home smart search (answerSmartQuery/runHomeSmartSearch), reusing
     its answer box instead of duplicating the matching logic here.
     ============================================================ */
  const NAV_DESTINATIONS = [
    { tab: 'home', label: 'Acasă' },
    ...Object.keys(BREADCRUMB_TABS).map(tab => ({ tab, label: BREADCRUMB_TABS[tab] })),
  ];
  const commandPalette = document.getElementById('commandPalette');
  const commandPaletteInput = document.getElementById('commandPaletteInput');
  const commandPaletteResults = document.getElementById('commandPaletteResults');
  let paletteActiveIndex = -1;
  let paletteCurrentItems = [];

  function openCommandPalette(){
    if (!commandPalette) return;
    commandPalette.classList.add('show');
    commandPalette.setAttribute('aria-hidden', 'false');
    commandPaletteInput.value = '';
    renderCommandPaletteResults('');
    setTimeout(() => commandPaletteInput.focus(), 10);
  }
  function closeCommandPalette(){
    if (!commandPalette) return;
    commandPalette.classList.remove('show');
    commandPalette.setAttribute('aria-hidden', 'true');
  }
  function renderCommandPaletteResults(rawQuery){
    const q = normalizeRomanianText(rawQuery.trim());
    const navMatches = q ? NAV_DESTINATIONS.filter(d => normalizeRomanianText(d.label).includes(q)) : NAV_DESTINATIONS;
    paletteCurrentItems = navMatches.map(d => ({ type: 'nav', tab: d.tab, label: d.label }));
    if (rawQuery.trim()) paletteCurrentItems.push({ type: 'search', raw: rawQuery.trim() });
    paletteActiveIndex = paletteCurrentItems.length ? 0 : -1;
    renderPaletteList();
  }
  function renderPaletteList(){
    if (!commandPaletteResults) return;
    if (!paletteCurrentItems.length) {
      commandPaletteResults.innerHTML = '<p class="command-palette-empty">Niciun rezultat.</p>';
      return;
    }
    let html = '';
    const navItems = paletteCurrentItems.filter(i => i.type === 'nav');
    const searchItem = paletteCurrentItems.find(i => i.type === 'search');
    if (navItems.length) {
      html += '<div class="command-palette-group-label">Pagini</div>';
      html += navItems.map(item => {
        const idx = paletteCurrentItems.indexOf(item);
        return `<button type="button" class="command-palette-item${idx === paletteActiveIndex ? ' active' : ''}" data-index="${idx}">
          <span class="cp-icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
          <span>${escapeHtml(item.label)}</span>
        </button>`;
      }).join('');
    }
    if (searchItem) {
      const idx = paletteCurrentItems.indexOf(searchItem);
      html += '<div class="command-palette-group-label">Căutare</div>';
      html += `<button type="button" class="command-palette-item${idx === paletteActiveIndex ? ' active' : ''}" data-index="${idx}">
        <span class="cp-icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
        <span>Caută „${escapeHtml(searchItem.raw)}”</span>
      </button>`;
    }
    commandPaletteResults.innerHTML = html;
    commandPaletteResults.querySelectorAll('.command-palette-item').forEach(btn => {
      btn.addEventListener('click', () => selectPaletteItem(Number(btn.dataset.index)));
    });
  }
  async function selectPaletteItem(index){
    const item = paletteCurrentItems[index];
    if (!item) return;
    closeCommandPalette();
    if (item.type === 'nav') { openAdminTab(item.tab); return; }
    openAdminTab('home');
    if (homeSmartSearchInput) {
      homeSmartSearchInput.value = item.raw;
      await runHomeSmartSearch();
    }
  }
  if (commandPaletteInput) {
    commandPaletteInput.addEventListener('input', () => renderCommandPaletteResults(commandPaletteInput.value));
    commandPaletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paletteCurrentItems.length) { paletteActiveIndex = (paletteActiveIndex + 1) % paletteCurrentItems.length; renderPaletteList(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paletteCurrentItems.length) { paletteActiveIndex = (paletteActiveIndex - 1 + paletteCurrentItems.length) % paletteCurrentItems.length; renderPaletteList(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (paletteActiveIndex >= 0) selectPaletteItem(paletteActiveIndex);
      } else if (e.key === 'Escape') {
        closeCommandPalette();
      }
    });
  }
  document.querySelectorAll('[data-close-palette]').forEach(el => el.addEventListener('click', closeCommandPalette));
  const commandPaletteBtn = document.getElementById('commandPaletteBtn');
  if (commandPaletteBtn) commandPaletteBtn.addEventListener('click', openCommandPalette);
  document.addEventListener('keydown', (e) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (commandPalette && commandPalette.classList.contains('show')) closeCommandPalette();
      else openCommandPalette();
    } else if (e.key === 'Escape' && commandPalette && commandPalette.classList.contains('show')) {
      closeCommandPalette();
    }
  });

  
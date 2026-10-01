/* ============================================================
     STARE SISTEM — live health checks, run from the browser with
     whatever the logged-in admin's own session can already reach
     (no separate credentials). Genuinely tests: a DB round trip, the
     current auth session, the Edge Functions runtime (via the
     side-effect-free status-ping function — NOT send-push/
     bright-processor, which have real effects if invoked), the
     calendar-reminder cron job's own recent run history (via
     get_system_status()), and the browser's push-notification
     permission. Deliberately does not attempt server CPU/memory/
     bandwidth — see the panel's own on-screen note for why.
     ============================================================ */
  let statusDbHistory = [];
  let statusDbChartInstance = null;
  let statusCronChartInstance = null;
  let statusCountsChartInstance = null;

  /* ============================================================
     STARE SISTEM — 48H HISTORY LOG. Persisted in localStorage (this
     browser only — there's no server-side cron running these checks,
     so it can only remember what happened while a tab with admin-2
     open actually ran them; see the periodic setInterval below and
     the sheet's own note). Logs on every status change immediately
     (so a failure is never missed) plus at least once an hour per
     check even while healthy (a heartbeat, so "no news" is still
     visible as "was actually checked and was fine" rather than a
     gap). Not a value-by-value time series — just enough to answer
     "what happened, and when" from the small "i" button.
     ============================================================ */
  const STATUS_HISTORY_KEY = 'systemStatusHistoryV1';
  const STATUS_HISTORY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
  const STATUS_HISTORY_HEARTBEAT_MS = 60 * 60 * 1000;
  const STATUS_CHECK_LABELS = {
    db: 'Bază de date', auth: 'Autentificare', functions: 'Funcții Edge',
    cron: 'Memento-uri calendar', push: 'Notificări push',
  };
  let lastLoggedStatusByCheck = {};

  function loadStatusHistory(){
    let raw;
    try { raw = localStorage.getItem(STATUS_HISTORY_KEY); } catch (_) { return []; }
    if (!raw) return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - STATUS_HISTORY_MAX_AGE_MS;
    return arr.filter(e => e && typeof e.ts === 'number' && e.ts >= cutoff);
  }

  function logStatusEvent(check, ok, message){
    const history = loadStatusHistory();
    history.push({ ts: Date.now(), check, ok, message });
    try { localStorage.setItem(STATUS_HISTORY_KEY, JSON.stringify(history)); } catch (_) { /* storage full/unavailable — the on-screen status still works, just without history */ }
  }

  // Only writes to localStorage when there's something worth writing
  // (a change, or the hourly heartbeat) — called from every checkStatusX
  // function below, right where each already knows its own result.
  function maybeLogStatusEvent(check, ok, message){
    const prev = lastLoggedStatusByCheck[check];
    const now = Date.now();
    if (prev && prev.ok === ok && (now - prev.ts) < STATUS_HISTORY_HEARTBEAT_MS) return;
    logStatusEvent(check, ok, message);
    lastLoggedStatusByCheck[check] = { ok, ts: now };
  }

  function renderStatusHistory(){
    const list = document.getElementById('statusHistoryList');
    if (!list) return;
    const history = loadStatusHistory().slice().reverse();
    if (history.length === 0) {
      list.innerHTML = '<p class="status-history-empty">Niciun eveniment înregistrat în ultimele 48 de ore.</p>';
      return;
    }
    list.innerHTML = history.map(e => {
      const d = new Date(e.ts);
      const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      const dateLabel = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
      const label = STATUS_CHECK_LABELS[e.check] || e.check;
      return `<div class="status-history-item ${e.ok ? 'ok' : 'bad'}">
        <span class="status-history-time">${dateLabel} ${time}</span>
        <span class="status-history-dot"></span>
        <div>
          <div class="status-history-check">${escapeHtml(label)}</div>
          <div class="status-history-message">${escapeHtml(e.message || '')}</div>
        </div>
      </div>`;
    }).join('');
  }

  const statusHistoryBtn = document.getElementById('statusHistoryBtn');
  if (statusHistoryBtn) statusHistoryBtn.addEventListener('click', () => {
    renderStatusHistory();
    setSheetOpen('statusHistorySheet', true);
  });
  const statusHistoryClearBtn = document.getElementById('statusHistoryClearBtn');
  if (statusHistoryClearBtn) statusHistoryClearBtn.addEventListener('click', () => {
    try { localStorage.removeItem(STATUS_HISTORY_KEY); } catch (_) { /* nothing to clear if storage isn't available */ }
    lastLoggedStatusByCheck = {};
    renderStatusHistory();
  });
  const statusHistoryDownloadBtn = document.getElementById('statusHistoryDownloadBtn');
  if (statusHistoryDownloadBtn) statusHistoryDownloadBtn.addEventListener('click', () => {
    downloadJson(`istoric-verificari-${new Date().toISOString().slice(0, 10)}.json`, loadStatusHistory());
  });

  function setStatusDot(id, state){
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('ok', 'bad', 'checking');
    if (state) el.classList.add(state);
  }

  async function checkStatusDb(){
    setStatusDot('statusDotDb', 'checking');
    const start = performance.now();
    const { error } = await supabaseClient.from('tickets').select('id', { count: 'exact', head: true });
    const elapsed = Math.round(performance.now() - start);
    document.getElementById('statusDbLatency').textContent = error ? 'Eroare' : elapsed + ' ms';
    setStatusDot('statusDotDb', error ? 'bad' : 'ok');
    statusDbHistory.push(error ? null : elapsed);
    if (statusDbHistory.length > 12) statusDbHistory.shift();
    renderStatusDbChart();
    maybeLogStatusEvent('db', !error, error ? ('Interogare eșuată: ' + (error.message || 'eroare necunoscută')) : ('Răspuns în ' + elapsed + ' ms'));
    return !error;
  }

  function renderStatusDbChart(){
    const canvas = document.getElementById('statusDbChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (statusDbChartInstance) statusDbChartInstance.destroy();
    statusDbChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: statusDbHistory.map((_, i) => i + 1),
        datasets: [{
          data: statusDbHistory,
          borderColor: '#D11F24',
          backgroundColor: 'rgba(209,31,36,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { font: { size: 9 } } },
          x: { display: false },
        },
      },
    });
  }

  async function checkStatusAuth(){
    setStatusDot('statusDotAuth', 'checking');
    const { data, error } = await supabaseClient.auth.getSession();
    const hasSession = !error && data && data.session;
    document.getElementById('statusAuthState').textContent = hasSession ? 'Activă' : 'Fără sesiune';
    document.getElementById('statusAuthLabel').textContent = hasSession
      ? currentSessionEmail || 'Sesiune activă'
      : 'Niciun utilizator autentificat';
    setStatusDot('statusDotAuth', hasSession ? 'ok' : 'bad');
    maybeLogStatusEvent('auth', !!hasSession, hasSession ? ('Sesiune activă — ' + (currentSessionEmail || 'utilizator necunoscut')) : 'Nicio sesiune activă');
  }

  async function checkStatusFunctions(){
    setStatusDot('statusDotFunctions', 'checking');
    const start = performance.now();
    let ok = false;
    let errDetail = '';
    try {
      const { error } = await supabaseClient.functions.invoke('status-ping');
      ok = !error;
      if (error) errDetail = error.message || String(error);
    } catch (err) {
      ok = false;
      errDetail = (err && err.message) ? err.message : String(err);
    }
    const elapsed = Math.round(performance.now() - start);
    document.getElementById('statusFunctionsLatency').textContent = ok ? elapsed + ' ms' : 'Eroare';
    setStatusDot('statusDotFunctions', ok ? 'ok' : 'bad');
    const list = document.getElementById('statusFunctionsList');
    if (list) {
      const known = [
        { name: 'status-ping', note: ok ? elapsed + ' ms' : ('eroare — ' + (errDetail || 'necunoscută')), tested: true },
        { name: 'send-push', note: 'nu e testat direct — vezi jobul de memento-uri mai jos', tested: false },
        { name: 'bright-processor', note: 'nu e testat direct (e-mail)', tested: false },
      ];
      list.innerHTML = known.map(f => `<li><span>${escapeHtml(f.name)}</span><span>${escapeHtml(f.note)}</span></li>`).join('');
    }
    maybeLogStatusEvent('functions', ok, ok ? ('status-ping a răspuns în ' + elapsed + ' ms') : ('status-ping a eșuat: ' + (errDetail || 'eroare necunoscută')));
    return ok;
  }

  async function checkStatusSystem(){
    // get_system_status() covers both the cron/reminder job and the
    // table-count snapshot in one call — see calendar_events_setup.sql
    // (or the migration applied directly) for its definition.
    setStatusDot('statusDotCron', 'checking');
    const { data, error } = await supabaseClient.rpc('get_system_status');
    if (error || !data) {
      document.getElementById('statusCronState').textContent = 'Eroare';
      setStatusDot('statusDotCron', 'bad');
      maybeLogStatusEvent('cron', false, 'get_system_status a eșuat: ' + (error && error.message ? error.message : 'necunoscută'));
      return;
    }
    const scheduled = !!data.cron_job_scheduled;
    const runs = data.cron_recent_runs || [];
    const lastRun = runs[0];
    document.getElementById('statusCronState').textContent = scheduled
      ? (lastRun ? (lastRun.status === 'succeeded' ? 'Activ' : 'Eroare la ultima rulare') : 'Programat, fără rulări încă')
      : 'Nu e programat';
    const cronOk = scheduled && (!lastRun || lastRun.status === 'succeeded');
    setStatusDot('statusDotCron', cronOk ? 'ok' : 'bad');
    maybeLogStatusEvent('cron', cronOk, !scheduled
      ? 'Jobul de memento-uri nu e programat'
      : (lastRun ? (lastRun.status === 'succeeded' ? 'Ultima rulare a reușit' : ('Ultima rulare a eșuat: ' + (lastRun.status || 'necunoscut'))) : 'Programat, fără rulări încă'));

    const cronCanvas = document.getElementById('statusCronChart');
    if (cronCanvas && typeof Chart !== 'undefined') {
      if (statusCronChartInstance) statusCronChartInstance.destroy();
      const ordered = runs.slice().reverse();
      statusCronChartInstance = new Chart(cronCanvas, {
        type: 'bar',
        data: {
          labels: ordered.map((_, i) => i + 1),
          datasets: [{
            data: ordered.map(r => r.status === 'succeeded' ? 1 : (r.status ? 0.15 : 0)),
            backgroundColor: ordered.map(r => r.status === 'succeeded' ? '#1E9E5A' : '#B5502F'),
            borderRadius: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { display: false, max: 1 }, x: { display: false } },
        },
      });
    }

    const counts = data.table_counts || {};
    const countsCanvas = document.getElementById('statusCountsChart');
    if (countsCanvas && typeof Chart !== 'undefined') {
      if (statusCountsChartInstance) statusCountsChartInstance.destroy();
      statusCountsChartInstance = new Chart(countsCanvas, {
        type: 'bar',
        data: {
          labels: ['Sesizări', 'Proiecte publice', 'Avarii rețele', 'Evenimente calendar', 'Dispozitive push'],
          datasets: [{
            data: [
              counts.tickets || 0, counts.current_projects || 0, counts.backlog_projects || 0,
              counts.calendar_events || 0, counts.push_subscriptions || 0,
            ],
            backgroundColor: '#D11F24',
            borderRadius: 3,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
            y: { ticks: { font: { size: 10 } } },
          },
        },
      });
    }

    checkStatusPush(counts.push_subscriptions || 0);
  }

  function checkStatusPush(deviceCount){
    setStatusDot('statusDotPush', 'checking');
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    const label = { granted: 'Permise', denied: 'Blocate', default: 'Neconfigurate', unsupported: 'Nesuportate' }[permission] || permission;
    document.getElementById('statusPushState').textContent = label;
    document.getElementById('statusPushLabel').textContent = `${deviceCount} dispozitiv${deviceCount === 1 ? '' : 'e'} înregistrat${deviceCount === 1 ? '' : 'e'}`;
    setStatusDot('statusDotPush', permission === 'granted' ? 'ok' : (permission === 'denied' ? 'bad' : 'checking'));
    maybeLogStatusEvent('push', permission === 'granted', `${label} — ${deviceCount} dispozitiv${deviceCount === 1 ? '' : 'e'} înregistrat${deviceCount === 1 ? '' : 'e'}`);
    // "Neconfigurate" just means this browser was never asked — the
    // auto-prompt (maybeAutoPromptForNotifications) only fires once,
    // automatically, for the installed PWA, never for a plain browser
    // tab. This button is the manual way to ask, from right here,
    // instead of that being unreachable outside the installed app.
    const enableBtn = document.getElementById('statusPushEnableBtn');
    if (enableBtn) enableBtn.style.display = permission === 'default' ? '' : 'none';
  }

  async function loadSystemStatus(){
    const lastCheckedEl = document.getElementById('statusLastChecked');
    if (lastCheckedEl) lastCheckedEl.textContent = 'Se verifică...';
    await Promise.all([
      checkStatusDb(),
      checkStatusAuth(),
      checkStatusFunctions(),
      checkStatusSystem(),
      loadErrorLog(),
      loadFrictionSignals(),
      loadWorkflowStats(),
      loadSearchQueries(),
    ]);
    renderChangelog();
    if (lastCheckedEl) {
      const now = new Date();
      lastCheckedEl.textContent = 'Ultima verificare: ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    }
  }

  const statusRefreshBtn = document.getElementById('statusRefreshBtn');
  if (statusRefreshBtn) statusRefreshBtn.addEventListener('click', loadSystemStatus);

  /* ============================================================
     SELF-ÎMBUNĂTĂȚIRE — jurnal de erori reale + semnale de
     fricțiune din UI (clicuri repetate, scris manual excesiv),
     afișate direct în Stare sistem. Nu e o buclă automată care își
     rescrie singură codul (prea riscant pentru un sistem live,
     folosit de personal municipal) — doar colectare + agregare a
     unor semnale concrete, ca punct de plecare pentru ce ar trebui
     îmbunătățit în continuare într-o sesiune viitoare. Golește
     fiecare eroare/semnal logat pentru a evita inundarea tabelului
     cât timp aceeași problemă se repetă rapid.
     ============================================================ */
  const recentErrorSignatures = new Map();
  const ERROR_LOG_DEDUPE_WINDOW_MS = 30000;
  async function logAppError(message, stack){
    try {
      const sig = String(message || 'Eroare necunoscută').slice(0, 300);
      const now = Date.now();
      const last = recentErrorSignatures.get(sig);
      if (last && (now - last) < ERROR_LOG_DEDUPE_WINDOW_MS) return;
      recentErrorSignatures.set(sig, now);
      await supabaseClient.from('app_error_log').insert({
        message: sig,
        stack: stack ? String(stack).slice(0, 4000) : null,
        tab: typeof currentAdminTab !== 'undefined' ? currentAdminTab : null,
        user_email: currentSessionEmail || null,
      });
    } catch (e) { /* logging must never itself crash the app */ }
  }
  window.addEventListener('error', (e) => {
    logAppError(e.message, e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    logAppError(reason && reason.message ? reason.message : String(reason), reason && reason.stack);
  });
  const origConsoleError = console.error.bind(console);
  console.error = function(...args){
    origConsoleError(...args);
    try {
      const msg = args.map(a => (a && a.message) ? a.message : (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 300);
      const withStack = args.find(a => a && a.stack);
      logAppError(msg, withStack ? withStack.stack : null);
    } catch (e) { /* ignore — never block on logging */ }
  };

  async function logFrictionSignal(signalType, targetLabel, meta){
    try {
      await supabaseClient.from('app_interaction_signals').insert({
        signal_type: signalType,
        tab: typeof currentAdminTab !== 'undefined' ? currentAdminTab : null,
        target_label: targetLabel,
        user_email: currentSessionEmail || null,
        meta: meta || {},
      });
    } catch (e) { /* ignore */ }
  }
  function frictionElementLabel(el){
    if (!el) return 'necunoscut';
    const label = (el.textContent || el.getAttribute('aria-label') || el.id || el.tagName).toString().trim().replace(/\s+/g, ' ');
    return (label || el.tagName).slice(0, 60);
  }
  // Rage clicks: 3+ clicks on the same button/link within 700ms — the
  // classic "it's not responding" or "I can't find the real button"
  // frustration signal. Throttled per element so one bad streak logs
  // one row, not a flood.
  const rageClickTracker = new Map();
  const rageClickLoggedAt = new Map();
  const RAGE_CLICK_WINDOW_MS = 700;
  const RAGE_CLICK_THRESHOLD = 3;
  const RAGE_CLICK_THROTTLE_MS = 60000;
  // Workflow tracking — tallied in memory and flushed periodically (not
  // one row per click) so "what do people click most" is answerable
  // without writing a row on every single click in the app.
  const featureClickTally = new Map();
  document.addEventListener('click', (e) => {
    const target = e.target.closest('button, a, [role="button"]');
    if (!target) return;
    const sig = frictionElementLabel(target);
    const now = Date.now();
    const tallyKey = (typeof currentAdminTab !== 'undefined' ? currentAdminTab : '') + '|' + sig;
    featureClickTally.set(tallyKey, (featureClickTally.get(tallyKey) || 0) + 1);
    const rec = rageClickTracker.get(sig);
    if (rec && (now - rec.firstTs) < RAGE_CLICK_WINDOW_MS) {
      rec.count++;
      if (rec.count >= RAGE_CLICK_THRESHOLD) {
        const lastLogged = rageClickLoggedAt.get(sig) || 0;
        if (now - lastLogged > RAGE_CLICK_THROTTLE_MS) {
          rageClickLoggedAt.set(sig, now);
          logFrictionSignal('rage_click', sig, { click_count: rec.count });
        }
        rageClickTracker.delete(sig);
      }
    } else {
      rageClickTracker.set(sig, { count: 1, firstTs: now });
    }
  }, true);
  async function flushFeatureClickTally(){
    if (featureClickTally.size === 0) return;
    const rows = Array.from(featureClickTally.entries()).map(([key, count]) => {
      const sepIdx = key.indexOf('|');
      return {
        tab: key.slice(0, sepIdx) || null,
        target_label: key.slice(sepIdx + 1),
        click_count: count,
        user_email: currentSessionEmail || null,
      };
    });
    featureClickTally.clear();
    try { await supabaseClient.from('app_feature_clicks').insert(rows); } catch (e) { /* best effort */ }
  }
  setInterval(flushFeatureClickTally, 120000);
  window.addEventListener('beforeunload', () => {
    flushFeatureClickTally();
    if (typeof currentAdminTab !== 'undefined') recordTabDwellTime(currentAdminTab);
  });

  // Tab dwell time — how long each tab stays open before switching away.
  let tabEnteredAt = Date.now();
  async function logPageView(tab, durationSeconds){
    try {
      await supabaseClient.from('app_page_views').insert({ tab, duration_seconds: Math.round(durationSeconds), user_email: currentSessionEmail || null });
    } catch (e) { /* best effort */ }
  }
  function recordTabDwellTime(prevTab){
    if (!prevTab) return;
    const seconds = (Date.now() - tabEnteredAt) / 1000;
    tabEnteredAt = Date.now();
    if (seconds < 2) return; // ignore accidental instant tab flicks
    logPageView(prevTab, seconds);
  }
  // Heavy typing: a text field that soaks up far more keystrokes than a
  // short answer would — a candidate for a picker/autocomplete/shorter
  // flow instead of free text.
  const keystrokeCounts = new WeakMap();
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if (el.type && ['checkbox', 'radio', 'button', 'submit', 'file', 'date', 'number'].includes(el.type)) return;
    keystrokeCounts.set(el, (keystrokeCounts.get(el) || 0) + 1);
  });
  document.addEventListener('blur', (e) => {
    const el = e.target;
    if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    const count = keystrokeCounts.get(el);
    if (!count) return;
    const threshold = el.tagName === 'TEXTAREA' ? 400 : 120;
    if (count >= threshold) {
      const fieldLabel = (el.closest('.ctrl-field') && el.closest('.ctrl-field').querySelector('label'))
        ? el.closest('.ctrl-field').querySelector('label').textContent
        : (el.placeholder || el.id || el.tagName);
      logFrictionSignal('heavy_typing', fieldLabel.trim().slice(0, 60), { keystrokes: count });
    }
    keystrokeCounts.delete(el);
  }, true);

  function formatLogTimeRO(iso){
    const d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function downloadJson(filename, data){
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  let lastErrorLogRows = [];
  async function loadErrorLog(){
    const listEl = document.getElementById('statusErrorList');
    if (!listEl) return;
    const { data, error } = await supabaseClient.from('app_error_log').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) { listEl.innerHTML = '<p class="status-history-empty">Jurnalul nu a putut fi încărcat.</p>'; return; }
    lastErrorLogRows = data || [];
    if (lastErrorLogRows.length === 0) { listEl.innerHTML = '<p class="status-history-empty">Nicio eroare înregistrată.</p>'; return; }
    listEl.innerHTML = lastErrorLogRows.map(row => `
      <div class="status-history-item">
        <span class="status-history-time">${formatLogTimeRO(row.created_at)}</span>
        <span class="status-history-dot"></span>
        <div>
          <div class="status-history-check">${escapeHtml(row.message || 'Eroare')}</div>
          <div class="status-history-message">${escapeHtml(row.tab || '')}${row.user_email ? ' · ' + escapeHtml(row.user_email) : ''}</div>
        </div>
      </div>
    `).join('');
  }
  const statusClearErrorsBtn = document.getElementById('statusClearErrorsBtn');
  if (statusClearErrorsBtn) statusClearErrorsBtn.addEventListener('click', async () => {
    if (!confirm('Ștergeți tot jurnalul de erori?')) return;
    const { error } = await supabaseClient.from('app_error_log').delete().gte('created_at', '1900-01-01');
    if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
    loadErrorLog();
  });
  const statusDownloadErrorsBtn = document.getElementById('statusDownloadErrorsBtn');
  if (statusDownloadErrorsBtn) statusDownloadErrorsBtn.addEventListener('click', () => {
    downloadJson(`jurnal-erori-${new Date().toISOString().slice(0, 10)}.json`, lastErrorLogRows);
  });

  let lastFrictionSignalRows = [];
  async function loadFrictionSignals(){
    const listEl = document.getElementById('statusFrictionList');
    if (!listEl) return;
    const { data, error } = await supabaseClient.from('app_interaction_signals').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) { listEl.innerHTML = '<p class="status-history-empty">Semnalele nu au putut fi încărcate.</p>'; return; }
    lastFrictionSignalRows = data || [];
    if (lastFrictionSignalRows.length === 0) { listEl.innerHTML = '<p class="status-history-empty">Niciun semnal de fricțiune înregistrat încă.</p>'; return; }
    const groups = new Map();
    lastFrictionSignalRows.forEach(row => {
      const key = row.signal_type + '|' + (row.tab || '') + '|' + (row.target_label || '');
      const g = groups.get(key) || { signal_type: row.signal_type, tab: row.tab, target_label: row.target_label, count: 0, lastSeen: row.created_at, users: new Set() };
      g.count++;
      if (row.created_at > g.lastSeen) g.lastSeen = row.created_at;
      if (row.user_email) g.users.add(row.user_email);
      groups.set(key, g);
    });
    const sorted = Array.from(groups.values()).sort((a, b) => b.count - a.count).slice(0, 20);
    listEl.innerHTML = sorted.map(g => {
      const kindLabel = g.signal_type === 'rage_click' ? 'Clicuri repetate (frustrare)' : 'Scris manual excesiv';
      const desc = g.signal_type === 'rage_click' ? `pe „${escapeHtml(g.target_label || '')}”` : `în câmpul „${escapeHtml(g.target_label || '')}”`;
      return `
        <div class="status-history-item">
          <span class="status-history-time">${formatLogTimeRO(g.lastSeen)}</span>
          <span class="status-history-dot"></span>
          <div>
            <div class="status-history-check">${kindLabel} ${desc} — ×${g.count}</div>
            <div class="status-history-message">${escapeHtml(g.tab || '')}${g.users.size ? ' · ' + g.users.size + (g.users.size === 1 ? ' utilizator' : ' utilizatori') : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  const statusDownloadFrictionBtn = document.getElementById('statusDownloadFrictionBtn');
  if (statusDownloadFrictionBtn) statusDownloadFrictionBtn.addEventListener('click', () => {
    downloadJson(`semnale-frictiune-ui-${new Date().toISOString().slice(0, 10)}.json`, lastFrictionSignalRows);
  });

  let lastPageViewRows = [];
  let lastFeatureClickRows = [];
  async function loadWorkflowStats(){
    const timeListEl = document.getElementById('statusTimeByTabList');
    const actionsListEl = document.getElementById('statusTopActionsList');
    if (!timeListEl || !actionsListEl) return;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [viewsResult, clicksResult] = await Promise.all([
      supabaseClient.from('app_page_views').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2000),
      supabaseClient.from('app_feature_clicks').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2000),
    ]);
    lastPageViewRows = viewsResult.data || [];
    lastFeatureClickRows = clicksResult.data || [];

    if (lastPageViewRows.length === 0) {
      timeListEl.innerHTML = '<p class="status-history-empty">Încă nu sunt date despre timpul petrecut pe pagini.</p>';
    } else {
      const byTab = new Map();
      lastPageViewRows.forEach(row => {
        const tabLabel = BREADCRUMB_TABS[row.tab] || row.tab || '—';
        byTab.set(tabLabel, (byTab.get(tabLabel) || 0) + Number(row.duration_seconds || 0));
      });
      const sorted = Array.from(byTab.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const maxSeconds = sorted.length ? sorted[0][1] : 1;
      timeListEl.innerHTML = sorted.map(([tabLabel, seconds]) => {
        const minutes = Math.round(seconds / 60);
        const pct = Math.max(4, Math.round((seconds / maxSeconds) * 100));
        return `
          <div class="status-history-item ok">
            <span class="status-history-time">${minutes} min</span>
            <span class="status-history-dot"></span>
            <div>
              <div class="status-history-check">${escapeHtml(tabLabel)}</div>
              <div class="status-workflow-bar"><div class="status-workflow-bar-fill" style="width:${pct}%"></div></div>
            </div>
          </div>
        `;
      }).join('');
    }

    if (lastFeatureClickRows.length === 0) {
      actionsListEl.innerHTML = '<p class="status-history-empty">Încă nu sunt date despre acțiunile folosite.</p>';
    } else {
      const byAction = new Map();
      lastFeatureClickRows.forEach(row => {
        const key = (row.tab || '—') + '|' + (row.target_label || '—');
        byAction.set(key, (byAction.get(key) || 0) + (Number(row.click_count) || 0));
      });
      const sorted = Array.from(byAction.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
      actionsListEl.innerHTML = sorted.map(([key, count]) => {
        const sepIdx = key.indexOf('|');
        const tab = key.slice(0, sepIdx);
        const label = key.slice(sepIdx + 1);
        const tabLabel = BREADCRUMB_TABS[tab] || tab;
        return `
          <div class="status-history-item ok">
            <span class="status-history-time">×${count}</span>
            <span class="status-history-dot"></span>
            <div>
              <div class="status-history-check">${escapeHtml(label)}</div>
              <div class="status-history-message">${escapeHtml(tabLabel || '')}</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
  const statusDownloadWorkflowBtn = document.getElementById('statusDownloadWorkflowBtn');
  if (statusDownloadWorkflowBtn) statusDownloadWorkflowBtn.addEventListener('click', () => {
    downloadJson(`workflow-${new Date().toISOString().slice(0, 10)}.json`, { page_views: lastPageViewRows, feature_clicks: lastFeatureClickRows });
  });

  let lastSearchQueryRows = [];
  async function loadSearchQueries(){
    const listEl = document.getElementById('statusSearchesList');
    if (!listEl) return;
    const { data, error } = await supabaseClient.from('app_interaction_signals').select('*').eq('signal_type', 'search_query').order('created_at', { ascending: false }).limit(100);
    if (error) { listEl.innerHTML = '<p class="status-history-empty">Căutările nu au putut fi încărcate.</p>'; return; }
    lastSearchQueryRows = data || [];
    if (lastSearchQueryRows.length === 0) { listEl.innerHTML = '<p class="status-history-empty">Nicio căutare înregistrată încă.</p>'; return; }
    listEl.innerHTML = lastSearchQueryRows.map(row => {
      const matched = !!(row.meta && row.meta.matched);
      return `
        <div class="status-history-item${matched ? ' ok' : ''}">
          <span class="status-history-time">${formatLogTimeRO(row.created_at)}</span>
          <span class="status-history-dot"></span>
          <div>
            <div class="status-history-check">„${escapeHtml(row.target_label || '')}”</div>
            <div class="status-history-message">${matched ? 'răspuns găsit' : 'fără răspuns'}${row.user_email ? ' · ' + escapeHtml(row.user_email) : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  const statusDownloadSearchesBtn = document.getElementById('statusDownloadSearchesBtn');
  if (statusDownloadSearchesBtn) statusDownloadSearchesBtn.addEventListener('click', () => {
    downloadJson(`cautari-acasa-${new Date().toISOString().slice(0, 10)}.json`, lastSearchQueryRows);
  });

  // Updated by hand each time a real change ships — a plain, visible
  // record of what's been built, not an automated log.
  const APP_CHANGELOG = [
    { date: '01.10.2026', text: 'Secțiunea Mașini din ERP a fost redenumită în Parc Auto.' },
    { date: '01.10.2026', text: 'ERP împărțit în Echipamente / Mașini / Materiale, cu pagină proprie de Home.' },
    { date: '01.10.2026', text: 'Stare sistem: jurnal de erori, sugestii de îmbunătățire (clicuri repetate, scris excesiv) și istoric actualizări.' },
    { date: '30.09.2026', text: 'Programe lucrări: calendar lunar complet, cu descărcare/printare și alocare pe persoană.' },
    { date: '30.09.2026', text: 'Planificare LPS legată de inventarul ERP — rezervare echipamente pe perioadă, scădere automată din stoc pentru materiale.' },
    { date: '30.09.2026', text: 'A doua bară laterală rămâne fixă, fără opțiune de restrângere.' },
  ];
  function renderChangelog(){
    const listEl = document.getElementById('statusChangelogList');
    if (!listEl) return;
    listEl.innerHTML = APP_CHANGELOG.map(entry => `
      <div class="status-history-item ok">
        <span class="status-history-time">${escapeHtml(entry.date)}</span>
        <span class="status-history-dot"></span>
        <div><div class="status-history-check">${escapeHtml(entry.text)}</div></div>
      </div>
    `).join('');
  }

  const statusPushEnableBtn = document.getElementById('statusPushEnableBtn');
  if (statusPushEnableBtn) statusPushEnableBtn.addEventListener('click', async () => {
    statusPushEnableBtn.disabled = true;
    statusPushEnableBtn.textContent = 'Se activează...';
    await subscribeToPush();
    statusPushEnableBtn.disabled = false;
    statusPushEnableBtn.textContent = 'Activează notificările';
    await checkStatusSystem(); // re-reads Notification.permission + the saved device count
  });

  // Keeps the 48h history actually filling up between visits to Stare
  // sistem, not just recording a single point every time someone opens
  // the tab. Only runs while logged in, and only while this browser tab
  // itself stays open — there's no server-side cron running these
  // particular checks, so closing the tab/browser still leaves a gap.
  setInterval(() => {
    if (currentSessionEmail && isReportFocusedView()) loadSystemStatus();
  }, 5 * 60 * 1000);

  function renderHomeMiniCal(){
    const monthEl = document.getElementById('homeMiniCalMonth');
    const gridEl = document.getElementById('homeMiniCalGrid');
    if (!monthEl || !gridEl) return;
    const now = new Date();
    const todayKey = dateKey(now);
    const year = calendarViewYear;
    const month = calendarViewMonth;
    monthEl.textContent = `${HOME_CLOCK_MONTH_NAMES[month]} ${year}`;
    const firstOfMonth = new Date(year, month, 1);
    // Monday-first week, matching the L-M-M-J-V-S-D header.
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    let html = '';
    for (let i = 0; i < startOffset; i++) {
      html += `<span class="home-mini-cal-day outside">${daysInPrevMonth - startOffset + i + 1}</span>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const thisKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEventCount = eventsOnDate(thisKey).length;
      // Capped at 4 dots — a 5th+ event on the same day would just
      // overflow the tiny cell rather than convey anything more.
      const dotsHtml = dayEventCount > 0
        ? `<span class="home-mini-cal-day-dots">${'<span class="home-mini-cal-day-dot"></span>'.repeat(Math.min(dayEventCount, 4))}</span>`
        : '';
      html += `<button type="button" class="home-mini-cal-day${thisKey === todayKey ? ' today' : ''}${dayEventCount > 0 ? ' has-events' : ''}" data-date="${thisKey}">${d}${dotsHtml}</button>`;
    }
    const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      html += `<span class="home-mini-cal-day outside">${i}</span>`;
    }
    gridEl.innerHTML = html;
    gridEl.querySelectorAll('.home-mini-cal-day[data-date]').forEach(btn => {
      btn.addEventListener('click', () => openCalendarDay(btn.dataset.date));
    });
  }

  // Reminder engine — foreground only (fires while this tab/PWA is
  // actually open and running): checks once a minute for events whose
  // reminder time just arrived, shows a toast plus a real OS
  // notification via the same service worker the ticket push
  // notifications already use. Each event only ever fires once per
  // browser (tracked here, separately from reminder_sent_at, which is
  // what the optional server-side cron dispatcher uses instead — see
  // calendar_events_setup.sql — so the two never double up or
  // conflict with each other). Declared before tickHomeClock (which
  // calls checkCalendarReminders on every tick, including its own
  // first immediate call right below) rather than after it — a
  // let/const referenced before its own declaration line has run is a
  // ReferenceError, not just undefined, so this genuinely has to come
  // first, not just anywhere earlier in the same scope.
  const CAL_REMINDER_NOTIFIED_KEY = 'insta-grup-vlas-cal-reminders-notified-v1';
  let calReminderNotifiedIds = [];
  try {
    calReminderNotifiedIds = JSON.parse(localStorage.getItem(CAL_REMINDER_NOTIFIED_KEY) || '[]');
  } catch (_) { calReminderNotifiedIds = []; }
  let lastCalReminderCheckMinute = null;
  function checkCalendarReminders(now){
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (minuteKey === lastCalReminderCheckMinute) return;
    lastCalReminderCheckMinute = minuteKey;
    calendarEvents.forEach(e => {
      if (!e.reminder_minutes_before || calReminderNotifiedIds.includes(e.id)) return;
      const start = new Date(e.start_time);
      const dueAt = new Date(start.getTime() - e.reminder_minutes_before * 60000);
      if (now >= dueAt && now < start) {
        calReminderNotifiedIds.push(e.id);
        try { localStorage.setItem(CAL_REMINDER_NOTIFIED_KEY, JSON.stringify(calReminderNotifiedIds)); } catch (_) {}
        const body = e.location || `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
        showToast(`Memento: ${e.title}`);
        const notifTitle = `Memento: ${e.title}`;
        if (swRegistration && swRegistration.showNotification) {
          swRegistration.showNotification(notifTitle, {
            body,
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
          }).catch(() => {});
        } else if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification(notifTitle, { body }); } catch (_) {}
        }
      }
    });
  }

  function tickHomeClock(){
    const timeEl = document.getElementById('homeClockTime');
    const dateEl = document.getElementById('homeClockDate');
    if (!timeEl || !dateEl) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    // Only the calendar/date label actually change minute-to-minute —
    // redrawing them every second along with the clock would just be
    // wasted work.
    if (now.getSeconds() === 0 || dateEl.textContent === '—') {
      dateEl.textContent = `${HOME_CLOCK_DAY_NAMES[now.getDay()]}, ${now.getDate()} ${HOME_CLOCK_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
      // Only snap the mini-cal's own month back to "today" on a real
      // day rollover if she's currently looking at the current month
      // anyway — never yanks her back to today while she's navigated
      // to a different month via the ‹/› buttons.
      if (calendarViewYear === now.getFullYear() && calendarViewMonth === now.getMonth()) {
        renderHomeMiniCal();
      }
      renderHomeCalToday();
    }
    checkCalendarReminders(now);
  }
  if (document.getElementById('homeClockTime')) {
    tickHomeClock();
    setInterval(tickHomeClock, 1000);
    loadCalendarEvents();
  }

  const homeMiniCalPrevBtn = document.getElementById('homeMiniCalPrevBtn');
  const homeMiniCalNextBtn = document.getElementById('homeMiniCalNextBtn');
  if (homeMiniCalPrevBtn) {
    homeMiniCalPrevBtn.addEventListener('click', () => {
      calendarViewMonth -= 1;
      if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear -= 1; }
      renderHomeMiniCal();
    });
  }
  if (homeMiniCalNextBtn) {
    homeMiniCalNextBtn.addEventListener('click', () => {
      calendarViewMonth += 1;
      if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear += 1; }
      renderHomeMiniCal();
    });
  }

  function pad2(n){ return String(n).padStart(2, '0'); }

  // An event with no explicit end_time still counts as "happening
  // now" for a 10-minute grace period past its start, rather than
  // instantly losing that state the moment the clock ticks past —
  // otherwise a quick glance right after something started would
  // make it look like it never happened.
  const EVENT_ACTIVE_GRACE_MS = 10 * 60 * 1000;
  function isEventHappeningNow(e, now){
    if (!e.start_time) return false;
    const start = new Date(e.start_time);
    const end = e.end_time ? new Date(e.end_time) : new Date(start.getTime() + EVENT_ACTIVE_GRACE_MS);
    return now >= start && now <= end;
  }

  // Shared card markup for an event, used both by the always-visible
  // "Astăzi" list under the mini-calendar and the day-detail sheet —
  // title, location, and description (not just the title), so seeing
  // an event anywhere shows what it's actually about.
  function buildCalendarEventCardHtml(e, now){
    const start = new Date(e.start_time);
    const timeLabel = e.all_day ? 'Toată ziua' : pad2(start.getHours()) + ':' + pad2(start.getMinutes());
    const activeClass = isEventHappeningNow(e, now || new Date()) ? ' happening-now' : '';
    const recurIcon = (e.recurrence_freq || e.is_recurring_occurrence) ? '🔁 ' : '';
    return `
      <div class="calendar-day-event${activeClass}" data-event-id="${e.id}">
        <div>
          <div class="calendar-day-event-title">${recurIcon}${escapeHtml(e.title)}</div>
          ${e.location ? `<div class="calendar-day-event-meta">📍 ${escapeHtml(e.location)}</div>` : ''}
          ${e.description ? `<div class="calendar-day-event-meta">${escapeHtml(e.description)}</div>` : ''}
          ${Array.isArray(e.attendees) && e.attendees.length ? `<div class="calendar-day-event-meta">👤 ${escapeHtml(e.attendees.join(', '))}</div>` : ''}
        </div>
        <span class="calendar-day-event-time">${escapeHtml(timeLabel)}</span>
      </div>
    `;
  }
  function wireCalendarEventCardClicks(container){
    container.querySelectorAll('.calendar-day-event').forEach(el => {
      el.addEventListener('click', () => {
        const ev = calendarEvents.find(e => String(e.id) === el.dataset.eventId);
        if (ev) openCalendarEventForm(ev, dateKey(new Date(ev.start_time)));
      });
    });
  }

  // "Astăzi" — every one of today's events, shown right under the
  // mini-calendar so the day's whole schedule is visible at a glance
  // without opening anything, not just the single next one.
  function renderHomeCalToday(){
    const wrap = document.getElementById('homeCalTodayList');
    if (!wrap) return;
    const now = new Date();
    const todayEvents = eventsOnDate(dateKey(now));
    if (todayEvents.length === 0) {
      wrap.innerHTML = '<div class="calendar-day-events-empty">Nicio programare azi.</div>';
      return;
    }
    wrap.innerHTML = todayEvents.map(e => buildCalendarEventCardHtml(e, now)).join('');
    wireCalendarEventCardClicks(wrap);
  }

  const homeCalAddBtn = document.getElementById('homeCalAddBtn');
  if (homeCalAddBtn) {
    homeCalAddBtn.addEventListener('click', () => openCalendarEventForm(null, dateKey(new Date())));
  }

  function openCalendarDay(dateKeyStr){
    selectedCalendarDate = dateKeyStr;
    const [y, m, d] = dateKeyStr.split('-').map(Number);
    const label = new Date(y, m - 1, d);
    document.getElementById('calendarDaySheetTitle').textContent =
      `${HOME_CLOCK_DAY_NAMES[label.getDay()]}, ${d} ${HOME_CLOCK_MONTH_NAMES[m - 1]} ${y}`;
    renderCalendarDayEvents();
    setSheetOpen('calendarDaySheet', true);
  }

  function renderCalendarDayEvents(){
    const list = document.getElementById('calendarDayEventsList');
    if (!list) return;
    const events = eventsOnDate(selectedCalendarDate);
    if (events.length === 0) {
      list.innerHTML = '<div class="calendar-day-events-empty">Nicio programare în această zi.</div>';
      return;
    }
    const now = new Date();
    list.innerHTML = events.map(e => buildCalendarEventCardHtml(e, now)).join('');
    wireCalendarEventCardClicks(list);
  }

  const calendarDayAddBtn = document.getElementById('calendarDayAddBtn');
  if (calendarDayAddBtn) {
    calendarDayAddBtn.addEventListener('click', () => openCalendarEventForm(null, selectedCalendarDate));
  }

  // Ora început defaults to a 15-minute-increment <select> — the
  // native type="time" scroll-wheel picker is what this replaces for
  // the common case. Populated once; the options never change.
  function populateCefStartTimeSelect(){
    const select = document.getElementById('cef-start-time-select');
    if (!select) return;
    let html = '';
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const val = pad2(h) + ':' + pad2(m);
        html += `<option value="${val}">${val}</option>`;
      }
    }
    select.innerHTML = html;
  }
  populateCefStartTimeSelect();

  // which: 'start' | 'end'. precise=true shows the native time input
  // (exact entry); precise=false shows the quick-pick select.
  function setCefTimeMode(which, precise){
    const selectEl = document.getElementById(which === 'start' ? 'cef-start-time-select' : 'cef-end-duration-select');
    const preciseEl = document.getElementById(which === 'start' ? 'cef-start-time' : 'cef-end-time');
    const toggleBtn = document.getElementById(which === 'start' ? 'cef-start-time-toggle' : 'cef-end-time-toggle');
    selectEl.hidden = precise;
    preciseEl.hidden = !precise;
    if (toggleBtn) toggleBtn.classList.toggle('active', precise);
  }
  // Effective current value ('HH:MM') for whichever mode is active.
  function getCefStartValue(){
    const precise = document.getElementById('cef-start-time');
    return !precise.hidden ? (precise.value || null) : document.getElementById('cef-start-time-select').value;
  }
  function getCefEndValue(dateVal, startVal){
    const precise = document.getElementById('cef-end-time');
    if (!precise.hidden) return precise.value || null;
    const duration = document.getElementById('cef-end-duration-select').value;
    if (!dateVal || !startVal || !duration) return null;
    const endDt = new Date(new Date(`${dateVal}T${startVal}`).getTime() + Number(duration) * 60000);
    return pad2(endDt.getHours()) + ':' + pad2(endDt.getMinutes());
  }

  const cefStartTimeToggle = document.getElementById('cef-start-time-toggle');
  if (cefStartTimeToggle) cefStartTimeToggle.addEventListener('click', () => {
    const precise = document.getElementById('cef-start-time');
    const willBePrecise = precise.hidden;
    if (willBePrecise && !precise.value) {
      precise.value = document.getElementById('cef-start-time-select').value;
    }
    setCefTimeMode('start', willBePrecise);
  });
  const cefEndTimeToggle = document.getElementById('cef-end-time-toggle');
  if (cefEndTimeToggle) cefEndTimeToggle.addEventListener('click', () => {
    const precise = document.getElementById('cef-end-time');
    const willBePrecise = precise.hidden;
    if (willBePrecise && !precise.value) {
      const dateVal = document.getElementById('cef-date').value;
      precise.value = getCefEndValue(dateVal, getCefStartValue()) || '';
    }
    setCefTimeMode('end', willBePrecise);
  });

  
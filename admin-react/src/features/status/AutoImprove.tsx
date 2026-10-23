import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { downloadJson, formatLogTimeRO } from '../../lib/format';

interface ErrorLogRow {
  created_at: string;
  message: string | null;
  tab: string | null;
  user_email: string | null;
}
interface FrictionRow {
  created_at: string;
  signal_type: string;
  tab: string | null;
  target_label: string | null;
  user_email: string | null;
}
interface PageViewRow {
  tab: string | null;
  duration_seconds: number | null;
}
interface FeatureClickRow {
  tab: string | null;
  target_label: string | null;
  click_count: number | null;
}
interface SearchQueryRow {
  created_at: string;
  target_label: string | null;
  user_email: string | null;
  meta: { matched?: boolean } | null;
}

const APP_CHANGELOG = [
  { date: '01.10.2026', text: 'Secțiunea Mașini din ERP a fost redenumită în Parc Auto.' },
  { date: '01.10.2026', text: 'ERP împărțit în Echipamente / Mașini / Materiale, cu pagină proprie de Home.' },
  { date: '01.10.2026', text: 'Stare sistem: jurnal de erori, sugestii de îmbunătățire (clicuri repetate, scris excesiv) și istoric actualizări.' },
  { date: '30.09.2026', text: 'Programe lucrări: calendar lunar complet, cu descărcare/printare și alocare pe persoană.' },
  { date: '30.09.2026', text: 'Planificare LPS legată de inventarul ERP — rezervare echipamente pe perioadă, scădere automată din stoc pentru materiale.' },
  { date: '30.09.2026', text: 'A doua bară laterală rămâne fixă, fără opțiune de restrângere.' },
];

export function AutoImprove() {
  const supabase = useSupabase();
  const [errors, setErrors] = useState<ErrorLogRow[]>([]);
  const [friction, setFriction] = useState<FrictionRow[]>([]);
  const [pageViews, setPageViews] = useState<PageViewRow[]>([]);
  const [featureClicks, setFeatureClicks] = useState<FeatureClickRow[]>([]);
  const [searches, setSearches] = useState<SearchQueryRow[]>([]);

  const loadErrorLog = useCallback(async () => {
    const { data } = await supabase.from('app_error_log').select('*').order('created_at', { ascending: false }).limit(50);
    setErrors(data || []);
  }, [supabase]);
  const loadFriction = useCallback(async () => {
    const { data } = await supabase.from('app_interaction_signals').select('*').order('created_at', { ascending: false }).limit(300);
    setFriction(data || []);
  }, [supabase]);
  const loadWorkflow = useCallback(async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [viewsResult, clicksResult] = await Promise.all([
      supabase.from('app_page_views').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2000),
      supabase.from('app_feature_clicks').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2000),
    ]);
    setPageViews(viewsResult.data || []);
    setFeatureClicks(clicksResult.data || []);
  }, [supabase]);
  const loadSearches = useCallback(async () => {
    const { data } = await supabase.from('app_interaction_signals').select('*').eq('signal_type', 'search_query').order('created_at', { ascending: false }).limit(100);
    setSearches(data || []);
  }, [supabase]);

  useEffect(() => {
    loadErrorLog();
    loadFriction();
    loadWorkflow();
    loadSearches();
  }, [loadErrorLog, loadFriction, loadWorkflow, loadSearches]);

  const frictionGroups = (() => {
    const groups = new Map<string, { signal_type: string; tab: string | null; target_label: string | null; count: number; lastSeen: string; users: Set<string> }>();
    friction.forEach((row) => {
      const key = `${row.signal_type}|${row.tab || ''}|${row.target_label || ''}`;
      const g = groups.get(key) || { signal_type: row.signal_type, tab: row.tab, target_label: row.target_label, count: 0, lastSeen: row.created_at, users: new Set<string>() };
      g.count++;
      if (row.created_at > g.lastSeen) g.lastSeen = row.created_at;
      if (row.user_email) g.users.add(row.user_email);
      groups.set(key, g);
    });
    return Array.from(groups.values()).sort((a, b) => b.count - a.count).slice(0, 20);
  })();

  const byTab = (() => {
    const m = new Map<string, number>();
    pageViews.forEach((row) => {
      const label = row.tab || '—';
      m.set(label, (m.get(label) || 0) + Number(row.duration_seconds || 0));
    });
    const sorted = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const max = sorted.length ? sorted[0][1] : 1;
    return { sorted, max };
  })();

  const byAction = (() => {
    const m = new Map<string, number>();
    featureClicks.forEach((row) => {
      const key = `${row.tab || '—'}|${row.target_label || '—'}`;
      m.set(key, (m.get(key) || 0) + (Number(row.click_count) || 0));
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
  })();

  return (
    <>
      <div className="status-panel-head">
        <div>
          <div className="home-eyebrow">Auto-îmbunătățire</div>
          <h2>Auto-îmbunătățire</h2>
        </div>
      </div>
      <div className="status-grid">
        <div className="status-card status-card-wide">
          <div className="status-card-head">
            <h4>Jurnal erori</h4>
            <div className="status-card-head-actions">
              <button type="button" className="btn status-card-head-btn" onClick={() => downloadJson(`jurnal-erori-${new Date().toISOString().slice(0, 10)}.json`, errors)}>
                Descarcă JSON
              </button>
              <button
                type="button"
                className="btn status-card-head-btn"
                onClick={async () => {
                  if (!confirm('Ștergeți tot jurnalul de erori?')) return;
                  const { error } = await supabase.from('app_error_log').delete().gte('created_at', '1900-01-01');
                  if (error) { alert('Eroare la ștergere. Încercați din nou.'); return; }
                  loadErrorLog();
                }}
              >
                Golește
              </button>
            </div>
          </div>
          <div className="status-history-list">
            {errors.length === 0 ? (
              <p className="status-history-empty">Nicio eroare înregistrată.</p>
            ) : (
              errors.map((row, i) => (
                <div key={i} className="status-history-item">
                  <span className="status-history-time">{formatLogTimeRO(row.created_at)}</span>
                  <span className="status-history-dot" />
                  <div>
                    <div className="status-history-check">{row.message || 'Eroare'}</div>
                    <div className="status-history-message">{row.tab || ''}{row.user_email ? ` · ${row.user_email}` : ''}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="status-card status-card-wide">
          <div className="status-card-head">
            <h4>Sugestii de îmbunătățire</h4>
            <div className="status-card-head-actions">
              <button type="button" className="btn status-card-head-btn" onClick={() => downloadJson(`semnale-frictiune-ui-${new Date().toISOString().slice(0, 10)}.json`, friction)}>
                Descarcă JSON
              </button>
            </div>
          </div>
          <p className="status-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Detectate automat din clicuri repetate pe același buton (semn de frustrare) și câmpuri unde se scrie mult de mână (candidați pentru o listă/completare automată în loc de text liber).
          </p>
          <div className="status-history-list">
            {frictionGroups.length === 0 ? (
              <p className="status-history-empty">Niciun semnal de fricțiune înregistrat încă.</p>
            ) : (
              frictionGroups.map((g, i) => {
                const kindLabel = g.signal_type === 'rage_click' ? 'Clicuri repetate (frustrare)' : 'Scris manual excesiv';
                const desc = g.signal_type === 'rage_click' ? `pe „${g.target_label || ''}”` : `în câmpul „${g.target_label || ''}”`;
                return (
                  <div key={i} className="status-history-item">
                    <span className="status-history-time">{formatLogTimeRO(g.lastSeen)}</span>
                    <span className="status-history-dot" />
                    <div>
                      <div className="status-history-check">{kindLabel} {desc} — ×{g.count}</div>
                      <div className="status-history-message">{g.tab || ''}{g.users.size ? ` · ${g.users.size} ${g.users.size === 1 ? 'utilizator' : 'utilizatori'}` : ''}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="status-card status-card-wide">
          <div className="status-card-head">
            <h4>Workflow — cum se folosește platforma</h4>
            <div className="status-card-head-actions">
              <button type="button" className="btn status-card-head-btn" onClick={() => downloadJson(`workflow-${new Date().toISOString().slice(0, 10)}.json`, { page_views: pageViews, feature_clicks: featureClicks })}>
                Descarcă JSON
              </button>
            </div>
          </div>
          <p className="status-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Timp petrecut pe fiecare pagină și acțiunile cele mai folosite, ca să se știe unde chiar contează efortul de îmbunătățire.
          </p>
          <h5 className="status-subhead">Timp petrecut pe pagini (ultimele 30 de zile)</h5>
          <div className="status-history-list">
            {byTab.sorted.length === 0 ? (
              <p className="status-history-empty">Încă nu sunt date despre timpul petrecut pe pagini.</p>
            ) : (
              byTab.sorted.map(([tabLabel, seconds]) => {
                const minutes = Math.round(seconds / 60);
                const pct = Math.max(4, Math.round((seconds / byTab.max) * 100));
                return (
                  <div key={tabLabel} className="status-history-item ok">
                    <span className="status-history-time">{minutes} min</span>
                    <span className="status-history-dot" />
                    <div>
                      <div className="status-history-check">{tabLabel}</div>
                      <div className="status-workflow-bar"><div className="status-workflow-bar-fill" style={{ width: `${pct}%` }} /></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <h5 className="status-subhead">Acțiuni cele mai folosite</h5>
          <div className="status-history-list">
            {byAction.length === 0 ? (
              <p className="status-history-empty">Încă nu sunt date despre acțiunile folosite.</p>
            ) : (
              byAction.map(([key, count]) => {
                const sepIdx = key.indexOf('|');
                const tab = key.slice(0, sepIdx);
                const label = key.slice(sepIdx + 1);
                return (
                  <div key={key} className="status-history-item ok">
                    <span className="status-history-time">×{count}</span>
                    <span className="status-history-dot" />
                    <div>
                      <div className="status-history-check">{label}</div>
                      <div className="status-history-message">{tab}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="status-card status-card-wide">
          <div className="status-card-head">
            <h4>Ce caută oamenii</h4>
            <div className="status-card-head-actions">
              <button type="button" className="btn status-card-head-btn" onClick={() => downloadJson(`cautari-acasa-${new Date().toISOString().slice(0, 10)}.json`, searches)}>
                Descarcă JSON
              </button>
            </div>
          </div>
          <p className="status-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Întrebările puse în căutarea de pe Acasă — inclusiv cele fără răspuns găsit, care arată ce lipsește din date.
          </p>
          <div className="status-history-list">
            {searches.length === 0 ? (
              <p className="status-history-empty">Nicio căutare înregistrată încă.</p>
            ) : (
              searches.map((row, i) => {
                const matched = !!row.meta?.matched;
                return (
                  <div key={i} className={`status-history-item${matched ? ' ok' : ''}`}>
                    <span className="status-history-time">{formatLogTimeRO(row.created_at)}</span>
                    <span className="status-history-dot" />
                    <div>
                      <div className="status-history-check">„{row.target_label || ''}”</div>
                      <div className="status-history-message">{matched ? 'răspuns găsit' : 'fără răspuns'}{row.user_email ? ` · ${row.user_email}` : ''}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="status-card status-card-wide">
          <div className="status-card-head">
            <h4>Istoric actualizări</h4>
          </div>
          <div className="status-history-list">
            {APP_CHANGELOG.map((entry, i) => (
              <div key={i} className="status-history-item ok">
                <span className="status-history-time">{entry.date}</span>
                <span className="status-history-dot" />
                <div><div className="status-history-check">{entry.text}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

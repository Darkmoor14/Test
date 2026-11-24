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
interface SearchQueryRow {
  created_at: string;
  target_label: string | null;
  user_email: string | null;
  meta: { matched?: boolean } | null;
}

// Hand-maintained on purpose (no "what shipped" table exists to query) --
// but that only works if it's actually kept current. Add a line here
// whenever something user-visible ships; newest first.
const APP_CHANGELOG = [
  { date: '26.10.2026', text: 'Jurnal de activitate acoperă acum și Sesizările (creare, schimbări de stare, arhivare, legături de duplicat), nu doar Proiecte/Resurse.' },
  { date: '26.10.2026', text: 'Documentație a devenit propria zonă (iconiță și rol separate), nu mai e sub meniul HR. Sincronizarea cu telefonul s-a mutat acolo.' },
  { date: '26.10.2026', text: 'Colțuri rotunjite pe tot tabloul de bord, pentru un aspect unitar.' },
  { date: '26.10.2026', text: 'Fereastra de adăugare din Resurse și inventar (Echipamente/Materiale/Produse) apare din nou și e centrată pe ecran, ca restul ferestrelor.' },
  { date: '26.10.2026', text: 'Ștergerea unui eveniment din calendar avertizează automat personalul invitat (notificare) și oferă trimiterea unui email de anulare invitaților externi.' },
  { date: '25.10.2026', text: 'Calendarul se poate sincroniza cu Apple Calendar de pe telefon (sincronizare într-un singur sens).' },
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
  const [searches, setSearches] = useState<SearchQueryRow[]>([]);

  const loadErrorLog = useCallback(async () => {
    const { data } = await supabase.from('app_error_log').select('*').order('created_at', { ascending: false }).limit(50);
    setErrors(data || []);
  }, [supabase]);
  const loadFriction = useCallback(async () => {
    const { data } = await supabase.from('app_interaction_signals').select('*').order('created_at', { ascending: false }).limit(300);
    setFriction(data || []);
  }, [supabase]);
  const loadSearches = useCallback(async () => {
    const { data } = await supabase.from('app_interaction_signals').select('*').eq('signal_type', 'search_query').order('created_at', { ascending: false }).limit(100);
    setSearches(data || []);
  }, [supabase]);

  useEffect(() => {
    loadErrorLog();
    loadFriction();
    loadSearches();
  }, [loadErrorLog, loadFriction, loadSearches]);

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

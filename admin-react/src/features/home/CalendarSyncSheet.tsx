import { useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';

// One-way sync only: Apple Calendar reads this feed, it never writes
// back. See supabase/functions/calendar-feed for the actual .ics
// generation and 20261025103110_calendar_feed_tokens.sql for the
// per-person token the feed URL is keyed on.
export function CalendarSyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const supabase = useSupabase();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setLoading(true);
    supabase.rpc('get_or_create_calendar_feed_token').then(({ data, error }) => {
      setLoading(false);
      if (error) { console.error(error); return; }
      setToken(data as string);
    });
  }, [open, supabase]);

  if (!open) return null;

  const baseUrl = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl || 'https://ebuigyyjifnjiuzsgpih.supabase.co';
  const httpsUrl = token ? `${baseUrl}/functions/v1/calendar-feed?token=${token}` : '';
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');

  const copyLink = async () => {
    if (!httpsUrl) return;
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Nu s-a putut copia. Selectează linkul manual.');
    }
  };

  const regenerate = async () => {
    if (!confirm('Linkul vechi va înceta să mai funcționeze — trebuie adăugat din nou pe telefon/Mac. Continui?')) return;
    setRegenerating(true);
    const { data, error } = await supabase.rpc('regenerate_calendar_feed_token');
    setRegenerating(false);
    if (error) { console.error(error); alert('Regenerarea a eșuat. Încearcă din nou.'); return; }
    setToken(data as string);
    setCopied(false);
  };

  return (
    <div id="calendarSyncSheet" className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="calendarSyncSheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div>
              <h3 id="calendarSyncSheetTitle">Sincronizează cu telefonul</h3>
              <p>Evenimentele tale apar automat în Apple Calendar. Editarea unui eveniment pe telefon nu se întoarce aici — sincronizarea merge într-un singur sens.</p>
            </div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
          </div>

          {loading && <p className="cef-attendees-empty">Se generează linkul…</p>}

          {!loading && token && (
            <>
              <div className="ctrl-field">
                <label>Link abonament calendar</label>
                <div className="cal-sync-link-row">
                  <input type="text" readOnly value={httpsUrl} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn" onClick={copyLink}>{copied ? 'Copiat ✓' : 'Copiază'}</button>
                </div>
              </div>

              <div className="cal-sync-steps">
                <div className="cal-sync-step">
                  <span className="cal-sync-step-label">Pe iPhone/iPad</span>
                  <p>Reglaje → Calendar → Conturi → Adaugă cont → Altul → Adaugă calendar abonat → lipește linkul.</p>
                </div>
                <div className="cal-sync-step">
                  <span className="cal-sync-step-label">Pe Mac</span>
                  <p>Aplicația Calendar → Fișier → Abonare nou calendar → lipește linkul.</p>
                </div>
              </div>
              <p className="cef-attendees-hint">
                <a href={webcalUrl}>Deschide direct pe acest dispozitiv</a> (funcționează doar dacă ești pe telefonul/Mac-ul pe care vrei să adaugi calendarul).
              </p>

              <div className="ctrl-field">
                <button type="button" className="btn" disabled={regenerating} onClick={regenerate}>
                  {regenerating ? 'Se regenerează…' : 'Regenerează linkul'}
                </button>
                <p className="cef-attendees-hint">Folosește asta dacă linkul a ajuns la cineva din greșeală — cel vechi încetează imediat să mai funcționeze.</p>
              </div>
            </>
          )}

          <div className="sheet-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>Gata</button>
          </div>
        </div>
      </div>
    </div>
  );
}

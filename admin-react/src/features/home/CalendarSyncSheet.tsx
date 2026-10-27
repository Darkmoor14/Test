import { useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';

declare global {
  interface Window {
    openCalendarSync?: () => void;
  }
}

// Two ways to get Acasă's events onto a phone, both keyed on the same
// per-person token (20261025103110_calendar_feed_tokens.sql) so there's
// only ever one secret to show/regenerate:
//   - CalDAV (supabase/functions/calendar-dav) -- a real account added
//     to the phone's own Calendar app, two-way: editing or adding an
//     event on the phone writes back here, same as the PC. Native on
//     iOS; Android has no built-in CalDAV, so it needs a third-party
//     client (DAVx⁵) to bridge it into the phone's own Calendar app.
//   - The original subscribe-only link (supabase/functions/calendar-feed)
//     -- Apple Calendar reads it, but a subscribed calendar is
//     read-only by design in iOS/macOS; editing on the phone never
//     comes back here. Kept as the simpler option for anyone who just
//     wants to SEE events on their phone without setting up a second
//     account.
// Lives in SharedSheetsRoot (mounted once, independent of any one
// panel) and opened via window.openCalendarSync -- its trigger button
// is on the Documentație page now, not Acasă's calendar card.
export function CalendarSyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const supabase = useSupabase();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [mode, setMode] = useState<'caldav' | 'feed'>('caldav');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCopiedField(null);
    setLoading(true);
    Promise.all([
      supabase.rpc('get_or_create_calendar_feed_token'),
      supabase.auth.getSession(),
    ]).then(([tokenRes, sessionRes]) => {
      setLoading(false);
      if (tokenRes.error) { console.error(tokenRes.error); return; }
      setToken(tokenRes.data as string);
      setEmail(sessionRes.data.session?.user.email ?? null);
    });
  }, [open, supabase]);

  if (!open) return null;

  const baseUrl = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl || 'https://ebuigyyjifnjiuzsgpih.supabase.co';
  const davUrl = `${baseUrl}/functions/v1/calendar-dav/`;
  // iOS/Android's "Server" field in a CalDAV account wants host+path, no
  // scheme -- shown and copied without "https://" so pasting it in just
  // works, rather than asking the person to hand-edit what they copied
  // (which silently breaks the connection if they paste it as-is).
  const davHost = davUrl.replace(/^https?:\/\//, '');
  const httpsUrl = token ? `${baseUrl}/functions/v1/calendar-feed?token=${token}` : '';
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');

  const copy = async (field: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 2000);
    } catch {
      alert('Nu s-a putut copia. Selectează textul manual.');
    }
  };

  const regenerate = async () => {
    if (!confirm('Parola/linkul vechi vor înceta să mai funcționeze — contul CalDAV și abonamentul vechi trebuie reconfigurate pe telefon/Mac. Continui?')) return;
    setRegenerating(true);
    const { data, error } = await supabase.rpc('regenerate_calendar_feed_token');
    setRegenerating(false);
    if (error) { console.error(error); alert('Regenerarea a eșuat. Încearcă din nou.'); return; }
    setToken(data as string);
    setCopiedField(null);
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
              <p>{mode === 'caldav'
                ? 'Cont de calendar complet — adaugi sau editezi un eveniment pe telefon și apare și aici, nu doar invers.'
                : 'Evenimentele tale apar automat pe telefon, dar doar într-un singur sens — editarea unui eveniment pe telefon nu se întoarce aici.'}</p>
            </div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
          </div>

          <div className="ticket-type-switch" style={{ marginBottom: 14 }}>
            <button type="button" className={`ticket-type-switch-btn${mode === 'caldav' ? ' active' : ''}`} onClick={() => setMode('caldav')}>Sincronizare completă</button>
            <button type="button" className={`ticket-type-switch-btn${mode === 'feed' ? ' active' : ''}`} onClick={() => setMode('feed')}>Doar vizualizare</button>
          </div>

          {loading && <p className="cef-attendees-empty">Se generează datele de conectare…</p>}

          {!loading && token && mode === 'caldav' && (
            <>
              <div className="ctrl-field">
                <label>Adresă server</label>
                <div className="cal-sync-link-row">
                  <input type="text" readOnly value={davHost} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn" onClick={() => copy('url', davHost)}>{copiedField === 'url' ? 'Copiat ✓' : 'Copiază'}</button>
                </div>
              </div>
              <div className="ctrl-field">
                <label>Utilizator</label>
                <div className="cal-sync-link-row">
                  <input type="text" readOnly value={email || ''} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn" onClick={() => copy('user', email || '')}>{copiedField === 'user' ? 'Copiat ✓' : 'Copiază'}</button>
                </div>
              </div>
              <div className="ctrl-field">
                <label>Parolă</label>
                <div className="cal-sync-link-row">
                  <input type="text" readOnly value={token} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn" onClick={() => copy('pass', token)}>{copiedField === 'pass' ? 'Copiat ✓' : 'Copiază'}</button>
                </div>
              </div>

              <div className="cal-sync-steps">
                <div className="cal-sync-step">
                  <span className="cal-sync-step-label">Pe iPhone/iPad</span>
                  <p>Reglaje → Calendar → Conturi → Adaugă cont → Altul → Adaugă cont CalDAV → copiază exact cele trei câmpuri de mai sus, fără sǎ le modifici (adresa de server e deja fără „https://" — nu adăuga nimic în plus).</p>
                </div>
                <div className="cal-sync-step">
                  <span className="cal-sync-step-label">Pe Mac</span>
                  <p>Reglaje sistem → Conturi de internet → Adaugă cont → Altul → Cont CalDAV → Tip cont: Avansat → copiază exact cele trei câmpuri de mai sus (Adresă server = câmpul de mai sus, neschimbat).</p>
                </div>
                <div className="cal-sync-step">
                  <span className="cal-sync-step-label">Pe Android</span>
                  <p>Instalează <strong>DAVx⁵</strong> din Play Store → Adaugă cont → Login with URL and user name → la Base URL adaugă <strong>https://</strong> înainte de adresa de server copiată mai sus (DAVx⁵ cere adresa completă, cu „https://"), apoi Utilizator și Parolă ca mai sus → activează sincronizarea calendarului din contul creat, apoi adaugă-l și în aplicația Calendar/Google Calendar de pe telefon dacă nu apare automat.</p>
                </div>
              </div>
              <p className="cef-attendees-hint">
                Editarea unui eveniment pe care altcineva l-a creat (ești doar invitat) rămâne needitabilă și din telefon — poți doar vedea, exact ca aici.
              </p>
            </>
          )}

          {!loading && token && mode === 'feed' && (
            <>
              <div className="ctrl-field">
                <label>Link abonament calendar</label>
                <div className="cal-sync-link-row">
                  <input type="text" readOnly value={httpsUrl} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn" onClick={() => copy('feed', httpsUrl)}>{copiedField === 'feed' ? 'Copiat ✓' : 'Copiază'}</button>
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
            </>
          )}

          {!loading && token && (
            <div className="ctrl-field">
              <button type="button" className="btn" disabled={regenerating} onClick={regenerate}>
                {regenerating ? 'Se regenerează…' : 'Regenerează parola/linkul'}
              </button>
              <p className="cef-attendees-hint">Folosește asta dacă a ajuns la cineva din greșeală — varianta veche (cont CalDAV și link de abonament deopotrivă) încetează imediat să mai funcționeze.</p>
            </div>
          )}

          <div className="sheet-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>Gata</button>
          </div>
        </div>
      </div>
    </div>
  );
}

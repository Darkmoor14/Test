import { useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { formatLogTimeRO } from '../../lib/format';

declare global {
  interface Window {
    openEntityLogSheet?: (entityType: string, entityId: string, title: string) => void;
  }
}

interface EntityLogRow {
  id: string;
  kind: 'activity' | 'note';
  text: string;
  user_email: string | null;
  created_at: string;
}

export interface EntityLogSheetState {
  type: string;
  id: string;
  title: string;
}

// Shared "Istoric" sheet for Proiecte/Avarii/ERP/LPS look-ahead items --
// one table (entity_log) holding both automatic activity entries and
// human notes, shown together as one timeline. Mounted once (see
// SharedSheetsRoot) and driven entirely through window.openEntityLogSheet
// so vanilla code (LPS, Parc Auto -- both still vanilla for now) can
// open it exactly like any React caller.
export function EntityLogSheet({ current, onClose, sessionEmail }: { current: EntityLogSheetState | null; onClose: () => void; sessionEmail: string | null }) {
  const supabase = useSupabase();
  const [rows, setRows] = useState<EntityLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async (type: string, id: string) => {
    setLoading(true);
    const { data, error } = await supabase.from('entity_log').select('*')
      .eq('entity_type', type).eq('entity_id', id)
      .order('created_at', { ascending: false }).limit(100);
    setLoading(false);
    if (error) { setRows([]); return; }
    setRows((data as EntityLogRow[]) || []);
  };

  useEffect(() => {
    if (current) { setNoteText(''); load(current.type, current.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.type, current?.id]);

  if (!current) return null;

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setSaving(true);
    const { error } = await supabase.from('entity_log').insert({
      entity_type: current.type, entity_id: current.id, kind: 'note', text, user_email: sessionEmail || null,
    });
    setSaving(false);
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
    setNoteText('');
    load(current.type, current.id);
  };

  return (
    <div className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="entityLogSheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div><h3 id="entityLogSheetTitle">Istoric — {current.title}</h3></div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
          </div>
          <div className="entity-log-list">
            {loading ? (
              <p className="status-history-empty">Se încarcă…</p>
            ) : rows.length === 0 ? (
              <p className="status-history-empty">Niciun eveniment încă.</p>
            ) : rows.map((row) => (
              <div key={row.id} className={`entity-log-item ${row.kind}`}>
                <span className="entity-log-time">{formatLogTimeRO(row.created_at)}</span>
                <div>
                  <div className="entity-log-text">{row.text}</div>
                  {row.user_email && <div className="entity-log-author">{row.user_email}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="entity-log-add">
            <textarea rows={2} placeholder="Adaugă o notiță…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={saving} onClick={addNote}>Adaugă notiță</button>
          </div>
        </div>
      </div>
    </div>
  );
}

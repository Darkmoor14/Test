import { useEffect, useRef, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { saveChecklist, type ChecklistTable } from '../../lib/dataServices';

declare global {
  interface Window {
    openChecklistSheet?: (table: string, id: string, items: ChecklistItem[], onSaved?: () => void) => void;
  }
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface ChecklistSheetState {
  table: string;
  id: string;
  items: ChecklistItem[];
  onSaved?: () => void;
}

// A simple JSON array column ({text, done}) saved whole on every change
// -- same simplicity tradeoff the vanilla version made (fine as long as
// one person edits a given list at a time). Shared by Proiecte/Avarii/
// Echipamente-Materiale-Produse (React) and LPS look-ahead items
// (vanilla, via window.openChecklistSheet).
export function ChecklistSheet({ current, onClose }: { current: ChecklistSheetState | null; onClose: () => void }) {
  const supabase = useSupabase();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (current) {
      setItems(current.items);
      savingRef.current = false;
      setSaving(false);
      setNewItemText('');
    }
  }, [current]);

  if (!current) return null;

  const persist = async (next: ChecklistItem[]) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    let errorMessage = '';
    try {
      const result = await saveChecklist(supabase, current.table as ChecklistTable, current.id, next);
      errorMessage = result.error?.message || '';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (errorMessage) {
      console.error('Checklist save failed:', errorMessage);
      alert('Lista nu a fost salvată. Verificați conexiunea și încercați din nou.');
      return false;
    }
    setItems(next);
    current.onSaved?.();
    return true;
  };

  const toggle = (i: number) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it));
    persist(next);
  };
  const remove = (i: number) => {
    const next = items.filter((_, idx) => idx !== i);
    persist(next);
  };
  const add = () => {
    const text = newItemText.trim();
    if (!text) return;
    void persist([...items, { text, done: false }]).then((saved) => { if (saved) setNewItemText(''); });
  };

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={saving ? undefined : onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="checklistSheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div><h3 id="checklistSheetTitle">Listă de verificare{items.length ? ` (${doneCount}/${items.length})` : ''}</h3></div>
            <button type="button" className="sheet-close" aria-label="Închide" disabled={saving} onClick={onClose}>×</button>
          </div>
          <div className="checklist-items">
            {items.length === 0 ? (
              <p className="status-history-empty">Nicio verificare adăugată încă.</p>
            ) : items.map((item, i) => (
              <div key={i} className={`checklist-item${item.done ? ' done' : ''}`}>
                <input type="checkbox" disabled={saving} checked={item.done} onChange={() => toggle(i)} />
                <span className="checklist-item-text">{item.text}</span>
                <button type="button" className="checklist-item-remove" aria-label="Șterge" disabled={saving} onClick={() => remove(i)}>×</button>
              </div>
            ))}
          </div>
          <div className="checklist-add">
            <input
              type="text" placeholder="Element nou…" value={newItemText}
              disabled={saving}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            />
            <button type="button" className="btn" disabled={saving} onClick={add}>+ Adaugă</button>
          </div>
        </div>
      </div>
    </div>
  );
}

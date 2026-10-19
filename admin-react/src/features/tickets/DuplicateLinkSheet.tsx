import { useEffect, useState } from 'react';
import { useTickets } from './TicketsContext';
import type { Ticket } from './types';

declare global {
  interface Window { showToast?: (message: string) => void; }
}
function showToast(message: string) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

export function DuplicateLinkSheet() {
  const store = useTickets();
  const sheet = store.duplicateSheet;
  const isAnchorMode = !!sheet?.excludeTicketId;
  const excludeTicketId = sheet?.excludeTicketId ?? null;
  const [query, setQuery] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sheet) { setQuery(''); setCheckedIds(new Set()); }
  }, [sheet]);

  if (!sheet) return null;

  const anchorTicket = isAnchorMode ? store.tickets.find((t) => t.id === excludeTicketId) : null;

  const toggleChecked = (id: string) => setCheckedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const close = () => store.setDuplicateSheet(null);

  const matches: Ticket[] = (() => {
    const rawQuery = query.trim();
    if (!rawQuery) {
      if (!isAnchorMode && store.selectedIds.size > 0) {
        const preselected = store.tickets.filter((t) => store.selectedIds.has(t.id) && !t.duplicate_of);
        if (preselected.length > 0) return preselected;
      }
      return [];
    }
    const terms = rawQuery.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return store.tickets.filter((t) =>
      t.id !== excludeTicketId && !t.duplicate_of &&
      terms.some((term) => (t.ticket_number || '').toLowerCase().includes(term) || (t.address || '').toLowerCase().includes(term)),
    ).slice(0, 20);
  })();

  const finalizePick = async (canonicalId: string) => {
    const extraIds = Array.from(checkedIds).filter((id) => id !== canonicalId);
    await runFinalize(canonicalId, extraIds);
  };

  const runFinalize = async (canonicalId: string, extraIds: string[]) => {
    if (extraIds.length === 0) return;
    const canonicalTicket = store.tickets.find((t) => t.id === canonicalId);
    const dupNumbers = extraIds.map((id) => store.tickets.find((t) => t.id === id)?.ticket_number).filter(Boolean).join(', ');
    if (!confirm(`Legi ${extraIds.length} sesizări (${dupNumbers}) ca duplicate ale ${canonicalTicket ? canonicalTicket.ticket_number : 'acesteia'}?`)) return;
    setBusy(true);
    const { error } = await store.markDuplicates(canonicalId, extraIds);
    setBusy(false);
    if (error) { console.error(error); alert('Eroare la marcarea ca duplicat. Încercați din nou.'); return; }
    showToast(extraIds.length === 1 ? 'Sesizarea a fost marcată ca duplicat.' : `${extraIds.length} sesizări au fost marcate ca duplicate.`);
    store.clearSelection();
    close();
    await store.reload();
  };

  const handleAnchorConfirm = async () => {
    if (checkedIds.size === 0 || !excludeTicketId) return;
    await runFinalize(excludeTicketId, Array.from(checkedIds));
  };

  return (
    <div className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={close} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="duplicateLinkSheetTitle">
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div>
            <h3 id="duplicateLinkSheetTitle">{isAnchorMode ? 'Leagă duplicate' : 'Marchează ca duplicate'}</h3>
            <p>
              {isAnchorMode
                ? `Bifează sesizările duplicate ale ${anchorTicket ? anchorTicket.ticket_number : 'acesteia'}, apoi apasă Confirmă.`
                : 'Apasă "Alege" pe cea originală — cea pe care o ții. Nu e niciuna dintre cele bifate? Caută alta (nr. tichet sau adresă).'}
            </p>
          </div>
          <button type="button" className="sheet-close" aria-label="Închide" onClick={close}>×</button>
        </div>
        <input
          type="search" className="duplicate-link-search" autoFocus
          placeholder="Nr. tichet sau adresă… (desparte prin virgulă pentru mai multe)"
          value={query} onChange={(e) => setQuery(e.target.value)}
        />
        <div className="duplicate-link-results">
          {matches.length === 0 ? (
            <div className="no-results">{query.trim() ? 'Nicio sesizare găsită.' : 'Scrie pentru a căuta…'}</div>
          ) : matches.map((t) => isAnchorMode ? (
            <div key={t.id} className={`duplicate-link-result-item${checkedIds.has(t.id) ? ' checked' : ''}`} onClick={() => toggleChecked(t.id)}>
              <label className="duplicate-link-result-checkwrap" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="duplicate-link-result-check" checked={checkedIds.has(t.id)} onChange={() => toggleChecked(t.id)} aria-label="Bifează ca duplicat" />
              </label>
              <span className="duplicate-link-result-pickbtn">
                <span className="duplicate-link-result-num">{t.ticket_number || '—'}</span>
                <span className="duplicate-link-result-address">{t.address || '—'}</span>
              </span>
            </div>
          ) : (
            <div key={t.id} className={`duplicate-link-result-item${checkedIds.has(t.id) ? ' checked' : ''}`}>
              <label className="duplicate-link-result-checkwrap">
                <input type="checkbox" className="duplicate-link-result-check" checked={checkedIds.has(t.id)} onChange={() => toggleChecked(t.id)} aria-label="Bifează ca duplicat suplimentar" />
              </label>
              <button type="button" className="duplicate-link-result-pickbtn" onClick={() => finalizePick(t.id)}>
                <span className="duplicate-link-result-num">{t.ticket_number || '—'}</span>
                <span className="duplicate-link-result-address">{t.address || '—'}</span>
                <span className="duplicate-link-result-pick">Alege</span>
              </button>
            </div>
          ))}
        </div>
        {!isAnchorMode && checkedIds.size > 0 && (
          <div className="duplicate-link-extra-count">
            {checkedIds.size === 1
              ? '1 sesizare bifată — apasă pe cea originală ca să le legi pe amândouă.'
              : `${checkedIds.size} sesizări bifate — apasă pe cea originală ca să le legi pe toate.`}
          </div>
        )}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={close}>Anulează</button>
          {isAnchorMode && (
            <button type="button" className="btn btn-primary" disabled={checkedIds.size === 0 || busy} onClick={handleAnchorConfirm}>Confirmă</button>
          )}
        </div>
      </div>
    </div>
  );
}

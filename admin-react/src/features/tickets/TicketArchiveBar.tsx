import { useTickets } from './TicketsContext';

export function TicketArchiveBar() {
  const store = useTickets();
  const count = store.selectedIds.size;
  if (count === 0) return null;
  const minDuplicateSelection = typeof window !== 'undefined' && window.innerWidth <= 600 ? 1 : 2;
  return (
    <div className="archive-bar show">
      <span>{count} selectate</span>
      <button className="btn" type="button" onClick={store.clearSelection}>Anulează selecția</button>
      {count === 1 && <button className="btn" type="button" onClick={store.startEditSelected}>Editează</button>}
      {count >= minDuplicateSelection && (
        <button className="btn" type="button" onClick={() => store.setDuplicateSheet({ excludeTicketId: null })}>Marchează ca duplicate</button>
      )}
      <button className="btn btn-primary" type="button" onClick={store.archiveSelected}>Arhivează selectate</button>
    </div>
  );
}

export function ActiveNarrowFilterBanner() {
  const store = useTickets();
  if (!store.agingOnlyFilter && !store.typeOnlyFilter) return null;
  const text = store.agingOnlyFilter
    ? 'Filtru activ: doar tichete deschise de peste 7 zile'
    : store.typeOnlyFilter === 'functional' ? 'Filtru activ: doar tichete cu defect' : 'Filtru activ: doar accidente';
  return (
    <div className="active-narrow-filter show">
      <span>{text}</span>
      <button type="button" onClick={store.clearNarrowFilter}>✕ Elimină acest filtru</button>
    </div>
  );
}

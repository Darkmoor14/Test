import { useProjects } from './ProjectsContext';
import { WorkOrderForm } from './WorkOrderForm';
import { WorkOrdersCalendar } from './WorkOrdersCalendar';
import { formatWoDateRO } from './projectUtils';
import type { WorkOrder } from './types';

function WorkOrderRow({ w }: { w: WorkOrder }) {
  const store = useProjects();
  const isDone = w.status === 'Finalizat';
  const isCancelled = w.status === 'Anulat';
  const dateLabel = formatWoDateRO(w.scheduled_date) + (w.scheduled_end_date ? ` – ${formatWoDateRO(w.scheduled_end_date)}` : '');
  return (
    <div className={`backlog-row${isDone ? ' done' : ''}`}>
      <div className="backlog-main">
        <div className="backlog-title-line">
          <span className="backlog-title">{w.title}</span>
          <span className="backlog-tag">{w.status}</span>
          <span className="backlog-days">{dateLabel}</span>
        </div>
        <div className="backlog-meta-line">{w.location || ''}{w.crew ? ` · ${w.crew}` : ''}{w.description ? ` · ${w.description}` : ''}</div>
      </div>
      <div className="backlog-actions">
        <button type="button" className="btn wo-edit" onClick={() => store.openWorkOrderForm(w)}>Editează</button>
        {!isDone && !isCancelled && <button type="button" className="btn btn-primary wo-status" onClick={() => store.markWorkOrderDone(w)}>Finalizat</button>}
        <button type="button" className="btn wo-delete" onClick={() => store.deleteWorkOrder(w)}>Șterge</button>
      </div>
    </div>
  );
}

export function WorkOrdersPanel() {
  const store = useProjects();
  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="result-count">{store.workOrders.length} {store.workOrders.length === 1 ? 'programare' : 'programări'}</div>
        </div>
        <button type="button" className="btn btn-primary" data-requires-write="proiecte" onClick={() => store.openWorkOrderForm(null)}>+ Programare nouă</button>
      </div>
      <WorkOrdersCalendar />
      <WorkOrderForm />
      <h3 className="wo-list-heading">Toate programările</h3>
      <div className="backlog-list">
        {store.workOrders.length === 0 ? (
          <div className="no-results" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-400)' }}>Nicio lucrare programată.</div>
        ) : (
          store.workOrders.map((w) => <WorkOrderRow key={w.id} w={w} />)
        )}
      </div>
    </>
  );
}

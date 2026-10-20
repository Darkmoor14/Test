import { useErp } from './ErpContext';
import { ERP_CATEGORY_LABEL, EQUIPMENT_STATUS_CYCLE, EQUIPMENT_STATUS_LABEL, formatWoDateRO, isLowStock } from './erpUtils';
import type { EquipmentItem } from './types';

export function EquipmentRow({ eq }: { eq: EquipmentItem }) {
  const store = useErp();
  const isEquipment = eq.item_type === 'echipament';
  const erpCategory = eq.erp_category || (isEquipment ? 'echipament' : 'material');
  const qtyLabel = !isEquipment && eq.quantity != null ? `${Number(eq.quantity)}${eq.unit ? ` ${eq.unit}` : ''}` : '';
  const lowStock = isLowStock(eq);
  const myAssignments = store.resourceAssignments.filter((a) => a.inventory_item_id === eq.id && a.status === 'reserved');
  let reservationNote = '';
  if (isEquipment && myAssignments.length) {
    reservationNote = `Rezervat: ${myAssignments.map((a) => `${formatWoDateRO(a.reserved_from)}–${formatWoDateRO(a.reserved_to)}`).join(', ')}`;
  } else if (!isEquipment && myAssignments.length) {
    const reservedTotal = myAssignments.reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
    reservationNote = `${reservedTotal}${eq.unit ? ` ${eq.unit}` : ''} rezervat pe proiecte neterminate`;
  }

  return (
    <div id={`equipment-row-${eq.id}`} className={`backlog-row${eq.status === 'Indisponibil' ? ' done' : ''}`}>
      <div className="backlog-main">
        <div className="backlog-title-line">
          <span className="backlog-title">{eq.name}</span>
          <span className={`backlog-tag erp-type-tag ${erpCategory}`}>{ERP_CATEGORY_LABEL[erpCategory]}</span>
          <span className="backlog-tag">{EQUIPMENT_STATUS_LABEL[eq.status] || eq.status}</span>
          {lowStock && <span className="backlog-tag erp-warning-tag">⚠ Stoc redus</span>}
          {qtyLabel && <span className="backlog-days">{qtyLabel}</span>}
        </div>
        <div className="backlog-meta-line">{eq.category || ''}{eq.location ? ` · ${eq.location}` : ''}{eq.assigned_to ? ` · alocat: ${eq.assigned_to}` : ''}{eq.serial_number ? ` · SN ${eq.serial_number}` : ''}</div>
        {reservationNote && <div className="backlog-meta-line erp-reservation-note">ⓘ {reservationNote}</div>}
      </div>
      <div className="backlog-actions">
        <button type="button" className="btn eq-edit" data-requires-write="erp" onClick={() => store.openForm(eq)}>Editează</button>
        <button type="button" className="btn btn-primary eq-status" data-requires-write="erp" onClick={() => store.cycleStatus(eq)}>{EQUIPMENT_STATUS_LABEL[EQUIPMENT_STATUS_CYCLE[eq.status]] || 'Schimbă starea'}</button>
        {(erpCategory === 'material' || erpCategory === 'produs') && (
          <button type="button" className="btn eq-ledger" onClick={() => window.openStockLedgerSheet?.(eq.id, eq.name)}>Jurnal stoc</button>
        )}
        <button type="button" className="btn eq-delete" data-requires-write="erp" onClick={() => store.deleteItem(eq)}>Șterge</button>
      </div>
    </div>
  );
}

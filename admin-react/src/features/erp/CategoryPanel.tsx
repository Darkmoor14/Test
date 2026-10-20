import { useErp } from './ErpContext';
import { EquipmentRow } from './EquipmentRow';
import type { NonVehicleCategory } from './types';

const CATEGORY_META: Record<NonVehicleCategory, { emptyMsg: string }> = {
  echipament: { emptyMsg: 'Niciun echipament înregistrat.' },
  material: { emptyMsg: 'Niciun material înregistrat.' },
  produs: { emptyMsg: 'Niciun produs înregistrat.' },
};

export function CategoryPanel({ category }: { category: NonVehicleCategory }) {
  const store = useErp();
  const items = store.itemsByCategory(category);
  const meta = CATEGORY_META[category];
  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="result-count">{items.length} {items.length === 1 ? 'element' : 'elemente'}</div>
        </div>
      </div>
      <div className="backlog-list">
        {items.length === 0 ? (
          <div className="no-results" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-400)' }}>{meta.emptyMsg}</div>
        ) : (
          items.map((eq) => <EquipmentRow key={eq.id} eq={eq} />)
        )}
      </div>
    </>
  );
}

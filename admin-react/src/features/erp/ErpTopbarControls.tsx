import { useErp } from './ErpContext';
import { ERP_ITEM_FORM_TITLE } from './erpUtils';
import type { NonVehicleCategory } from './types';

// Icon-only, moved up into the shared topbar-actions row (same spot
// Sesizări's own add/filter/search icons live) instead of each
// category's own inline .toolbar text button -- consistent placement
// across every Resurse tab, same as everywhere else in the app.
export function AddItemButton({ category }: { category: NonVehicleCategory }) {
  const store = useErp();
  const label = `Adaugă ${ERP_ITEM_FORM_TITLE[category]}`;
  return (
    <button type="button" className="overview-icon-btn add-btn" data-requires-write="erp" title={label} aria-label={label} onClick={() => store.openForm(null, category)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    </button>
  );
}

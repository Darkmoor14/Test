import { useErp } from './ErpContext';
import { expiredDocNames, hasExpiredDocs, isLowStock } from './erpUtils';
import type { EquipmentItem } from './types';

declare global {
  interface Window {
    openAdminTab?: (tabKey: string) => void;
    goToVehicle?: (eq: EquipmentItem) => void;
  }
}
function goToTab(tab: string) {
  window.openAdminTab?.(tab);
}
// Mirrors goToVehicle (erp.js, still vanilla for Parc Auto): switch to
// the item's own tab, then scroll to and highlight its row there — a
// click on an alert goes straight to the item, not just the tab.
function goToItem(eq: EquipmentItem, tab: string) {
  window.openAdminTab?.(tab);
  requestAnimationFrame(() => {
    const row = document.getElementById('equipment-row-' + eq.id);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('jump-highlight');
      setTimeout(() => row.classList.remove('jump-highlight'), 1800);
    }
  });
}

export function ErpHomePanel() {
  const store = useErp();
  const counts = { echipament: 0, masina: 0, material: 0, produs: 0 } as Record<string, number>;
  store.equipment.forEach((eq) => {
    const cat = eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material');
    // The diesel reservoir lives under erp_category 'masina' but isn't a
    // vehicle to count alongside them -- same exclusion as erp.js's
    // machinesFilterCounts() for Parc Auto's own table/cards.
    if (cat === 'masina' && eq.category === 'rezervor') return;
    if (counts[cat] != null) counts[cat]++;
  });
  const lowStockItems = store.equipment.filter(isLowStock);
  const expiredDocsItems = store.equipment.filter(hasExpiredDocs);
  const hasAlerts = lowStockItems.length > 0 || expiredDocsItems.length > 0;

  return (
    <>
      <div className="priority-grid">
        <button type="button" className="priority-card" onClick={() => goToTab('equipment')}>
          <span className="k">● Echipamente</span>
          <div className="num">{counts.echipament}</div>
          <div className="sub">Scule și utilaje mici</div>
        </button>
        <button type="button" className="priority-card" onClick={() => goToTab('machines')}>
          <span className="k">◆ Parc Auto</span>
          <div className="num">{counts.masina}</div>
          <div className="sub">Utilaje grele și transport</div>
        </button>
        <button type="button" className="priority-card" onClick={() => goToTab('materials')}>
          <span className="k">■ Materiale</span>
          <div className="num">{counts.material}</div>
          <div className="sub">Stoc consumabile</div>
        </button>
        <button type="button" className="priority-card" onClick={() => goToTab('products')}>
          <span className="k">▲ Produse</span>
          <div className="num">{counts.produs}</div>
          <div className="sub">Produse finite</div>
        </button>
      </div>
      {hasAlerts && (
        <div className="erp-alerts-wrap" style={{ marginTop: 24 }}>
          <h3 className="status-subhead">Alerte stoc și revizii</h3>
          <div className="status-history-list">
            {lowStockItems.map((eq) => (
              <div key={eq.id} className="status-history-item" onClick={() => goToItem(eq, eq.erp_category === 'produs' ? 'products' : 'materials')}>
                <span className="status-history-time">{eq.erp_category === 'produs' ? 'PRODUS' : 'MATERIAL'}</span>
                <span className="status-history-dot" />
                <div>
                  <div className="status-history-check">{eq.name}</div>
                  <div className="status-history-message">Stoc redus: {eq.quantity}{eq.unit ? ` ${eq.unit}` : ''} (prag {eq.reorder_threshold}{eq.unit ? ` ${eq.unit}` : ''})</div>
                </div>
              </div>
            ))}
            {expiredDocsItems.map((eq) => (
              <div key={eq.id} className="status-history-item" onClick={() => window.goToVehicle?.(eq)}>
                <span className="status-history-time">MAȘINĂ</span>
                <span className="status-history-dot" />
                <div>
                  <div className="status-history-check">{eq.name}</div>
                  <div className="status-history-message">Acte expirate: {expiredDocNames(eq).join(', ')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="home-nav-grid" style={{ marginTop: 28 }}>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('equipment')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Echipamente</span><span className="home-nav-sub">Scule, generatoare, compresoare</span></span>
        </button>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('machines')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8" /><path d="M14 17H9" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="17.5" cy="17.5" r="1.5" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Parc Auto</span><span className="home-nav-sub">Utilaje grele și autovehicule</span></span>
        </button>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('materials')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Materiale</span><span className="home-nav-sub">Stoc consumabile de șantier</span></span>
        </button>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('products')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 7.3 12 12l-8.5-4.7" /><path d="M12 22V12" /><path d="m3.3 7 8.2-4.6a1 1 0 0 1 1 0L20.7 7a1 1 0 0 1 .5.87v8.26a1 1 0 0 1-.5.87l-8.2 4.6a1 1 0 0 1-1 0l-8.2-4.6a1 1 0 0 1-.5-.87V7.87a1 1 0 0 1 .5-.87z" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Produse</span><span className="home-nav-sub">Produse finite, stoc</span></span>
        </button>
      </div>
    </>
  );
}

import { createPortal } from 'react-dom';
import { ErpStoreProvider } from './ErpContext';
import { ErpHomePanel } from './ErpHomePanel';
import { CategoryPanel } from './CategoryPanel';
import { EquipmentForm } from './EquipmentForm';
import { AddItemButton } from './ErpTopbarControls';

export interface ErpMountTargets {
  erpHomeRoot: HTMLElement;
  equipmentPanelRoot: HTMLElement;
  materialsPanelRoot: HTMLElement;
  productsPanelRoot: HTMLElement;
  equipmentQuickFilters: HTMLElement;
  materialsQuickFilters: HTMLElement;
  productsQuickFilters: HTMLElement;
}

// Each category's own add-item icon is a portal into the shared
// topbar-actions row (admin-3.html's data-year-panel="equipment"/
// "materials"/"products" slots, toggled the same generic way the
// Sesizări/Proiecte ones already are) instead of living inside the
// panel itself. Parc Auto (machines, fuel report) stays vanilla/
// deferred -- its own add/download icons are wired directly in
// admin-3.html + erp.js, not through here.
export function ErpRoot({ sessionEmail, targets }: { sessionEmail: string | null; targets: ErpMountTargets }) {
  return (
    <ErpStoreProvider sessionEmail={sessionEmail}>
      {createPortal(<CategoryPanel category="echipament" />, targets.equipmentPanelRoot)}
      {createPortal(<CategoryPanel category="material" />, targets.materialsPanelRoot)}
      {createPortal(<CategoryPanel category="produs" />, targets.productsPanelRoot)}
      {createPortal(<AddItemButton category="echipament" />, targets.equipmentQuickFilters)}
      {createPortal(<AddItemButton category="material" />, targets.materialsQuickFilters)}
      {createPortal(<AddItemButton category="produs" />, targets.productsQuickFilters)}
      <ErpHomePanel />
      <EquipmentForm />
    </ErpStoreProvider>
  );
}

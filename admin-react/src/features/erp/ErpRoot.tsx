import { createPortal } from 'react-dom';
import { ErpStoreProvider } from './ErpContext';
import { ErpHomePanel } from './ErpHomePanel';
import { CategoryPanel } from './CategoryPanel';
import { EquipmentForm } from './EquipmentForm';

export interface ErpMountTargets {
  erpHomeRoot: HTMLElement;
  equipmentPanelRoot: HTMLElement;
  materialsPanelRoot: HTMLElement;
  productsPanelRoot: HTMLElement;
}

// No topbar portals needed -- unlike Proiecte/Sesizări, the ERP panels
// never had a year-bar/quick-filters strip (see admin-3.html: just a
// plain .toolbar with a count and an add button). Parc Auto (machines,
// fuel report) stays vanilla/deferred, so there's no portal target for
// it here.
export function ErpRoot({ sessionEmail, targets }: { sessionEmail: string | null; targets: ErpMountTargets }) {
  return (
    <ErpStoreProvider sessionEmail={sessionEmail}>
      {createPortal(<CategoryPanel category="echipament" />, targets.equipmentPanelRoot)}
      {createPortal(<CategoryPanel category="material" />, targets.materialsPanelRoot)}
      {createPortal(<CategoryPanel category="produs" />, targets.productsPanelRoot)}
      <ErpHomePanel />
      <EquipmentForm />
    </ErpStoreProvider>
  );
}

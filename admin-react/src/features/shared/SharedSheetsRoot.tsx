import { useEffect, useState } from 'react';
import { EntityLogSheet, type EntityLogSheetState } from './EntityLogSheet';
import { ChecklistSheet, type ChecklistItem, type ChecklistSheetState } from './ChecklistSheet';
import { StockLedgerSheet, type StockLedgerSheetState } from './StockLedgerSheet';
import { CalendarSyncSheet } from '../home/CalendarSyncSheet';

// Mounted exactly once (see mount.tsx's mountSharedSheets), independent
// of the Proiecte/ERP React roots (and, for CalendarSyncSheet, the Home
// root) that also need these sheets -- every caller (React or
// still-vanilla LPS/Parc Auto/Documentație) opens them through the same
// window.* functions, so there's one sheet instance, not one per feature.
export function SharedSheetsRoot({ sessionEmail }: { sessionEmail: string | null }) {
  const [entityLog, setEntityLog] = useState<EntityLogSheetState | null>(null);
  const [checklist, setChecklist] = useState<ChecklistSheetState | null>(null);
  const [stockLedger, setStockLedger] = useState<StockLedgerSheetState | null>(null);
  const [calendarSyncOpen, setCalendarSyncOpen] = useState(false);

  useEffect(() => {
    window.openEntityLogSheet = (entityType, entityId, title) => setEntityLog({ type: entityType, id: entityId, title });
    window.openChecklistSheet = (table, id, items, onSaved) => setChecklist({ table, id, items: JSON.parse(JSON.stringify(items)) as ChecklistItem[], onSaved });
    window.openStockLedgerSheet = (itemId, itemName) => setStockLedger({ itemId, itemName });
    window.openCalendarSync = () => setCalendarSyncOpen(true);
    return () => {
      delete window.openEntityLogSheet;
      delete window.openChecklistSheet;
      delete window.openStockLedgerSheet;
      delete window.openCalendarSync;
    };
  }, []);

  return (
    <>
      <EntityLogSheet current={entityLog} onClose={() => setEntityLog(null)} sessionEmail={sessionEmail} />
      <ChecklistSheet current={checklist} onClose={() => setChecklist(null)} />
      <StockLedgerSheet current={stockLedger} onClose={() => setStockLedger(null)} />
      <CalendarSyncSheet open={calendarSyncOpen} onClose={() => setCalendarSyncOpen(false)} />
    </>
  );
}

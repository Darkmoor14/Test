import { useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { formatLogTimeRO } from '../../lib/format';

declare global {
  interface Window {
    openStockLedgerSheet?: (itemId: string, itemName: string) => void;
  }
}

interface StockLedgerRow {
  id: string;
  change_qty: number;
  resulting_qty: number;
  reason: string;
  user_email: string | null;
  created_at: string;
}

export interface StockLedgerSheetState {
  itemId: string;
  itemName: string;
}

export function StockLedgerSheet({ current, onClose }: { current: StockLedgerSheetState | null; onClose: () => void }) {
  const supabase = useSupabase();
  const [rows, setRows] = useState<StockLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!current) return;
    setLoading(true);
    supabase.from('stock_ledger').select('*')
      .eq('item_id', current.itemId).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        setLoading(false);
        setRows(error ? [] : ((data as StockLedgerRow[]) || []));
      });
  }, [current, supabase]);

  if (!current) return null;

  return (
    <div className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="stockLedgerSheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div><h3 id="stockLedgerSheetTitle">Jurnal stoc — {current.itemName}</h3></div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
          </div>
          <div className="entity-log-list">
            {loading ? (
              <p className="status-history-empty">Se încarcă…</p>
            ) : rows.length === 0 ? (
              <p className="status-history-empty">Nicio mișcare de stoc încă.</p>
            ) : rows.map((row) => {
              const sign = Number(row.change_qty) > 0 ? '+' : '';
              return (
                <div key={row.id} className="entity-log-item">
                  <span className="entity-log-time">{formatLogTimeRO(row.created_at)}</span>
                  <div>
                    <div className="entity-log-text">{sign}{row.change_qty} (rămas: {row.resulting_qty}) — {row.reason}</div>
                    {row.user_email && <div className="entity-log-author">{row.user_email}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

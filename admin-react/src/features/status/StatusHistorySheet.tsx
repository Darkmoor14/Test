import { useEffect, useState } from 'react';
import { clearStatusHistory, loadStatusHistory, STATUS_CHECK_LABELS, type StatusHistoryEntry } from './useStatusHistory';
import { downloadJson, formatLogTimeRO } from '../../lib/format';

export function StatusHistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);

  useEffect(() => {
    if (open) setHistory(loadStatusHistory().slice().reverse());
  }, [open]);

  if (!open) return null;

  return (
    <div className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="statusHistorySheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-header">
            <div>
              <h3 id="statusHistorySheetTitle">Istoric verificări (48h)</h3>
            </div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="status-card-head-actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn status-card-head-btn"
              onClick={() => downloadJson(`istoric-verificari-${new Date().toISOString().slice(0, 10)}.json`, loadStatusHistory())}
            >
              Descarcă JSON
            </button>
            <button
              type="button"
              className="btn status-card-head-btn"
              onClick={() => {
                clearStatusHistory();
                setHistory([]);
              }}
            >
              Golește istoricul
            </button>
          </div>
          <div className="status-history-list">
            {history.length === 0 ? (
              <p className="status-history-empty">Niciun eveniment înregistrat în ultimele 48 de ore.</p>
            ) : (
              history.map((e, i) => (
                <div key={i} className={`status-history-item ${e.ok ? 'ok' : 'bad'}`}>
                  <span className="status-history-time">{formatLogTimeRO(new Date(e.ts).toISOString())}</span>
                  <span className="status-history-dot" />
                  <div>
                    <div className="status-history-check">{STATUS_CHECK_LABELS[e.check] || e.check}</div>
                    <div className="status-history-message">{e.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

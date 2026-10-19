import { useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import '../../lib/chartSetup';
import { useStatusChecks } from './useStatusChecks';
import { StatusHistorySheet } from './StatusHistorySheet';
import { useSubscribeToPush } from './usePush';

function StatusDot({ state }: { state: 'ok' | 'bad' | 'checking' | null }) {
  return <span className={`status-dot${state ? ` ${state}` : ''}`} />;
}

export function StatusDashboard({ sessionEmail, landingPage }: { sessionEmail: string | null; landingPage?: string }) {
  const { state, loadSystemStatus, checkSystem } = useStatusChecks(sessionEmail);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const subscribeToPush = useSubscribeToPush(sessionEmail, landingPage);

  const dbChartData = {
    labels: state.db.history.map((_, i) => i + 1),
    datasets: [
      {
        data: state.db.history,
        borderColor: '#D11F24',
        backgroundColor: 'rgba(209,31,36,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  };

  const cronChartData = {
    labels: state.cron.runs.map((_, i) => i + 1),
    datasets: [
      {
        data: state.cron.runs.map((r) => (r.status === 'succeeded' ? 1 : r.status ? 0.15 : 0)),
        backgroundColor: state.cron.runs.map((r) => (r.status === 'succeeded' ? '#1E9E5A' : '#B5502F')),
        borderRadius: 2,
      },
    ],
  };

  const countsChartData = {
    labels: ['Sesizări', 'Proiecte publice', 'Avarii rețele', 'Evenimente calendar', 'Dispozitive push'],
    datasets: [
      {
        data: [
          state.counts.tickets,
          state.counts.current_projects,
          state.counts.backlog_projects,
          state.counts.calendar_events,
          state.counts.push_subscriptions,
        ],
        backgroundColor: '#D11F24',
        borderRadius: 3,
      },
    ],
  };

  return (
    <div className="admin-panel active">
      <div className="status-panel-head">
        <div>
          <div className="home-eyebrow">Monitorizare</div>
          <h2>Stare sistem</h2>
        </div>
        <button
          type="button"
          className="status-info-btn"
          aria-label="Istoric verificări (ultimele 48h)"
          title="Istoric verificări (ultimele 48h)"
          onClick={() => setHistoryOpen(true)}
        >
          i
        </button>
      </div>
      <div className="status-grid">
        <div className="status-card">
          <div className="status-card-head">
            <StatusDot state={state.db.dot} />
            <h4>Bază de date</h4>
          </div>
          <div className="status-card-body">
            <div className="status-stat">{state.db.latencyLabel}</div>
            <div className="status-stat-label">Timp de răspuns</div>
          </div>
          <div className="status-chart" style={{ height: 60 }}>
            <Line data={dbChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 9 } } }, x: { display: false } } }} />
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-head">
            <StatusDot state={state.auth.dot} />
            <h4>Autentificare</h4>
          </div>
          <div className="status-card-body">
            <div className="status-stat">{state.auth.stateLabel}</div>
            <div className="status-stat-label">{state.auth.subLabel}</div>
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-head">
            <StatusDot state={state.functions.dot} />
            <h4>Funcții Edge</h4>
          </div>
          <div className="status-card-body">
            <div className="status-stat">{state.functions.latencyLabel}</div>
            <div className="status-stat-label">status-ping — timp de răspuns</div>
          </div>
          <ul className="status-function-list">
            {state.functions.list.map((f) => (
              <li key={f.name}>
                <span>{f.name}</span>
                <span>{f.note}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="status-card">
          <div className="status-card-head">
            <StatusDot state={state.cron.dot} />
            <h4>Memento-uri calendar</h4>
          </div>
          <div className="status-card-body">
            <div className="status-stat">{state.cron.stateLabel}</div>
            <div className="status-stat-label">Job programat (la fiecare minut)</div>
          </div>
          <div className="status-chart" style={{ height: 60 }}>
            <Bar data={cronChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { display: false, max: 1 }, x: { display: false } } }} />
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-head">
            <StatusDot state={state.push.dot} />
            <h4>Notificări push</h4>
          </div>
          <div className="status-card-body">
            <div className="status-stat">{state.push.stateLabel}</div>
            <div className="status-stat-label">{state.push.subLabel}</div>
          </div>
          {state.push.showEnableButton && (
            <button
              type="button"
              className="btn status-push-enable-btn"
              disabled={enabling}
              onClick={async () => {
                setEnabling(true);
                await subscribeToPush();
                setEnabling(false);
                await checkSystem();
              }}
            >
              {enabling ? 'Se activează...' : 'Activează notificările'}
            </button>
          )}
        </div>

        <div className="status-card status-card-wide">
          <div className="status-card-head">
            <h4>Date în platformă</h4>
          </div>
          <div className="status-chart status-chart-tall" style={{ height: 140 }}>
            <Bar
              data={countsChartData}
              options={{
                indexAxis: 'y' as const,
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } },
              }}
            />
          </div>
        </div>
      </div>
      <div className="status-refresh-row">
        <span>{state.lastCheckedLabel}</span>
        <button type="button" className="btn" onClick={loadSystemStatus}>
          Reîmprospătează
        </button>
      </div>
      <p className="status-note">
        Memoria/CPU-ul serverului nu pot fi verificate în siguranță din browser (necesită un token de administrare Supabase care nu ar trebui expus aici) — pentru acele metrici, vezi dashboard-ul Supabase direct.
      </p>
      <StatusHistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}

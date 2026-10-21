import { Bar, Line } from 'react-chartjs-2';
import '../../lib/chartSetup';
import { useSiteStats } from './useSiteStats';

// Shortens a path like "/relatii-publice.html" down to "relatii-publice"
// for the top-pages chart's labels -- the .html and leading slash add
// nothing a staff member reading the chart needs.
function shortPath(path: string): string {
  return path.replace(/^\//, '').replace(/\.html$/, '') || 'acasă';
}

export function SiteStats() {
  const { state, reload } = useSiteStats();
  const { loading, error, pageviews, topPages, funnel } = state;

  const pageviewsChartData = {
    labels: pageviews ? pageviews.days.map((d) => d.slice(5)) : [],
    datasets: [
      {
        label: 'Afișări pagină',
        data: pageviews?.total || [],
        borderColor: '#D11F24',
        backgroundColor: 'rgba(209,31,36,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
      {
        label: 'Vizitatori unici',
        data: pageviews?.unique || [],
        borderColor: '#2B333B',
        backgroundColor: 'rgba(43,51,59,0.06)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  };

  const topPagesChartData = {
    labels: topPages.map((p) => shortPath(p.path)),
    datasets: [
      {
        data: topPages.map((p) => p.count),
        backgroundColor: '#D11F24',
        borderRadius: 3,
      },
    ],
  };

  return (
    <>
      <div className="status-panel-head">
        <div className="home-eyebrow">Statistici site public</div>
      </div>
      {error && (
        <p className="status-note" style={{ color: 'var(--signal-red, #B5502F)' }}>
          Eroare la încărcarea statisticilor: {error}
        </p>
      )}
      <div className="status-grid">
        <div className="status-card">
          <div className="status-card-head"><h4>Afișări pagină (30 zile)</h4></div>
          <div className="status-card-body">
            <div className="status-stat">{loading ? '—' : (pageviews?.totalSum ?? 0)}</div>
            <div className="status-stat-label">Total afișări</div>
          </div>
        </div>
        <div className="status-card">
          <div className="status-card-head"><h4>Vizitatori unici (30 zile)</h4></div>
          <div className="status-card-body">
            <div className="status-stat">{loading ? '—' : (pageviews?.uniqueSum ?? 0)}</div>
            <div className="status-stat-label">Sumă zilnică — aceeași persoană pe mai multe zile se numără de mai multe ori (urmărire anonimă, fără cookie)</div>
          </div>
        </div>
        <div className="status-card">
          <div className="status-card-head"><h4>Sesizări trimise (30 zile)</h4></div>
          <div className="status-card-body">
            <div className="status-stat">{loading ? '—' : (funnel?.ticketSubmitted ?? 0)}</div>
            <div className="status-stat-label">Formular raportare.html</div>
          </div>
        </div>
        <div className="status-card">
          <div className="status-card-head"><h4>Solicitări de contact (30 zile)</h4></div>
          <div className="status-card-body">
            <div className="status-stat">{loading ? '—' : (funnel?.contactFormSubmitted ?? 0)}</div>
            <div className="status-stat-label">Formularele de contact (Acasă, Servicii, Produse)</div>
          </div>
        </div>

        <div className="status-card status-card-wide">
          <div className="status-card-head"><h4>Trafic zilnic</h4></div>
          <div className="status-chart status-chart-tall" style={{ height: 220 }}>
            <Line
              data={pageviewsChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } },
              }}
            />
          </div>
        </div>

        <div className="status-card status-card-wide">
          <div className="status-card-head"><h4>Pagini cele mai vizitate (30 zile)</h4></div>
          <div className="status-chart status-chart-tall" style={{ height: 180 }}>
            {topPages.length === 0 && !loading ? (
              <p className="status-history-empty">Fără date încă.</p>
            ) : (
              <Bar
                data={topPagesChartData}
                options={{
                  indexAxis: 'y' as const,
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } },
                }}
              />
            )}
          </div>
        </div>
      </div>
      <div className="status-refresh-row">
        <span>{loading ? 'Se încarcă…' : 'Ultimele 30 de zile, actualizat la fiecare deschidere a paginii.'}</span>
        <button type="button" className="btn" onClick={reload} disabled={loading}>
          Reîmprospătează
        </button>
      </div>
      <p className="status-note">
        Date din PostHog, urmărire anonimă fără cookie-uri (vezi Politica de cookie-uri de pe site-ul public) — vizibile doar personalului autentificat aici, nu public.
      </p>
    </>
  );
}

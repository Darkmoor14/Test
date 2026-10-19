import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import '../../lib/chartSetup';
import { useTickets } from './TicketsContext';
import { calendarDaysBetween, formatDays, isDuplicateTicket, matchesMonth, matchesYear, parseTicketDate } from './ticketUtils';

const MONTH_NAMES = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];

export function OverviewCharts() {
  const store = useTickets();
  const { tickets, ticketYearFilter, ticketMonthFilter } = store;

  const volume = useMemo(() => {
    const volumeSource = tickets.filter((t) => !isDuplicateTicket(t));
    const monthCounts: Record<string, number> = {};
    volumeSource.forEach((t) => {
      if (!t.submitted_on) return;
      const d = parseTicketDate(t.submitted_on);
      if (isNaN(d.getTime())) return;
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    });
    const sortedKeys = Object.keys(monthCounts).sort();
    return {
      labels: sortedKeys.map((k) => { const [y, m] = k.split('-'); return MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + y.slice(2); }),
      data: sortedKeys.map((k) => monthCounts[k]),
    };
  }, [tickets]);

  const resolutionStats = useMemo(() => {
    const visible = tickets.filter((t) => matchesYear(t, ticketYearFilter) && matchesMonth(t, ticketMonthFilter) && !isDuplicateTicket(t));
    const resolved = visible.filter((t) => t.status === 'Terminat' && t.resolved_on && t.submitted_on);
    const daysFor = (t: typeof resolved[number]) => calendarDaysBetween(t.submitted_on!, t.resolved_on!);
    const avg = (arr: typeof resolved) => (arr.length ? arr.reduce((sum, t) => sum + daysFor(t), 0) / arr.length : NaN);
    const funcResolved = resolved.filter((t) => t.type !== 'Anunt accident');
    const accResolved = resolved.filter((t) => t.type === 'Anunt accident');
    return {
      hasData: resolved.length > 0,
      overallLabel: resolved.length ? formatDays(avg(resolved)) + ' (medie)' : 'Fără date încă',
      funcAvg: isFinite(avg(funcResolved)) ? Math.round(avg(funcResolved) * 10) / 10 : 0,
      accAvg: isFinite(avg(accResolved)) ? Math.round(avg(accResolved) * 10) / 10 : 0,
    };
  }, [tickets, ticketYearFilter, ticketMonthFilter]);

  return (
    <div className="overview-sidebar">
      <div className="chart-card">
        <h4>Sesizări pe an</h4>
        <Bar
          data={{ labels: volume.labels, datasets: [{ data: volume.data, backgroundColor: '#D11F24', borderRadius: 3 }] }}
          options={{
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } },
          }}
        />
      </div>
      <div className="chart-card">
        <h4>Timp mediu de rezolvare</h4>
        <Bar
          data={{
            labels: ['Defect', 'Accident'],
            datasets: [{ data: [resolutionStats.funcAvg, resolutionStats.accAvg], backgroundColor: ['#D11F24', '#B5502F'], borderRadius: 3 }],
          }}
          options={{
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, title: { display: true, text: 'zile', font: { size: 10 } }, ticks: { font: { size: 10 } } },
              x: { ticks: { font: { size: 11 } } },
            },
          }}
        />
        <div className="chart-stat">{resolutionStats.overallLabel}</div>
      </div>
    </div>
  );
}

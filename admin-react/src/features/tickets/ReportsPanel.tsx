import { useMemo } from 'react';
import { Bar, Line, Pie } from 'react-chartjs-2';
import '../../lib/chartSetup';
import { useTickets } from './TicketsContext';
import {
  calendarDaysBetween, classifyTicketSource, describeActiveDateFilter, formatDays, isDuplicateTicket,
  matchesMonth, matchesYear, parseTicketDate, TICKET_SOURCE_LABELS,
} from './ticketUtils';

const MONTH_NAMES = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];
const WEEKDAY_NAMES = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];

const PIE_OPTIONS = {
  responsive: true,
  plugins: {
    legend: { position: 'bottom' as const, labels: { font: { size: 11 }, boxWidth: 12, padding: 10 } },
  },
};

function NoData() {
  return <div className="chart-stat">Fără date încă</div>;
}

export function ReportsPanel() {
  const store = useTickets();
  const { tickets, ticketYearFilter, ticketMonthFilter } = store;

  const dateNote = describeActiveDateFilter({
    year: ticketYearFilter, yearTouched: store.ticketYearFilterTouched,
    month: ticketMonthFilter, monthTouched: store.ticketMonthFilterTouched,
    day: null,
  });

  // The filtered-by-date charts below (everything except the three
  // trend-over-time ones -- the two month-by-month charts and the
  // weekday one -- which deliberately ignore the filter and always
  // show the full history) share this same base set.
  const filtered = useMemo(
    () => tickets.filter((t) => !isDuplicateTicket(t) && matchesYear(t, ticketYearFilter) && matchesMonth(t, ticketMonthFilter)),
    [tickets, ticketYearFilter, ticketMonthFilter],
  );

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
    const resolved = filtered.filter((t) => t.status === 'Terminat' && t.resolved_on && t.submitted_on);
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
  }, [filtered]);

  const sourceStats = useMemo(() => {
    const counts: Record<string, number> = { public: 0, autosesizare: 0, 'politia-locala': 0, 'biroul-energetic': 0 };
    filtered.forEach((t) => { counts[classifyTicketSource(t)]++; });
    const keys = (Object.keys(counts) as (keyof typeof counts)[]).filter((k) => counts[k] > 0);
    return {
      hasData: filtered.length > 0,
      labels: keys.map((k) => TICKET_SOURCE_LABELS[k as keyof typeof TICKET_SOURCE_LABELS]),
      data: keys.map((k) => counts[k]),
    };
  }, [filtered]);

  const typeStats = useMemo(() => {
    const accidents = filtered.filter((t) => t.type === 'Anunt accident').length;
    const defects = filtered.length - accidents;
    return { hasData: filtered.length > 0, defects, accidents };
  }, [filtered]);

  const statusStats = useMemo(() => {
    let active = 0; let doneWithReport = 0; let awaitingReport = 0;
    filtered.forEach((t) => {
      if (t.status !== 'Terminat') active++;
      else if (t.resolution_note) doneWithReport++;
      else awaitingReport++;
    });
    return { hasData: filtered.length > 0, active, doneWithReport, awaitingReport };
  }, [filtered]);

  const weekdayStats = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]; // Monday..Sunday
    let any = false;
    tickets.filter((t) => !isDuplicateTicket(t)).forEach((t) => {
      if (!t.submitted_on) return;
      const d = parseTicketDate(t.submitted_on);
      if (isNaN(d.getTime())) return;
      const jsDay = d.getDay(); // 0=Sunday..6=Saturday
      counts[(jsDay + 6) % 7]++;
      any = true;
    });
    return { hasData: any, data: counts };
  }, [tickets]);

  return (
    <div className="reports-grid">
      {dateNote && <div className="reports-grid-note">Grafice filtrate pe: {dateNote} (cu excepția celor de evoluție în timp, de mai jos, care arată mereu tot istoricul)</div>}

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
        <h4>Evoluție lunară a sesizărilor</h4>
        <Line
          data={{
            labels: volume.labels,
            datasets: [{
              data: volume.data, borderColor: '#D11F24', backgroundColor: 'rgba(209,31,36,0.12)',
              fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#D11F24',
            }],
          }}
          options={{
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } },
          }}
        />
      </div>

      <div className="chart-card">
        <h4>Sesizări pe zi a săptămânii</h4>
        <Bar
          data={{ labels: WEEKDAY_NAMES, datasets: [{ data: weekdayStats.data, backgroundColor: '#D11F24', borderRadius: 3 }] }}
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

      <div className="chart-card">
        <h4>Sursa sesizărilor</h4>
        {sourceStats.hasData ? (
          <Pie
            data={{ labels: sourceStats.labels, datasets: [{ data: sourceStats.data, backgroundColor: ['#D11F24', '#7C5CBF', '#2F6FB5', '#B5792F'] }] }}
            options={PIE_OPTIONS}
          />
        ) : <NoData />}
      </div>

      <div className="chart-card">
        <h4>Tip sesizare</h4>
        {typeStats.hasData ? (
          <Pie
            data={{ labels: ['Defecte', 'Accidente'], datasets: [{ data: [typeStats.defects, typeStats.accidents], backgroundColor: ['#D11F24', '#B5502F'] }] }}
            options={PIE_OPTIONS}
          />
        ) : <NoData />}
      </div>

      <div className="chart-card">
        <h4>Stare sesizări</h4>
        {statusStats.hasData ? (
          <Pie
            data={{
              labels: ['Active', 'Soluționate', 'Așteaptă raport'],
              datasets: [{ data: [statusStats.active, statusStats.doneWithReport, statusStats.awaitingReport], backgroundColor: ['#2F6FB5', '#3E7A57', '#B5792F'] }],
            }}
            options={PIE_OPTIONS}
          />
        ) : <NoData />}
      </div>
    </div>
  );
}

import { useProjects } from './ProjectsContext';

// internalProjects (Proiecte LPS) is deliberately browser-local storage,
// not Supabase (see lps.js) -- still fully vanilla/deferred this round,
// so its count is read directly from the same localStorage key rather
// than needing a vanilla->React bridge.
const INTERNAL_PROJECTS_STORAGE_KEY = 'insta-grup-vlas-internal-projects-v1';
function internalProjectsCount(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(INTERNAL_PROJECTS_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.length : 0;
  } catch {
    return 0;
  }
}

declare global {
  interface Window { openAdminTab?: (tabKey: string) => void; }
}
function goToTab(tab: string) {
  window.openAdminTab?.(tab);
}

export function ProjectsHomePanel() {
  const store = useProjects();
  const activeProjects = store.projects.filter((p) => !p.archived).length;
  const activeBacklog = store.backlogProjects.filter((p) => (p.status || 'Ongoing') !== 'Terminat').length;
  const lpsCount = internalProjectsCount();
  const in14Days = new Date();
  in14Days.setDate(in14Days.getDate() + 14);
  const upcomingWorkOrders = store.workOrders.filter((w) => w.status !== 'Finalizat' && w.status !== 'Anulat' && new Date(w.scheduled_date) <= in14Days).length;

  return (
    <>
      <div className="priority-grid">
        <button type="button" className="priority-card" onClick={() => goToTab('projects')}>
          <span className="k">● Proiecte publice</span>
          <div className="num">{activeProjects}</div>
          <div className="sub">Active momentan</div>
        </button>
        <button type="button" className="priority-card warn" onClick={() => goToTab('backlog')}>
          <span className="k">⚡ Avarii rețele</span>
          <div className="num">{activeBacklog}</div>
          <div className="sub">Lucrări deschise</div>
        </button>
        <button type="button" className="priority-card" onClick={() => goToTab('lps')}>
          <span className="k">◫ Proiecte LPS</span>
          <div className="num">{lpsCount}</div>
          <div className="sub">Proiecte interne de planificare</div>
        </button>
        <button type="button" className="priority-card done" onClick={() => goToTab('workorders')}>
          <span className="k">🗓 Programe lucrări</span>
          <div className="num">{upcomingWorkOrders}</div>
          <div className="sub">Programate în următoarele 14 zile</div>
        </button>
      </div>
      <div className="home-nav-grid" style={{ marginTop: 28 }}>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('projects')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M9 4v5" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Proiecte publice</span><span className="home-nav-sub">Lucrări în curs și programate</span></span>
        </button>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('backlog')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Avarii rețele</span><span className="home-nav-sub">Lucrări din teren</span></span>
        </button>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('lps')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="M3 9h6" /><path d="M3 15h6" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Proiecte LPS</span><span className="home-nav-sub">Planificare Last Planner</span></span>
        </button>
        <button type="button" className="home-nav-btn" onClick={() => goToTab('workorders')}>
          <span className="home-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
          </span>
          <span className="home-nav-text"><span className="home-nav-label">Programe lucrări</span><span className="home-nav-sub">Calendar de lucrări planificate</span></span>
        </button>
      </div>
    </>
  );
}

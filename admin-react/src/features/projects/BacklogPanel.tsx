import { useProjects } from './ProjectsContext';
import { BacklogForm } from './BacklogForm';
import { daysSince } from './projectUtils';
import type { BacklogProject } from './types';

function BacklogRow({ p }: { p: BacklogProject }) {
  const store = useProjects();
  const isDone = (p.status || 'Ongoing') === 'Terminat';
  const days = daysSince(p.start_date, isDone ? p.resolved_on : null);
  const ageClass = days >= 90 ? 'age-stale' : days >= 30 ? 'age-aging' : 'age-fresh';
  const checklistDone = p.checklist ? p.checklist.filter((i) => i.done).length : 0;

  return (
    <div className={`backlog-row ${ageClass}${isDone ? ' done' : ''}`}>
      <div className="backlog-main">
        <div className="backlog-title-line">
          <span className="backlog-title">{p.title}</span>
          {isDone && <span className="backlog-tag">Soluționat</span>}
          <span className="backlog-days">{days} {days === 1 ? 'zi' : 'zile'}</span>
          {p.checklist && p.checklist.length > 0 && <span className="checklist-progress">{checklistDone}/{p.checklist.length}</span>}
        </div>
        <div className="backlog-meta-line">{p.address}{p.employee_name ? ` · ${p.employee_name}` : ''}{p.description ? ` · ${p.description}` : ''}</div>
      </div>
      <div className="backlog-actions">
        <button type="button" className="btn bl-checklist" onClick={() => window.openChecklistSheet?.('backlog_projects', p.id, p.checklist || [], store.reloadBacklog)}>Listă</button>
        <button type="button" className="btn bl-history" onClick={() => window.openEntityLogSheet?.('backlog', p.id, p.title)}>Istoric</button>
        <button type="button" className="btn bl-edit" onClick={() => store.openBacklogForm(p)}>Editează</button>
        <button type="button" className={`btn ${isDone ? '' : 'btn-primary'} bl-status`} onClick={() => store.toggleBacklogStatus(p)}>{isDone ? 'Reactivează' : 'Soluționat'}</button>
      </div>
    </div>
  );
}

export function BacklogPanel() {
  const store = useProjects();
  const filtered = store.filteredBacklogProjects;
  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="result-count">{filtered.length} din {store.backlogProjects.length} lucrări</div>
        </div>
      </div>
      <BacklogForm />
      <div className="backlog-list">
        {filtered.length === 0 ? (
          <div className="no-results" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-400)' }}>Nicio lucrare în backlog.</div>
        ) : (
          filtered.map((p) => <BacklogRow key={p.id} p={p} />)
        )}
      </div>
    </>
  );
}

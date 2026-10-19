import { useProjects } from './ProjectsContext';
import { calcProjectProgress, calcProjectStatus, fmtDateShort } from './projectUtils';
import type { Project } from './types';

export function ProjectCard({ p }: { p: Project }) {
  const store = useProjects();
  const pct = calcProjectProgress(p.start_date, p.due_date);
  const status = calcProjectStatus(p.start_date, p.due_date);
  const isArchived = !!p.archived;
  const checklistDone = p.checklist ? p.checklist.filter((i) => i.done).length : 0;

  return (
    <div className={`project-card${isArchived ? ' archived' : ''}`}>
      <div className="pc-top">
        <div className="ticket-select">
          <input
            type="checkbox" className="pc-select"
            checked={store.projectSelectedIds.has(p.id)}
            onChange={(e) => store.toggleProjectSelected(p.id, e.target.checked)}
          />
          <div>
            <div className="pc-title">
              {p.title}
              {p.checklist && p.checklist.length > 0 && <span className="checklist-progress">{checklistDone}/{p.checklist.length}</span>}
            </div>
            <div className="pc-address">{p.address}</div>
            {isArchived && <span className="archived-badge">Arhivat {fmtDateShort(p.archived_at)}</span>}
          </div>
        </div>
        <span className={`pc-status ${status.key}`}>{status.label}</span>
      </div>
      <div className="pc-bar-track"><div className="pc-bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="pc-meta">
        <span>{fmtDateShort(p.start_date)} → {fmtDateShort(p.due_date)}</span>
        <span>{pct}%</span>
      </div>
      {p.notes && <div className="pc-address" style={{ marginBottom: 12 }}>📝 {p.notes}</div>}
      <div className="pc-actions">
        <button type="button" className="btn pc-checklist" onClick={() => window.openChecklistSheet?.('current_projects', p.id, p.checklist || [], store.reloadProjects)}>Listă</button>
        <button type="button" className="btn pc-history" onClick={() => window.openEntityLogSheet?.('project', p.id, p.title)}>Istoric</button>
        {isArchived ? (
          <button type="button" className="btn pc-restore" onClick={() => store.restoreProject(p)}>Dezarhivează</button>
        ) : (
          <>
            <button type="button" className="btn pc-edit" onClick={() => store.openProjectForm(p)}>Editează</button>
            <button type="button" className="btn pc-delete" onClick={() => store.deleteProject(p)}>Șterge</button>
          </>
        )}
      </div>
    </div>
  );
}

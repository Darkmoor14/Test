import { useProjects } from './ProjectsContext';
import { ProjectCard } from './ProjectCard';
import { ProjectForm } from './ProjectForm';

export function ProjectsArchiveBar() {
  const store = useProjects();
  const count = store.projectSelectedIds.size;
  if (count === 0) return null;
  return (
    <div className="archive-bar show">
      <span>{count} selectate</span>
      <button className="btn" type="button" onClick={store.clearProjectSelection}>Anulează selecția</button>
      <button className="btn btn-primary" type="button" onClick={store.archiveSelectedProjects}>Arhivează selectate</button>
    </div>
  );
}

export function ProjectsPanel() {
  const store = useProjects();
  const filtered = store.filteredProjects;
  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="result-count">{filtered.length} din {store.projects.length} proiecte</div>
        </div>
      </div>
      <ProjectsArchiveBar />
      <ProjectForm />
      <div className="project-list">
        {filtered.length === 0 ? (
          <div className="no-results" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-400)' }}>Niciun proiect în această categorie.</div>
        ) : (
          filtered.map((p) => <ProjectCard key={p.id} p={p} />)
        )}
      </div>
    </>
  );
}

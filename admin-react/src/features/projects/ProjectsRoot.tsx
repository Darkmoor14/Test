import { createPortal } from 'react-dom';
import { ProjectsStoreProvider } from './ProjectsContext';
import { ProjectsYearBarInner, ProjectsQuickFiltersInner, BacklogQuickFiltersInner } from './ProjectsTopbarControls';
import { ProjectsHomePanel } from './ProjectsHomePanel';
import { ProjectsPanel } from './ProjectsPanel';
import { BacklogPanel } from './BacklogPanel';
import { WorkOrdersPanel } from './WorkOrdersPanel';

export interface ProjectsMountTargets {
  projectsYearBar: HTMLElement;
  projectsQuickFilters: HTMLElement;
  backlogQuickFilters: HTMLElement;
  projectsHomeRoot: HTMLElement;
  projectsPanelRoot: HTMLElement;
  backlogPanelRoot: HTMLElement;
  workOrdersPanelRoot: HTMLElement;
}

// Same portal-based multi-mount-point shape as tickets/TicketsRoot.tsx:
// one store covers all four admin-panel destinations (Home, Proiecte
// publice, Avarii rețele, Programe lucrări) plus the two topbar slots
// that only exist for the projects/backlog tabs (Proiecte LPS keeps its
// own vanilla topbar-less panel, deferred this round).
export function ProjectsRoot({ sessionEmail, targets }: { sessionEmail: string | null; targets: ProjectsMountTargets }) {
  return (
    <ProjectsStoreProvider sessionEmail={sessionEmail}>
      {createPortal(<ProjectsYearBarInner />, targets.projectsYearBar)}
      {createPortal(<ProjectsQuickFiltersInner sessionEmail={sessionEmail} />, targets.projectsQuickFilters)}
      {createPortal(<BacklogQuickFiltersInner sessionEmail={sessionEmail} />, targets.backlogQuickFilters)}
      {createPortal(<ProjectsPanel />, targets.projectsPanelRoot)}
      {createPortal(<BacklogPanel />, targets.backlogPanelRoot)}
      {createPortal(<WorkOrdersPanel />, targets.workOrdersPanelRoot)}
      <ProjectsHomePanel />
    </ProjectsStoreProvider>
  );
}

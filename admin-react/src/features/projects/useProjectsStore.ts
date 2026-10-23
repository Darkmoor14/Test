import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { createLogEntityActivity } from '../shared/entityLogClient';
import { saveChecklist as persistChecklist } from '../../lib/dataServices';
import type { BacklogProject, BacklogFilterKey, Project, ProjectsFilterKey, WorkOrder } from './types';
import { calcProjectStatus, getProjectStatusFilterKey, matchesProjectSearch, matchesProjectYear } from './projectUtils';
import type { ProjectStatusKey } from './types';

declare global {
  interface Window {
    showToast?: (message: string) => void;
    allProjects?: Project[];
    allBacklogProjects?: BacklogProject[];
    allWorkOrders?: WorkOrder[];
    calcProjectStatus?: (startISO: string, dueISO: string) => { key: ProjectStatusKey; label: string };
  }
}
function showToast(message: string) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

export function useProjectsStore(sessionEmail: string | null) {
  const supabase = useSupabase();
  const logEntityActivity = useMemo(() => createLogEntityActivity(supabase, () => sessionEmail), [supabase, sessionEmail]);

  // ---- current_projects (Proiecte publice) ----
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsFilter, setProjectsFilterState] = useState<ProjectsFilterKey>('Ongoing');
  const [projectYearFilter, setProjectYearFilterState] = useState('all');
  const [projectYearFilterTouched, setProjectYearFilterTouched] = useState(false);
  const [projectYearFilterInitialized, setProjectYearFilterInitialized] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectSelectedIds, setProjectSelectedIds] = useState<Set<string>>(new Set());
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const reloadProjects = useCallback(async () => {
    const { data, error } = await supabase.from('current_projects').select('*').order('start_date', { ascending: true });
    if (error) { console.error(error); setProjectsLoading(false); return; }
    setProjects((data as Project[]) || []);
    setProjectsLoading(false);
  }, [supabase]);

  useEffect(() => { if (sessionEmail) reloadProjects(); }, [sessionEmail, reloadProjects]);

  const projectAvailableYears = useMemo(() => {
    const years = new Set<number>();
    projects.forEach((p) => { if (p.start_date) years.add(new Date(p.start_date).getFullYear()); });
    return [...years].sort((a, b) => b - a);
  }, [projects]);

  useEffect(() => {
    if (!projectYearFilterInitialized) {
      const currentYear = new Date().getFullYear();
      setProjectYearFilterState(projectAvailableYears.includes(currentYear) ? String(currentYear) : 'all');
      setProjectYearFilterInitialized(true);
    }
  }, [projectAvailableYears, projectYearFilterInitialized]);

  const setProjectYearFilter = useCallback((v: string) => { setProjectYearFilterState(v); setProjectYearFilterTouched(true); }, []);
  const setProjectsFilter = useCallback((key: ProjectsFilterKey) => { setProjectsFilterState(key); setProjectSelectedIds(new Set()); }, []);

  const filteredProjects = useMemo(() => {
    const base = projects.filter((p) => projectsFilter === 'Toate' || getProjectStatusFilterKey(p) === projectsFilter);
    const q = projectSearchQuery.trim().toLowerCase();
    return base.filter((p) => matchesProjectYear(p, projectYearFilter) && matchesProjectSearch(p, q));
  }, [projects, projectsFilter, projectYearFilter, projectSearchQuery]);

  const toggleProjectSelected = useCallback((id: string, checked: boolean) => {
    setProjectSelectedIds((prev) => { const next = new Set(prev); if (checked) next.add(id); else next.delete(id); return next; });
  }, []);
  const clearProjectSelection = useCallback(() => setProjectSelectedIds(new Set()), []);

  const openProjectForm = useCallback((p: Project | null) => { setEditingProject(p); setProjectFormOpen(true); }, []);
  const closeProjectForm = useCallback(() => setProjectFormOpen(false), []);

  const saveProject = useCallback(async (payload: Omit<Project, 'id' | 'checklist' | 'archived' | 'archived_at'>, id: string | null) => {
    const { error } = id
      ? await supabase.from('current_projects').update(payload).eq('id', id)
      : await supabase.from('current_projects').insert(payload);
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return false; }
    showToast(id ? 'Proiectul a fost actualizat.' : 'Proiectul a fost adăugat.');
    setProjectFormOpen(false);
    await reloadProjects();
    return true;
  }, [supabase, reloadProjects]);

  const deleteProject = useCallback(async (p: Project) => {
    if (!confirm(`Ștergeți proiectul "${p.title}"? Această acțiune este permanentă.`)) return;
    const { error } = await supabase.from('current_projects').delete().eq('id', p.id);
    if (error) { console.error(error); alert('Eroare la ștergere.'); return; }
    await reloadProjects();
  }, [supabase, reloadProjects]);

  const restoreProject = useCallback(async (p: Project) => {
    const { error } = await supabase.from('current_projects').update({ archived: false, archived_at: null }).eq('id', p.id);
    if (error) { console.error(error); alert('Eroare la dezarhivare. Încercați din nou.'); return; }
    logEntityActivity('project', p.id, 'Proiectul a fost dezarhivat.');
    await reloadProjects();
  }, [supabase, reloadProjects, logEntityActivity]);

  const archiveSelectedProjects = useCallback(async () => {
    if (projectSelectedIds.size === 0) return;
    if (!confirm(`Arhivați ${projectSelectedIds.size} proiecte? Nu vor mai apărea pe pagina publică, dar rămân salvate și pot fi restaurate oricând.`)) return;
    const ids = Array.from(projectSelectedIds);
    const { error } = await supabase.from('current_projects').update({ archived: true, archived_at: new Date().toISOString() }).in('id', ids);
    if (error) { console.error(error); alert('Eroare la arhivare. Încercați din nou.'); return; }
    ids.forEach((id) => logEntityActivity('project', id, 'Proiectul a fost arhivat.'));
    setProjectSelectedIds(new Set());
    await reloadProjects();
  }, [supabase, projectSelectedIds, reloadProjects, logEntityActivity]);

  const saveProjectChecklist = useCallback(async (id: string, items: Project['checklist']) => {
    const { error } = await persistChecklist(supabase, 'current_projects', id, items || []);
    if (error) { console.error(error); alert('Lista nu a fost salvată. Încercați din nou.'); return false; }
    await reloadProjects();
    return true;
  }, [supabase, reloadProjects]);

  useEffect(() => {
    window.allProjects = projects;
    return () => { if (window.allProjects === projects) delete window.allProjects; };
  }, [projects]);

  // search.js's smart search still calls calcProjectStatus(...) as a bare
  // identifier (its own copy lived in the now-deleted projects.js) --
  // same bridge contract as window.allTickets/window.goToTicket for
  // Tickets: a bare reference with no shadowing declaration anywhere
  // falls through to this window property.
  useEffect(() => {
    window.calcProjectStatus = calcProjectStatus;
    return () => { if (window.calcProjectStatus === calcProjectStatus) delete window.calcProjectStatus; };
  }, []);

  // ---- backlog_projects (Avarii rețele) ----
  const [backlogProjects, setBacklogProjects] = useState<BacklogProject[]>([]);
  const [backlogLoading, setBacklogLoading] = useState(true);
  const [backlogFilter, setBacklogFilterState] = useState<BacklogFilterKey>('Ongoing');
  const [backlogSearchQuery, setBacklogSearchQuery] = useState('');
  const [backlogFormOpen, setBacklogFormOpen] = useState(false);
  const [editingBacklog, setEditingBacklog] = useState<BacklogProject | null>(null);

  const reloadBacklog = useCallback(async () => {
    const { data, error } = await supabase.from('backlog_projects').select('*').order('start_date', { ascending: true });
    if (error) { console.error(error); setBacklogLoading(false); return; }
    setBacklogProjects((data as BacklogProject[]) || []);
    setBacklogLoading(false);
  }, [supabase]);

  useEffect(() => { if (sessionEmail) reloadBacklog(); }, [sessionEmail, reloadBacklog]);

  const setBacklogFilter = useCallback((key: BacklogFilterKey) => setBacklogFilterState(key), []);

  const filteredBacklogProjects = useMemo(() => {
    const q = backlogSearchQuery.trim().toLowerCase();
    return backlogProjects.filter((p) => {
      const statusMatches = backlogFilter === 'Toate' || (p.status || 'Ongoing') === backlogFilter;
      const searchMatches = !q || [p.title, p.address, p.employee_name, p.description].some((f) => (f || '').toLowerCase().includes(q));
      return statusMatches && searchMatches;
    });
  }, [backlogProjects, backlogFilter, backlogSearchQuery]);

  const openBacklogForm = useCallback((p: BacklogProject | null) => { setEditingBacklog(p); setBacklogFormOpen(true); }, []);
  const closeBacklogForm = useCallback(() => setBacklogFormOpen(false), []);

  const saveBacklog = useCallback(async (payload: { title: string; address: string; employee_name: string | null; start_date: string; description: string | null }, id: string | null) => {
    const { error } = id
      ? await supabase.from('backlog_projects').update(payload).eq('id', id)
      : await supabase.from('backlog_projects').insert(payload);
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return false; }
    showToast(id ? 'Lucrarea a fost actualizată.' : 'Lucrarea a fost adăugată.');
    setBacklogFormOpen(false);
    await reloadBacklog();
    return true;
  }, [supabase, reloadBacklog]);

  const toggleBacklogStatus = useCallback(async (p: BacklogProject) => {
    const isDone = (p.status || 'Ongoing') === 'Terminat';
    const nextStatus = isDone ? 'Ongoing' : 'Terminat';
    const question = isDone ? `Reactivați lucrarea "${p.title}"?` : `Marcați lucrarea "${p.title}" ca soluționată? Va fi mutată în tab-ul „Soluționate”.`;
    if (!confirm(question)) return;
    const { error } = await supabase.from('backlog_projects').update({ status: nextStatus, resolved_on: isDone ? null : new Date().toISOString() }).eq('id', p.id);
    if (error) { console.error(error); alert('Eroare la actualizarea lucrării. Încercați din nou.'); return; }
    logEntityActivity('backlog', p.id, isDone ? 'Lucrarea a fost reactivată.' : 'Lucrarea a fost marcată ca soluționată.');
    await reloadBacklog();
  }, [supabase, reloadBacklog, logEntityActivity]);

  const saveBacklogChecklist = useCallback(async (id: string, items: BacklogProject['checklist']) => {
    const { error } = await persistChecklist(supabase, 'backlog_projects', id, items || []);
    if (error) { console.error(error); alert('Lista nu a fost salvată. Încercați din nou.'); return false; }
    await reloadBacklog();
    return true;
  }, [supabase, reloadBacklog]);

  useEffect(() => {
    window.allBacklogProjects = backlogProjects;
    return () => { if (window.allBacklogProjects === backlogProjects) delete window.allBacklogProjects; };
  }, [backlogProjects]);

  // ---- work_orders (Programe lucrări) ----
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workOrdersLoading, setWorkOrdersLoading] = useState(true);
  const [workOrderFormOpen, setWorkOrderFormOpen] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<WorkOrder | null>(null);
  const [workOrderFormDefaultDate, setWorkOrderFormDefaultDate] = useState<string | null>(null);

  const reloadWorkOrders = useCallback(async () => {
    const { data, error } = await supabase.from('work_orders').select('*').order('scheduled_date', { ascending: true });
    if (error) { console.error(error); setWorkOrdersLoading(false); return; }
    setWorkOrders((data as WorkOrder[]) || []);
    setWorkOrdersLoading(false);
  }, [supabase]);

  useEffect(() => { if (sessionEmail) reloadWorkOrders(); }, [sessionEmail, reloadWorkOrders]);

  // Supabase is shared across staff accounts. Refresh when returning to a
  // module so edits made by another person do not remain invisible until
  // this user makes a local change or signs in again.
  useEffect(() => {
    const onTabChange = (event: Event) => {
      if (!sessionEmail) return;
      const tab = (event as CustomEvent<string>).detail;
      if (tab === 'projects-home') {
        void Promise.all([reloadProjects(), reloadBacklog(), reloadWorkOrders()]);
      } else if (tab === 'projects') {
        void reloadProjects();
      } else if (tab === 'backlog') {
        void reloadBacklog();
      } else if (tab === 'workorders') {
        void reloadWorkOrders();
      }
    };
    window.addEventListener('admin:tabchange', onTabChange);
    return () => window.removeEventListener('admin:tabchange', onTabChange);
  }, [sessionEmail, reloadProjects, reloadBacklog, reloadWorkOrders]);

  const openWorkOrderForm = useCallback((w: WorkOrder | null, defaultDate?: string) => {
    setEditingWorkOrder(w);
    setWorkOrderFormDefaultDate(defaultDate || null);
    setWorkOrderFormOpen(true);
  }, []);
  const closeWorkOrderForm = useCallback(() => setWorkOrderFormOpen(false), []);

  const saveWorkOrder = useCallback(async (payload: Omit<WorkOrder, 'id' | 'status'>, id: string | null) => {
    const { error } = id
      ? await supabase.from('work_orders').update(payload).eq('id', id)
      : await supabase.from('work_orders').insert(payload);
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return false; }
    showToast(id ? 'Programarea a fost actualizată.' : 'Programarea a fost adăugată.');
    setWorkOrderFormOpen(false);
    await reloadWorkOrders();
    return true;
  }, [supabase, reloadWorkOrders]);

  const markWorkOrderDone = useCallback(async (w: WorkOrder) => {
    if (!confirm(`Marcați „${w.title}” ca finalizată?`)) return;
    const { error } = await supabase.from('work_orders').update({ status: 'Finalizat' }).eq('id', w.id);
    if (error) { console.error(error); alert('Eroare la actualizare. Încercați din nou.'); return; }
    await reloadWorkOrders();
  }, [supabase, reloadWorkOrders]);

  const deleteWorkOrder = useCallback(async (w: WorkOrder) => {
    if (!confirm(`Ștergeți definitiv programarea „${w.title}”?`)) return;
    const { error } = await supabase.from('work_orders').delete().eq('id', w.id);
    if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
    await reloadWorkOrders();
  }, [supabase, reloadWorkOrders]);

  useEffect(() => {
    window.allWorkOrders = workOrders;
    return () => { if (window.allWorkOrders === workOrders) delete window.allWorkOrders; };
  }, [workOrders]);

  return {
    projects, projectsLoading, reloadProjects, projectAvailableYears,
    projectsFilter, setProjectsFilter, projectYearFilter, setProjectYearFilter, projectYearFilterTouched,
    projectSearchQuery, setProjectSearchQuery, filteredProjects,
    projectSelectedIds, toggleProjectSelected, clearProjectSelection,
    projectFormOpen, editingProject, openProjectForm, closeProjectForm,
    saveProject, deleteProject, restoreProject, archiveSelectedProjects, saveProjectChecklist,

    backlogProjects, backlogLoading, reloadBacklog,
    backlogFilter, setBacklogFilter, backlogSearchQuery, setBacklogSearchQuery, filteredBacklogProjects,
    backlogFormOpen, editingBacklog, openBacklogForm, closeBacklogForm,
    saveBacklog, toggleBacklogStatus, saveBacklogChecklist,

    workOrders, workOrdersLoading, reloadWorkOrders,
    workOrderFormOpen, editingWorkOrder, workOrderFormDefaultDate, openWorkOrderForm, closeWorkOrderForm,
    saveWorkOrder, markWorkOrderDone, deleteWorkOrder,

    logEntityActivity,
  };
}

export type ProjectsStore = ReturnType<typeof useProjectsStore>;

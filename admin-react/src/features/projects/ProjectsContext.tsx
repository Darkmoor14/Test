import { createContext, useContext, type ReactNode } from 'react';
import { useProjectsStore, type ProjectsStore } from './useProjectsStore';

const ProjectsStoreContext = createContext<ProjectsStore | null>(null);

export function ProjectsStoreProvider({ sessionEmail, children }: { sessionEmail: string | null; children: ReactNode }) {
  const store = useProjectsStore(sessionEmail);
  return <ProjectsStoreContext.Provider value={store}>{children}</ProjectsStoreContext.Provider>;
}

export function useProjects(): ProjectsStore {
  const store = useContext(ProjectsStoreContext);
  if (!store) throw new Error('useProjects() called outside <ProjectsStoreProvider>');
  return store;
}

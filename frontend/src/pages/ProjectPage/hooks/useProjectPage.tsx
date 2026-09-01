import { createContext, useContext, type ReactNode } from 'react';
import { useProjectPageController } from './useProjectPageController';

type ProjectPageContextValue = ReturnType<typeof useProjectPageController>;

const ProjectPageContext = createContext<ProjectPageContextValue | null>(null);

export function ProjectPageProvider({ children }: { children: ReactNode }) {
  const ctx = useProjectPageController();
  return <ProjectPageContext.Provider value={ctx}>{children}</ProjectPageContext.Provider>;
}

export function useProjectPage() {
  const ctx = useContext(ProjectPageContext);
  if (!ctx) throw new Error('useProjectPage must be used within ProjectPageProvider');
  return ctx;
}

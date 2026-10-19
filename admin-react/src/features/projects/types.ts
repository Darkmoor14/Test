import type { ChecklistItem } from '../shared/ChecklistSheet';

export interface Project {
  id: string;
  title: string;
  address: string;
  start_date: string;
  due_date: string;
  notes: string | null;
  checklist: ChecklistItem[] | null;
  archived: boolean | null;
  archived_at: string | null;
}

export interface BacklogProject {
  id: string;
  title: string;
  address: string;
  employee_name: string | null;
  start_date: string;
  description: string | null;
  status: string | null; // 'Ongoing' | 'Terminat'
  resolved_on: string | null;
  checklist: ChecklistItem[] | null;
}

export interface WorkOrder {
  id: string;
  title: string;
  location: string | null;
  crew: string | null;
  scheduled_date: string;
  scheduled_end_date: string | null;
  description: string | null;
  status: string; // 'Programat' | 'Finalizat' | 'Anulat'
}

export type ProjectStatusKey = 'scheduled' | 'progress' | 'done';
export type ProjectsFilterKey = 'Ongoing' | 'Terminat' | 'Toate';
export type BacklogFilterKey = 'Ongoing' | 'Terminat' | 'Toate';

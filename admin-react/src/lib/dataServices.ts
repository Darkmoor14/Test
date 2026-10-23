import type { SupabaseClient } from '@supabase/supabase-js';

export type ChecklistTable = 'current_projects' | 'backlog_projects' | 'lps_lookahead_items';

/** Shared persistence boundary for checklist edits from React and vanilla panels. */
export async function saveChecklist(
  supabase: SupabaseClient,
  table: ChecklistTable,
  id: string,
  items: Array<{ text: string; done: boolean }>,
) {
  return supabase.from(table).update({ checklist: items }).eq('id', id);
}

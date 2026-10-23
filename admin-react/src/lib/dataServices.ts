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

/** Shared ticket persistence boundary used by React ticket workflows. */
export const ticketData = {
  list: (db: SupabaseClient) => db.from('tickets').select('*').order('submitted_on', { ascending: false }),
  update: (db: SupabaseClient, id: string, values: Record<string, unknown>) => db.from('tickets').update(values).eq('id', id),
  updateMany: (db: SupabaseClient, ids: string[], values: Record<string, unknown>) => db.from('tickets').update(values).in('id', ids),
  updateByNumber: (db: SupabaseClient, ticketNumber: string, values: Record<string, unknown>) => db.from('tickets').update(values).eq('ticket_number', ticketNumber),
  create: (db: SupabaseClient, values: { p_type: string; p_name: string; p_phone: string; p_email: string | null; p_address: string; p_description: string | null }) => db.rpc('create_ticket', values),
};

/** Shared project, network-backlog, and work-order persistence boundary. */
export const projectData = {
  listProjects: (db: SupabaseClient) => db.from('current_projects').select('*').order('start_date', { ascending: true }),
  saveProject: (db: SupabaseClient, id: string | null, values: Record<string, unknown>) => id
    ? db.from('current_projects').update(values).eq('id', id)
    : db.from('current_projects').insert(values),
  updateProject: (db: SupabaseClient, id: string, values: Record<string, unknown>) => db.from('current_projects').update(values).eq('id', id),
  updateProjects: (db: SupabaseClient, ids: string[], values: Record<string, unknown>) => db.from('current_projects').update(values).in('id', ids),
  deleteProject: (db: SupabaseClient, id: string) => db.from('current_projects').delete().eq('id', id),
  listBacklog: (db: SupabaseClient) => db.from('backlog_projects').select('*').order('start_date', { ascending: true }),
  saveBacklog: (db: SupabaseClient, id: string | null, values: Record<string, unknown>) => id
    ? db.from('backlog_projects').update(values).eq('id', id)
    : db.from('backlog_projects').insert(values),
  updateBacklog: (db: SupabaseClient, id: string, values: Record<string, unknown>) => db.from('backlog_projects').update(values).eq('id', id),
  listWorkOrders: (db: SupabaseClient) => db.from('work_orders').select('*').order('scheduled_date', { ascending: true }),
  saveWorkOrder: (db: SupabaseClient, id: string | null, values: Record<string, unknown>) => id
    ? db.from('work_orders').update(values).eq('id', id)
    : db.from('work_orders').insert(values),
  updateWorkOrder: (db: SupabaseClient, id: string, values: Record<string, unknown>) => db.from('work_orders').update(values).eq('id', id),
  deleteWorkOrder: (db: SupabaseClient, id: string) => db.from('work_orders').delete().eq('id', id),
};

/** Shared ERP persistence boundary for inventory and stock history. */
export const erpData = {
  listInventory: (db: SupabaseClient) => db.from('equipment_inventory').select('*').order('name', { ascending: true }),
  listAssignments: (db: SupabaseClient) => db.from('lps_resource_assignments').select('*'),
  updateInventory: (db: SupabaseClient, id: string, values: Record<string, unknown>) => db.from('equipment_inventory').update(values).eq('id', id),
  insertInventory: (db: SupabaseClient, values: Record<string, unknown>) => db.from('equipment_inventory').insert(values).select(),
  deleteInventory: (db: SupabaseClient, id: string) => db.from('equipment_inventory').delete().eq('id', id),
  addStockLedgerEntry: (db: SupabaseClient, values: Record<string, unknown>) => db.from('stock_ledger').insert(values),
};

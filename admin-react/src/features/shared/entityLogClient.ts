import type { SupabaseClient } from '@supabase/supabase-js';

// Plain (non-hook) helper so it can be called from anywhere -- mutation
// handlers in useProjectsStore/useErpStore, and (via the window bridge
// set up in SharedSheetsRoot) still-vanilla LPS/Parc Auto code, which
// used to call admin-core.js's own logEntityActivity() by bare name.
export function createLogEntityActivity(supabase: SupabaseClient, getSessionEmail: () => string | null) {
  return async function logEntityActivity(entityType: string, entityId: string, text: string): Promise<void> {
    try {
      await supabase.from('entity_log').insert({ entity_type: entityType, entity_id: entityId, kind: 'activity', text, user_email: getSessionEmail() || null });
    } catch {
      // best effort -- never block the action it's describing
    }
  };
}

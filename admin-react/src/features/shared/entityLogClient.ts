import type { SupabaseClient } from '@supabase/supabase-js';

// Plain (non-hook) helper so it can be called from anywhere -- mutation
// handlers in useProjectsStore/useErpStore/useTicketsStore, and (via the
// window bridge set up in SharedSheetsRoot) still-vanilla LPS/Parc Auto
// code, which used to call admin-core.js's own logEntityActivity() by
// bare name.
export function createLogEntityActivity(supabase: SupabaseClient, getSessionEmail: () => string | null) {
  return async function logEntityActivity(entityType: string, entityId: string, text: string): Promise<void> {
    try {
      await supabase.from('entity_log').insert({ entity_type: entityType, entity_id: entityId, kind: 'activity', text, user_email: getSessionEmail() || null });
    } catch {
      // best effort -- never block the action it's describing
    }
  };
}

// Originally ERP-only (see erpUtils.ts's old copy); moved here once
// Tickets needed the exact same "what actually changed" diffing --
// without it, every edit logged identically regardless of whether one
// typo was fixed or the whole record was rewritten.
export function describeFieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): string {
  const changes: string[] = [];
  for (const key of Object.keys(labels)) {
    const oldVal = before[key];
    const newVal = after[key];
    const oldNorm = oldVal === null || oldVal === undefined || oldVal === '' ? '—' : String(oldVal);
    const newNorm = newVal === null || newVal === undefined || newVal === '' ? '—' : String(newVal);
    if (oldNorm !== newNorm) changes.push(`${labels[key]}: ${oldNorm} → ${newNorm}`);
  }
  return changes.join('; ');
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { useRealtimeReload } from '../../lib/useRealtimeReload';

// Independent of admin-3.html's own vanilla currentUserRoles/allStaffEmails
// globals -- same reasoning as AuditLog.tsx's entity-title resolution: this
// pilot runs on its own data rather than depending on another (still
// vanilla) page's already-loaded state.
export function useStaffRoster(sessionEmail: string | null) {
  const supabase = useSupabase();
  const [roles, setRoles] = useState<string[]>([]);
  const [allStaffEmails, setAllStaffEmails] = useState<string[]>([]);
  // Mirrors staff_permission()'s own extra grant: a legacy
  // admin_html_access row with role='full' gets ticket write access
  // independent of staff_roles. Without this, this hook's modulePermission
  // could say 'none' for 'tickets' while the DB (and admin-core.js's own
  // separate copy of this same check) would actually allow the write --
  // UI controls gated on this hook would then block someone the DB lets
  // through.
  const [legacyTicketsFull, setLegacyTicketsFull] = useState(false);
  const [loading, setLoading] = useState(true);

  // load() now has two callers (the mount/sessionEmail effect below,
  // and realtime) that can overlap -- this call-id guard keeps a
  // response that finishes out of order from clobbering state with
  // stale data, same protection the single effect's own `cancelled`
  // flag used to give it before load() became a shared callback.
  const latestCallId = useRef(0);
  const load = useCallback(async () => {
    const callId = ++latestCallId.current;
    const rosterPromise = supabase.from('staff_roles').select('email').order('email', { ascending: true });
    const rolesPromise = sessionEmail
      ? supabase.from('staff_roles').select('role').eq('email', sessionEmail)
      : Promise.resolve({ data: [] as { role: string }[], error: null });
    const legacyPromise = sessionEmail
      ? supabase.from('admin_html_access').select('role').eq('email', sessionEmail)
      : Promise.resolve({ data: [] as { role: string }[], error: null });
    const [{ data: rosterRows }, { data: roleRows }, { data: legacyRows }] = await Promise.all([rosterPromise, rolesPromise, legacyPromise]);
    if (callId !== latestCallId.current) return;
    setAllStaffEmails([...new Set((rosterRows || []).map((r: { email: string }) => r.email))]);
    setRoles((roleRows || []).map((r: { role: string }) => r.role));
    setLegacyTicketsFull((legacyRows || []).some((r: { role: string }) => r.role === 'full'));
    setLoading(false);
  }, [supabase, sessionEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  // A permission change (someone else granting/revoking a module,
  // or this person's own role being edited from another device) now
  // takes effect without needing to sign out or reload.
  useRealtimeReload(supabase, 'staff_roles', load, !!sessionEmail);

  const isGod = roles.includes('god');
  const modulePermission = (mod: string): 'write' | 'none' =>
    (isGod || roles.includes(mod) || (mod === 'tickets' && legacyTicketsFull)) ? 'write' : 'none';

  return { loading, isGod, modulePermission, allStaffEmails };
}

import { useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';

// Independent of admin-3.html's own vanilla currentUserRoles/allStaffEmails
// globals -- same reasoning as AuditLog.tsx's entity-title resolution: this
// pilot runs on its own data rather than depending on another (still
// vanilla) page's already-loaded state.
export function useStaffRoster(sessionEmail: string | null) {
  const supabase = useSupabase();
  const [roles, setRoles] = useState<string[]>([]);
  const [allStaffEmails, setAllStaffEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const rosterPromise = supabase.from('staff_roles').select('email').order('email', { ascending: true });
      const rolesPromise = sessionEmail
        ? supabase.from('staff_roles').select('role').eq('email', sessionEmail)
        : Promise.resolve({ data: [] as { role: string }[], error: null });
      const [{ data: rosterRows }, { data: roleRows }] = await Promise.all([rosterPromise, rolesPromise]);
      if (cancelled) return;
      setAllStaffEmails([...new Set((rosterRows || []).map((r: { email: string }) => r.email))]);
      setRoles((roleRows || []).map((r: { role: string }) => r.role));
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [supabase, sessionEmail]);

  const isGod = roles.includes('god');
  const modulePermission = (mod: string): 'write' | 'none' => (isGod || roles.includes(mod) ? 'write' : 'none');

  return { loading, isGod, modulePermission, allStaffEmails };
}

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';

export interface SavedFilterView {
  id: string;
  name: string;
  filter_json: { status: string; year?: string; month?: string; day?: number | null };
}

export function useSavedFilterViews(scope: string, sessionEmail: string | null) {
  const supabase = useSupabase();
  const [views, setViews] = useState<SavedFilterView[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('saved_filter_views').select('*').eq('scope', scope).order('created_at', { ascending: true });
    if (error) return;
    setViews((data as SavedFilterView[]) || []);
  }, [supabase, scope]);

  const save = useCallback(async (name: string, filterJson: SavedFilterView['filter_json']) => {
    const { data, error } = await supabase.from('saved_filter_views').insert({
      scope, name, filter_json: filterJson, user_email: sessionEmail || null,
    }).select();
    if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return; }
    if (data && data[0]) setViews((prev) => [...prev, data[0] as SavedFilterView]);
  }, [supabase, scope, sessionEmail]);

  const remove = useCallback(async (id: string) => {
    setViews((prev) => prev.filter((v) => v.id !== id));
    await supabase.from('saved_filter_views').delete().eq('id', id);
  }, [supabase]);

  useEffect(() => { /* loaded lazily on popover open via load() */ }, []);

  return { views, load, save, remove };
}

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
    let removed: SavedFilterView | undefined;
    let removedIndex = -1;
    setViews((prev) => {
      removedIndex = prev.findIndex((v) => v.id === id);
      removed = prev[removedIndex];
      return prev.filter((v) => v.id !== id);
    });
    const { error } = await supabase.from('saved_filter_views').delete().eq('id', id);
    if (error && removed) {
      // The optimistic removal above was wrong -- put it back rather than
      // leave the UI showing it gone while it's still saved server-side
      // with no indication anything failed (CLICK-PATH-104/302).
      console.error(error);
      alert('Nu am putut șterge vizualizarea salvată. Încercați din nou.');
      setViews((prev) => {
        const next = prev.slice();
        next.splice(Math.min(removedIndex, next.length), 0, removed as SavedFilterView);
        return next;
      });
    }
  }, [supabase]);

  useEffect(() => { /* loaded lazily on popover open via load() */ }, []);

  return { views, load, save, remove };
}

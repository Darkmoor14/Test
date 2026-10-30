import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { useRealtimeReload } from '../../lib/useRealtimeReload';

export interface DocsPage {
  id: string;
  slug: string;
  title: string;
  content: string;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics (ă/â/î/ș/ț etc.)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pagina';
}

export function useDocsStore(sessionEmail: string | null, canWrite: boolean) {
  const supabase = useSupabase();
  const [pages, setPages] = useState<DocsPage[]>([]);
  const [loading, setLoading] = useState(true);

  const latestCallId = useRef(0);
  const reload = useCallback(async () => {
    const callId = ++latestCallId.current;
    const { data } = await supabase.from('docs_pages').select('*').order('title', { ascending: true });
    if (callId !== latestCallId.current) return;
    setPages((data || []) as DocsPage[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void reload(); }, [reload]);
  useRealtimeReload(supabase, 'docs_pages', reload);

  const savePage = useCallback(async (page: { id?: string; title: string; content: string }): Promise<DocsPage> => {
    if (!canWrite) throw new Error('Nu aveți permisiunea de a edita documentația.');
    const title = page.title.trim();
    if (!title) throw new Error('Titlul este obligatoriu.');

    let data: DocsPage;
    if (page.id) {
      const { data: row, error } = await supabase
        .from('docs_pages')
        .update({ title, content: page.content, updated_by: sessionEmail })
        .eq('id', page.id)
        .select('*')
        .single();
      if (error) throw error;
      data = row as DocsPage;
    } else {
      // Existing slugs collide (e.g. two "Ghid" pages) -- append a
      // short suffix rather than failing the save outright.
      let slug = slugify(title);
      if (pages.some((p) => p.slug === slug)) slug = `${slug}-${Date.now().toString(36)}`;
      const { data: row, error } = await supabase
        .from('docs_pages')
        .insert({ slug, title, content: page.content, updated_by: sessionEmail })
        .select('*')
        .single();
      if (error) throw error;
      data = row as DocsPage;
    }

    await supabase.from('docs_page_revisions').insert({ page_id: data.id, content: data.content, edited_by: sessionEmail });
    await reload();
    return data;
  }, [supabase, sessionEmail, canWrite, pages, reload]);

  const deletePage = useCallback(async (id: string) => {
    if (!canWrite) throw new Error('Nu aveți permisiunea de a șterge pagini.');
    const { error } = await supabase.from('docs_pages').delete().eq('id', id);
    if (error) throw error;
    await reload();
  }, [supabase, canWrite, reload]);

  return { pages, loading, savePage, deletePage, reload };
}

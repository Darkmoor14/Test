import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';

export interface SiteStatsState {
  loading: boolean;
  error: string | null;
  pageviews: { days: string[]; total: number[]; unique: number[]; totalSum: number; uniqueSum: number } | null;
  topPages: { path: string; count: number }[];
  funnel: { ticketSubmitted: number; contactFormSubmitted: number } | null;
}

const initialState: SiteStatsState = {
  loading: true,
  error: null,
  pageviews: null,
  topPages: [],
  funnel: null,
};

// Fetches the last 30 days of public-website analytics from the
// posthog-stats edge function (which holds the PostHog Personal API
// Key server-side -- see that function for why this can't just call
// PostHog directly from the browser).
export function useSiteStats() {
  const supabase = useSupabase();
  const [state, setState] = useState<SiteStatsState>(initialState);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await supabase.functions.invoke('posthog-stats');
      if (error) throw error;
      setState({
        loading: false,
        error: null,
        pageviews: data.pageviews,
        topPages: data.topPages || [],
        funnel: data.funnel,
      });
    } catch (err) {
      setState({
        ...initialState,
        loading: false,
        error: err instanceof Error ? err.message : 'Nu s-au putut încărca statisticile.',
      });
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  return { state, reload: load };
}

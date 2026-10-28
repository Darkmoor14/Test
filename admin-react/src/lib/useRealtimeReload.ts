import { useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

// Subscribes to Postgres Changes on one or more tables and calls
// `reload` (debounced) whenever ANY row in any of them changes --
// insert, update or delete, by anyone, on any device. Deliberately
// doesn't try to patch the changed row into local state itself: every
// store's own reload() already knows how to re-fetch, filter and sort
// correctly, so re-running it is both simpler and impossible to get
// subtly wrong compared to hand-merging a realtime payload.
//
// Debounced (not fired on the leading edge) so a burst of changes --
// e.g. several rows touched by one bulk action -- triggers one reload,
// not one per row. A ref holds the latest `reload` so the one realtime
// subscription set up on mount always calls the current closure
// without needing to resubscribe every render.
//
// Requires the table to actually be in the `supabase_realtime`
// publication (see 20261028090000_enable_realtime_core_tables.sql) --
// Postgres Changes broadcasts nothing for a table that isn't, and RLS
// still applies on top of that (a client only ever hears about a row
// it could have SELECTed anyway).
export function useRealtimeReload(
  supabase: SupabaseClient,
  tables: string | string[],
  reload: () => void | Promise<void>,
  enabled = true,
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const tableList = Array.isArray(tables) ? tables : [tables];
  const tableKey = tableList.join(',');

  useEffect(() => {
    if (!enabled || !tableList.length) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const triggerReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void reloadRef.current(); }, 400);
    };

    let channel = supabase.channel(`realtime:${tableKey}`);
    for (const table of tableList) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, triggerReload);
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, tableKey, enabled]);
}

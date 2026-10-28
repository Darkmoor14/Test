import { useEffect, useRef } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

// Subscribes to Postgres Changes on one or more tables and calls
// `reload` (debounced) whenever ANY row in any of them changes --
// insert, update or delete, by anyone, on any device. Deliberately
// doesn't try to patch the changed row into local state itself: every
// store's own reload() already knows how to re-fetch, filter and sort
// correctly, so re-running it is both simpler and impossible to get
// subtly wrong compared to hand-merging a realtime payload.
//
// Requires the table to actually be in the `supabase_realtime`
// publication (see 20261028090000_enable_realtime_core_tables.sql) --
// Postgres Changes broadcasts nothing for a table that isn't, and RLS
// still applies on top of that (a client only ever hears about a row
// it could have SELECTed anyway).
//
// --- module-level dedup, not one subscription per caller ---
// Some hooks that use this (useStaffRoster) are plain hooks called
// independently by several components, including once per rendered
// TicketCard -- a ticket list is not one or two of those, it's
// however many tickets are open. Without this registry, each one
// would open its OWN Realtime channel for the same table, multiplying
// a handful of expected subscriptions into dozens of simultaneous
// websocket joins on every page that renders a list of them. The
// registry keeps exactly one real channel per (client, table-set),
// ref-counted, and fans a change out to every caller's own debounced
// reload; the channel itself is only torn down once the last caller
// unmounts.
interface ChannelEntry {
  channel: RealtimeChannel;
  listeners: Set<() => void>;
  refCount: number;
}
const registryByClient = new WeakMap<SupabaseClient, Map<string, ChannelEntry>>();

function acquireChannel(supabase: SupabaseClient, tableKey: string, tableList: string[], listener: () => void): () => void {
  let clientRegistry = registryByClient.get(supabase);
  if (!clientRegistry) {
    clientRegistry = new Map();
    registryByClient.set(supabase, clientRegistry);
  }

  let entry = clientRegistry.get(tableKey);
  if (!entry) {
    const listeners = new Set<() => void>();
    try {
      let channel = supabase.channel(`realtime:${tableKey}`);
      for (const table of tableList) {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          listeners.forEach((fn) => fn());
        });
      }
      channel.subscribe();
      entry = { channel, listeners, refCount: 0 };
      clientRegistry.set(tableKey, entry);
    } catch (err) {
      // Realtime is a liveliness nicety, never a hard requirement --
      // a page's own data still loaded via the normal one-shot fetch
      // before this ran, so a subscription failure here (network,
      // Realtime unavailable, whatever) must never surface as a
      // broken page, only as "updates arrive on refresh" again.
      console.error(`useRealtimeReload: failed to subscribe to ${tableKey}`, err);
      return () => {};
    }
  }

  entry.listeners.add(listener);
  entry.refCount += 1;
  const activeEntry = entry;
  return () => {
    activeEntry.listeners.delete(listener);
    activeEntry.refCount -= 1;
    if (activeEntry.refCount <= 0) {
      try {
        supabase.removeChannel(activeEntry.channel);
      } catch {
        // already gone -- nothing to clean up
      }
      clientRegistry!.delete(tableKey);
    }
  };
}

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
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void reloadRef.current(); }, 400);
    };

    const release = acquireChannel(supabase, tableKey, tableList, onChange);
    return () => {
      if (timer) clearTimeout(timer);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, tableKey, enabled]);
}

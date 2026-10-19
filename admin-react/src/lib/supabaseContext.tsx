import { createContext, useContext, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function SupabaseProvider({ client, children }: { client: SupabaseClient; children: ReactNode }) {
  return <SupabaseContext.Provider value={client}>{children}</SupabaseContext.Provider>;
}

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error('useSupabase() called outside <SupabaseProvider>');
  return client;
}

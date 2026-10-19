import { createContext, useContext, type ReactNode } from 'react';
import { useTicketsStore, type TicketsStore } from './useTicketsStore';

const TicketsStoreContext = createContext<TicketsStore | null>(null);

export function TicketsStoreProvider({ sessionEmail, children }: { sessionEmail: string | null; children: ReactNode }) {
  const store = useTicketsStore(sessionEmail);
  return <TicketsStoreContext.Provider value={store}>{children}</TicketsStoreContext.Provider>;
}

export function useTickets(): TicketsStore {
  const store = useContext(TicketsStoreContext);
  if (!store) throw new Error('useTickets() called outside <TicketsStoreProvider>');
  return store;
}

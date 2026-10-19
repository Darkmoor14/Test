import { createContext, useContext, type ReactNode } from 'react';
import { useErpStore, type ErpStore } from './useErpStore';

const ErpStoreContext = createContext<ErpStore | null>(null);

export function ErpStoreProvider({ sessionEmail, children }: { sessionEmail: string | null; children: ReactNode }) {
  const store = useErpStore(sessionEmail);
  return <ErpStoreContext.Provider value={store}>{children}</ErpStoreContext.Provider>;
}

export function useErp(): ErpStore {
  const store = useContext(ErpStoreContext);
  if (!store) throw new Error('useErp() called outside <ErpStoreProvider>');
  return store;
}

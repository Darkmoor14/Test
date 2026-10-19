import type { ReactElement } from 'react';

export type HomeNavKey = 'tickets' | 'projects' | 'erp' | 'hr' | 'docs' | 'status';

const NAV_ITEMS: { key: HomeNavKey; label: string; sub: string; icon: ReactElement }[] = [
  {
    key: 'tickets', label: 'Sesizări', sub: 'Funcționale și accidente',
    icon: <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  },
  {
    key: 'projects', label: 'Proiecte', sub: 'Publice, avarii rețele, LPS, programe',
    icon: <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="14" x2="14" y2="14" /></svg>,
  },
  {
    key: 'erp', label: 'Resurse și inventar', sub: 'Echipamente, mașini, materiale, produse',
    icon: <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>,
  },
  {
    key: 'hr', label: 'HR', sub: 'Angajați, pontaj, concediu',
    icon: <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M17 3.13a4 4 0 0 1 0 7.75" /></svg>,
  },
  {
    key: 'docs', label: 'Documentație', sub: 'Ghid de utilizare a platformei',
    icon: <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>,
  },
  {
    key: 'status', label: 'Stare sistem', sub: 'Conexiune, funcții, memento-uri',
    icon: <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
  },
];

export function NavGrid({ visibility, onNavigate }: { visibility: Record<HomeNavKey, boolean>; onNavigate: (key: HomeNavKey) => void }) {
  return (
    <div className="home-nav-grid">
      {NAV_ITEMS.filter((item) => visibility[item.key]).map((item) => (
        <button key={item.key} type="button" className="home-nav-btn" onClick={() => onNavigate(item.key)}>
          <span className="home-nav-icon" aria-hidden="true">{item.icon}</span>
          <span className="home-nav-text"><span className="home-nav-label">{item.label}</span><span className="home-nav-sub">{item.sub}</span></span>
        </button>
      ))}
    </div>
  );
}

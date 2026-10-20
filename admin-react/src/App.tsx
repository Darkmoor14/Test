import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from './lib/supabaseContext';
import { useGlobalTelemetry } from './features/status/useGlobalTelemetry';
import { StatusDashboard } from './features/status/StatusDashboard';
import { AutoImprove } from './features/status/AutoImprove';
import { AuditLog } from './features/status/AuditLog';
import { Roles } from './features/status/Roles';
import { HomePage } from './features/home/HomePage';
import { TicketsRoot, type TicketsMountTargets } from './features/tickets/TicketsRoot';

type StatusTab = 'home' | 'overview' | 'tickets-functional' | 'reports' | 'status' | 'status-improve' | 'status-audit' | 'status-roles';

const TABS: { key: StatusTab; label: string }[] = [
  { key: 'home', label: 'Acasă' },
  { key: 'overview', label: 'Sesizări — Overview' },
  { key: 'tickets-functional', label: 'Sesizări — Listă' },
  { key: 'reports', label: 'Sesizări — Rapoarte' },
  { key: 'status', label: 'Stare sistem' },
  { key: 'status-improve', label: 'Auto-îmbunătățire' },
  { key: 'status-audit', label: 'Jurnal de activitate' },
  { key: 'status-roles', label: 'Roluri' },
];

// Standalone-only: TicketsRoot portals into real DOM containers shaped
// like admin-3.html's topbar slots (see TicketsRoot.tsx) -- this stub
// provides those containers for isolated dev testing, and dispatches
// the same admin:tabchange event lps.js dispatches for real, so
// Tickets' own view-tracking (Overview vs. the ticket list, which
// triggers a silent refresh on switch) behaves the same way here.
function TicketsStandaloneStub({ sessionEmail, activeTab }: { sessionEmail: string | null; activeTab: StatusTab }) {
  const overviewYearBar = useRef<HTMLDivElement>(null);
  const overviewQuickFilters = useRef<HTMLDivElement>(null);
  const ticketsYearBar = useRef<HTMLDivElement>(null);
  const ticketsQuickFilters = useRef<HTMLDivElement>(null);
  const ticketsPanelRoot = useRef<HTMLDivElement>(null);
  const reportsPanelRoot = useRef<HTMLDivElement>(null);
  const overviewPanelRoot = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<TicketsMountTargets | null>(null);

  useEffect(() => {
    if (overviewYearBar.current && overviewQuickFilters.current && ticketsYearBar.current && ticketsQuickFilters.current && ticketsPanelRoot.current && reportsPanelRoot.current) {
      setTargets({
        overviewYearBar: overviewYearBar.current,
        overviewQuickFilters: overviewQuickFilters.current,
        ticketsYearBar: ticketsYearBar.current,
        ticketsQuickFilters: ticketsQuickFilters.current,
        ticketsPanelRoot: ticketsPanelRoot.current,
        reportsPanelRoot: reportsPanelRoot.current,
      });
    }
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('admin:tabchange', { detail: activeTab }));
  }, [activeTab]);

  return (
    <>
      <div ref={overviewYearBar} style={{ display: activeTab === 'overview' ? 'flex' : 'none' }} />
      <div ref={overviewQuickFilters} style={{ display: activeTab === 'overview' ? 'flex' : 'none' }} />
      <div ref={ticketsYearBar} style={{ display: activeTab === 'tickets-functional' ? 'flex' : 'none' }} />
      <div ref={ticketsQuickFilters} style={{ display: activeTab === 'tickets-functional' ? 'flex' : 'none' }} />
      <div ref={overviewPanelRoot} style={{ display: activeTab === 'overview' ? 'block' : 'none' }} />
      <div ref={ticketsPanelRoot} style={{ display: activeTab === 'tickets-functional' ? 'block' : 'none' }} />
      <div ref={reportsPanelRoot} style={{ display: activeTab === 'reports' ? 'block' : 'none' }} />
      {targets && overviewPanelRoot.current && <TicketsRootMounter sessionEmail={sessionEmail} targets={targets} anchor={overviewPanelRoot.current} />}
    </>
  );
}

// TicketsRoot's own OverviewPanel renders as a direct child (same
// contract as the real mount: it lands wherever the tree itself is
// rendered) -- portal it into the dedicated overviewPanelRoot div.
function TicketsRootMounter({ sessionEmail, targets, anchor }: { sessionEmail: string | null; targets: TicketsMountTargets; anchor: HTMLElement }) {
  return createPortal(<TicketsRoot sessionEmail={sessionEmail} targets={targets} />, anchor);
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const supabase = useSupabase();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setError('Email sau parolă greșită.'); return; }
    onLoggedIn();
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h2>Admin — Stare sistem (pilot React)</h2>
        <p className="sub">Autentificare pentru echipa Insta Grup</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Parolă</label>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Se autentifică...' : 'Autentificare'}
          </button>
        </form>
      </div>
    </div>
  );
}

function NotGodScreen({ email }: { email: string }) {
  return (
    <div className="page-body" style={{ padding: 40 }}>
      <h2>Acces restricționat</h2>
      <p>Contul {email} nu are rolul „god" — acest pilot (Stare sistem) e disponibil doar pentru acel rol, la fel ca în admin-3.html.</p>
    </div>
  );
}

export default function App() {
  const supabase = useSupabase();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [isGod, setIsGod] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<StatusTab>('home');

  useGlobalTelemetry(sessionEmail);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!sessionEmail) { setIsGod(null); return; }
    supabase
      .from('staff_roles')
      .select('role')
      .eq('email', sessionEmail)
      .eq('role', 'god')
      .then(({ data }) => setIsGod(!!data && data.length > 0));
  }, [sessionEmail, supabase]);

  if (!sessionEmail) return <LoginScreen onLoggedIn={() => {}} />;
  if (isGod === null) return null;
  if (!isGod) return <NotGodScreen email={sessionEmail} />;

  return (
    <div className="dash show">
      <div className="app-shell">
        <div className="main">
          <div className="topbar">
            <span className="topbar-title">{TABS.find((t) => t.key === activeTab)?.label}</span>
            <div className="topbar-actions">
              <button
                type="button"
                className="sidebar-logout-btn"
                style={{ display: 'flex' }}
                onClick={() => supabase.auth.signOut()}
              >
                Deconectare
              </button>
            </div>
          </div>
          <div className="category-topbar active">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`admin-tab category-topbar-item${activeTab === t.key ? ' active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="page-body">
            {activeTab === 'home' && <HomePage sessionEmail={sessionEmail} onNavigate={() => {}} />}
            <TicketsStandaloneStub sessionEmail={sessionEmail} activeTab={activeTab} />
            {activeTab === 'status' && <StatusDashboard sessionEmail={sessionEmail} />}
            {activeTab === 'status-improve' && <AutoImprove />}
            {activeTab === 'status-audit' && <AuditLog />}
            {activeTab === 'status-roles' && <Roles sessionEmail={sessionEmail} />}
          </div>
        </div>
      </div>
    </div>
  );
}

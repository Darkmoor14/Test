import { useEffect, useState } from 'react';
import { useSupabase } from './lib/supabaseContext';
import { useGlobalTelemetry } from './features/status/useGlobalTelemetry';
import { StatusDashboard } from './features/status/StatusDashboard';
import { AutoImprove } from './features/status/AutoImprove';
import { AuditLog } from './features/status/AuditLog';
import { Roles } from './features/status/Roles';
import { HomePage } from './features/home/HomePage';

type StatusTab = 'home' | 'status' | 'status-improve' | 'status-audit' | 'status-roles';

const TABS: { key: StatusTab; label: string }[] = [
  { key: 'home', label: 'Acasă' },
  { key: 'status', label: 'Stare sistem' },
  { key: 'status-improve', label: 'Auto-îmbunătățire' },
  { key: 'status-audit', label: 'Jurnal de activitate' },
  { key: 'status-roles', label: 'Roluri' },
];

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

import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseProvider } from './lib/supabaseContext';
import { useGlobalTelemetry } from './features/status/useGlobalTelemetry';
import { StatusDashboard } from './features/status/StatusDashboard';
import { AutoImprove } from './features/status/AutoImprove';
import { AuditLog } from './features/status/AuditLog';
import { Roles } from './features/status/Roles';
import { useState, useEffect } from 'react';

// Entry point for mounting into admin-3.html, as opposed to main.tsx
// (the standalone dev app). The shell there already handles login,
// role-gating and navigation (rail/category-panel), so this only
// renders each panel's own content, reusing admin-3.html's EXISTING
// Supabase client/session rather than creating a second one.

declare global {
  interface Window {
    currentAdminTab?: string;
    AdminReactStatus?: {
      mountDashboard: (el: HTMLElement, client: SupabaseClient) => void;
      mountAutoImprove: (el: HTMLElement, client: SupabaseClient) => void;
      mountAuditLog: (el: HTMLElement, client: SupabaseClient) => void;
      mountRoles: (el: HTMLElement, client: SupabaseClient) => void;
    };
  }
}

function getCurrentTab(): string {
  return typeof window.currentAdminTab === 'string' ? window.currentAdminTab : 'status';
}

function useSessionEmail(client: SupabaseClient): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    client.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [client]);
  return email;
}

// The app-wide telemetry listeners (window.onerror, document click/keydown)
// live here, mounted exactly once alongside the dashboard -- not
// duplicated per panel, since all four panels share one page. Needs to be
// a child of SupabaseProvider (not called directly in DashboardRoot's own
// body) since useGlobalTelemetry reads the client via context.
function DashboardInner({ sessionEmail }: { sessionEmail: string | null }) {
  useGlobalTelemetry(sessionEmail, getCurrentTab);
  return <StatusDashboard sessionEmail={sessionEmail} landingPage="admin-3.html" />;
}

function DashboardRoot({ client }: { client: SupabaseClient }) {
  const sessionEmail = useSessionEmail(client);
  return (
    <SupabaseProvider client={client}>
      <DashboardInner sessionEmail={sessionEmail} />
    </SupabaseProvider>
  );
}

function AutoImproveRoot({ client }: { client: SupabaseClient }) {
  return (
    <SupabaseProvider client={client}>
      <AutoImprove />
    </SupabaseProvider>
  );
}

function AuditLogRoot({ client }: { client: SupabaseClient }) {
  return (
    <SupabaseProvider client={client}>
      <AuditLog />
    </SupabaseProvider>
  );
}

function RolesRoot({ client }: { client: SupabaseClient }) {
  const sessionEmail = useSessionEmail(client);
  return (
    <SupabaseProvider client={client}>
      <Roles sessionEmail={sessionEmail} />
    </SupabaseProvider>
  );
}

const roots = new WeakMap<HTMLElement, Root>();
function getRoot(el: HTMLElement): Root {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  return root;
}

window.AdminReactStatus = {
  mountDashboard(el, client) {
    getRoot(el).render(<DashboardRoot client={client} />);
  },
  mountAutoImprove(el, client) {
    getRoot(el).render(<AutoImproveRoot client={client} />);
  },
  mountAuditLog(el, client) {
    getRoot(el).render(<AuditLogRoot client={client} />);
  },
  mountRoles(el, client) {
    getRoot(el).render(<RolesRoot client={client} />);
  },
};

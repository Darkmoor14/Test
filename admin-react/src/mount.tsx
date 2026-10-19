import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseProvider } from './lib/supabaseContext';
import { useGlobalTelemetry } from './features/status/useGlobalTelemetry';
import { StatusDashboard } from './features/status/StatusDashboard';
import { AutoImprove } from './features/status/AutoImprove';
import { AuditLog } from './features/status/AuditLog';
import { Roles } from './features/status/Roles';
import { HomePage } from './features/home/HomePage';
import type { HomeNavKey } from './features/home/NavGrid';
import { TicketsRoot, type TicketsMountTargets } from './features/tickets/TicketsRoot';
import { ProjectsRoot, type ProjectsMountTargets } from './features/projects/ProjectsRoot';
import { ErpRoot, type ErpMountTargets } from './features/erp/ErpRoot';
import { SharedSheetsRoot } from './features/shared/SharedSheetsRoot';
import { useState, useEffect } from 'react';

// Entry point for mounting into admin-3.html, as opposed to main.tsx
// (the standalone dev app). The shell there already handles login,
// role-gating and navigation (rail/category-panel), so this only
// renders each panel's own content, reusing admin-3.html's EXISTING
// Supabase client/session rather than creating a second one.

declare global {
  interface Window {
    currentAdminTab?: string;
    openAdminTab?: (tabKey: string) => void;
    goHomeToTicketsOverview?: () => void;
    AdminReactStatus?: {
      mountDashboard: (el: HTMLElement, client: SupabaseClient) => void;
      mountAutoImprove: (el: HTMLElement, client: SupabaseClient) => void;
      mountAuditLog: (el: HTMLElement, client: SupabaseClient) => void;
      mountRoles: (el: HTMLElement, client: SupabaseClient) => void;
      mountHome: (el: HTMLElement, client: SupabaseClient) => void;
      mountTickets: (overviewPanelRootEl: HTMLElement, targets: TicketsMountTargets, client: SupabaseClient) => void;
      mountProjects: (projectsHomeRootEl: HTMLElement, targets: ProjectsMountTargets, client: SupabaseClient) => void;
      mountErp: (erpHomeRootEl: HTMLElement, targets: ErpMountTargets, client: SupabaseClient) => void;
      mountSharedSheets: (el: HTMLElement, client: SupabaseClient) => void;
    };
  }
}

// Maps Acasă's nav-grid buttons to their target tabs -- Tickets is now
// itself a React section too, so "Sesizări" is a plain openAdminTab
// call like every other nav button (no more window.goHomeToTicketsOverview
// bridge; that only existed to reset Sesizări's own vanilla search
// state, which Tickets' own React store now owns and resets itself).
const HOME_NAV_TARGETS: Record<HomeNavKey, string> = {
  tickets: 'overview',
  projects: 'projects-home',
  erp: 'erp-home',
  hr: 'hr-home',
  docs: 'docs',
  status: 'status',
};
function navigateFromHome(key: HomeNavKey) {
  window.openAdminTab?.(HOME_NAV_TARGETS[key]);
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

function HomeRoot({ client }: { client: SupabaseClient }) {
  const sessionEmail = useSessionEmail(client);
  return (
    <SupabaseProvider client={client}>
      <HomePage sessionEmail={sessionEmail} onNavigate={navigateFromHome} />
    </SupabaseProvider>
  );
}

function TicketsAppRoot({ client, targets }: { client: SupabaseClient; targets: TicketsMountTargets }) {
  const sessionEmail = useSessionEmail(client);
  return (
    <SupabaseProvider client={client}>
      <TicketsRoot sessionEmail={sessionEmail} targets={targets} />
    </SupabaseProvider>
  );
}

function ProjectsAppRoot({ client, targets }: { client: SupabaseClient; targets: ProjectsMountTargets }) {
  const sessionEmail = useSessionEmail(client);
  return (
    <SupabaseProvider client={client}>
      <ProjectsRoot sessionEmail={sessionEmail} targets={targets} />
    </SupabaseProvider>
  );
}

function ErpAppRoot({ client, targets }: { client: SupabaseClient; targets: ErpMountTargets }) {
  const sessionEmail = useSessionEmail(client);
  return (
    <SupabaseProvider client={client}>
      <ErpRoot sessionEmail={sessionEmail} targets={targets} />
    </SupabaseProvider>
  );
}

function SharedSheetsAppRoot({ client }: { client: SupabaseClient }) {
  const sessionEmail = useSessionEmail(client);
  return (
    <SupabaseProvider client={client}>
      <SharedSheetsRoot sessionEmail={sessionEmail} />
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
  mountHome(el, client) {
    getRoot(el).render(<HomeRoot client={client} />);
  },
  mountTickets(overviewPanelRootEl, targets, client) {
    getRoot(overviewPanelRootEl).render(<TicketsAppRoot client={client} targets={targets} />);
  },
  mountProjects(projectsHomeRootEl, targets, client) {
    getRoot(projectsHomeRootEl).render(<ProjectsAppRoot client={client} targets={targets} />);
  },
  mountErp(erpHomeRootEl, targets, client) {
    getRoot(erpHomeRootEl).render(<ErpAppRoot client={client} targets={targets} />);
  },
  mountSharedSheets(el, client) {
    getRoot(el).render(<SharedSheetsAppRoot client={client} />);
  },
};

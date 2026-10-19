import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { useMaybeLogStatusEvent } from './useStatusHistory';

export type DotState = 'ok' | 'bad' | 'checking' | null;

export interface FunctionListItem {
  name: string;
  note: string;
  tested: boolean;
}

export interface CronRun {
  status?: string;
}

export interface StatusState {
  db: { dot: DotState; latencyLabel: string; history: (number | null)[] };
  auth: { dot: DotState; stateLabel: string; subLabel: string };
  functions: { dot: DotState; latencyLabel: string; list: FunctionListItem[] };
  cron: { dot: DotState; stateLabel: string; runs: CronRun[] };
  counts: {
    tickets: number;
    current_projects: number;
    backlog_projects: number;
    calendar_events: number;
    push_subscriptions: number;
  };
  push: { dot: DotState; stateLabel: string; subLabel: string; deviceCount: number; showEnableButton: boolean };
  lastCheckedLabel: string;
}

const initialState: StatusState = {
  db: { dot: null, latencyLabel: '—', history: [] },
  auth: { dot: null, stateLabel: '—', subLabel: 'Sesiune' },
  functions: { dot: null, latencyLabel: '—', list: [] },
  cron: { dot: null, stateLabel: '—', runs: [] },
  counts: { tickets: 0, current_projects: 0, backlog_projects: 0, calendar_events: 0, push_subscriptions: 0 },
  push: { dot: null, stateLabel: '—', subLabel: '', deviceCount: 0, showEnableButton: false },
  lastCheckedLabel: '',
};

const PUSH_PERMISSION_LABEL: Record<string, string> = {
  granted: 'Permise',
  denied: 'Blocate',
  default: 'Neconfigurate',
  unsupported: 'Nesuportate',
};

export function useStatusChecks(sessionEmail: string | null) {
  const supabase = useSupabase();
  const [state, setState] = useState<StatusState>(initialState);
  const dbHistoryRef = useRef<(number | null)[]>([]);
  const maybeLog = useMaybeLogStatusEvent();

  const checkDb = useCallback(async () => {
    setState((s) => ({ ...s, db: { ...s.db, dot: 'checking' } }));
    const start = performance.now();
    const { error } = await supabase.from('tickets').select('id', { count: 'exact', head: true });
    const elapsed = Math.round(performance.now() - start);
    dbHistoryRef.current = [...dbHistoryRef.current, error ? null : elapsed].slice(-12);
    setState((s) => ({
      ...s,
      db: {
        dot: error ? 'bad' : 'ok',
        latencyLabel: error ? 'Eroare' : `${elapsed} ms`,
        history: dbHistoryRef.current,
      },
    }));
    maybeLog('db', !error, error ? `Interogare eșuată: ${error.message || 'eroare necunoscută'}` : `Răspuns în ${elapsed} ms`);
    return !error;
  }, [maybeLog, supabase]);

  const checkAuth = useCallback(async () => {
    setState((s) => ({ ...s, auth: { ...s.auth, dot: 'checking' } }));
    const { data, error } = await supabase.auth.getSession();
    const hasSession = !error && !!data?.session;
    setState((s) => ({
      ...s,
      auth: {
        dot: hasSession ? 'ok' : 'bad',
        stateLabel: hasSession ? 'Activă' : 'Fără sesiune',
        subLabel: hasSession ? sessionEmail || 'Sesiune activă' : 'Niciun utilizator autentificat',
      },
    }));
    maybeLog('auth', hasSession, hasSession ? `Sesiune activă — ${sessionEmail || 'utilizator necunoscut'}` : 'Nicio sesiune activă');
  }, [maybeLog, sessionEmail, supabase]);

  const checkFunctions = useCallback(async () => {
    setState((s) => ({ ...s, functions: { ...s.functions, dot: 'checking' } }));
    const start = performance.now();
    let ok = false;
    let errDetail = '';
    try {
      const { error } = await supabase.functions.invoke('status-ping');
      ok = !error;
      if (error) errDetail = error.message || String(error);
    } catch (err) {
      ok = false;
      errDetail = err instanceof Error ? err.message : String(err);
    }
    const elapsed = Math.round(performance.now() - start);
    const list: FunctionListItem[] = [
      { name: 'status-ping', note: ok ? `${elapsed} ms` : `eroare — ${errDetail || 'necunoscută'}`, tested: true },
      { name: 'send-push', note: 'nu e testat direct — vezi jobul de memento-uri mai jos', tested: false },
      { name: 'bright-processor', note: 'nu e testat direct (e-mail)', tested: false },
    ];
    setState((s) => ({
      ...s,
      functions: { dot: ok ? 'ok' : 'bad', latencyLabel: ok ? `${elapsed} ms` : 'Eroare', list },
    }));
    maybeLog('functions', ok, ok ? `status-ping a răspuns în ${elapsed} ms` : `status-ping a eșuat: ${errDetail || 'eroare necunoscută'}`);
    return ok;
  }, [maybeLog, supabase]);

  const checkPush = useCallback(
    (deviceCount: number) => {
      const supported = 'Notification' in window;
      const permission = supported ? Notification.permission : 'unsupported';
      const label = PUSH_PERMISSION_LABEL[permission] || permission;
      setState((s) => ({
        ...s,
        push: {
          dot: permission === 'granted' ? 'ok' : permission === 'denied' ? 'bad' : 'checking',
          stateLabel: label,
          subLabel: `${deviceCount} dispozitiv${deviceCount === 1 ? '' : 'e'} înregistrat${deviceCount === 1 ? '' : 'e'}`,
          deviceCount,
          showEnableButton: permission === 'default',
        },
      }));
      maybeLog('push', permission === 'granted', `${label} — ${deviceCount} dispozitiv${deviceCount === 1 ? '' : 'e'} înregistrat${deviceCount === 1 ? '' : 'e'}`);
    },
    [maybeLog],
  );

  const checkSystem = useCallback(async () => {
    setState((s) => ({ ...s, cron: { ...s.cron, dot: 'checking' } }));
    const { data, error } = await supabase.rpc('get_system_status');
    if (error || !data) {
      setState((s) => ({ ...s, cron: { dot: 'bad', stateLabel: 'Eroare', runs: [] } }));
      maybeLog('cron', false, `get_system_status a eșuat: ${error?.message || 'necunoscută'}`);
      return;
    }
    const scheduled = !!data.cron_job_scheduled;
    const runs: CronRun[] = data.cron_recent_runs || [];
    const lastRun = runs[0];
    const stateLabel = scheduled
      ? lastRun
        ? lastRun.status === 'succeeded'
          ? 'Activ'
          : 'Eroare la ultima rulare'
        : 'Programat, fără rulări încă'
      : 'Nu e programat';
    const cronOk = scheduled && (!lastRun || lastRun.status === 'succeeded');
    setState((s) => ({ ...s, cron: { dot: cronOk ? 'ok' : 'bad', stateLabel, runs: runs.slice().reverse() } }));
    maybeLog(
      'cron',
      cronOk,
      !scheduled
        ? 'Jobul de memento-uri nu e programat'
        : lastRun
          ? lastRun.status === 'succeeded'
            ? 'Ultima rulare a reușit'
            : `Ultima rulare a eșuat: ${lastRun.status || 'necunoscut'}`
          : 'Programat, fără rulări încă',
    );

    const counts = data.table_counts || {};
    setState((s) => ({
      ...s,
      counts: {
        tickets: counts.tickets || 0,
        current_projects: counts.current_projects || 0,
        backlog_projects: counts.backlog_projects || 0,
        calendar_events: counts.calendar_events || 0,
        push_subscriptions: counts.push_subscriptions || 0,
      },
    }));
    checkPush(counts.push_subscriptions || 0);
  }, [checkPush, maybeLog, supabase]);

  const loadSystemStatus = useCallback(async () => {
    await Promise.all([checkDb(), checkAuth(), checkFunctions(), checkSystem()]);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setState((s) => ({
      ...s,
      lastCheckedLabel: `Ultima verificare: ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    }));
  }, [checkAuth, checkDb, checkFunctions, checkSystem]);

  useEffect(() => {
    loadSystemStatus();
    // Keeps the 48h history filling up between visits, not just a single
    // point every time the tab is opened -- matches the 5-minute interval
    // in system-status.js.
    const id = setInterval(() => {
      if (sessionEmail) loadSystemStatus();
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, loadSystemStatus, checkSystem };
}

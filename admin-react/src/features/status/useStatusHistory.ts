import { useRef } from 'react';

// 48h history log, persisted in localStorage (this browser only -- there's
// no server-side cron running these checks, so it can only remember what
// happened while a tab with this page open actually ran them). Logs on
// every status change immediately (a failure is never missed) plus at
// least once an hour per check even while healthy (a heartbeat, so "no
// news" is still visible as "was actually checked and was fine" rather
// than a gap). Ported 1:1 from system-status.js.
const STATUS_HISTORY_KEY = 'systemStatusHistoryV1';
const STATUS_HISTORY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const STATUS_HISTORY_HEARTBEAT_MS = 60 * 60 * 1000;

export type StatusCheckKey = 'db' | 'auth' | 'functions' | 'cron' | 'push';

export const STATUS_CHECK_LABELS: Record<StatusCheckKey, string> = {
  db: 'Bază de date',
  auth: 'Autentificare',
  functions: 'Funcții Edge',
  cron: 'Memento-uri calendar',
  push: 'Notificări push',
};

export interface StatusHistoryEntry {
  ts: number;
  check: StatusCheckKey;
  ok: boolean;
  message: string;
}

export function loadStatusHistory(): StatusHistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STATUS_HISTORY_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const cutoff = Date.now() - STATUS_HISTORY_MAX_AGE_MS;
  return (arr as StatusHistoryEntry[]).filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff);
}

function logStatusEvent(check: StatusCheckKey, ok: boolean, message: string): void {
  const history = loadStatusHistory();
  history.push({ ts: Date.now(), check, ok, message });
  try {
    localStorage.setItem(STATUS_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // storage full/unavailable -- the on-screen status still works, just without history
  }
}

export function clearStatusHistory(): void {
  try {
    localStorage.removeItem(STATUS_HISTORY_KEY);
  } catch {
    // nothing to clear if storage isn't available
  }
}

// Only writes to localStorage when there's something worth writing (a
// change, or the hourly heartbeat).
export function useMaybeLogStatusEvent() {
  const lastLoggedRef = useRef<Partial<Record<StatusCheckKey, { ok: boolean; ts: number }>>>({});
  return (check: StatusCheckKey, ok: boolean, message: string) => {
    const prev = lastLoggedRef.current[check];
    const now = Date.now();
    if (prev && prev.ok === ok && now - prev.ts < STATUS_HISTORY_HEARTBEAT_MS) return;
    logStatusEvent(check, ok, message);
    lastLoggedRef.current[check] = { ok, ts: now };
  };
}

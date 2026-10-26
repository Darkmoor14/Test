import { useEffect, useRef } from 'react';
import { useSupabase } from '../../lib/supabaseContext';

// Ported from system-status.js's "Auto-îmbunătățire" collectors: real JS
// errors and UI friction signals (rage clicks, heavy typing). All
// best-effort -- logging must never itself break the app.
//
// Used to also tally feature clicks and tab dwell time into
// app_feature_clicks/app_page_views for a "Workflow" card on that page --
// dropped (card and collection both) since nobody acted on time-on-page
// or click-count stats for a handful of staff; the data just grew
// forever unread. The tables themselves are left in place, unused.
//
// IMPORTANT: this installs app-WIDE listeners (window.onerror,
// console.error, click/keydown/blur on `document`). Once mounted inside
// admin-3.html, the equivalent vanilla listeners in system-status.js must
// be removed first, or every error/click gets logged twice.
//
// `getCurrentTab` lets the mounted version tag signals with the real
// current tab (reading the shell's own `currentAdminTab` global) instead
// of a fixed label -- defaults to a fixed "status" for the standalone pilot.
const ERROR_LOG_DEDUPE_WINDOW_MS = 30000;
const RAGE_CLICK_WINDOW_MS = 700;
const RAGE_CLICK_THRESHOLD = 3;
const RAGE_CLICK_THROTTLE_MS = 60000;

function frictionElementLabel(el: Element | null): string {
  if (!el) return 'necunoscut';
  const label = (el.textContent || el.getAttribute('aria-label') || el.id || el.tagName).toString().trim().replace(/\s+/g, ' ');
  return (label || el.tagName).slice(0, 60);
}

export function useGlobalTelemetry(sessionEmail: string | null, getCurrentTab: () => string = () => 'status') {
  const supabase = useSupabase();
  const sessionEmailRef = useRef(sessionEmail);
  sessionEmailRef.current = sessionEmail;
  const getCurrentTabRef = useRef(getCurrentTab);
  getCurrentTabRef.current = getCurrentTab;

  useEffect(() => {
    const recentErrorSignatures = new Map<string, number>();
    async function logAppError(message: string, stack?: string | null) {
      try {
        const sig = String(message || 'Eroare necunoscută').slice(0, 300);
        const now = Date.now();
        const last = recentErrorSignatures.get(sig);
        if (last && now - last < ERROR_LOG_DEDUPE_WINDOW_MS) return;
        recentErrorSignatures.set(sig, now);
        await supabase.from('app_error_log').insert({
          message: sig,
          stack: stack ? String(stack).slice(0, 4000) : null,
          tab: getCurrentTabRef.current(),
          user_email: sessionEmailRef.current,
        });
      } catch {
        // logging must never itself crash the app
      }
    }

    const onError = (e: ErrorEvent) => logAppError(e.message, e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      logAppError(reason?.message ? reason.message : String(reason), reason?.stack);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    const origConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      origConsoleError(...args);
      try {
        const msg = args
          .map((a) => ((a as Error)?.message ? (a as Error).message : typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')
          .slice(0, 300);
        const withStack = args.find((a) => (a as Error)?.stack) as Error | undefined;
        logAppError(msg, withStack?.stack);
      } catch {
        // ignore -- never block on logging
      }
    };

    async function logFrictionSignal(signalType: string, targetLabel: string, meta?: Record<string, unknown>) {
      try {
        await supabase.from('app_interaction_signals').insert({
          signal_type: signalType,
          tab: getCurrentTabRef.current(),
          target_label: targetLabel,
          user_email: sessionEmailRef.current,
          meta: meta || {},
        });
      } catch {
        // ignore
      }
    }

    const rageClickTracker = new Map<string, { count: number; firstTs: number }>();
    const rageClickLoggedAt = new Map<string, number>();

    const onClick = (e: MouseEvent) => {
      const target = (e.target as Element)?.closest('button, a, [role="button"]');
      if (!target) return;
      const sig = frictionElementLabel(target);
      const now = Date.now();
      const rec = rageClickTracker.get(sig);
      if (rec && now - rec.firstTs < RAGE_CLICK_WINDOW_MS) {
        rec.count++;
        if (rec.count >= RAGE_CLICK_THRESHOLD) {
          const lastLogged = rageClickLoggedAt.get(sig) || 0;
          if (now - lastLogged > RAGE_CLICK_THROTTLE_MS) {
            rageClickLoggedAt.set(sig, now);
            logFrictionSignal('rage_click', sig, { click_count: rec.count });
          }
          rageClickTracker.delete(sig);
        }
      } else {
        rageClickTracker.set(sig, { count: 1, firstTs: now });
      }
    };
    document.addEventListener('click', onClick, true);

    const keystrokeCounts = new WeakMap<Element, number>();
    const onKeydown = (e: KeyboardEvent) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (el.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit', 'file', 'date', 'number'].includes(el.type)) return;
      keystrokeCounts.set(el, (keystrokeCounts.get(el) || 0) + 1);
    };
    const onBlur = (e: FocusEvent) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const count = keystrokeCounts.get(el);
      if (!count) return;
      const threshold = el.tagName === 'TEXTAREA' ? 400 : 120;
      if (count >= threshold) {
        const fieldLabelEl = el.closest('.ctrl-field')?.querySelector('label');
        const fieldLabel = (fieldLabelEl?.textContent || el.placeholder || el.id || el.tagName).trim().slice(0, 60);
        logFrictionSignal('heavy_typing', fieldLabel, { keystrokes: count });
      }
      keystrokeCounts.delete(el);
    };
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('blur', onBlur, true);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      console.error = origConsoleError;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('blur', onBlur, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);
}

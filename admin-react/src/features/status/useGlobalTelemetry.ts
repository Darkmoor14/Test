import { useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';

// Ported from system-status.js's "Auto-îmbunătățire" collectors: real JS
// errors, UI friction signals (rage clicks, heavy typing), feature-click
// tallies, and tab dwell time. All best-effort -- logging must never
// itself break the app.
//
// Simplification for this standalone pilot: the original tags every
// signal with `currentAdminTab` (whichever of ~20 tabs is open in the
// full shell). This pilot only has one page, so everything is tagged
// "status" for now -- once mounted inside admin-3.html alongside the
// real tab router, this should read the shell's actual current tab
// instead of the fixed string below.
const PILOT_TAB_LABEL = 'status';

const ERROR_LOG_DEDUPE_WINDOW_MS = 30000;
const RAGE_CLICK_WINDOW_MS = 700;
const RAGE_CLICK_THRESHOLD = 3;
const RAGE_CLICK_THROTTLE_MS = 60000;
const FEATURE_CLICK_FLUSH_MS = 120000;

function frictionElementLabel(el: Element | null): string {
  if (!el) return 'necunoscut';
  const label = (el.textContent || el.getAttribute('aria-label') || el.id || el.tagName).toString().trim().replace(/\s+/g, ' ');
  return (label || el.tagName).slice(0, 60);
}

export function useGlobalTelemetry(sessionEmail: string | null) {
  const sessionEmailRef = useRef(sessionEmail);
  sessionEmailRef.current = sessionEmail;

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
          tab: PILOT_TAB_LABEL,
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
          tab: PILOT_TAB_LABEL,
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
    const featureClickTally = new Map<string, number>();

    const onClick = (e: MouseEvent) => {
      const target = (e.target as Element)?.closest('button, a, [role="button"]');
      if (!target) return;
      const sig = frictionElementLabel(target);
      const now = Date.now();
      const tallyKey = `${PILOT_TAB_LABEL}|${sig}`;
      featureClickTally.set(tallyKey, (featureClickTally.get(tallyKey) || 0) + 1);
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

    async function flushFeatureClickTally() {
      if (featureClickTally.size === 0) return;
      const rows = Array.from(featureClickTally.entries()).map(([key, count]) => {
        const sepIdx = key.indexOf('|');
        return {
          tab: key.slice(0, sepIdx) || null,
          target_label: key.slice(sepIdx + 1),
          click_count: count,
          user_email: sessionEmailRef.current,
        };
      });
      featureClickTally.clear();
      try {
        await supabase.from('app_feature_clicks').insert(rows);
      } catch {
        // best effort
      }
    }
    const flushInterval = setInterval(flushFeatureClickTally, FEATURE_CLICK_FLUSH_MS);

    const tabEnteredAt = Date.now();
    async function logPageView(tab: string, durationSeconds: number) {
      try {
        await supabase.from('app_page_views').insert({ tab, duration_seconds: Math.round(durationSeconds), user_email: sessionEmailRef.current });
      } catch {
        // best effort
      }
    }
    const onBeforeUnload = () => {
      flushFeatureClickTally();
      const seconds = (Date.now() - tabEnteredAt) / 1000;
      if (seconds >= 2) logPageView(PILOT_TAB_LABEL, seconds);
    };
    window.addEventListener('beforeunload', onBeforeUnload);

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
      clearInterval(flushInterval);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('blur', onBlur, true);
    };
  }, []);
}

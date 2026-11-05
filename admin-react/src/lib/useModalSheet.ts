import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared behavior for every .mobile-sheet dialog: traps Tab/Shift+Tab within
// the panel while open (background rows/buttons were reachable through the
// backdrop before this -- see CLICK-PATH-201/403), moves focus in on open and
// restores it on close, and gates Escape/backdrop-click on an optional
// `guard` (e.g. a `saving` flag) the same way ChecklistSheet already did by
// hand -- see CLICK-PATH-001/402.
export function useModalSheet({
  open,
  onClose,
  guard,
}: {
  open: boolean;
  onClose: () => void;
  guard?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first || panel)?.focus();
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !guard) onClose();
  };

  return { panelRef, handleKeyDown, backdropOnClick: guard ? undefined : onClose };
}

import { useEffect, useRef, useState } from 'react';

interface PreSearchFilters<S> { status: S | null; year: string | null; month: string | null; day: number | null | undefined; }

// Widens status/year/month/day to "no restriction" the moment a search
// starts (so an exact match can be found regardless of current
// filters), and restores whatever was selected before once the search
// is cleared again -- same behavior as createSearchToggleWidget in the
// vanilla version.
export function SearchToggle<S>({
  query, setQuery, placeholder,
  status, setStatus, widenStatus,
  year, setYear, month, setMonth, day, setDay,
}: {
  query: string; setQuery: (v: string) => void; placeholder: string;
  status?: S; setStatus?: (v: S) => void; widenStatus?: S;
  year?: string; setYear?: (v: string) => void;
  month?: string; setMonth?: (v: string) => void;
  day?: number | null; setDay?: (v: number | null) => void;
}) {
  const [expanded, setExpanded] = useState(!!query.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  const hadQueryRef = useRef(!!query.trim());
  const preSearchRef = useRef<PreSearchFilters<S> | null>(null);
  // What THIS component set each field to while widening -- lets the
  // watcher below tell "nothing touched it since" apart from "the popover
  // changed it mid-search" (see CLICK-PATH-102).
  const widenedRef = useRef<PreSearchFilters<S> | null>(null);

  // An external clear (e.g. goToTicket() clearing a stale search) sets
  // `query` directly rather than through handleChange -- re-sync the
  // expanded/hadQuery bookkeeping so the box visually collapses too.
  useEffect(() => {
    const hasQuery = !!query.trim();
    if (hasQuery !== hadQueryRef.current) {
      hadQueryRef.current = hasQuery;
      preSearchRef.current = null;
    }
    if (!hasQuery) setExpanded(false);
  }, [query]);

  const handleChange = (value: string) => {
    const hasQuery = !!value.trim();
    if (hasQuery && !hadQueryRef.current) {
      const pre: PreSearchFilters<S> = { status: status ?? null, year: year ?? null, month: month ?? null, day };
      preSearchRef.current = pre;
      const widened: PreSearchFilters<S> = { status: pre.status, year: pre.year, month: pre.month, day: pre.day };
      if (setStatus && widenStatus !== undefined) { setStatus(widenStatus); widened.status = widenStatus; }
      if (setYear) { setYear('all'); widened.year = 'all'; }
      if (setMonth) { setMonth('all'); widened.month = 'all'; }
      if (setDay) { setDay(null); widened.day = null; }
      widenedRef.current = widened;
    } else if (!hasQuery && hadQueryRef.current && preSearchRef.current) {
      const pre = preSearchRef.current;
      if (setStatus && pre.status !== null) setStatus(pre.status);
      if (setYear && pre.year !== null) setYear(pre.year);
      if (setMonth && pre.month !== null) setMonth(pre.month);
      if (setDay && pre.day !== undefined) setDay(pre.day ?? null);
      preSearchRef.current = null;
      widenedRef.current = null;
    }
    hadQueryRef.current = hasQuery;
    setQuery(value);
  };

  // While a search is active, year/month/day/status can still be changed
  // directly (e.g. via FilterPopover) -- without this, clearing the search
  // would silently revert that change back to whatever was selected before
  // the search even started, since preSearchRef's snapshot was otherwise
  // frozen at search-start (CLICK-PATH-102). Treat any value that no
  // longer matches what THIS component set while widening as a real
  // external change, and keep the restore target in sync with it.
  useEffect(() => {
    if (!hadQueryRef.current) return;
    const w = widenedRef.current;
    const pre = preSearchRef.current;
    if (!w || !pre) return;
    if (status !== undefined && status !== w.status) { pre.status = status; w.status = status; }
    if (year !== undefined && year !== w.year) { pre.year = year; w.year = year; }
    if (month !== undefined && month !== w.month) { pre.month = month; w.month = month; }
    if (day !== w.day) { pre.day = day; w.day = day; }
  }, [status, year, month, day]);

  return (
    <div className={`overview-search-wrap${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className={`overview-icon-btn${expanded ? ' active' : ''}`}
        aria-label="Căutare"
        onClick={() => { setExpanded(true); inputRef.current?.focus(); }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      </button>
      <input
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => { if (!query.trim()) setExpanded(false); }}
      />
    </div>
  );
}

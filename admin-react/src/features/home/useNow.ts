import { useEffect, useState } from 'react';

// A ticking "current time" for anything that needs to notice time
// passing on its own, without waiting for an unrelated re-render (a
// data reload, a click, anything) to happen to refresh it. Without
// this, something computed from `new Date()` directly in a render --
// e.g. "is this event happening right now" -- goes stale the moment
// that event ends and nothing else causes the page to re-render:
// still-red "happening now" styling long after the event is over is
// exactly that bug, not a data-sync issue.
//
// Defaults to a 30s tick -- plenty for anything keyed on minutes
// (event start/end times), far cheaper than HomeClock's own 1s tick,
// which is for the seconds display and has no reason to also drive
// every other "now"-dependent render on the page.
export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
  return now;
}

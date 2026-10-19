import { useEffect, useState } from 'react';
import { HOME_CLOCK_DAY_NAMES, HOME_CLOCK_MONTH_NAMES } from './calendarUtils';

export function HomeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <>
      <div className="home-clock-time">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</div>
      <div className="home-clock-date">{HOME_CLOCK_DAY_NAMES[now.getDay()]}, {now.getDate()} {HOME_CLOCK_MONTH_NAMES[now.getMonth()]} {now.getFullYear()}</div>
    </>
  );
}

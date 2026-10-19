/* ============================================================
     This file used to hold ALL of "Stare sistem" (health checks,
     auto-îmbunătățire telemetry, audit log, roluri) as hand-written
     vanilla JS. That's now a React pilot (see admin-react/, built into
     assets/js/admin-react-status.js and mounted directly into
     panel-status/panel-status-improve/panel-status-audit/panel-status-roles
     in admin-3.html) — do not re-add status code here, edit the React
     source instead and rebuild.

     What's left below is unrelated to Stare sistem: the "Acasă" home
     page's live clock, mini-calendar, calendar reminders, and the
     calendar-event form's time-picker helpers. It stayed in this file
     only because it happened to live in the same original source file,
     not because it belongs with the status code above it used to sit
     under.
     ============================================================ */
  function renderHomeMiniCal(){
    const monthEl = document.getElementById('homeMiniCalMonth');
    const gridEl = document.getElementById('homeMiniCalGrid');
    if (!monthEl || !gridEl) return;
    const now = new Date();
    const todayKey = dateKey(now);
    const year = calendarViewYear;
    const month = calendarViewMonth;
    monthEl.textContent = `${HOME_CLOCK_MONTH_NAMES[month]} ${year}`;
    const firstOfMonth = new Date(year, month, 1);
    // Monday-first week, matching the L-M-M-J-V-S-D header.
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    let html = '';
    for (let i = 0; i < startOffset; i++) {
      html += `<span class="home-mini-cal-day outside">${daysInPrevMonth - startOffset + i + 1}</span>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const thisKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEventCount = eventsOnDate(thisKey).length;
      // Capped at 4 dots — a 5th+ event on the same day would just
      // overflow the tiny cell rather than convey anything more.
      const dotsHtml = dayEventCount > 0
        ? `<span class="home-mini-cal-day-dots">${'<span class="home-mini-cal-day-dot"></span>'.repeat(Math.min(dayEventCount, 4))}</span>`
        : '';
      html += `<button type="button" class="home-mini-cal-day${thisKey === todayKey ? ' today' : ''}${dayEventCount > 0 ? ' has-events' : ''}" data-date="${thisKey}">${d}${dotsHtml}</button>`;
    }
    const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      html += `<span class="home-mini-cal-day outside">${i}</span>`;
    }
    gridEl.innerHTML = html;
    gridEl.querySelectorAll('.home-mini-cal-day[data-date]').forEach(btn => {
      btn.addEventListener('click', () => openCalendarDay(btn.dataset.date));
    });
  }

  // Reminder engine — foreground only (fires while this tab/PWA is
  // actually open and running): checks once a minute for events whose
  // reminder time just arrived, shows a toast plus a real OS
  // notification via the same service worker the ticket push
  // notifications already use. Each event only ever fires once per
  // browser (tracked here, separately from reminder_sent_at, which is
  // what the optional server-side cron dispatcher uses instead — see
  // calendar_events_setup.sql — so the two never double up or
  // conflict with each other). Declared before tickHomeClock (which
  // calls checkCalendarReminders on every tick, including its own
  // first immediate call right below) rather than after it — a
  // let/const referenced before its own declaration line has run is a
  // ReferenceError, not just undefined, so this genuinely has to come
  // first, not just anywhere earlier in the same scope.
  const CAL_REMINDER_NOTIFIED_KEY = 'insta-grup-vlas-cal-reminders-notified-v1';
  let calReminderNotifiedIds = [];
  try {
    calReminderNotifiedIds = JSON.parse(localStorage.getItem(CAL_REMINDER_NOTIFIED_KEY) || '[]');
  } catch (_) { calReminderNotifiedIds = []; }
  let lastCalReminderCheckMinute = null;
  function checkCalendarReminders(now){
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (minuteKey === lastCalReminderCheckMinute) return;
    lastCalReminderCheckMinute = minuteKey;
    calendarEvents.forEach(e => {
      if (!e.reminder_minutes_before || calReminderNotifiedIds.includes(e.id)) return;
      const start = new Date(e.start_time);
      const dueAt = new Date(start.getTime() - e.reminder_minutes_before * 60000);
      if (now >= dueAt && now < start) {
        calReminderNotifiedIds.push(e.id);
        try { localStorage.setItem(CAL_REMINDER_NOTIFIED_KEY, JSON.stringify(calReminderNotifiedIds)); } catch (_) {}
        const body = e.location || `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
        showToast(`Memento: ${e.title}`);
        const notifTitle = `Memento: ${e.title}`;
        if (swRegistration && swRegistration.showNotification) {
          swRegistration.showNotification(notifTitle, {
            body,
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
          }).catch(() => {});
        } else if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification(notifTitle, { body }); } catch (_) {}
        }
      }
    });
  }

  function tickHomeClock(){
    const timeEl = document.getElementById('homeClockTime');
    const dateEl = document.getElementById('homeClockDate');
    if (!timeEl || !dateEl) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    // Only the calendar/date label actually change minute-to-minute —
    // redrawing them every second along with the clock would just be
    // wasted work.
    if (now.getSeconds() === 0 || dateEl.textContent === '—') {
      dateEl.textContent = `${HOME_CLOCK_DAY_NAMES[now.getDay()]}, ${now.getDate()} ${HOME_CLOCK_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
      // Only snap the mini-cal's own month back to "today" on a real
      // day rollover if she's currently looking at the current month
      // anyway — never yanks her back to today while she's navigated
      // to a different month via the ‹/› buttons.
      if (calendarViewYear === now.getFullYear() && calendarViewMonth === now.getMonth()) {
        renderHomeMiniCal();
      }
      renderHomeCalToday();
    }
    checkCalendarReminders(now);
  }
  if (document.getElementById('homeClockTime')) {
    tickHomeClock();
    setInterval(tickHomeClock, 1000);
    loadCalendarEvents();
  }

  const homeMiniCalPrevBtn = document.getElementById('homeMiniCalPrevBtn');
  const homeMiniCalNextBtn = document.getElementById('homeMiniCalNextBtn');
  if (homeMiniCalPrevBtn) {
    homeMiniCalPrevBtn.addEventListener('click', () => {
      calendarViewMonth -= 1;
      if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear -= 1; }
      renderHomeMiniCal();
    });
  }
  if (homeMiniCalNextBtn) {
    homeMiniCalNextBtn.addEventListener('click', () => {
      calendarViewMonth += 1;
      if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear += 1; }
      renderHomeMiniCal();
    });
  }

  function pad2(n){ return String(n).padStart(2, '0'); }

  // An event with no explicit end_time still counts as "happening
  // now" for a 10-minute grace period past its start, rather than
  // instantly losing that state the moment the clock ticks past —
  // otherwise a quick glance right after something started would
  // make it look like it never happened.
  const EVENT_ACTIVE_GRACE_MS = 10 * 60 * 1000;
  function isEventHappeningNow(e, now){
    if (!e.start_time) return false;
    const start = new Date(e.start_time);
    const end = e.end_time ? new Date(e.end_time) : new Date(start.getTime() + EVENT_ACTIVE_GRACE_MS);
    return now >= start && now <= end;
  }

  // Shared card markup for an event, used both by the always-visible
  // "Astăzi" list under the mini-calendar and the day-detail sheet —
  // title, location, and description (not just the title), so seeing
  // an event anywhere shows what it's actually about.
  function buildCalendarEventCardHtml(e, now){
    const start = new Date(e.start_time);
    const timeLabel = e.all_day ? 'Toată ziua' : pad2(start.getHours()) + ':' + pad2(start.getMinutes());
    const activeClass = isEventHappeningNow(e, now || new Date()) ? ' happening-now' : '';
    const recurIcon = (e.recurrence_freq || e.is_recurring_occurrence) ? '🔁 ' : '';
    return `
      <div class="calendar-day-event${activeClass}" data-event-id="${e.id}">
        <div>
          <div class="calendar-day-event-title">${recurIcon}${escapeHtml(e.title)}</div>
          ${e.location ? `<div class="calendar-day-event-meta">📍 ${escapeHtml(e.location)}</div>` : ''}
          ${e.description ? `<div class="calendar-day-event-meta">${escapeHtml(e.description)}</div>` : ''}
          ${Array.isArray(e.attendees) && e.attendees.length ? `<div class="calendar-day-event-meta">👤 ${escapeHtml(e.attendees.join(', '))}</div>` : ''}
        </div>
        <span class="calendar-day-event-time">${escapeHtml(timeLabel)}</span>
      </div>
    `;
  }
  function wireCalendarEventCardClicks(container){
    container.querySelectorAll('.calendar-day-event').forEach(el => {
      el.addEventListener('click', () => {
        const ev = calendarEvents.find(e => String(e.id) === el.dataset.eventId);
        if (ev) openCalendarEventForm(ev, dateKey(new Date(ev.start_time)));
      });
    });
  }

  // "Astăzi" — every one of today's events, shown right under the
  // mini-calendar so the day's whole schedule is visible at a glance
  // without opening anything, not just the single next one.
  function renderHomeCalToday(){
    const wrap = document.getElementById('homeCalTodayList');
    if (!wrap) return;
    const now = new Date();
    const todayEvents = eventsOnDate(dateKey(now));
    if (todayEvents.length === 0) {
      wrap.innerHTML = '<div class="calendar-day-events-empty">Nicio programare azi.</div>';
      return;
    }
    wrap.innerHTML = todayEvents.map(e => buildCalendarEventCardHtml(e, now)).join('');
    wireCalendarEventCardClicks(wrap);
  }

  const homeCalAddBtn = document.getElementById('homeCalAddBtn');
  if (homeCalAddBtn) {
    homeCalAddBtn.addEventListener('click', () => openCalendarEventForm(null, dateKey(new Date())));
  }

  function openCalendarDay(dateKeyStr){
    selectedCalendarDate = dateKeyStr;
    const [y, m, d] = dateKeyStr.split('-').map(Number);
    const label = new Date(y, m - 1, d);
    document.getElementById('calendarDaySheetTitle').textContent =
      `${HOME_CLOCK_DAY_NAMES[label.getDay()]}, ${d} ${HOME_CLOCK_MONTH_NAMES[m - 1]} ${y}`;
    renderCalendarDayEvents();
    setSheetOpen('calendarDaySheet', true);
  }

  function renderCalendarDayEvents(){
    const list = document.getElementById('calendarDayEventsList');
    if (!list) return;
    const events = eventsOnDate(selectedCalendarDate);
    if (events.length === 0) {
      list.innerHTML = '<div class="calendar-day-events-empty">Nicio programare în această zi.</div>';
      return;
    }
    const now = new Date();
    list.innerHTML = events.map(e => buildCalendarEventCardHtml(e, now)).join('');
    wireCalendarEventCardClicks(list);
  }

  const calendarDayAddBtn = document.getElementById('calendarDayAddBtn');
  if (calendarDayAddBtn) {
    calendarDayAddBtn.addEventListener('click', () => openCalendarEventForm(null, selectedCalendarDate));
  }

  // Ora început defaults to a 15-minute-increment <select> — the
  // native type="time" scroll-wheel picker is what this replaces for
  // the common case. Populated once; the options never change.
  function populateCefStartTimeSelect(){
    const select = document.getElementById('cef-start-time-select');
    if (!select) return;
    let html = '';
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const val = pad2(h) + ':' + pad2(m);
        html += `<option value="${val}">${val}</option>`;
      }
    }
    select.innerHTML = html;
  }
  populateCefStartTimeSelect();

  // which: 'start' | 'end'. precise=true shows the native time input
  // (exact entry); precise=false shows the quick-pick select.
  function setCefTimeMode(which, precise){
    const selectEl = document.getElementById(which === 'start' ? 'cef-start-time-select' : 'cef-end-duration-select');
    const preciseEl = document.getElementById(which === 'start' ? 'cef-start-time' : 'cef-end-time');
    const toggleBtn = document.getElementById(which === 'start' ? 'cef-start-time-toggle' : 'cef-end-time-toggle');
    selectEl.hidden = precise;
    preciseEl.hidden = !precise;
    if (toggleBtn) toggleBtn.classList.toggle('active', precise);
  }
  // Effective current value ('HH:MM') for whichever mode is active.
  function getCefStartValue(){
    const precise = document.getElementById('cef-start-time');
    return !precise.hidden ? (precise.value || null) : document.getElementById('cef-start-time-select').value;
  }
  function getCefEndValue(dateVal, startVal){
    const precise = document.getElementById('cef-end-time');
    if (!precise.hidden) return precise.value || null;
    const duration = document.getElementById('cef-end-duration-select').value;
    if (!dateVal || !startVal || !duration) return null;
    const endDt = new Date(new Date(`${dateVal}T${startVal}`).getTime() + Number(duration) * 60000);
    return pad2(endDt.getHours()) + ':' + pad2(endDt.getMinutes());
  }

  const cefStartTimeToggle = document.getElementById('cef-start-time-toggle');
  if (cefStartTimeToggle) cefStartTimeToggle.addEventListener('click', () => {
    const precise = document.getElementById('cef-start-time');
    const willBePrecise = precise.hidden;
    if (willBePrecise && !precise.value) {
      precise.value = document.getElementById('cef-start-time-select').value;
    }
    setCefTimeMode('start', willBePrecise);
  });
  const cefEndTimeToggle = document.getElementById('cef-end-time-toggle');
  if (cefEndTimeToggle) cefEndTimeToggle.addEventListener('click', () => {
    const precise = document.getElementById('cef-end-time');
    const willBePrecise = precise.hidden;
    if (willBePrecise && !precise.value) {
      const dateVal = document.getElementById('cef-date').value;
      precise.value = getCefEndValue(dateVal, getCefStartValue()) || '';
    }
    setCefTimeMode('end', willBePrecise);
  });


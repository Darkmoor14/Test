
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileSidebar = document.getElementById('mobileSidebar');
  const mobileSidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
  const mobileSidebarCloseBtn = document.getElementById('mobileSidebarCloseBtn');
  const mobileSidebarLogoutBtn = document.getElementById('mobileSidebarLogoutBtn');

  // Closing needs to keep the backdrop physically absorbing taps for
  // a brief moment AFTER it starts visually fading out, not just
  // instantly become inert — a "suppress the next click via a JS
  // flag" approach was tried first and failed for a plain mouse
  // click landing directly on the backdrop: the flag gets set inside
  // the backdrop's own click handler, but a capturing document-level
  // listener runs earlier in that exact same event's capture phase,
  // before the flag is set, so it can't catch it. Physically keeping
  // the backdrop interactive (pointer-events:auto via this separate
  // .closing-guard class, decoupled from the .open class driving the
  // fade) sidesteps that timing problem entirely — any stray
  // touch/click landing in that area during the buffer window hits
  // the backdrop itself (whose handler just closes an already-closed
  // sidebar, a harmless no-op) instead of whatever ticket or link
  // happens to be underneath.
  let sidebarClosingGuardTimeout = null;
  function setMobileSidebarOpen(open){
    mobileSidebar.classList.toggle('open', open);
    mobileSidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    clearTimeout(sidebarClosingGuardTimeout);
    if (open) {
      mobileSidebarBackdrop.classList.add('open');
      mobileSidebarBackdrop.classList.remove('closing-guard');
    } else {
      mobileSidebarBackdrop.classList.remove('open');
      mobileSidebarBackdrop.classList.add('closing-guard');
      sidebarClosingGuardTimeout = setTimeout(() => {
        mobileSidebarBackdrop.classList.remove('closing-guard');
      }, 400);
    }
  }
  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', () => setMobileSidebarOpen(true));
  if (mobileSidebarCloseBtn) mobileSidebarCloseBtn.addEventListener('click', () => setMobileSidebarOpen(false));
  if (mobileSidebarBackdrop) {
    mobileSidebarBackdrop.addEventListener('click', (e) => { e.preventDefault(); setMobileSidebarOpen(false); });
    mobileSidebarBackdrop.addEventListener('touchstart', (e) => { e.preventDefault(); setMobileSidebarOpen(false); }, { passive: false });
  }
  if (mobileSidebarLogoutBtn) mobileSidebarLogoutBtn.addEventListener('click', () => {
    setMobileSidebarOpen(false);
    performLogout();
  });

  document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openAdminTab(btn.dataset.tab);
      setMobileSidebarOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Back-to-top — same button on both desktop and mobile, fades in
  // once there's meaningfully far to scroll back.
  const backToTopBtn = document.getElementById('backToTopBtn');
  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', () => {
      backToTopBtn.classList.toggle('show', window.scrollY > 400);
    }, { passive: true });
  }

  // Toast notification — brief confirmation after a save, called from
  // the ticket-resolve save handler and the "Add sesizare" save
  // handler further up. Defined here rather than a separate function
  // library file; reused as-is if more save flows want it later.
  let toastTimer = null;
  function showToast(message){
    const toast = document.getElementById('toastNotification');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !msgEl) return;
    msgEl.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // Known iOS Safari/WKWebView bug: fixed-position elements can end up
  // stuck referencing a stale viewport height after the on-screen
  // keyboard dismisses — as if the keyboard were still partially
  // covering the screen — leaving a gap below them (the mobile tab
  // bar, back-to-top, toast, archive bar) until something forces a
  // recalculation.
  //
  // An earlier version of this tried to precisely calculate the
  // keyboard's height and shift these elements up to sit flush above
  // it while typing. That introduced its own gap — window.innerHeight
  // doesn't track visualViewport.height perfectly predictably in an
  // installed PWA specifically, and without a way to test the exact
  // numbers on a real device, tuning that further would just be
  // guessing again. Hiding these elements entirely while the keyboard
  // is open sidesteps the problem instead of trying to out-calculate
  // it — there's no gap to get wrong if nothing is being positioned
  // there in the first place, and none of them are things you need
  // while actively typing into a field anyway. They reappear the
  // moment the keyboard closes.
  // Restricted to genuinely touch/mobile contexts specifically —
  // window.visualViewport exists on desktop browsers too, and without
  // this guard, resizing or opening browser dev tools (common during
  // active testing) shrinks the visual viewport the exact same way a
  // real mobile keyboard would, incorrectly triggering kb-open and
  // hiding the archive bar / tab bar / toast / back-to-top via
  // !important — on desktop, where there's no keyboard at all to be
  // reacting to. Real virtual keyboards only exist on touch devices,
  // so restricting this there entirely removes that whole failure
  // mode rather than trying to tune the detection threshold further.
  const isTouchPrimaryDevice = window.matchMedia('(pointer: coarse)').matches;
  if (window.visualViewport && isTouchPrimaryDevice) {
    document.documentElement.classList.add('has-visual-viewport');
    let keyboardWasOpen = false;
    let keyboardSettleTimer = null;

    function settleFixedBottomUI(){
      const root = document.documentElement;
      root.classList.add('kb-settling');
      if (keyboardSettleTimer) clearTimeout(keyboardSettleTimer);

      // Force a fresh layout pass on iOS Safari / installed PWAs after
      // the keyboard closes; otherwise fixed bottom elements can keep
      // using the stale pre-dismiss viewport for a moment.
      requestAnimationFrame(() => {
        window.scrollTo(window.scrollX, window.scrollY);
        requestAnimationFrame(() => {
          keyboardSettleTimer = setTimeout(() => {
            root.classList.remove('kb-settling');
          }, 260);
        });
      });
    }

    function syncKeyboardOpen(){
      const vv = window.visualViewport;
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // 80px threshold — comfortably larger than ordinary viewport
      // jitter (browser chrome show/hide, minor rounding) so this
      // only fires for an actual keyboard, not false positives.
      const isOpen = covered > 80;
      document.documentElement.classList.toggle('kb-open', isOpen);
      if (keyboardWasOpen && !isOpen) settleFixedBottomUI();
      keyboardWasOpen = isOpen;
    }
    window.visualViewport.addEventListener('resize', syncKeyboardOpen);
    window.visualViewport.addEventListener('scroll', syncKeyboardOpen);
    window.addEventListener('orientationchange', settleFixedBottomUI);
    syncKeyboardOpen();
  }

  // Extra Safari/PWA fallback: some home-screen sessions do not fire
  // visualViewport changes consistently for keyboard close, but they
  // do still emit focus transitions on the actual form controls.
  // Keeping the same kb-open / kb-settling classes in sync here gives
  // the bottom tab bar a second path to hide/reappear correctly.
  (function(){
    if (!isTouchPrimaryDevice) return;
    const root = document.documentElement;
    const focusSelector = 'input, textarea, select, [contenteditable="true"]';
    let focusSettleTimer = null;

    function isEditableTarget(target){
      return !!(target && target.matches && target.matches(focusSelector));
    }

    function beginFocusSettle(){
      root.classList.add('kb-settling');
      if (focusSettleTimer) clearTimeout(focusSettleTimer);
      focusSettleTimer = setTimeout(() => {
        root.classList.remove('kb-open');
        root.classList.remove('kb-settling');
      }, 320);
    }

    document.addEventListener('focusin', (event) => {
      if (!isEditableTarget(event.target)) return;
      if (focusSettleTimer) clearTimeout(focusSettleTimer);
      root.classList.remove('kb-settling');
      root.classList.add('kb-open');
    });

    document.addEventListener('focusout', (event) => {
      if (!isEditableTarget(event.target)) return;
      beginFocusSettle();
    });
  })();

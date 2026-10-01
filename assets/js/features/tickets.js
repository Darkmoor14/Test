/* ============================================================
     DUPLICATE TICKETS — see isDuplicateTicket()'s own comment. Picking
     the canonical ticket happens in a small search sheet (ticket
     number or address); the actual linking/unlinking is a single
     Supabase update — the DB triggers handle archiving the mirrored
     resolution fields.
     ============================================================ */
  // Two modes, depending on whether excludeTicketId is given:
  //
  // ANCHOR MODE (excludeTicketId set -- opened from one specific
  // ticket's own "Leagă duplicate" button): that ticket IS the
  // original and never changes. Checking boxes in the search results
  // just builds the set of tickets that become its duplicates; one
  // "Confirmă" button finalizes all of them at once. There's nothing
  // to "pick" here -- the original was already decided by which
  // ticket's button you opened this from.
  //
  // BULK MODE (excludeTicketId null -- opened from the "Marchează ca
  // duplicate" bar after pre-selecting tickets in the main list):
  // those pre-selected tickets are the known duplicates, but which
  // ticket is the original is NOT yet decided, so this still needs an
  // explicit pick -- checking a box adds an extra duplicate, and
  // tapping a result's "Alege" button both finalizes that one as the
  // original and applies to everything checked.
  //
  // Resolves with { canonicalId, extraIds } in both modes, or null on
  // cancel. Checkbox markup/wiring mirrors the main ticket list's own
  // proven .ticket-select/.f-select checkbox exactly (a <label>
  // wrapping the <input>, one direct addEventListener('change', ...)
  // attached per checkbox right after it's rendered, no event
  // delegation).
  function openDuplicateLinkSheet(excludeTicketId){
    const isAnchorMode = !!excludeTicketId;
    const sheet = document.getElementById('duplicateLinkSheet');
    const searchBox = document.getElementById('duplicateLinkSearchBox');
    const results = document.getElementById('duplicateLinkResults');
    const extraCount = document.getElementById('duplicateLinkExtraCount');
    const hint = document.getElementById('duplicateLinkSheetHint');
    const title = document.getElementById('duplicateLinkSheetTitle');
    const cancelBtn = document.getElementById('duplicateLinkCancelBtn');
    const closeBtn = document.getElementById('duplicateLinkCloseBtn');
    const confirmBtn = document.getElementById('duplicateLinkConfirmBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !searchBox || !results || !extraCount || !hint || !title || !cancelBtn || !closeBtn || !confirmBtn || !backdrop) return Promise.resolve(null);

    const anchorTicket = isAnchorMode ? allTickets.find(t => t.id === excludeTicketId) : null;
    searchBox.value = '';
    extraCount.style.display = 'none';
    title.textContent = isAnchorMode ? 'Leagă duplicate' : 'Marchează ca duplicate';
    hint.textContent = isAnchorMode
      ? `Bifează sesizările duplicate ale ${anchorTicket ? anchorTicket.ticket_number : 'acesteia'}, apoi apasă Confirmă.`
      : 'Apasă "Alege" pe cea originală — cea pe care o ții. Nu e niciuna dintre cele bifate? Caută alta (nr. tichet sau adresă).';
    confirmBtn.style.display = isAnchorMode ? '' : 'none';
    confirmBtn.disabled = true;
    setSheetOpen('duplicateLinkSheet', true);
    setTimeout(() => searchBox.focus(), 50);

    return new Promise(resolve => {
      let settled = false;
      const checkedIds = new Set();
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('duplicateLinkSheet', false);
        searchBox.removeEventListener('input', handleInput);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        confirmBtn.removeEventListener('click', handleConfirm);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };
      const updateCheckedCount = () => {
        if (isAnchorMode) {
          confirmBtn.disabled = checkedIds.size === 0;
          extraCount.style.display = 'none';
          return;
        }
        if (checkedIds.size === 0) {
          extraCount.style.display = 'none';
        } else {
          extraCount.style.display = '';
          extraCount.textContent = checkedIds.size === 1
            ? '1 sesizare bifată — apasă pe cea originală ca să le legi pe amândouă.'
            : `${checkedIds.size} sesizări bifate — apasă pe cea originală ca să le legi pe toate.`;
        }
      };
      const finalizePick = (canonicalId) => {
        checkedIds.delete(canonicalId);
        cleanup({ canonicalId, extraIds: Array.from(checkedIds) });
      };
      const renderRows = (matches) => {
        if (matches.length === 0) {
          results.innerHTML = '<div class="no-results">Nicio sesizare găsită.</div>';
          return;
        }
        results.innerHTML = matches.map(t => isAnchorMode ? `
          <div class="duplicate-link-result-item${checkedIds.has(t.id) ? ' checked' : ''}" data-ticket-id="${t.id}">
            <label class="duplicate-link-result-checkwrap">
              <input type="checkbox" class="duplicate-link-result-check" data-ticket-id="${t.id}" ${checkedIds.has(t.id) ? 'checked' : ''} aria-label="Bifează ca duplicat">
            </label>
            <span class="duplicate-link-result-pickbtn">
              <span class="duplicate-link-result-num">${escapeHtml(t.ticket_number || '—')}</span>
              <span class="duplicate-link-result-address">${escapeHtml(t.address || '—')}</span>
            </span>
          </div>
        ` : `
          <div class="duplicate-link-result-item${checkedIds.has(t.id) ? ' checked' : ''}" data-ticket-id="${t.id}">
            <label class="duplicate-link-result-checkwrap">
              <input type="checkbox" class="duplicate-link-result-check" data-ticket-id="${t.id}" ${checkedIds.has(t.id) ? 'checked' : ''} aria-label="Bifează ca duplicat suplimentar">
            </label>
            <button type="button" class="duplicate-link-result-pickbtn" data-ticket-id="${t.id}">
              <span class="duplicate-link-result-num">${escapeHtml(t.ticket_number || '—')}</span>
              <span class="duplicate-link-result-address">${escapeHtml(t.address || '—')}</span>
              <span class="duplicate-link-result-pick">Alege</span>
            </button>
          </div>
        `).join('');
        // Direct listeners, attached right here per-item -- same
        // pattern as the main list's checkbox, not event delegation.
        results.querySelectorAll('.duplicate-link-result-check').forEach(checkbox => {
          checkbox.addEventListener('change', () => {
            const id = checkbox.dataset.ticketId;
            if (checkbox.checked) checkedIds.add(id); else checkedIds.delete(id);
            checkbox.closest('.duplicate-link-result-item').classList.toggle('checked', checkbox.checked);
            updateCheckedCount();
            checkbox.blur();
          });
        });
        if (isAnchorMode) {
          // No separate "Alege" here -- the whole row is just the
          // checkbox's tap target, made bigger and easier to hit.
          results.querySelectorAll('.duplicate-link-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
              if (e.target.closest('.duplicate-link-result-check')) return;
              const checkbox = item.querySelector('.duplicate-link-result-check');
              checkbox.checked = !checkbox.checked;
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            });
          });
        } else {
          results.querySelectorAll('.duplicate-link-result-pickbtn').forEach(btn => {
            btn.addEventListener('click', () => finalizePick(btn.dataset.ticketId));
          });
        }
      };
      const renderResults = () => {
        const rawQuery = searchBox.value.trim();
        if (!rawQuery) {
          // Bulk mode opens with tickets already pre-selected via the
          // main list's own checkboxes -- show those immediately
          // instead of an empty "type to search" placeholder, so the
          // common case (the original IS one of the ones you already
          // picked) needs no typing at all, just a tap on "Alege".
          if (!isAnchorMode && selectedIds.size > 0) {
            const preselected = allTickets.filter(t => selectedIds.has(t.id) && !t.duplicate_of);
            if (preselected.length > 0) {
              renderRows(preselected);
              return;
            }
          }
          results.innerHTML = '<div class="no-results">Scrie pentru a căuta…</div>';
          return;
        }
        // Supports several terms at once (comma or newline separated),
        // matching any of them -- so a ticket number and a street name
        // (or a few candidate streets) can be searched together instead
        // of one term per search.
        const terms = rawQuery.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
        // Excludes itself and anything already marked as a duplicate —
        // a duplicate can only ever point at an original, never at
        // another duplicate (no chains), matching the DB's own check.
        const matches = allTickets.filter(t =>
          t.id !== excludeTicketId &&
          !t.duplicate_of &&
          terms.some(term => (t.ticket_number || '').toLowerCase().includes(term) || (t.address || '').toLowerCase().includes(term))
        ).slice(0, 20);
        renderRows(matches);
      };
      const handleInput = () => renderResults();
      const handleConfirm = () => {
        if (checkedIds.size === 0) return;
        cleanup({ canonicalId: excludeTicketId, extraIds: Array.from(checkedIds) });
      };
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => { if (event.key === 'Escape') handleCancel(); };
      searchBox.addEventListener('input', handleInput);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      confirmBtn.addEventListener('click', handleConfirm);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
      renderResults();
    });
  }

  async function markAsDuplicate(ticketId){
    // Anchor mode: ticketId itself is the original and never changes
    // -- only the checked tickets (extraIds) get linked to it. See
    // openDuplicateLinkSheet's own comment for why.
    const picked = await openDuplicateLinkSheet(ticketId);
    if (!picked) return;
    const { extraIds } = picked;
    if (extraIds.length === 0) return;
    const anchorTicket = allTickets.find(t => t.id === ticketId);
    const dupNumbers = extraIds
      .map(id => allTickets.find(t => t.id === id)?.ticket_number)
      .filter(Boolean)
      .join(', ');
    if (!confirm(`Legi ${extraIds.length} sesizări (${dupNumbers}) ca duplicate ale ${anchorTicket ? anchorTicket.ticket_number : 'acesteia'}?`)) {
      return;
    }
    // Deliberately does NOT archive the ticket — it stays visible on
    // the public site exactly as before (an early citizen complaint
    // about "my ticket vanished" is worse than a rare double
    // dispatch). It only ever archives later through the normal
    // 14-days-after-resolution sweep (autoArchiveStaleTickets), once
    // it has picked up a real resolution via the canonical ticket —
    // see sync_duplicate_ticket()/propagate_resolution_to_duplicates().
    const { error } = await AppDataServices.tickets.markDuplicates(supabaseClient, ticketId, extraIds);
    if (error) {
      console.error(error);
      alert('Eroare la marcarea ca duplicat. Încercați din nou.');
      return;
    }
    showToast(extraIds.length === 1 ? 'Sesizarea a fost marcată ca duplicat.' : `${extraIds.length} sesizări au fost marcate ca duplicate.`);
    loadTickets();
  }

  async function unmarkDuplicate(ticketId){
    if (!confirm('Anulezi legătura de duplicat? Sesizarea revine la starea pe care o avea înainte să fie marcată duplicat.')) return;
    // status/resolution_note/resolved_on/resolved_by are deliberately
    // NOT set here -- the DB's snapshot_before_duplicate_link_trigger
    // restores them from what the ticket actually had before it was
    // linked as a duplicate (pre_duplicate_* columns), instead of
    // blanking a ticket that was already solved back to unresolved.
    //
    // archived is different: it's only forced back to false when the
    // restored status would leave an Ongoing ticket sitting archived
    // -- an invariant the rest of the admin relies on (see
    // getFilteredTickets' own comment: "an archived ticket is never
    // Ongoing"). A ticket that was already genuinely Terminat before
    // ever being linked as a duplicate stays exactly as archived (or
    // not) as it already was; forcing it out of the archive every
    // time used to yank an old, legitimately-closed ticket back into
    // the active list for no reason.
    const ticket = allTickets.find(t => t.id === ticketId);
    const restoredStatus = ticket ? (ticket.pre_duplicate_status || 'Ongoing') : 'Ongoing';
    const payload = { duplicate_of: null };
    if (restoredStatus !== 'Terminat') {
      payload.archived = false;
      payload.archived_at = null;
    }
    const { error } = await supabaseClient
      .from('tickets')
      .update(payload)
      .eq('id', ticketId);
    if (error) {
      console.error(error);
      alert('Eroare la anularea duplicatului. Încercați din nou.');
      return;
    }
    showToast('Legătura de duplicat a fost anulată.');
    loadTickets();
  }

  
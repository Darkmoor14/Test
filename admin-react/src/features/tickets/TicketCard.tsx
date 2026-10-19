import { useEffect, useRef, useState } from 'react';
import { useTickets } from './TicketsContext';
import { useStaffRoster } from '../home/useStaffRoster';
import {
  combineDateTimeToISO, fmtDate, getCanonicalTicket, getDuplicatesOf, hasSuspiciousYear, isAwaitingReport,
  isDuplicateTicket, normalizeYearInDateValue, parseTicketDate, toDateTimeInputParts,
} from './ticketUtils';
import type { Ticket } from './types';

declare global {
  interface Window { showToast?: (message: string) => void; }
}
function showToast(message: string) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

export function TicketCard({ t, sessionEmail }: { t: Ticket; sessionEmail: string | null }) {
  const store = useTickets();
  const { isGod, modulePermission } = useStaffRoster(sessionEmail);
  const canWriteTickets = isGod || modulePermission('tickets') === 'write';

  const isUrgent = t.type === 'Anunt accident';
  const isDone = t.status === 'Terminat';
  const isFullyComplete = !canWriteTickets ? isDone : (isDone && !isAwaitingReport(t));
  const isArchived = !!t.archived;
  const isDuplicate = isDuplicateTicket(t);
  const canonicalTicket = getCanonicalTicket(store.tickets, t);
  const linkedDuplicates = getDuplicatesOf(store.tickets, t.id);
  const isEditing = t.id === store.editingTicketId;
  const resolvedDateParts = toDateTimeInputParts(t.resolved_on);
  const submittedDateParts = toDateTimeInputParts(t.submitted_on);

  const draft = store.getDraft(t.id);
  const [name, setName] = useState(draft?.['.f-name'] ?? t.name ?? '');
  const [phone, setPhone] = useState(draft?.['.f-phone'] ?? t.phone ?? '');
  const [email, setEmail] = useState(draft?.['.f-email'] ?? t.email ?? '');
  const [address, setAddress] = useState(draft?.['.f-address'] ?? t.address ?? '');
  const [description, setDescription] = useState(draft?.['.f-description'] ?? t.description ?? '');
  const [submittedDate, setSubmittedDate] = useState(draft?.['.f-submitted-date'] ?? submittedDateParts.date);
  const [status, setStatus] = useState(draft?.['.f-status'] ?? t.status);
  const [resolver, setResolver] = useState(draft?.['.f-resolver'] ?? t.resolved_by ?? '');
  const [resolvedDate, setResolvedDate] = useState(draft?.['.f-resolved-date'] ?? resolvedDateParts.date);
  const [saving, setSaving] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);

  // A reload (fresh server data, another admin's save, a push-triggered
  // refresh) swaps `t` for a new object -- re-sync local field state
  // from it, UNLESS this ticket has a tracked unsaved draft, which
  // takes priority (see draftEdits in useTicketsStore). This is the
  // actual draft-preservation behavior: a background refresh must show
  // fresh data everywhere EXCEPT a field someone is mid-typing into.
  useEffect(() => {
    const d = store.getDraft(t.id);
    setName(d?.['.f-name'] ?? t.name ?? '');
    setPhone(d?.['.f-phone'] ?? t.phone ?? '');
    setEmail(d?.['.f-email'] ?? t.email ?? '');
    setAddress(d?.['.f-address'] ?? t.address ?? '');
    setDescription(d?.['.f-description'] ?? t.description ?? '');
    setSubmittedDate(d?.['.f-submitted-date'] ?? toDateTimeInputParts(t.submitted_on).date);
    setStatus(d?.['.f-status'] ?? t.status);
    setResolver(d?.['.f-resolver'] ?? t.resolved_by ?? '');
    setResolvedDate(d?.['.f-resolved-date'] ?? toDateTimeInputParts(t.resolved_on).date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    if (store.pendingScrollToId === t.id && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      store.setPendingScrollToId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.pendingScrollToId]);

  const draftField = (sel: string, value: string) => store.setDraftField(t.id, sel, value);

  const handleSave = async () => {
    const newStatus = status;
    let submittedDateVal = isEditing ? submittedDate : null;
    if (isEditing && submittedDateVal) {
      const normalized = normalizeYearInDateValue(submittedDateVal);
      if (normalized !== submittedDateVal) {
        submittedDateVal = normalized;
        setSubmittedDate(normalized);
        showToast(`Anul din data trimiterii a fost corectat automat la ${normalized.slice(0, 4)}.`);
      }
    }
    if (isEditing && !submittedDateVal) { alert('Data trimiterii nu poate fi golită.'); return; }
    if (isEditing && submittedDateVal && hasSuspiciousYear(submittedDateVal)) {
      alert('Anul din data trimiterii pare greșit (verificați să fie scris complet, ex: 2026, nu 26).');
      return;
    }
    const submittedOnISO = (isEditing && submittedDateVal !== submittedDateParts.date)
      ? combineDateTimeToISO(submittedDateVal!)
      : t.submitted_on;

    let resolvedOnISO: string | undefined;
    if (newStatus === 'Terminat') {
      let resolvedDateVal = resolvedDate;
      const normalizedResolved = normalizeYearInDateValue(resolvedDateVal);
      if (normalizedResolved !== resolvedDateVal) {
        resolvedDateVal = normalizedResolved;
        setResolvedDate(normalizedResolved);
        showToast(`Anul din data soluționării a fost corectat automat la ${normalizedResolved.slice(0, 4)}.`);
      }
      if (hasSuspiciousYear(resolvedDateVal)) {
        alert('Anul din data soluționării pare greșit (verificați să fie scris complet, ex: 2026, nu 26).');
        return;
      }
      resolvedOnISO = combineDateTimeToISO(resolvedDateVal);
      const submittedDateOnly = submittedOnISO ? parseTicketDate(submittedOnISO).toDateString() : null;
      const resolvedDateOnly = new Date(resolvedOnISO).toDateString();
      if (submittedDateOnly && new Date(resolvedDateOnly) < new Date(submittedDateOnly)) {
        alert(`Data soluționării (${fmtDate(resolvedOnISO)}) nu poate fi înainte de data sesizării (${fmtDate(submittedOnISO)}).`);
        return;
      }
    }

    const nameVal = isEditing ? name.trim() : (t.name || '');
    const phoneVal = isEditing ? phone.trim() : (t.phone || '');
    const addressVal = isEditing ? address.trim() : (t.address || '');
    if (isEditing && (!nameVal || !phoneVal || !addressVal)) {
      alert('Numele, telefonul și adresa nu pot fi golite complet.');
      return;
    }

    if (newStatus !== t.status) {
      const statusLabel = newStatus === 'Terminat' ? 'Soluționat' : 'Activ';
      if (!confirm(`Schimbați starea tichetului ${t.ticket_number || ''} în "${statusLabel}"?`)) return;
    }

    setSaving(true);
    const emailVal = isEditing ? email.trim() : (t.email || '');
    const descriptionVal = isEditing ? description.trim() : (t.description || '');
    const payload: Record<string, unknown> = {
      status: newStatus,
      resolved_by: resolver.trim() || null,
      resolution_note: t.resolution_note || null,
      name: nameVal, phone: phoneVal, email: emailVal || null, address: addressVal, description: descriptionVal || null,
      submitted_on: submittedOnISO,
      resolved_on: newStatus === 'Terminat' ? resolvedOnISO : null,
    };
    const wasAwaitingReport = t.status === 'Terminat' && !t.resolution_note;
    const isNowAwaitingReport = newStatus === 'Terminat' && !t.resolution_note;
    await store.saveTicketCard(t, payload, { wasAwaitingReport, isNowAwaitingReport, resolver: resolver.trim(), addressVal });
    setSaving(false);
  };

  return (
    <div
      ref={cardRef}
      id={'ticket-card-' + t.id}
      className={`ticket-card ${isUrgent && !isDone ? 'urgent' : ''} ${isFullyComplete ? 'done' : ''} ${isArchived ? 'archived' : ''} ${isDuplicate ? 'duplicate' : ''} ${store.jumpHighlightId === t.id ? 'jump-highlight' : ''}`}
    >
      <div className="ticket-top">
        <div className="ticket-meta">
          <label className="ticket-select">
            <input type="checkbox" className="f-select" checked={store.selectedIds.has(t.id)} onChange={(e) => store.toggleSelected(t.id, e.target.checked)} />
          </label>
          <span className="ticket-num">{t.ticket_number || '—'}</span>
          <span className={`ticket-tag ${isUrgent ? 'urgent-tag' : ''}`}>{isUrgent ? 'Accident' : 'Defect'}</span>
          {isArchived && <span className="archived-badge">Arhivat {fmtDate(t.archived_at)}</span>}
          {isDuplicate && (canonicalTicket ? (
            <button type="button" className="duplicate-badge" title={`Mergi la sesizarea originală ${canonicalTicket.ticket_number || ''}`} onClick={() => store.goToTicket(canonicalTicket.id)}>
              Duplicat al {canonicalTicket.ticket_number || '—'} — Mergi la original
            </button>
          ) : <span className="duplicate-badge">Duplicat al —</span>)}
        </div>
        <span className="ticket-date">Trimis: {fmtDate(t.submitted_on)}</span>
      </div>
      {store.overviewReturnState && store.overviewReturnState.ticketId === t.id && (
        <div className="ticket-return-row"><button type="button" className="btn ticket-return-overview" onClick={store.returnToOverviewTable}>← Înapoi la tabel</button></div>
      )}
      <div className="ticket-body">
        {isEditing ? (
          <>
            <div className="ctrl-field"><label>Nume reclamant</label><input type="text" value={name} disabled={isArchived || isDuplicate} onChange={(e) => { setName(e.target.value); draftField('.f-name', e.target.value); }} /></div>
            <div className="ctrl-field"><label>Telefon</label><input type="text" value={phone} disabled={isArchived || isDuplicate} onChange={(e) => { setPhone(e.target.value); draftField('.f-phone', e.target.value); }} /></div>
            <div className="ctrl-field"><label>Email</label><input type="email" value={email} disabled={isArchived || isDuplicate} onChange={(e) => { setEmail(e.target.value); draftField('.f-email', e.target.value); }} /></div>
            <div className="ctrl-field"><label>Adresă identificare loc defect</label><input type="text" value={address} disabled={isArchived || isDuplicate} onChange={(e) => { setAddress(e.target.value); draftField('.f-address', e.target.value); }} /></div>
            <div className="ctrl-field"><label>Data trimiterii</label><input type="date" value={submittedDate} disabled={isArchived || isDuplicate} onChange={(e) => { setSubmittedDate(e.target.value); draftField('.f-submitted-date', e.target.value); }} /></div>
            <div className="ctrl-field"><label>Descriere</label><input type="text" value={description} disabled={isArchived || isDuplicate} onChange={(e) => { setDescription(e.target.value); draftField('.f-description', e.target.value); }} /></div>
          </>
        ) : (
          <>
            <div><span className="k">Nume</span>{t.name || '—'}</div>
            <div><span className="k">Telefon</span>{t.phone || '—'}</div>
            <div><span className="k">Email</span>{t.email || '—'}</div>
            <div><span className="k">Adresă</span>{t.address || '—'}</div>
            {t.description && <div><span className="k">Descriere</span>{t.description}</div>}
          </>
        )}
        {t.resolved_on && <div className="full"><span className="k">Soluționat</span>{fmtDate(t.resolved_on)}</div>}
        {linkedDuplicates.length > 0 && (
          <div className="duplicate-link-note full">
            🔗 {linkedDuplicates.length === 1 ? 'Duplicat legat' : `${linkedDuplicates.length} duplicate legate`}: {linkedDuplicates.map((d) => d.ticket_number || '—').join(', ')}
          </div>
        )}
      </div>
      <div className="ticket-controls">
        {isDone && !isEditing ? (
          <>
            <div className="ctrl-field stare-field"><label>Stare</label><div className="resnote-readonly">Soluționat</div></div>
            <div className="ctrl-field resolver-field"><label>Soluționat de</label><div className="resnote-readonly">{t.resolved_by || '—'}</div></div>
            <div className="ctrl-field resnote-field"><label>Ce s-a făcut</label><div className="resnote-readonly">{t.resolution_note || '—'}</div></div>
            <div className="ctrl-field resolved-date-field"><label>Data soluționării</label><div className="resnote-readonly">{resolvedDateParts.date || '—'}</div></div>
          </>
        ) : (
          <>
            <div className="ctrl-field stare-field">
              <label>Stare</label>
              <select className="f-status" disabled={isArchived || isDuplicate} value={status} onChange={(e) => { setStatus(e.target.value); draftField('.f-status', e.target.value); }}>
                <option value="Ongoing">Activ</option>
                <option value="Terminat">Soluționat</option>
              </select>
            </div>
            <div className="ctrl-field resolver-field">
              <label>Soluționat de</label>
              <input type="text" placeholder="Nume angajat" disabled={isArchived || isDuplicate} value={resolver} onChange={(e) => { setResolver(e.target.value); draftField('.f-resolver', e.target.value); }} />
            </div>
            {t.resolution_note && (
              <div className="ctrl-field resnote-field"><label>Ce s-a făcut</label><div className="resnote-readonly">{t.resolution_note}</div></div>
            )}
            <div className="ctrl-field resolved-date-field">
              <label>Data soluționării</label>
              <input type="date" disabled={isArchived || isDuplicate || status !== 'Terminat'} value={resolvedDate} onChange={(e) => { setResolvedDate(e.target.value); draftField('.f-resolved-date', e.target.value); }} />
            </div>
          </>
        )}
        {isDuplicate ? (
          <button type="button" className="btn" onClick={() => store.unmarkDuplicate(t.id)}>Anulează duplicat</button>
        ) : isArchived ? (
          <button className="btn" onClick={() => store.restoreTicket(t.id)}>Dezarhivează</button>
        ) : (isDone && !isEditing) ? (
          <div className="resnote-readonly">Pentru modificări, selectează tichetul și apasă Editează.</div>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>Salvează<span className="save-status">✓ Salvat</span></button>
            {isEditing && <button type="button" className="btn" onClick={() => store.cancelEdit(t.id)}>Anulează</button>}
          </>
        )}
        {!isDuplicate && !isArchived && (
          <button type="button" className="btn" onClick={() => store.setDuplicateSheet({ excludeTicketId: t.id })}>Leagă duplicate</button>
        )}
      </div>
    </div>
  );
}

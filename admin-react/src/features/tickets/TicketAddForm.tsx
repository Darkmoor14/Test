import { useState } from 'react';
import { useTickets } from './TicketsContext';
import { hasSuspiciousYear, normalizeYearInDateValue } from './ticketUtils';

declare global {
  interface Window { showToast?: (message: string) => void; }
}
function showToast(message: string) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

export function TicketAddForm() {
  const store = useTickets();
  const [type, setType] = useState('Sesizare functionala');
  const [date, setDate] = useState('');
  const [resolvedDate, setResolvedDate] = useState('');
  const [resolvedBy, setResolvedBy] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  if (!store.addFormOpen) return null;

  const close = () => store.setAddFormOpen(false);

  const handleSave = async () => {
    let dateVal = date, resolvedDateVal = resolvedDate;
    const normalizedDateVal = normalizeYearInDateValue(dateVal);
    const normalizedResolvedDateVal = normalizeYearInDateValue(resolvedDateVal);
    if (normalizedDateVal !== dateVal) { dateVal = normalizedDateVal; setDate(normalizedDateVal); showToast(`Anul din data trimiterii a fost corectat automat la ${normalizedDateVal.slice(0, 4)}.`); }
    if (normalizedResolvedDateVal !== resolvedDateVal) { resolvedDateVal = normalizedResolvedDateVal; setResolvedDate(normalizedResolvedDateVal); showToast(`Anul din data soluționării a fost corectat automat la ${normalizedResolvedDateVal.slice(0, 4)}.`); }

    const nameVal = name.trim(), phoneVal = phone.trim(), addressVal = address.trim();
    if (!nameVal || !phoneVal || !addressVal) { alert('Completați nume, telefon și adresă.'); return; }
    if (hasSuspiciousYear(dateVal) || hasSuspiciousYear(resolvedDateVal)) {
      alert('Anul introdus într-una dintre date pare greșit (verificați să fie scris complet, ex: 2026, nu 26).');
      return;
    }

    setSaving(true);
    const result = await store.createTicket({
      type, name: nameVal, phone: phoneVal, email: email.trim(), address: addressVal, description: description.trim(),
      dateVal, resolvedDateVal, resolvedByVal: resolvedBy.trim(),
    });
    setSaving(false);
    if (!result.ok) { alert('Eroare la salvare. Încercați din nou.'); return; }
    setType('Sesizare functionala'); setDate(''); setResolvedDate(''); setResolvedBy('');
    setName(''); setPhone(''); setEmail(''); setAddress(''); setDescription('');
    close();
  };

  return (
    <div className="project-form" style={{ display: 'block' }}>
      <div className="pf-grid">
        <div className="ctrl-field-stack">
          <div className="ctrl-field">
            <label>Tip sesizare</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="Sesizare functionala">Defect</option>
              <option value="Anunt accident">Accident</option>
            </select>
          </div>
          <div className="ctrl-field"><label>Nume reclamant</label><input type="text" placeholder="ex: Ion Popescu" value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <div className="ctrl-field-stack">
          <div className="ctrl-field resolved-date-field"><label>Data sesizării</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="ctrl-field resolved-date-field"><label>Data soluționării (opțional)</label><input type="date" value={resolvedDate} onChange={(e) => setResolvedDate(e.target.value)} /></div>
          {resolvedDate && (
            <div className="ctrl-field"><label>Soluționat de</label><input type="text" placeholder="ex: Bogdan Vlas" value={resolvedBy} onChange={(e) => setResolvedBy(e.target.value)} /></div>
          )}
        </div>
        <div className="ctrl-field"><label>Telefon</label><input type="text" placeholder="ex: 0740123456" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="ctrl-field"><label>Email (opțional)</label><input type="email" placeholder="ex: nume@exemplu.ro" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="ctrl-field"><label>Adresă identificare loc defect</label><input type="text" placeholder="ex: Str. Gh. Doja nr. 4" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="ctrl-field"><label>Descriere (opțional)</label><input type="text" placeholder="Detalii despre sesizare" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
      <div className="pf-actions">
        <button className="btn" type="button" onClick={close}>Anulează</button>
        <button className="btn btn-primary" type="button" disabled={saving} onClick={handleSave}>Salvează sesizarea</button>
      </div>
    </div>
  );
}

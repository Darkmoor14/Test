import { useEffect, useState, useId } from 'react';
import { useProjects } from './ProjectsContext';
import { monthInputToDate, toMonthInput } from './projectUtils';

export function ProjectForm() {
  const a11yId = useId();
  const store = useProjects();
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [start, setStart] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!store.projectFormOpen) return;
    const p = store.editingProject;
    setTitle(p ? p.title : '');
    setAddress(p ? p.address : '');
    setStart(p ? toMonthInput(p.start_date) : '');
    setDue(p ? toMonthInput(p.due_date) : '');
    setNotes(p ? (p.notes || '') : '');
  }, [store.projectFormOpen, store.editingProject]);

  if (!store.projectFormOpen) return null;

  const handleSave = async () => {
    const titleVal = title.trim(), addressVal = address.trim();
    if (!titleVal || !addressVal || !start || !due) { alert('Completați tip lucrare, adresă, luna de început și luna de finalizare.'); return; }
    if (due < start) { alert('Luna de finalizare nu poate fi înainte de luna de început.'); return; }
    setSaving(true);
    const start_date = monthInputToDate(start, false);
    const due_date = monthInputToDate(due, true);
    await store.saveProject({ title: titleVal, address: addressVal, start_date, due_date, notes: notes.trim() || null }, store.editingProject?.id || null);
    setSaving(false);
  };

  return (
    <div className="project-form" style={{ display: 'block' }}>
      <div className="pf-grid">
        <div className="ctrl-field"><label htmlFor={`${a11yId}-tip-lucrare-titlu`}>Tip lucrare / Titlu</label><input type="text" placeholder="ex: Reabilitare rețea electrică" value={title} onChange={(e) => setTitle(e.target.value)} id={`${a11yId}-tip-lucrare-titlu`}/></div>
        <div className="ctrl-field"><label htmlFor={`${a11yId}-adres`}>Adresă</label><input type="text" placeholder="ex: Str. Gh. Doja, Târgu-Mureș" value={address} onChange={(e) => setAddress(e.target.value)} id={`${a11yId}-adres`}/></div>
        <div className="ctrl-field"><label htmlFor={`${a11yId}-data-nceput`}>Data început</label><input type="month" value={start} onChange={(e) => setStart(e.target.value)} id={`${a11yId}-data-nceput`}/></div>
        <div className="ctrl-field"><label htmlFor={`${a11yId}-data-finalizare-estimat`}>Data finalizare estimată</label><input type="month" value={due} onChange={(e) => setDue(e.target.value)} id={`${a11yId}-data-finalizare-estimat`}/></div>
        <div className="ctrl-field" style={{ gridColumn: '1/-1' }}><label htmlFor={`${a11yId}-note-op-ional-intern`}>Note (opțional)</label><input type="text" placeholder="Apare și pe site, sub proiect, dacă este completat" value={notes} onChange={(e) => setNotes(e.target.value)} id={`${a11yId}-note-op-ional-intern`}/></div>
      </div>
      <div className="pf-actions">
        <button className="btn" type="button" onClick={store.closeProjectForm}>Anulează</button>
        <button className="btn btn-primary" type="button" disabled={saving} onClick={handleSave}>Salvează proiectul</button>
      </div>
    </div>
  );
}

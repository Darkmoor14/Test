import { useEffect, useState } from 'react';
import { useProjects } from './ProjectsContext';

export function ProjectForm() {
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
    setStart(p ? p.start_date : '');
    setDue(p ? p.due_date : '');
    setNotes(p ? (p.notes || '') : '');
  }, [store.projectFormOpen, store.editingProject]);

  if (!store.projectFormOpen) return null;

  const handleSave = async () => {
    const titleVal = title.trim(), addressVal = address.trim();
    if (!titleVal || !addressVal || !start || !due) { alert('Completați tip lucrare, adresă, data început și data finalizare.'); return; }
    if (new Date(due) < new Date(start)) { alert('Data de finalizare nu poate fi înainte de data de început.'); return; }
    setSaving(true);
    await store.saveProject({ title: titleVal, address: addressVal, start_date: start, due_date: due, notes: notes.trim() || null }, store.editingProject?.id || null);
    setSaving(false);
  };

  return (
    <div className="project-form" style={{ display: 'block' }}>
      <div className="pf-grid">
        <div className="ctrl-field"><label>Tip lucrare / Titlu</label><input type="text" placeholder="ex: Reabilitare rețea electrică" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="ctrl-field"><label>Adresă</label><input type="text" placeholder="ex: Str. Gh. Doja, Târgu-Mureș" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="ctrl-field"><label>Data început</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="ctrl-field"><label>Data finalizare estimată</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="ctrl-field" style={{ gridColumn: '1/-1' }}><label>Note (opțional, intern)</label><input type="text" placeholder="Vizibil doar aici, nu pe site" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div className="pf-actions">
        <button className="btn" type="button" onClick={store.closeProjectForm}>Anulează</button>
        <button className="btn btn-primary" type="button" disabled={saving} onClick={handleSave}>Salvează proiectul</button>
      </div>
    </div>
  );
}

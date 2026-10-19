import { useEffect, useState } from 'react';
import { useProjects } from './ProjectsContext';

export function BacklogForm() {
  const store = useProjects();
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [employee, setEmployee] = useState('');
  const [start, setStart] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!store.backlogFormOpen) return;
    const p = store.editingBacklog;
    setTitle(p ? p.title : '');
    setAddress(p ? p.address : '');
    setEmployee(p ? (p.employee_name || '') : '');
    setStart(p ? p.start_date : '');
    setDescription(p ? (p.description || '') : '');
  }, [store.backlogFormOpen, store.editingBacklog]);

  if (!store.backlogFormOpen) return null;

  const handleSave = async () => {
    const titleVal = title.trim(), addressVal = address.trim();
    if (!titleVal || !addressVal || !start) { alert('Completați tipul lucrării, adresa și data înregistrării.'); return; }
    setSaving(true);
    await store.saveBacklog({ title: titleVal, address: addressVal, employee_name: employee.trim() || null, start_date: start, description: description.trim() || null }, store.editingBacklog?.id || null);
    setSaving(false);
  };

  return (
    <div className="project-form" style={{ display: 'block' }}>
      <div className="pf-grid">
        <div className="ctrl-field"><label>Tipul lucrării</label><input type="text" placeholder="ex: Extindere rețea electrică" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="ctrl-field"><label>Adresă</label><input type="text" placeholder="ex: Str. Gh. Doja, Târgu-Mureș" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="ctrl-field"><label>Nume angajat</label><input type="text" placeholder="ex: Ionel Ghiurchi" value={employee} onChange={(e) => setEmployee(e.target.value)} /></div>
        <div className="ctrl-field"><label>Data înregistrării</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="ctrl-field" style={{ gridColumn: '1/-1' }}><label>Descriere</label><input type="text" placeholder="Detalii despre lucrare" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
      <div className="pf-actions">
        <button className="btn" type="button" onClick={store.closeBacklogForm}>Anulează</button>
        <button className="btn btn-primary" type="button" disabled={saving} onClick={handleSave}>Salvează lucrarea</button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useProjects } from './ProjectsContext';

export function WorkOrderForm() {
  const store = useProjects();
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [crew, setCrew] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!store.workOrderFormOpen) return;
    const w = store.editingWorkOrder;
    setTitle(w ? w.title : '');
    setLocation(w ? (w.location || '') : '');
    setCrew(w ? (w.crew || '') : '');
    setStart(w ? w.scheduled_date : (store.workOrderFormDefaultDate || ''));
    setEnd(w ? (w.scheduled_end_date || '') : '');
    setDescription(w ? (w.description || '') : '');
  }, [store.workOrderFormOpen, store.editingWorkOrder, store.workOrderFormDefaultDate]);

  if (!store.workOrderFormOpen) return null;

  const handleSave = async () => {
    const titleVal = title.trim();
    if (!titleVal || !start) { alert('Completați lucrarea și data programată.'); return; }
    if (end && end < start) { alert('Data de sfârșit nu poate fi înaintea datei de început.'); return; }
    setSaving(true);
    await store.saveWorkOrder({ title: titleVal, location: location.trim() || null, crew: crew.trim() || null, scheduled_date: start, scheduled_end_date: end || null, description: description.trim() || null }, store.editingWorkOrder?.id || null);
    setSaving(false);
  };

  return (
    <div className="project-form" style={{ display: 'block' }}>
      <div className="pf-grid">
        <div className="ctrl-field"><label>Lucrare</label><input type="text" placeholder="ex: Asfaltare Str. Gh. Doja" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="ctrl-field"><label>Loc / adresă</label><input type="text" placeholder="ex: Str. Gh. Doja, Târgu-Mureș" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div className="ctrl-field"><label>Echipă / responsabil</label><input type="text" placeholder="ex: Echipa 2 - Ionel Ghiurchi" value={crew} onChange={(e) => setCrew(e.target.value)} /></div>
        <div className="ctrl-field"><label>Data programată</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="ctrl-field"><label>Până la (opțional)</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div className="ctrl-field" style={{ gridColumn: '1/-1' }}><label>Descriere</label><input type="text" placeholder="Detalii despre lucrare" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
      <div className="pf-actions">
        <button className="btn" type="button" onClick={store.closeWorkOrderForm}>Anulează</button>
        <button className="btn btn-primary" type="button" disabled={saving} onClick={handleSave}>Salvează programarea</button>
      </div>
    </div>
  );
}

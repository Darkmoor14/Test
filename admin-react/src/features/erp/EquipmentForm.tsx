import { useEffect, useState } from 'react';
import { useErp } from './ErpContext';
import { ERP_ITEM_FORM_TITLE } from './erpUtils';
import type { NonVehicleCategory } from './types';

export function EquipmentForm() {
  const store = useErp();
  const [name, setName] = useState('');
  const [erpCategory, setErpCategory] = useState<NonVehicleCategory>('echipament');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [reorderThreshold, setReorderThreshold] = useState('');
  const [serial, setSerial] = useState('');
  const [location, setLocation] = useState('');
  const [assigned, setAssigned] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [originalQuantity, setOriginalQuantity] = useState<number | null>(null);

  useEffect(() => {
    if (!store.formOpen) return;
    const eq = store.editingItem;
    setOriginalQuantity(eq && eq.quantity != null ? Number(eq.quantity) : null);
    setName(eq ? eq.name : '');
    setErpCategory(eq ? (eq.erp_category as NonVehicleCategory) : store.presetCategory);
    setCategory(eq ? (eq.category || '') : '');
    setQuantity(eq ? String(eq.quantity ?? 1) : '1');
    setUnit(eq ? (eq.unit || '') : '');
    setReorderThreshold(eq && eq.reorder_threshold != null ? String(eq.reorder_threshold) : '');
    setSerial(eq ? (eq.serial_number || '') : '');
    setLocation(eq ? (eq.location || '') : '');
    setAssigned(eq ? (eq.assigned_to || '') : '');
    setNotes(eq ? (eq.notes || '') : '');
  }, [store.formOpen, store.editingItem, store.presetCategory]);

  if (!store.formOpen) return null;

  const isStockTracked = erpCategory === 'material' || erpCategory === 'produs';

  const handleSave = async () => {
    const nameVal = name.trim();
    if (!nameVal) { alert('Completați denumirea echipamentului sau materialului.'); return; }
    setSaving(true);
    await store.saveItem(
      { name: nameVal, erp_category: erpCategory, category, quantity, unit, reorder_threshold: reorderThreshold, serial_number: serial, location, assigned_to: assigned, notes },
      store.editingItem?.id || null,
      originalQuantity,
    );
    setSaving(false);
  };

  return (
    <div id="erpItemFormSheet" className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={store.closeForm} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="erpItemFormSheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div><h3 id="erpItemFormSheetTitle">{(store.editingItem ? 'Editează ' : 'Adaugă ') + ERP_ITEM_FORM_TITLE[erpCategory]}</h3></div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={store.closeForm}>×</button>
          </div>
          <div className="pf-grid">
            <div className="ctrl-field">
              <label>Denumire</label>
              <input type="text" placeholder="ex: Buldoexcavator JCB 3CX" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="ctrl-field">
              <label>Categorie</label>
              <select value={erpCategory} onChange={(e) => setErpCategory(e.target.value as NonVehicleCategory)}>
                <option value="echipament">Echipament (se rezervă pe perioadă)</option>
                <option value="material">Material (consumabil — se scade din stoc)</option>
                <option value="produs">Produs (produs finit — se scade din stoc)</option>
              </select>
            </div>
            <div className="ctrl-field">
              <label>Subcategorie</label>
              <input type="text" placeholder="ex: Utilaj greu / Material electric" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            {isStockTracked && (
              <div className="ctrl-field">
                <label>Cantitate</label>
                <input type="number" min={0} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            )}
            {isStockTracked && (
              <div className="ctrl-field">
                <label>Unitate</label>
                <input type="text" placeholder="ex: buc, kg, m" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            )}
            {isStockTracked && (
              <div className="ctrl-field">
                <label>Prag reaprovizionare</label>
                <input type="number" min={0} step={1} placeholder="ex: 50 (opțional)" value={reorderThreshold} onChange={(e) => setReorderThreshold(e.target.value)} />
              </div>
            )}
            <div className="ctrl-field">
              <label>Nr. serie / inventar</label>
              <input type="text" placeholder="ex: SN-4471" value={serial} onChange={(e) => setSerial(e.target.value)} />
            </div>
            <div className="ctrl-field">
              <label>Locație curentă</label>
              <input type="text" placeholder="ex: Depozit central / Șantier Str. X" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="ctrl-field">
              <label>Alocat la</label>
              <input type="text" placeholder="ex: Echipa 2 / Ionel Ghiurchi" value={assigned} onChange={(e) => setAssigned(e.target.value)} />
            </div>
            <div className="ctrl-field" style={{ gridColumn: '1/-1' }}>
              <label>Notițe</label>
              <input type="text" placeholder="Detalii suplimentare" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="sheet-actions">
            <button className="btn" type="button" onClick={store.closeForm}>Anulează</button>
            <button className="btn btn-primary" type="button" disabled={saving} onClick={handleSave}>Salvează</button>
          </div>
        </div>
      </div>
    </div>
  );
}

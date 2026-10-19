import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { createLogEntityActivity } from '../shared/entityLogClient';
import type { EquipmentItem, NonVehicleCategory, ResourceAssignment } from './types';
import { EQUIPMENT_STATUS_CYCLE } from './erpUtils';

declare global {
  interface Window {
    showToast?: (message: string) => void;
  }
}
function showToast(message: string) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

export interface EquipmentFormValues {
  name: string;
  erp_category: NonVehicleCategory;
  category: string;
  quantity: string;
  unit: string;
  reorder_threshold: string;
  serial_number: string;
  location: string;
  assigned_to: string;
  notes: string;
}

export function useErpStore(sessionEmail: string | null) {
  const supabase = useSupabase();
  const logEntityActivity = useMemo(() => createLogEntityActivity(supabase, () => sessionEmail), [supabase, sessionEmail]);

  const logStockLedger = useCallback(async (itemId: string, itemName: string, changeQty: number, resultingQty: number, reason: string) => {
    try {
      await supabase.from('stock_ledger').insert({ item_id: itemId, item_name: itemName, change_qty: changeQty, resulting_qty: resultingQty, reason, user_email: sessionEmail || null });
    } catch {
      // best effort -- never block the stock change it's describing
    }
  }, [supabase, sessionEmail]);

  // equipment_inventory holds all 4 categories in one table -- React
  // fetches the whole thing (needed for ERP Home's counts across all 4,
  // and the low-stock/expired-doc alert banner), but only CRUDs the 3
  // non-vehicle categories; Parc Auto (masina) stays vanilla/deferred
  // and manages its own separate fetch of the same table.
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(true);
  const [resourceAssignments, setResourceAssignments] = useState<ResourceAssignment[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EquipmentItem | null>(null);
  const [presetCategory, setPresetCategory] = useState<NonVehicleCategory>('echipament');

  const reloadEquipment = useCallback(async () => {
    const [eqResult, assignResult] = await Promise.all([
      supabase.from('equipment_inventory').select('*').order('name', { ascending: true }),
      supabase.from('lps_resource_assignments').select('*'),
    ]);
    if (eqResult.error) { console.error(eqResult.error); setEquipmentLoading(false); return; }
    setEquipment((eqResult.data as EquipmentItem[]) || []);
    setResourceAssignments(assignResult.error ? [] : ((assignResult.data as ResourceAssignment[]) || []));
    setEquipmentLoading(false);
  }, [supabase]);

  useEffect(() => { if (sessionEmail) reloadEquipment(); }, [sessionEmail, reloadEquipment]);

  const itemsByCategory = useCallback((cat: NonVehicleCategory) => equipment.filter((eq) => (eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material')) === cat), [equipment]);

  const openForm = useCallback((eq: EquipmentItem | null, preset?: NonVehicleCategory) => {
    setEditingItem(eq);
    setPresetCategory(preset || (eq ? (eq.erp_category as NonVehicleCategory) : 'echipament'));
    setFormOpen(true);
  }, []);
  const closeForm = useCallback(() => setFormOpen(false), []);

  const saveItem = useCallback(async (values: EquipmentFormValues, id: string | null, originalQuantity: number | null) => {
    const isStockTracked = values.erp_category === 'material' || values.erp_category === 'produs';
    const item_type = isStockTracked ? 'material' : 'echipament';
    const quantity = parseFloat(values.quantity) || 0;
    const reorder_threshold = isStockTracked && values.reorder_threshold !== '' ? parseFloat(values.reorder_threshold) : null;
    const payload = {
      name: values.name, quantity, item_type, erp_category: values.erp_category,
      category: values.category.trim() || null,
      unit: values.unit.trim() || null,
      reorder_threshold,
      serial_number: values.serial_number.trim() || null,
      location: values.location.trim() || null,
      assigned_to: values.assigned_to.trim() || null,
      notes: values.notes.trim() || null,
    };
    if (id) {
      const { error } = await supabase.from('equipment_inventory').update(payload).eq('id', id);
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return false; }
      if (isStockTracked && originalQuantity !== null && quantity !== originalQuantity) {
        logStockLedger(id, values.name, quantity - originalQuantity, quantity, 'Editare manuală');
      }
      logEntityActivity(values.erp_category, id, `„${values.name}” a fost actualizat.`);
    } else {
      const { data, error } = await supabase.from('equipment_inventory').insert(payload).select();
      if (error) { console.error(error); alert('Eroare la salvare. Încercați din nou.'); return false; }
      const inserted = data?.[0];
      if (inserted) logEntityActivity(values.erp_category, inserted.id, `„${values.name}” a fost adăugat.`);
      if (isStockTracked && inserted) logStockLedger(inserted.id, values.name, quantity, quantity, 'Articol adăugat');
    }
    showToast(id ? 'Articolul a fost actualizat.' : 'Articolul a fost adăugat.');
    setFormOpen(false);
    await reloadEquipment();
    return true;
  }, [supabase, logEntityActivity, logStockLedger, reloadEquipment]);

  const cycleStatus = useCallback(async (eq: EquipmentItem) => {
    const erpCategory = eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material');
    const nextStatus = EQUIPMENT_STATUS_CYCLE[eq.status] || 'Disponibil';
    const { error } = await supabase.from('equipment_inventory').update({ status: nextStatus }).eq('id', eq.id);
    if (error) { console.error(error); alert('Eroare la actualizare. Încercați din nou.'); return; }
    logEntityActivity(erpCategory, eq.id, `Stare schimbată în „${nextStatus}”.`);
    await reloadEquipment();
  }, [supabase, logEntityActivity, reloadEquipment]);

  const deleteItem = useCallback(async (eq: EquipmentItem) => {
    if (!confirm(`Ștergeți definitiv „${eq.name}” din inventar?`)) return;
    const { error } = await supabase.from('equipment_inventory').delete().eq('id', eq.id);
    if (error) { console.error(error); alert('Eroare la ștergere. Încercați din nou.'); return; }
    const erpCategory = eq.erp_category || (eq.item_type === 'echipament' ? 'echipament' : 'material');
    logEntityActivity(erpCategory, eq.id, `„${eq.name}” a fost șters din inventar.`);
    await reloadEquipment();
  }, [supabase, logEntityActivity, reloadEquipment]);

  return {
    equipment, equipmentLoading, reloadEquipment, resourceAssignments, itemsByCategory,
    formOpen, editingItem, presetCategory, openForm, closeForm,
    saveItem, cycleStatus, deleteItem,
  };
}

export type ErpStore = ReturnType<typeof useErpStore>;

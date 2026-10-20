import type { EquipmentItem } from './types';

export const ERP_CATEGORY_LABEL: Record<string, string> = { echipament: 'Echipament', masina: 'Mașină', material: 'Material', produs: 'Produs' };
export const EQUIPMENT_STATUS_LABEL: Record<string, string> = { Disponibil: 'Disponibil', 'In folosinta': 'În folosință', Service: 'Service', Indisponibil: 'Indisponibil' };
export const EQUIPMENT_STATUS_CYCLE: Record<string, string> = { Disponibil: 'In folosinta', 'In folosinta': 'Service', Service: 'Disponibil', Indisponibil: 'Disponibil' };
export const ERP_ITEM_FORM_TITLE: Record<string, string> = { echipament: 'echipament', masina: 'mașină', material: 'material', produs: 'produs' };

export function isLowStock(eq: EquipmentItem): boolean {
  return (eq.erp_category === 'material' || eq.erp_category === 'produs') && eq.reorder_threshold != null && Number(eq.quantity) <= Number(eq.reorder_threshold);
}

export function formatWoDateRO(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

// Vehicle document-expiry alert logic, ported from erp.js's
// hasExpiredDocs/expiredDocNames -- small enough to keep live for the
// ERP Home alert banner even though the rest of Parc Auto (forms,
// service-due countdowns, fuel reports) stays vanilla/deferred.
const VEHICLE_DOC_FIELDS: { key: keyof EquipmentItem; label: string; camionOnly?: boolean }[] = [
  { key: 'itp_expires_on', label: 'ITP' },
  { key: 'insurance_expires_on', label: 'Asigurare' },
  { key: 'parking_ticket_expires_on', label: 'Tichete parcare' },
  { key: 'vignette_expires_on', label: 'Rovinietă' },
  { key: 'transport_license_expires_on', label: 'Licență transport', camionOnly: true },
  { key: 'tachograph_expires_on', label: 'Tahograf', camionOnly: true },
];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function expiredDocNames(eq: EquipmentItem): string[] {
  if (eq.erp_category !== 'masina') return [];
  const today = dateKey(new Date());
  return VEHICLE_DOC_FIELDS.filter((f) => {
    if (f.camionOnly && eq.category !== 'camion') return false;
    const val = eq[f.key] as string | null | undefined;
    return !!val && val < today;
  }).map((f) => f.label);
}

export function hasExpiredDocs(eq: EquipmentItem): boolean {
  return expiredDocNames(eq).length > 0;
}

// Field-level diff for the activity journal -- "X a fost actualizat"
// told you *that* something changed on save, never *what*, so every
// edit looked identical in Jurnal de activitate regardless of whether
// one typo was fixed or the whole record was rewritten.
export const EQUIPMENT_FIELD_LABELS: Record<string, string> = {
  name: 'Nume',
  category: 'Categorie',
  quantity: 'Cantitate',
  unit: 'Unitate',
  reorder_threshold: 'Prag reaprovizionare',
  serial_number: 'Serie',
  location: 'Locație',
  assigned_to: 'Alocat cui',
  notes: 'Note',
};

export function describeFieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): string {
  const changes: string[] = [];
  for (const key of Object.keys(labels)) {
    const oldVal = before[key];
    const newVal = after[key];
    const oldNorm = oldVal === null || oldVal === undefined || oldVal === '' ? '—' : String(oldVal);
    const newNorm = newVal === null || newVal === undefined || newVal === '' ? '—' : String(newVal);
    if (oldNorm !== newNorm) changes.push(`${labels[key]}: ${oldNorm} → ${newNorm}`);
  }
  return changes.join('; ');
}

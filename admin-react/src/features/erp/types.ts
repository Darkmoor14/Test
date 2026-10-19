export type ErpCategory = 'echipament' | 'masina' | 'material' | 'produs';

export interface EquipmentItem {
  id: string;
  name: string;
  item_type: string; // 'echipament' | 'material' (drives LPS reservation behavior)
  erp_category: ErpCategory;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  reorder_threshold: number | null;
  serial_number: string | null;
  location: string | null;
  assigned_to: string | null;
  notes: string | null;
  status: string; // 'Disponibil' | 'In folosinta' | 'Service' | 'Indisponibil'
  // Vehicle-only document-expiry fields -- only populated/relevant for
  // erp_category === 'masina' (Parc Auto, deferred this round). Kept
  // here only so ErpHomePanel's alert banner can read them directly
  // off the same fetched rows, without a separate vanilla bridge.
  itp_expires_on?: string | null;
  insurance_expires_on?: string | null;
  parking_ticket_expires_on?: string | null;
  vignette_expires_on?: string | null;
  transport_license_expires_on?: string | null;
  tachograph_expires_on?: string | null;
}

export interface ResourceAssignment {
  id: string;
  inventory_item_id: string;
  status: string; // 'reserved' | ...
  quantity: number | null;
  reserved_from: string | null;
  reserved_to: string | null;
}

export type NonVehicleCategory = 'echipament' | 'material' | 'produs';

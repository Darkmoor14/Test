/* Shared, feature-scoped Supabase operations for ticket and ERP workflows.
 * Keep multi-table mutations behind database RPCs so each user action is atomic.
 */
(function (root) {
  'use strict';

  const tickets = {
    markDuplicates(client, canonicalId, duplicateIds) {
      return client.from('tickets').update({ duplicate_of: canonicalId }).in('id', duplicateIds);
    },
    saveResolutionNote(client, ticketId, note) {
      return client.from('tickets').update({ resolution_note: note }).eq('id', ticketId);
    },
    archive(client, ticketIds, archivedAt) {
      return client.from('tickets').update({ archived: true, archived_at: archivedAt }).in('id', ticketIds);
    },
  };

  const erp = {
    reserveMaterial(client, { lookaheadId, inventoryId, quantity, allowOverstock }) {
      return client.rpc('reserve_lps_material', {
        p_lookahead_item_id: lookaheadId,
        p_inventory_item_id: inventoryId,
        p_quantity: quantity,
        p_allow_overstock: !!allowOverstock,
      });
    },
    deleteResource(client, assignmentId) {
      return client.rpc('delete_lps_resource_assignment', { p_assignment_id: assignmentId });
    },
    setResourceStatus(client, assignmentId, status) {
      return client.from('lps_resource_assignments').update({ status }).eq('id', assignmentId);
    },
    saveVehicle(client, payload, id) {
      return id
        ? client.from('equipment_inventory').update(payload).eq('id', id)
        : client.from('equipment_inventory').insert(payload).select();
    },
    async deleteVehicle(client, id) {
      const { data, error } = await client.from('lps_resource_assignments')
        .select('id').eq('inventory_item_id', id).limit(1);
      if (error) return { error };
      if (data && data.length) {
        return { error: new Error('Vehicle has reservation history; mark it unavailable to retain its history.'), blockedByHistory: true };
      }
      return client.from('equipment_inventory').delete().eq('id', id);
    },
  };

  root.AppDataServices = Object.freeze({ tickets: Object.freeze(tickets), erp: Object.freeze(erp) });
})(window);

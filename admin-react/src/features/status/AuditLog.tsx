import { useEffect, useMemo, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { formatLogTimeRO } from '../../lib/format';

const TICKET_ENTITY_TYPES = ['ticket'] as const;
const PROJECT_ENTITY_TYPES = ['project', 'backlog', 'lookahead'] as const;
const ERP_ENTITY_TYPES = ['echipament', 'masina', 'material', 'produs'] as const;
const ENTITY_TYPE_LABEL: Record<string, string> = {
  ticket: 'Sesizare',
  project: 'Proiect public',
  backlog: 'Avarie rețea',
  lookahead: 'LPS Look-ahead',
  echipament: 'Echipament',
  masina: 'Mașină',
  material: 'Material',
  produs: 'Produs',
};

interface EntityLogRow {
  entity_type: string;
  entity_id: string;
  created_at: string;
  text: string;
  kind: string;
  user_email: string | null;
}

export function AuditLog() {
  const supabase = useSupabase();
  const [rows, setRows] = useState<EntityLogRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: logData, error } = await supabase
        .from('entity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) { setRows([]); setLoading(false); return; }
      const entries = (logData || []) as EntityLogRow[];
      setRows(entries);

      // Resolve each referenced entity's display title -- a lightweight
      // on-demand lookup rather than depending on the whole app's other
      // pages having already loaded their own data (this pilot runs
      // standalone, outside the shared global state the rest of the app
      // still uses).
      const ticketIds = entries.filter((r) => r.entity_type === 'ticket').map((r) => r.entity_id);
      const projectIds = entries.filter((r) => r.entity_type === 'project').map((r) => r.entity_id);
      const backlogIds = entries.filter((r) => r.entity_type === 'backlog').map((r) => r.entity_id);
      const lookaheadIds = entries.filter((r) => r.entity_type === 'lookahead').map((r) => r.entity_id);
      const erpIds = entries.filter((r) => (ERP_ENTITY_TYPES as readonly string[]).includes(r.entity_type)).map((r) => r.entity_id);

      const [ticketsRes, projectsRes, backlogRes, lookaheadRes, erpRes] = await Promise.all([
        ticketIds.length ? supabase.from('tickets').select('id,ticket_number').in('id', ticketIds) : Promise.resolve({ data: [] }),
        projectIds.length ? supabase.from('current_projects').select('id,title').in('id', projectIds) : Promise.resolve({ data: [] }),
        backlogIds.length ? supabase.from('backlog_projects').select('id,title').in('id', backlogIds) : Promise.resolve({ data: [] }),
        lookaheadIds.length ? supabase.from('lps_lookahead_items').select('id,title').in('id', lookaheadIds) : Promise.resolve({ data: [] }),
        erpIds.length ? supabase.from('equipment_inventory').select('id,name').in('id', erpIds) : Promise.resolve({ data: [] }),
      ]);
      const titleMap: Record<string, string> = {};
      (ticketsRes.data || []).forEach((r: { id: string; ticket_number: string }) => { titleMap[`ticket:${r.id}`] = r.ticket_number; });
      (projectsRes.data || []).forEach((r: { id: string; title: string }) => { titleMap[`project:${r.id}`] = r.title; });
      (backlogRes.data || []).forEach((r: { id: string; title: string }) => { titleMap[`backlog:${r.id}`] = r.title; });
      (lookaheadRes.data || []).forEach((r: { id: string; title: string }) => { titleMap[`lookahead:${r.id}`] = r.title; });
      (erpRes.data || []).forEach((r: { id: string; name: string }) => {
        ERP_ENTITY_TYPES.forEach((t) => { titleMap[`${t}:${r.id}`] = r.name; });
      });
      setTitles(titleMap);
      setLoading(false);
    })();
  }, [supabase]);

  const entityTitle = (row: EntityLogRow) => {
    const key = `${row.entity_type}:${row.entity_id}`;
    if (titles[key]) return titles[key];
    if (row.entity_type === 'ticket') return 'Sesizare ștearsă';
    if (row.entity_type === 'project') return 'Proiect șters';
    if (row.entity_type === 'backlog') return 'Avarie ștearsă';
    if (row.entity_type === 'lookahead') return 'Element șters';
    if ((ERP_ENTITY_TYPES as readonly string[]).includes(row.entity_type)) return 'Element șters';
    return row.entity_type;
  };

  const filtered = useMemo(() => {
    const allRows = rows.filter((r) => (TICKET_ENTITY_TYPES as readonly string[]).includes(r.entity_type) || (PROJECT_ENTITY_TYPES as readonly string[]).includes(r.entity_type) || (ERP_ENTITY_TYPES as readonly string[]).includes(r.entity_type));
    return filter === 'all' ? allRows : allRows.filter((r) => r.entity_type === filter);
  }, [rows, filter]);

  return (
    <>
      <div className="status-panel-head">
        <div>
          <div className="home-eyebrow">Jurnal de activitate</div>
          <h2>Jurnal de activitate</h2>
        </div>
      </div>
      <div className="status-grid">
        <div className="status-card status-card-wide">
          <div className="status-card-head">
            <h4>Activitate recentă</h4>
            <div className="status-card-head-actions">
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">Toate categoriile</option>
                <option value="ticket">Sesizări</option>
                <option value="project">Proiecte publice</option>
                <option value="backlog">Avarii rețele</option>
                <option value="lookahead">LPS Look-ahead</option>
                <option value="echipament">Echipamente</option>
                <option value="masina">Parc Auto</option>
                <option value="material">Materiale</option>
                <option value="produs">Produse</option>
              </select>
            </div>
          </div>
          <p className="status-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Schimbările de stare și notițele adăugate pe sesizări, proiecte publice, avarii de rețea, elemente Look-ahead din LPS și inventarul Resurse și inventar (echipamente, mașini, materiale, produse) — toate, într-un singur fir cronologic.
          </p>
          <div className="entity-log-list" style={{ maxHeight: 560 }}>
            {loading ? (
              <p className="status-history-empty">Se încarcă…</p>
            ) : filtered.length === 0 ? (
              <p className="status-history-empty">Niciun eveniment încă.</p>
            ) : (
              filtered.map((row, i) => (
                <div key={i} className={`entity-log-item ${row.kind}`}>
                  <span className="entity-log-time">{formatLogTimeRO(row.created_at)}</span>
                  <div>
                    <div className="entity-log-text">
                      <span className="audit-log-badge">{ENTITY_TYPE_LABEL[row.entity_type] || row.entity_type}</span> <strong>{entityTitle(row)}</strong> — {row.text}
                    </div>
                    {row.user_email && <div className="entity-log-author">{row.user_email}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

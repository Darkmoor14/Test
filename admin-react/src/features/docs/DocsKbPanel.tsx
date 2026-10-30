import { useMemo, useState } from 'react';
import { useStaffRoster } from '../home/useStaffRoster';
import { useDocsStore, type DocsPage } from './useDocsStore';

function formatUpdated(page: DocsPage): string {
  const d = new Date(page.updated_at);
  const date = d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  return page.updated_by ? `Actualizat de ${page.updated_by}, ${date} ${time}` : `Actualizat ${date} ${time}`;
}

interface DraftState {
  id?: string;
  title: string;
  content: string;
}

export function DocsKbPanel({ sessionEmail }: { sessionEmail: string | null }) {
  const { isGod, modulePermission } = useStaffRoster(sessionEmail);
  const canWrite = isGod || modulePermission('docs') === 'write';
  const { pages, loading, savePage, deletePage } = useDocsStore(sessionEmail, canWrite);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null); // non-null while editing
  const [saving, setSaving] = useState(false);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
  }, [pages, query]);

  const selectedPage = selectedId ? pages.find((p) => p.id === selectedId) || null : null;
  const isNew = draft !== null && draft.id === undefined;

  const startNewPage = () => {
    setSelectedId(null);
    setDraft({ title: '', content: '' });
  };
  const startEdit = (page: DocsPage) => {
    setSelectedId(page.id);
    setDraft({ id: page.id, title: page.title, content: page.content });
  };
  const cancelEdit = () => setDraft(null);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await savePage(draft);
      setSelectedId(saved.id);
      setDraft(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Eroare la salvare. Încercați din nou.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (page: DocsPage) => {
    if (!confirm(`Ștergi pagina „${page.title}”?`)) return;
    try {
      await deletePage(page.id);
      if (selectedId === page.id) setSelectedId(null);
      if (draft?.id === page.id) setDraft(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Eroare la ștergere. Încercați din nou.');
    }
  };

  return (
    <>
      <div className="status-panel-head">
        <div>
          <div className="home-eyebrow">Bază de cunoștințe</div>
          <h2>Bază de cunoștințe</h2>
        </div>
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={startNewPage}>+ Pagină nouă</button>
        )}
      </div>

      <div className="docs-kb-body">
        <div className="docs-kb-sidebar">
          <input
            type="text"
            className="docs-kb-search"
            placeholder="Caută..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="docs-kb-list">
            {loading ? (
              <li className="docs-kb-empty">Se încarcă…</li>
            ) : filteredPages.length === 0 ? (
              <li className="docs-kb-empty">{pages.length === 0 ? 'Nicio pagină încă.' : 'Niciun rezultat.'}</li>
            ) : (
              filteredPages.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`docs-kb-list-item${selectedId === page.id && !isNew ? ' active' : ''}`}
                    onClick={() => { setSelectedId(page.id); setDraft(null); }}
                  >
                    {page.title}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="docs-kb-content">
          {draft ? (
            <div className="docs-kb-editor">
              <input
                type="text"
                className="docs-kb-title-input"
                placeholder="Titlu pagină"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                autoFocus
              />
              <textarea
                className="docs-kb-textarea"
                placeholder="Scrie aici conținutul paginii..."
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
              <div className="sheet-actions">
                <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>Anulează</button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Se salvează...' : 'Salvează'}
                </button>
              </div>
            </div>
          ) : selectedPage ? (
            <div className="docs-kb-view">
              <div className="docs-kb-view-head">
                <h3>{selectedPage.title}</h3>
                {canWrite && (
                  <div className="docs-kb-view-actions">
                    <button type="button" className="btn" onClick={() => startEdit(selectedPage)}>Editează</button>
                    <button type="button" className="btn" onClick={() => handleDelete(selectedPage)}>Șterge</button>
                  </div>
                )}
              </div>
              <p className="status-note docs-kb-meta">{formatUpdated(selectedPage)}</p>
              <div className="docs-kb-text">{selectedPage.content || <em>Pagină goală.</em>}</div>
            </div>
          ) : (
            <p className="docs-kb-empty-state">
              {pages.length === 0
                ? (canWrite ? 'Nicio pagină încă — creează prima cu „+ Pagină nouă”.' : 'Nicio pagină încă.')
                : 'Selectează o pagină din listă.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

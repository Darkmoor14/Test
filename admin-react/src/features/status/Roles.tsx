import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const STAFF_ROLE_KEYS = ['tickets', 'proiecte', 'erp', 'hr', 'god'] as const;
type RoleKey = (typeof STAFF_ROLE_KEYS)[number];
const ROLE_LABEL: Record<RoleKey, string> = { tickets: 'Sesizări', proiecte: 'Proiecte', erp: 'Resurse', hr: 'HR', god: 'God' };

function generateStaffPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function setStaffAuthPassword(email: string, password: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('staff-auth-admin', { body: { email, password } });
    if (error || !data || (data as { error?: string }).error) {
      alert(`Eroare la salvarea parolei: ${(data as { error?: string })?.error || error?.message || 'eroare necunoscută'}. Încercați din nou.`);
      return false;
    }
    return true;
  } catch {
    alert('Eroare la salvarea parolei. Verificați conexiunea și încercați din nou.');
    return false;
  }
}

export function Roles({ sessionEmail }: { sessionEmail: string | null }) {
  const [rolesByEmail, setRolesByEmail] = useState<Map<string, Set<RoleKey>>>(new Map());
  const [notifiedEmails, setNotifiedEmails] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRoles, setAddRoles] = useState<Set<RoleKey>>(new Set());
  const [addSaving, setAddSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: roleRows, error }, { data: subRows }] = await Promise.all([
      supabase.from('staff_roles').select('email,role').order('email', { ascending: true }),
      supabase.from('push_subscriptions').select('user_email'),
    ]);
    if (error) { setLoading(false); return; }
    const map = new Map<string, Set<RoleKey>>();
    (roleRows || []).forEach((r: { email: string; role: string }) => {
      if (!map.has(r.email)) map.set(r.email, new Set());
      map.get(r.email)!.add(r.role as RoleKey);
    });
    setRolesByEmail(map);
    setNotifiedEmails(new Set((subRows || []).filter((r: { user_email: string | null }) => r.user_email).map((r: { user_email: string }) => r.user_email)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleRole = async (email: string, role: RoleKey, checked: boolean) => {
    const prev = new Map(rolesByEmail);
    const roles = new Set(prev.get(email) || []);
    if (checked) roles.add(role); else roles.delete(role);
    prev.set(email, roles);
    setRolesByEmail(prev);

    const { error } = checked
      ? await supabase.from('staff_roles').insert({ email, role })
      : await supabase.from('staff_roles').delete().eq('email', email).eq('role', role);
    if (error) {
      alert('Eroare la salvare. Încercați din nou.');
      load();
    }
  };

  const removePerson = async (email: string) => {
    if (!confirm(`Elimini complet accesul pentru „${email}”?`)) return;
    const { error } = await supabase.from('staff_roles').delete().eq('email', email);
    if (error) { alert('Eroare la ștergere. Încercați din nou.'); return; }
    const next = new Map(rolesByEmail);
    next.delete(email);
    setRolesByEmail(next);
  };

  const emails = [...rolesByEmail.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <div className="admin-panel active">
      <div className="status-panel-head">
        <div>
          <div className="home-eyebrow">Stare sistem</div>
          <h2>Roluri</h2>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setAddEmail('');
            setAddPassword(generateStaffPassword());
            setAddRoles(new Set());
            setAddOpen(true);
          }}
        >
          + Adaugă persoană
        </button>
      </div>
      <div className="status-grid">
        <div className="status-card status-card-wide">
          <p className="status-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Fiecare secțiune din bara principală (Sesizări, Proiecte, Resurse, HR) are propriul rol — bifată, persoana are acces complet la secțiune și îi apare iconița pe Acasă; nebifată, secțiunea îi este complet ascunsă. O persoană poate avea orice combinație. „God” e singurul care vede și <strong>Stare sistem</strong>, și are automat acces la tot restul.
          </p>
          <div className="overview-table-wrap">
            <table className="overview-table" id="staffRolesTable">
              <colgroup>
                <col style={{ width: '22%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '18%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Sesizări</th>
                  <th>Proiecte</th>
                  <th>Resurse</th>
                  <th>HR</th>
                  <th>God</th>
                  <th>Notificări</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="no-results">Se încarcă…</td></tr>
                ) : emails.length === 0 ? (
                  <tr><td colSpan={8} className="no-results">Nimeni încă — adaugă prima persoană.</td></tr>
                ) : (
                  emails.map((email) => {
                    const roles = rolesByEmail.get(email) || new Set();
                    const isSelf = email === sessionEmail;
                    const notified = notifiedEmails.has(email);
                    return (
                      <tr key={email}>
                        <td>{email}{isSelf && <span className="backlog-tag">tu</span>}</td>
                        {(['tickets', 'proiecte', 'erp', 'hr', 'god'] as RoleKey[]).map((role) => {
                          const lockedSelf = isSelf && role === 'god';
                          return (
                            <td key={role}>
                              <input
                                type="checkbox"
                                checked={roles.has(role)}
                                disabled={lockedSelf}
                                title={lockedSelf ? 'Nu îți poți elimina propriul rol God' : undefined}
                                onChange={(e) => toggleRole(email, role, e.target.checked)}
                              />
                            </td>
                          );
                        })}
                        <td><span className={`status-pill ${notified ? 'status-pill-done' : 'status-pill-active'}`}>{notified ? 'Pornite' : 'Oprite'}</span></td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => { setResetEmail(email); setResetPassword(''); setResetOpen(true); }}
                          >
                            Parolă
                          </button>
                          {!isSelf && (
                            <button type="button" className="btn" onClick={() => removePerson(email)}>
                              Șterge
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {addOpen && (
        <div className="mobile-sheet show" aria-hidden="false">
          <div className="mobile-sheet-backdrop" onClick={() => setAddOpen(false)} />
          <div className="mobile-sheet-panel" role="dialog" aria-modal="true">
            <div className="mobile-sheet-panel-scroll">
              <div className="sheet-header">
                <div><h3>Adaugă persoană</h3></div>
                <button type="button" className="sheet-close" aria-label="Închide" onClick={() => setAddOpen(false)}>×</button>
              </div>
              <div className="ctrl-field">
                <label>Email</label>
                <input type="email" placeholder="ex: nume@insta-grup.ro" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
              </div>
              <div className="ctrl-field">
                <label>Parolă</label>
                <input type="text" placeholder="ex: parola generată sau aleasă" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} />
                <button type="button" className="btn" onClick={() => setAddPassword(generateStaffPassword())}>Generează</button>
              </div>
              <div className="ctrl-field">
                <label>Roluri</label>
                {STAFF_ROLE_KEYS.map((r) => (
                  <label key={r} className="recur-radio">
                    <input
                      type="checkbox"
                      checked={addRoles.has(r)}
                      onChange={(e) => {
                        const next = new Set(addRoles);
                        if (e.target.checked) next.add(r); else next.delete(r);
                        setAddRoles(next);
                      }}
                    />
                    {ROLE_LABEL[r]}
                  </label>
                ))}
              </div>
              <div className="sheet-actions">
                <button className="btn" type="button" onClick={() => setAddOpen(false)}>Anulează</button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={addSaving}
                  onClick={async () => {
                    const email = addEmail.trim().toLowerCase();
                    if (!email || !email.includes('@')) { alert('Introduceți un email valid.'); return; }
                    if (!addPassword || addPassword.length < 6) { alert('Introduceți o parolă de cel puțin 6 caractere (sau apăsați „Generează”).'); return; }
                    if (addRoles.size === 0) { alert('Selectați cel puțin un rol.'); return; }
                    if (rolesByEmail.has(email)) { alert('Această persoană are deja un rol — editează-i rolurile direct din tabel.'); return; }
                    setAddSaving(true);
                    const authOk = await setStaffAuthPassword(email, addPassword);
                    if (!authOk) { setAddSaving(false); return; }
                    const { error } = await supabase.from('staff_roles').insert([...addRoles].map((role) => ({ email, role })));
                    setAddSaving(false);
                    if (error) { alert('Contul a fost creat, dar rolurile nu au putut fi salvate. Încercați din nou din tabel.'); return; }
                    setAddOpen(false);
                    await load();
                  }}
                >
                  {addSaving ? 'Se salvează...' : 'Salvează'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resetOpen && (
        <div className="mobile-sheet show" aria-hidden="false">
          <div className="mobile-sheet-backdrop" onClick={() => setResetOpen(false)} />
          <div className="mobile-sheet-panel" role="dialog" aria-modal="true">
            <div className="mobile-sheet-panel-scroll">
              <div className="sheet-header">
                <div><h3>Schimbă parola — {resetEmail}</h3></div>
                <button type="button" className="sheet-close" aria-label="Închide" onClick={() => setResetOpen(false)}>×</button>
              </div>
              <div className="ctrl-field">
                <label>Parolă nouă</label>
                <input type="text" placeholder="ex: parola generată sau aleasă" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
                <button type="button" className="btn" onClick={() => setResetPassword(generateStaffPassword())}>Generează</button>
              </div>
              <div className="sheet-actions">
                <button className="btn" type="button" onClick={() => setResetOpen(false)}>Anulează</button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={resetSaving}
                  onClick={async () => {
                    if (!resetPassword || resetPassword.length < 6) { alert('Parola trebuie să aibă cel puțin 6 caractere.'); return; }
                    setResetSaving(true);
                    const ok = await setStaffAuthPassword(resetEmail, resetPassword);
                    setResetSaving(false);
                    if (!ok) return;
                    setResetOpen(false);
                  }}
                >
                  {resetSaving ? 'Se salvează...' : 'Salvează'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

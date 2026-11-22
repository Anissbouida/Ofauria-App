import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MODULE_LABELS, STORE_SCOPED_MODULES, type AppModule, type ModulePilot } from '@ofauria/shared';
import { Modal } from '../../components/ds';
import { rolesApi, usersApi } from '../../api/users.api';
import { storesApi } from '../../api/stores.api';

/**
 * Diffusion d'un module (mig 509, lot P0c) : ouvert à tous ou en PILOTE (quelques
 * rôles / utilisateurs le voient le temps de le tester), et établissements où il est
 * fermé (modules « par établissement » seulement). Le module reste actif pour la
 * société : ses données ne bougent pas.
 */
export default function RolloutDialog({ module, pilot, disabledStores, busy, onClose, onSave }: {
  module: AppModule;
  pilot: ModulePilot | null;
  disabledStores: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (change: { pilot: ModulePilot | null; disabledStores: string[] }) => void;
}) {
  const [inPilot, setInPilot] = useState(!!pilot);
  const [roles, setRoles] = useState<string[]>(pilot?.roles ?? []);
  const [users, setUsers] = useState<string[]>(pilot?.users ?? []);
  const [closed, setClosed] = useState<string[]>(disabledStores);
  const storeScoped = STORE_SCOPED_MODULES.has(module);

  const { data: roleRows = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const { data: userRows = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: stores = [] } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list, enabled: storeScoped });

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const pilotEmpty = inPilot && !roles.length && !users.length;

  const box: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' };
  const listStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, maxHeight: 180, overflowY: 'auto' };

  return (
    <Modal title={`Diffusion — ${MODULE_LABELS[module]}`} onClose={onClose} locked={busy} width={620}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={busy || pilotEmpty} aria-busy={busy || undefined}
          onClick={() => onSave({ pilot: inPilot ? { roles, users } : null, disabledStores: storeScoped ? closed : [] })}>
          Enregistrer la diffusion
        </button>
      </>}>
        <div style={{ display: 'grid', gap: 16 }}>
          <fieldset style={{ display: 'grid', gap: 6, border: 0, padding: 0, margin: 0 }}>
            <legend className="ds-field-label" style={{ marginBottom: 6 }}>Qui voit le module ?</legend>
            <label style={box}><input type="radio" checked={!inPilot} onChange={() => setInPilot(false)} /> Tous les rôles autorisés</label>
            <label style={box}><input type="radio" checked={inPilot} onChange={() => setInPilot(true)} /> Pilote : seulement les rôles et utilisateurs choisis (l'administrateur le voit toujours)</label>
          </fieldset>

          {inPilot && (
            <>
              <div style={{ display: 'grid', gap: 6 }}>
                <div className="ds-field-label">Rôles du pilote</div>
                <div style={listStyle}>
                  {roleRows.filter(r => r.is_active && r.code !== 'admin').map(r => (
                    <label key={r.code} style={box}><input type="checkbox" checked={roles.includes(r.code)} onChange={() => toggle(roles, setRoles, r.code)} /> {r.label}</label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <div className="ds-field-label">Utilisateurs du pilote</div>
                <div style={listStyle}>
                  {(userRows as { id: string; firstName: string; lastName: string; isActive?: boolean }[])
                    .filter(u => u.isActive !== false)
                    .map(u => (
                      <label key={u.id} style={box}><input type="checkbox" checked={users.includes(u.id)} onChange={() => toggle(users, setUsers, u.id)} /> {u.firstName} {u.lastName}</label>
                    ))}
                </div>
              </div>
              {pilotEmpty && <p className="ds-field-hint" role="alert" style={{ margin: 0, color: 'var(--ds-danger)', fontWeight: 600 }}>Choisissez au moins un rôle ou un utilisateur.</p>}
            </>
          )}

          {storeScoped ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="ds-field-label">Dans quels établissements ?</div>
              <p className="ds-field-hint" style={{ margin: 0 }}>Décochez un établissement pour y fermer le module (le labo produit, la boutique non). Ses données restent intactes.</p>
              <div style={listStyle}>
                {(stores as { id: string; name: string }[]).map(st => (
                  <label key={st.id} style={box}><input type="checkbox" checked={!closed.includes(st.id)} onChange={() => toggle(closed, setClosed, st.id)} /> {st.name}</label>
                ))}
              </div>
            </div>
          ) : (
            <p className="ds-field-hint" style={{ margin: 0 }}>Ce module est central : il s'applique à toute la société, pas établissement par établissement.</p>
          )}
        </div>

    </Modal>
  );
}
